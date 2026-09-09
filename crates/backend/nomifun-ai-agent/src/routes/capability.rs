//! Capability-routing endpoint (P0 "建议模式").
//!
//! `POST /api/capability/route`
//!
//! Frontend sends a user message plus a flat list of currently-available
//! capabilities (skills / experts / MCP servers / plugins, each as a `{id, label,
//! type, hint}` tuple along with install candidates). The handler calls the
//! configured provider/model with `one_shot_completion_timeout` and asks the LLM
//! to return a structured JSON array of suggestions. Every returned id is
//! strictly validated against the frontend's candidate list to prevent the LLM
//! from inventing out-of-tree references (hallucination guard). Items below the
//! confidence threshold or beyond the top-K cap are dropped on the way out so
//! the router does not silently bloat the suggestion bar.
//!
//! Fully additive — no side effects on the main conversation turn. The user
//! must opt in by enabling the suggestion bar in Settings; the route stays
//! available even with the bar off so other client surfaces (workbench plugin,
//! expert-market deck) can reuse it.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::Json;
use axum::extract::State;
use axum::routing::post;
use axum::Router;
use geekclaw_types::message::{ContentBlock, Message, Role};
use nomifun_api_types::ApiResponse;
use nomifun_auth::CurrentUser;
use nomifun_common::AppError;
use nomifun_db::{IProviderModelRepository, IProviderRepository};
use serde::{Deserialize, Serialize};

use crate::factory::provider_config::{one_shot_completion_timeout, resolve_provider_config};

/// Router state for the capability-route endpoint. Mirrors
/// [`crate::routes::co_agent::CoAgentRouterState`] (same provider + key plumbing)
/// so we can swap to a different routing model without touching app-wide wiring.
#[derive(Clone)]
pub struct CapabilityRouterState {
    pub provider_repo: Arc<dyn IProviderRepository>,
    pub provider_model_repo: Arc<dyn IProviderModelRepository>,
    pub encryption_key: [u8; 32],
    pub data_dir: PathBuf,
}

/// A single capability surfaced to the router for selection.
#[derive(Debug, Clone, Deserialize)]
pub struct CapabilityCandidate {
    /// Stable identifier from the source market (`skill:<id>`, `expert:<id>`,
    /// `mcp:<id>`, `plugin:<id>`, `market_install:<id>`). The router uses it as
    /// the only key the LLM is allowed to return; ids invented by the model
    /// are dropped at validation time.
    pub id: String,
    /// Human-readable label (already localized by the frontend).
    pub label: String,
    /// Capability bucket used for both filtering and UI grouping.
    #[serde(rename = "type")]
    pub cap_type: String,
    /// One-line scenario hint fed verbatim to the LLM as the capability
    /// descriptor (e.g. "Browser automation for filling web forms"). Empty
    /// strings are tolerated and ignored by the prompt.
    #[serde(default)]
    pub hint: String,
}

/// One router-decided suggestion. Mirrors the frontend `CapabilityDecision` so
/// no second re-shape is needed in the renderer.
#[derive(Debug, Clone, Serialize)]
pub struct CapabilityDecision {
    /// Echo of [`CapabilityCandidate::cap_type`] (`skill` / `expert` / `mcp` /
    /// `plugin` / `market_install`) — included so the frontend can group
    /// suggestions without re-resolving the candidate list.
    #[serde(rename = "type")]
    pub cap_type: String,
    /// Candidate id, validated to exist in the request.
    pub id: String,
    /// Human label, copied from the candidate (frontend already localized it).
    pub label: String,
    /// 0.0–1.0; returned values are clamped into [0, 1].
    pub confidence: f32,
    /// Optional short rationale from the LLM (≤ 60 chars already enforced in
    /// the prompt); an empty string means the LLM declined to explain.
    #[serde(default)]
    pub reason: String,
}

/// Request body for `POST /api/capability/route`.
#[derive(Debug, Deserialize)]
pub struct RouteRequest {
    pub message: String,
    pub candidates: Vec<CapabilityCandidate>,

    /// Optional override (e.g. session-scoped model); when `None` we fall back
    /// to the system default — same convention the co-agent endpoint uses.
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub model: Option<String>,

    /// Hard cap on returned decisions (already enforced on the output, so the
    /// LLM does not need to obey it; we still clamp to be safe).
    #[serde(default = "default_max_suggestions")]
    pub max_suggestions: u32,
    /// Confidence floor (0–1). Anything at or below this is dropped silently.
    #[serde(default = "default_threshold")]
    pub threshold: f32,
}

const fn default_max_suggestions() -> u32 {
    3
}
const fn default_threshold() -> f32 {
    0.6
}

pub fn capability_routes(state: CapabilityRouterState) -> Router {
    Router::new()
        .route("/api/capability/route", post(handle_route))
        .with_state(state)
}

/// Bounded timeout for the routing call. We deliberately keep it smaller than
/// the 30s the chat completion uses — the suggestion bar must never feel like
/// it is gating a normal turn. Anything slower should fall back to recall-only.
const ROUTE_TIMEOUT: Duration = Duration::from_secs(8);

async fn handle_route(
    State(state): State<CapabilityRouterState>,
    axum::extract::Extension(_user): axum::extract::Extension<CurrentUser>,
    Json(req): Json<RouteRequest>,
) -> Result<Json<ApiResponse<Vec<CapabilityDecision>>>, AppError> {
    let candidates = req.candidates;
    if candidates.is_empty() || req.message.trim().is_empty() {
        return Ok(Json(ApiResponse::ok(Vec::new())));
    }

    // Drop ridiculously long messages before they hit the prompt — the LLM
    // does not need the full chat history; the recent context is already on
    // the frontend side and is what truly drives the capability decision.
    let user_msg: String = req.message.chars().take(500).collect();

    // Resolve provider/model: explicit overrides win; otherwise the system
    // default — identical fallback to the co-agent endpoint.
    let (provider_id, model) = match (req.provider_id.as_deref(), req.model.as_deref()) {
        (Some(p), Some(m)) if !p.is_empty() && !m.is_empty() => (p.to_string(), m.to_string()),
        _ => resolve_default_provider_and_model(&state).await?,
    };

    let cfg = resolve_provider_config(
        &state.provider_repo,
        &state.provider_model_repo,
        &state.encryption_key,
        &provider_id,
        &model,
        &state.data_dir,
    )
    .await?;

    let system_prompt = build_system_prompt(&candidates);
    let user_prompt = format_user_prompt(&user_msg);

    let raw = one_shot_completion_timeout(
        &cfg,
        &system_prompt,
        vec![Message::new(
            Role::User,
            vec![ContentBlock::Text { text: user_prompt }],
        )],
        512,
        ROUTE_TIMEOUT,
    )
    .await?;

    // Parse and validate.
    let decisions = parse_and_validate(&raw, &candidates, req.threshold, req.max_suggestions as usize);
    Ok(Json(ApiResponse::ok(decisions)))
}

/// Fallback to the system-default provider/model pair. Mirrors the
/// co-agent's "no override → take the next-enabled provider's first paid
/// model" rule so users get a sensible answer without configuring routing.
async fn resolve_default_provider_and_model(
    state: &CapabilityRouterState,
) -> Result<(String, String), AppError> {
    let all = state.provider_repo.list().await?;
    let mut providers: Vec<_> = all.into_iter().filter(|p| p.enabled).collect();
    providers.sort_by_key(|p| p.sort_order);
    let provider = providers
        .into_iter()
        .next()
        .ok_or_else(|| AppError::BadRequest("no enabled provider".into()))?;
    let models = state
        .provider_model_repo
        .list_for_provider(&provider.provider_id)
        .await?;
    let model = models
        .into_iter()
        .filter(|m| m.enabled)
        .min_by_key(|m| m.sort_order)
        .ok_or_else(|| {
            AppError::BadRequest(format!("no enabled model for provider {}", provider.provider_id))
        })?;
    Ok((provider.provider_id, model.model))
}

fn build_system_prompt(candidates: &[CapabilityCandidate]) -> String {
    let mut buf = String::with_capacity(512 + candidates.len() * 64);
    buf.push_str(
        "You are a capability router inside GeekClaw. Given a user message and a list of available\n\
         capabilities (skill / expert / mcp / plugin / market_install), decide which capabilities\n\
         would help the user. Return ONLY a JSON array (no prose, no markdown) of objects with the\n\
         exact fields: {\"id\": \"<candidate id>\", \"confidence\": <0.0-1.0>, \"reason\": \"<≤60 chars>\"}.\n\
         Hard rules:\n\
         - 0 to 3 items, ranked by confidence descending.\n\
         - Each `id` MUST be from the provided candidate list; never invent ids.\n\
         - Confidence ≤ 0.4 means \"not relevant\"; omit such items.\n\
         - If the message is routine and no capability helps, return [].",
    );
    buf.push_str("\n\nCandidates:\n");
    for (i, c) in candidates.iter().enumerate() {
        // Single-line compact format keeps the prompt short and avoids the
        // LLM misreading JSON-in-JSON as a fragment to copy verbatim.
        buf.push_str(&format!(
            "{}. id={} type={} label={} hint={}\n",
            i + 1,
            c.id,
            c.cap_type,
            c.label.replace('\n', " "),
            c.hint.replace('\n', " ")
        ));
    }
    buf
}

fn format_user_prompt(message: &str) -> String {
    format!("User message: \"{}\"", message)
}

/// Parse the LLM response, validate every returned id against the candidate
/// set (the only thing that makes the suggestion safe), apply threshold +
/// top-K, and return the final decision list.
fn parse_and_validate(
    raw: &str,
    candidates: &[CapabilityCandidate],
    threshold: f32,
    max_suggestions: usize,
) -> Vec<CapabilityDecision> {
    // LLM sometimes wraps the JSON in ```json fences or adds a leading
    // sentence; extract the first `[...]` block before parsing.
    let body = match extract_first_json_array(raw) {
        Some(s) => s,
        None => return Vec::new(),
    };

    let parsed: Vec<RawDecision> = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    let by_id: std::collections::HashMap<&str, &CapabilityCandidate> =
        candidates.iter().map(|c| (c.id.as_str(), c)).collect();

    let mut out: Vec<CapabilityDecision> = Vec::with_capacity(max_suggestions);
    let mut seen: HashSet<String> = HashSet::new();

    for raw in parsed.into_iter() {
        // Hallucination guard: the LLM must reference ids it was shown.
        let cand = match by_id.get(raw.id.as_str()) {
            Some(c) => c,
            None => continue,
        };
        // De-dup in case the model repeats the same id.
        if !seen.insert(cand.id.clone()) {
            continue;
        }
        // Clamp + threshold.
        let conf = raw.confidence.clamp(0.0, 1.0);
        if conf < threshold {
            continue;
        }
        let reason = raw.reason.chars().take(120).collect::<String>();
        out.push(CapabilityDecision {
            cap_type: cand.cap_type.clone(),
            id: cand.id.clone(),
            label: cand.label.clone(),
            confidence: conf,
            reason,
        });
        if out.len() >= max_suggestions {
            break;
        }
    }

    // Sort defensively — the prompt asks for ranked output but never trust the
    // model on ordering.
    out.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));
    out.truncate(max_suggestions);
    out
}

#[derive(Debug, Deserialize)]
struct RawDecision {
    id: String,
    confidence: f32,
    #[serde(default)]
    reason: String,
}

/// Locate the first balanced JSON array in `text`. Returns the slice between
/// the matching brackets (inclusive). Strips any ```json``` fences first.
fn extract_first_json_array(text: &str) -> Option<String> {
    let stripped = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    let bytes = stripped.as_bytes();
    let start = bytes.iter().position(|b| *b == b'[')?;
    let mut depth: i32 = 0;
    for (i, b) in bytes.iter().enumerate().skip(start) {
        if *b == b'[' {
            depth += 1;
        } else if *b == b']' {
            depth -= 1;
            if depth == 0 {
                return Some(stripped[start..=i].to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cand(id: &str, label: &str, cap_type: &str, hint: &str) -> CapabilityCandidate {
        CapabilityCandidate {
            id: id.to_string(),
            label: label.to_string(),
            cap_type: cap_type.to_string(),
            hint: hint.to_string(),
        }
    }

    #[test]
    fn drops_unknown_ids() {
        let cands = vec![
            cand("skill:a", "Browser", "skill", ""),
            cand("skill:b", "Sheets", "skill", ""),
        ];
        // LLM hallucinates a skill:c that was never in the candidate set.
        let raw = r#"[{"id":"skill:c","confidence":0.9,"reason":""}]"#;
        let out = parse_and_validate(raw, &cands, 0.6, 3);
        assert!(out.is_empty(), "hallucinated id must be dropped");
    }

    #[test]
    fn clamps_and_thresholds() {
        let cands = vec![
            cand("skill:a", "Browser", "skill", ""),
            cand("skill:b", "Sheets", "skill", ""),
        ];
        let raw = r#"[
            {"id":"skill:a","confidence":0.91,"reason":"auto-fill"},
            {"id":"skill:b","confidence":0.42,"reason":"weak"}
        ]"#;
        let out = parse_and_validate(raw, &cands, 0.6, 3);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "skill:a");
    }

    #[test]
    fn top_k_truncated() {
        let cands = vec![
            cand("skill:a", "A", "skill", ""),
            cand("skill:b", "B", "skill", ""),
            cand("skill:c", "C", "skill", ""),
            cand("skill:d", "D", "skill", ""),
        ];
        let raw = r#"[
            {"id":"skill:a","confidence":0.9,"reason":""},
            {"id":"skill:b","confidence":0.85,"reason":""},
            {"id":"skill:c","confidence":0.8,"reason":""},
            {"id":"skill:d","confidence":0.75,"reason":""}
        ]"#;
        let out = parse_and_validate(raw, &cands, 0.6, 2);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].id, "skill:a");
        assert_eq!(out[1].id, "skill:b");
    }

    #[test]
    fn extracts_from_fenced_response() {
        let cands = vec![cand("skill:a", "A", "skill", "")];
        let raw = "sure thing\n```json\n[{\"id\":\"skill:a\",\"confidence\":0.95,\"reason\":\"hit\"}]\n```";
        let out = parse_and_validate(raw, &cands, 0.6, 3);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "skill:a");
    }

    #[test]
    fn returns_empty_on_garbage() {
        let cands = vec![cand("skill:a", "A", "skill", "")];
        let out = parse_and_validate("not json at all", &cands, 0.6, 3);
        assert!(out.is_empty());
    }
}
