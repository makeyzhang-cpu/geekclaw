//! #73 team consensus engine.
//!
//! A consensus run is a multi-round deliberation loop: each member persona of a
//! team takes a turn via the stateless one-shot LLM turn primitive
//! (`nomifun_ai_agent::run_one_shot_turn`), then a synthesizer persona produces
//! a per-round summary and a convergence verdict. The loop runs in the
//! background (spawned tokio task) so the HTTP request returns immediately; the
//! frontend polls `get_consensus` to render progress. This is the "永续循环"
//! — it keeps cycling rounds until the synthesizer reports `CONSENSUS_REACHED`
//! or `max_rounds` is hit.

use std::collections::HashMap;
use std::sync::Arc;

use nomifun_api_types::{
    ConsensusMessageResponse, ConsensusRunResponse, ConsensusStateResponse,
    MemberPromptOverride, StartConsensusRequest,
};
use nomifun_common::{generate_id, now_ms, AppError, ProviderWithModel};
use nomifun_db::{
    CreateMessageParams, CreateRunParams, ConsensusRunRow, ITeamConsensusRepository,
    ITeamRepository, TeamRow,
};

use crate::persona_defs::{persona, DEFAULT_PERSONA_PROMPT, SYNTHESIZER};

/// Errors surfaced by the consensus service.
#[derive(Debug, thiserror::Error)]
pub enum ConsensusServiceError {
    #[error("team not found")]
    NotFound,
    #[error("invalid request: {0}")]
    BadRequest(String),
    #[error("a consensus run is already in progress for this team")]
    Conflict,
    #[error("internal error: {0}")]
    Internal(String),
}

/// Clears a run's cancellation flag when the deliberation loop exits.
///
/// `cancel()` inserts into the flag map but nothing ever removed entries, so a
/// long-lived process accumulated one map entry per run — a slow leak that only
/// grew with usage. Doing it in `Drop` covers every early `return` in the loop
/// (cancelled / provider error / consensus reached) and a panic unwinding,
/// without threading a cleanup call through each branch.
struct CancelFlagGuard {
    flags: Arc<tokio::sync::Mutex<HashMap<String, bool>>>,
    run_id: String,
}

impl Drop for CancelFlagGuard {
    fn drop(&mut self) {
        // Drop cannot await. `try_lock` is the only option here; on the rare
        // contended case the flag survives, which is harmless — a later
        // `cancel()` simply re-inserts it and the next run clears it again.
        if let Ok(mut guard) = self.flags.try_lock() {
            guard.remove(&self.run_id);
        }
    }
}

/// Team consensus engine. Holds the repository + one-shot LLM deps; cheap to
/// clone internally (all fields are `Arc` or `Clone`).
#[derive(Clone)]
pub struct TeamConsensusService {
    team_repo: Arc<dyn ITeamRepository>,
    consensus_repo: Arc<dyn ITeamConsensusRepository>,
    one_shot: nomifun_ai_agent::OneShotDeps,
    cancel_flags: Arc<tokio::sync::Mutex<HashMap<String, bool>>>,
}

impl TeamConsensusService {
    pub fn new(
        team_repo: Arc<dyn ITeamRepository>,
        consensus_repo: Arc<dyn ITeamConsensusRepository>,
        one_shot: nomifun_ai_agent::OneShotDeps,
    ) -> Self {
        Self {
            team_repo,
            consensus_repo,
            one_shot,
            cancel_flags: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        }
    }

    /// Kick off a consensus run for `team_id`, owned by `user_id`. Returns the
    /// freshly-created run snapshot; the deliberation itself runs in the
    /// background.
    pub async fn start(
        self: Arc<Self>,
        user_id: &str,
        team_id: &str,
        req: StartConsensusRequest,
    ) -> Result<ConsensusRunResponse, ConsensusServiceError> {
        validate_team_id(team_id)?;
        if req.topic.trim().is_empty() {
            return Err(ConsensusServiceError::BadRequest("topic is required".into()));
        }
        let max_rounds = req
            .max_rounds
            .filter(|v| *v >= 1 && *v <= 20)
            .unwrap_or(6);

        let team: TeamRow = self
            .team_repo
            .find(user_id, team_id)
            .await
            .map_err(map_err)?
            .ok_or(ConsensusServiceError::NotFound)?;

        // Only one live run at a time.
        if self
            .consensus_repo
            .find_active_run(team_id)
            .await
            .map_err(map_err)?
            .is_some()
        {
            return Err(ConsensusServiceError::Conflict);
        }

        // Resolve provider/model (explicit override or user default).
        let provider = match (req.provider_id.clone(), req.model.clone()) {
            (Some(pid), Some(m)) => ProviderWithModel {
                provider_id: pid,
                model: m,
                use_model: None,
            },
            _ => self.resolve_default_provider().await?,
        };

        let run_id = generate_id();
        let now = now_ms();
        let run = self
            .consensus_repo
            .create_run(CreateRunParams {
                run_id: &run_id,
                team_id,
                owner_user_id: user_id,
                max_rounds,
                topic: &req.topic,
                now,
            })
            .await
            .map_err(map_err)?;

        self.consensus_repo
            .mark_running(&run_id, &provider.provider_id, &provider.model, now)
            .await
            .map_err(map_err)?;

        // Roster order (lead first) drives speaking order.
        let members = self
            .team_repo
            .list_members(team_id)
            .await
            .map_err(map_err)?;
        let member_keys: Vec<String> = members.iter().map(|m| m.member_key.clone()).collect();

        // Spawn the perpetual loop; it owns its own Arc<Self>.
        let svc = Arc::clone(&self);
        let run_id_owned = run_id.clone();
        let team_id_owned = team_id.to_string();
        let topic_owned = req.topic.clone();
        let provider_owned = provider.clone();
        let chairman_owned = req.chairman_prompt.clone();
        let member_prompts_owned = req.member_prompts.clone();
        tokio::spawn(async move {
            svc.run_loop(
                &run_id_owned,
                &team_id_owned,
                &topic_owned,
                max_rounds,
                &provider_owned,
                &member_keys,
                chairman_owned,
                member_prompts_owned,
            )
            .await;
        });

        // Return the run snapshot (still "running" now).
        let _ = team;
        Ok(run_response(&run))
    }

    /// Pollable state: latest run for the team + all its messages.
    pub async fn get_state(
        &self,
        user_id: &str,
        team_id: &str,
    ) -> Result<ConsensusStateResponse, ConsensusServiceError> {
        validate_team_id(team_id)?;
        // Ownership check.
        self.team_repo
            .find(user_id, team_id)
            .await
            .map_err(map_err)?
            .ok_or(ConsensusServiceError::NotFound)?;

        // Prefer the active run so the board always shows the live deliberation
        // when one exists; fall back to the most recent terminal run for history.
        let state = match self
            .consensus_repo
            .find_active_run(team_id)
            .await
            .map_err(map_err)?
            .or(self
                .consensus_repo
                .find_latest_run(team_id)
                .await
                .map_err(map_err)?)
        {
            Some(run) => {
                let messages = self
                    .consensus_repo
                    .list_messages(&run.run_id)
                    .await
                    .map_err(map_err)?
                    .into_iter()
                    .map(message_response)
                    .collect();
                ConsensusStateResponse {
                    run: Some(run_response(&run)),
                    messages,
                }
            }
            None => ConsensusStateResponse::default(),
        };
        Ok(state)
    }

    /// Cancel a running consensus run, if any.
    /// Mark every run still persisted as "running" as terminal. This is called
    /// once at process startup: any background tokio tasks from a previous
    /// process died with it, so these rows are zombies.
    pub async fn startup_cleanup(&self) -> Result<(), ConsensusServiceError> {
        tracing::info!("team consensus startup cleanup invoked");
        let runs = self
            .consensus_repo
            .list_running_runs()
            .await
            .map_err(map_err)?;
        tracing::info!(running_count = runs.len(), "team consensus startup cleanup scanned");
        if runs.is_empty() {
            return Ok(());
        }
        let now = now_ms();
        for run in &runs {
            tracing::info!(run_id = %run.run_id, team_id = %run.team_id, "orphaned consensus run cleaned up at startup");
            self.consensus_repo
                .finish_run(
                    &run.run_id,
                    "error",
                    Some("Application restarted before the consensus run completed."),
                    now,
                )
                .await
                .map_err(map_err)?;
        }
        Ok(())
    }

    pub async fn cancel(
        &self,
        user_id: &str,
        team_id: &str,
    ) -> Result<(), ConsensusServiceError> {
        validate_team_id(team_id)?;
        let run = self
            .team_repo
            .find(user_id, team_id)
            .await
            .map_err(map_err)?
            .ok_or(ConsensusServiceError::NotFound)?;
        let _ = run;
        let active = self
            .consensus_repo
            .find_active_run(team_id)
            .await
            .map_err(map_err)?
            .ok_or(ConsensusServiceError::BadRequest(
                "no running consensus to cancel".into(),
            ))?;
        // Signal the background loop.
        self.cancel_flags
            .lock()
            .await
            .insert(active.run_id.clone(), true);
        self.consensus_repo
            .finish_run(&active.run_id, "cancelled", None, now_ms())
            .await
            .map_err(map_err)?;
        Ok(())
    }

    /// History: every consensus run for a team, newest first.
    pub async fn list_runs(
        &self,
        user_id: &str,
        team_id: &str,
    ) -> Result<Vec<ConsensusRunResponse>, ConsensusServiceError> {
        validate_team_id(team_id)?;
        self.team_repo
            .find(user_id, team_id)
            .await
            .map_err(map_err)?
            .ok_or(ConsensusServiceError::NotFound)?;
        let runs = self
            .consensus_repo
            .list_runs(team_id)
            .await
            .map_err(map_err)?;
        Ok(runs.into_iter().map(|row| run_response(&row)).collect())
    }

    /// History detail: a specific run plus all its messages.
    pub async fn get_run_detail(
        &self,
        user_id: &str,
        team_id: &str,
        run_id: &str,
    ) -> Result<ConsensusStateResponse, ConsensusServiceError> {
        validate_team_id(team_id)?;
        self.team_repo
            .find(user_id, team_id)
            .await
            .map_err(map_err)?
            .ok_or(ConsensusServiceError::NotFound)?;
        let run = self
            .consensus_repo
            .get_run(run_id)
            .await
            .map_err(map_err)?
            .ok_or(ConsensusServiceError::NotFound)?;
        if run.team_id != team_id {
            return Err(ConsensusServiceError::NotFound);
        }
        let messages = self
            .consensus_repo
            .list_messages(run_id)
            .await
            .map_err(map_err)?
            .into_iter()
            .map(message_response)
            .collect();
        Ok(ConsensusStateResponse {
            run: Some(run_response(&run)),
            messages,
        })
    }

    /// Resolve the user's default provider + first enabled model.
    async fn resolve_default_provider(&self) -> Result<ProviderWithModel, ConsensusServiceError> {
        let providers = self
            .one_shot
            .provider_repo
            .list()
            .await
            .map_err(|e| ConsensusServiceError::Internal(e.to_string()))?;
        let provider = providers
            .into_iter()
            .filter(|p| p.enabled)
            .min_by_key(|p| p.sort_order)
            .ok_or_else(|| {
                ConsensusServiceError::BadRequest("no enabled provider is configured".into())
            })?;
        let models = self
            .one_shot
            .provider_model_repo
            .list_for_provider(&provider.provider_id)
            .await
            .map_err(|e| ConsensusServiceError::Internal(e.to_string()))?;
        let model = models
            .into_iter()
            .filter(|m| m.enabled)
            .map(|m| m.model)
            .next()
            .ok_or_else(|| {
                ConsensusServiceError::BadRequest(format!(
                    "provider '{}' has no enabled model",
                    provider.provider_id
                ))
            })?;
        Ok(ProviderWithModel {
            provider_id: provider.provider_id,
            model,
            use_model: None,
        })
    }

    async fn is_cancelled(&self, run_id: &str) -> bool {
        self.cancel_flags
            .lock()
            .await
            .get(run_id)
            .copied()
            .unwrap_or(false)
    }

    /// The background deliberation loop.
    async fn run_loop(
        self: Arc<Self>,
        run_id: &str,
        team_id: &str,
        topic: &str,
        max_rounds: i64,
        provider: &ProviderWithModel,
        member_keys: &[String],
        chairman_prompt: Option<String>,
        member_prompts: Option<HashMap<String, MemberPromptOverride>>,
    ) {
        // Every exit path — cancelled, provider error, consensus reached, max
        // rounds exhausted, or a panic unwinding — clears this run's flag.
        let _cancel_guard = CancelFlagGuard {
            flags: Arc::clone(&self.cancel_flags),
            run_id: run_id.to_owned(),
        };
        let mut history: Vec<(String, String)> = Vec::new();

        for round in 1..=max_rounds {
            if self.is_cancelled(run_id).await {
                let _ = self
                    .consensus_repo
                    .finish_run(run_id, "cancelled", None, now_ms())
                    .await;
                return;
            }

            let discussion = render_history(&history);
            let mut round_text = String::new();

            for mk in member_keys {
                let def = persona(mk);
                let override_for_mk = member_prompts.as_ref().and_then(|m| m.get(mk));
                let name = override_for_mk
                    .and_then(|o| o.name.clone())
                    .or_else(|| def.map(|d| d.name.to_string()))
                    .unwrap_or_else(|| mk.clone());
                let system = override_for_mk
                    .map(|o| o.prompt.clone())
                    .unwrap_or_else(|| {
                        def.map(|d| d.system_prompt.to_string())
                            .unwrap_or_else(|| DEFAULT_PERSONA_PROMPT.to_string())
                    });
                let user_text = format!(
                    "Topic under discussion: {topic}\n\n\
                     This is round {round} of {max_rounds}. You are the {name} on the team. \
                     Below is the discussion so far:\n\n{discussion}\n\n\
                     Provide your perspective, analysis, or concrete proposal on the topic. \
                     Be concise and specific."
                );
                // History is deliberately NOT forwarded as chat messages. The
                // accumulated discussion is already rendered into `user_text`
                // (see `discussion` above), so passing it again as turns would
                // both double the prompt and build an illegal message sequence:
                // every speaker was pushed as "assistant", producing N
                // consecutive assistant turns that Anthropic-style APIs reject
                // with a 400. One system + one user message is valid everywhere.
                let content = match nomifun_ai_agent::run_one_shot_turn(
                    &self.one_shot,
                    nomifun_ai_agent::OneShotTurnRequest {
                        provider: provider.clone(),
                        system_prompt: system,
                        history: Vec::new(),
                        user_text,
                        tools: vec![],
                        timeout_secs: 120,
                    },
                )
                .await
                {
                    Ok(c) => c,
                    Err(e) => {
                        let _ = self
                            .consensus_repo
                            .finish_run(
                                run_id,
                                "error",
                                Some(&format!("LLM error in round {round} ({name}): {e}")),
                                now_ms(),
                            )
                            .await;
                        return;
                    }
                };
                let _ = self
                    .consensus_repo
                    .append_message(CreateMessageParams {
                        message_id: &generate_id(),
                        run_id,
                        team_id,
                        round,
                        speaker_member_key: mk,
                        role: "member",
                        content: &content,
                        created_at: now_ms(),
                    })
                    .await;
                round_text.push_str(&format!("[{name}] {content}\n\n"));
                history.push(("assistant".to_string(), format!("({name}): {content}")));
            }

            // Synthesis / convergence assessment.
            let synth_text = format!(
                "Topic: {topic}\n\nHere is round {round}'s full discussion:\n\n{round_text}\n\n\
                 As the synthesizer, produce: (1) a one-paragraph summary of where the team \
                 agrees, (2) any remaining disagreements, and (3) end with exactly one line \
                 that is either 'CONSENSUS_REACHED' or 'NEEDS_MORE_ROUNDS'."
            );
            let synth = match nomifun_ai_agent::run_one_shot_turn(
                &self.one_shot,
                nomifun_ai_agent::OneShotTurnRequest {
                    provider: provider.clone(),
                    system_prompt: chairman_prompt
                        .clone()
                        .unwrap_or_else(|| SYNTHESIZER.system_prompt.to_string()),
                    // Same reasoning as the member turns: `round_text` already
                    // carries this round's discussion, so the history would be
                    // duplicated content tacked on as a block of assistant
                    // turns. The chairman judges the round from `synth_text`.
                    history: Vec::new(),
                    user_text: synth_text,
                    tools: vec![],
                    timeout_secs: 120,
                },
            )
            .await
            {
                Ok(c) => c,
                Err(e) => {
                    let _ = self
                        .consensus_repo
                        .finish_run(
                            run_id,
                            "error",
                            Some(&format!("LLM error during synthesis (round {round}): {e}")),
                            now_ms(),
                        )
                        .await;
                    return;
                }
            };
            let _ = self
                .consensus_repo
                .append_message(CreateMessageParams {
                    message_id: &generate_id(),
                    run_id,
                    team_id,
                    round,
                    speaker_member_key: SYNTHESIZER.key,
                    role: "synthesis",
                    content: &synth,
                    created_at: now_ms(),
                })
                .await;
            let _ = self.consensus_repo.set_round(run_id, round).await;
            history.push(("assistant".to_string(), format!("(Synthesizer): {synth}")));

            if synth.contains("CONSENSUS_REACHED") {
                let _ = self
                    .consensus_repo
                    .finish_run(run_id, "consensus_reached", Some(&synth), now_ms())
                    .await;
                return;
            }
        }

        let _ = self
            .consensus_repo
            .finish_run(
                run_id,
                "max_rounds",
                Some("Reached the maximum number of rounds without an explicit consensus."),
                now_ms(),
            )
            .await;
    }
}

fn render_history(history: &[(String, String)]) -> String {
    history
        .iter()
        .map(|(_, text)| text.clone())
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn run_response(row: &ConsensusRunRow) -> ConsensusRunResponse {
    ConsensusRunResponse {
        run_id: row.run_id.clone(),
        team_id: row.team_id.clone(),
        status: row.status.clone(),
        current_round: row.current_round,
        max_rounds: row.max_rounds,
        topic: row.topic.clone(),
        provider_id: row.provider_id.clone(),
        model: row.model.clone(),
        summary: row.summary.clone(),
        started_at: row.started_at,
        finished_at: row.finished_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn message_response(row: nomifun_db::ConsensusMessageRow) -> ConsensusMessageResponse {
    ConsensusMessageResponse {
        message_id: row.message_id,
        run_id: row.run_id,
        team_id: row.team_id,
        round: row.round,
        speaker_member_key: row.speaker_member_key,
        role: row.role,
        content: row.content,
        created_at: row.created_at,
    }
}

fn validate_team_id(value: &str) -> Result<(), ConsensusServiceError> {
    nomifun_common::validate_uuidv7(value)
        .map(|_| ())
        .map_err(|e| ConsensusServiceError::BadRequest(format!("invalid team_id: {e}")))
}

fn map_err(e: nomifun_db::DbError) -> ConsensusServiceError {
    match e {
        nomifun_db::DbError::NotFound(_) => ConsensusServiceError::NotFound,
        other => ConsensusServiceError::Internal(other.to_string()),
    }
}

/// Map a consensus service error to the API error envelope.
pub fn into_app_error(e: ConsensusServiceError) -> AppError {
    match e {
        ConsensusServiceError::NotFound => AppError::NotFound("team".into()),
        ConsensusServiceError::BadRequest(m) => AppError::BadRequest(m),
        ConsensusServiceError::Conflict => AppError::Conflict("consensus already running".into()),
        ConsensusServiceError::Internal(m) => AppError::Internal(m),
    }
}
