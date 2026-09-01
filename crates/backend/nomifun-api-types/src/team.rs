//! Contracts for Team Agent composer persistence (GeekClaw #72).
//!
//! Mirrors the owner-scoped SSH host-book DTOs: a `CreateTeamRequest` carries
//! the composer result (name, workflow template, and 2..=5 expert persona
//! keys); the service writes both `teams` and the normalized `team_members`
//! roster and answers with a fully-hydrated `TeamResponse`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// One row of a team's roster.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TeamMemberResponse {
    pub team_member_id: String,
    pub team_id: String,
    /// Persona key from the UI's EXPERT_PERSONAS (e.g. "ceo").
    pub member_key: String,
    /// "lead" | "member".
    #[serde(default)]
    pub role: String,
    pub created_at: i64,
}

/// A persisted team plus its hydrated roster.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TeamResponse {
    pub team_id: String,
    pub owner_user_id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Selected workflow template key (see ui WORKFLOW_TEMPLATES).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow_template: Option<String>,
    /// Expert persona keys (mirrors the Phase 1 selectedExperts set).
    #[serde(default)]
    pub expert_keys: Vec<String>,
    /// Lifecycle: "draft" | "active" | "archived".
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default)]
    pub members: Vec<TeamMemberResponse>,
    pub created_at: i64,
    pub updated_at: i64,
}

fn default_status() -> String {
    "draft".to_string()
}

/// Create a team. `expert_keys` must carry at least one expert persona key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTeamRequest {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub workflow_template: Option<String>,
    #[serde(default)]
    pub expert_keys: Vec<String>,
    /// Defaults to "draft" when omitted.
    #[serde(default)]
    pub status: Option<String>,
}

/// Partial team update. `None` fields are left unchanged; `Some(None)` on the
/// `Option<Option<_>>` fields clears the stored value; `Some(Some(v))` sets it.
/// `expert_keys` wrapped in `Some` replaces the entire roster.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateTeamRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<Option<String>>,
    #[serde(default)]
    pub workflow_template: Option<Option<String>>,
    #[serde(default)]
    pub expert_keys: Option<Vec<String>>,
    #[serde(default)]
    pub status: Option<String>,
}

/// A per-member system-prompt + optional display-name override sent from the
/// UI. Replaces the built-in `PERSONAS` lookup for that `member_key` during a
/// consensus run — this is what powers user-defined experts (departments /
/// positions / experts) and the custom chairman directive.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MemberPromptOverride {
    /// Full system prompt for this member (overrides the built-in persona).
    pub prompt: String,
    /// Optional display name; when present it overrides the `PERSONAS` name in
    /// the deliberation prompt so custom experts show a proper title.
    #[serde(default)]
    pub name: Option<String>,
}

/// #73 consensus engine request: kick off a multi-round deliberation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartConsensusRequest {
  pub topic: String,
  /// Override the loop length (defaults to the run's 6).
  #[serde(default)]
  pub max_rounds: Option<i64>,
  /// Optional explicit provider/model; omitted resolves the user's default.
  #[serde(default)]
  pub provider_id: Option<String>,
  #[serde(default)]
  pub model: Option<String>,
  /// Optional custom chairman/synthesizer system prompt. When set, it
  /// overrides the built-in SYNTHESIZER persona for this run (lets the user
  /// tailor the "董事长决策指令" style).
  #[serde(default)]
  pub chairman_prompt: Option<String>,
  /// Optional per-member system-prompt + name overrides keyed by member_key.
  /// A key present here replaces the built-in persona lookup — this is how
  /// user-defined experts (departments/positions/experts) join a consensus.
  #[serde(default)]
  pub member_prompts: Option<HashMap<String, MemberPromptOverride>>,
}

/// One turn in a consensus run (a member's perspective or the synthesizer's
/// round summary).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsensusMessageResponse {
    pub message_id: String,
    pub run_id: String,
    pub team_id: String,
    pub round: i64,
    /// Persona key of the speaker (or "_synthesizer").
    pub speaker_member_key: String,
    /// "member" | "synthesis" | "system".
    pub role: String,
    pub content: String,
    pub created_at: i64,
}

/// Snapshot of a consensus run's lifecycle state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsensusRunResponse {
    pub run_id: String,
    pub team_id: String,
    /// idle | running | consensus_reached | max_rounds | cancelled | error
    pub status: String,
    pub current_round: i64,
    pub max_rounds: i64,
    pub topic: String,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    /// Final synthesizer output / error message once terminated.
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub started_at: Option<i64>,
    #[serde(default)]
    pub finished_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Pollable state for the frontend consensus board: the latest run plus all of
/// its messages (ordered by insertion).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ConsensusStateResponse {
    #[serde(default)]
    pub run: Option<ConsensusRunResponse>,
    #[serde(default)]
    pub messages: Vec<ConsensusMessageResponse>,
}
