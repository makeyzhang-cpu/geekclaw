use nomifun_common::TimestampMs;
use serde::{Deserialize, Serialize};

/// Row mapping for the `teams` table — a Team Agent composer result owned by
/// one user: a named team, a selected workflow template, and a roster of expert
/// persona keys (denormalized into `expert_keys` for single-row reads; the
/// normalized `team_members` table is the source of truth for the roster).
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct TeamRow {
    pub id: i64,
    pub team_id: String,
    pub owner_user_id: String,
    pub name: String,
    pub description: Option<String>,
    pub workflow_template: Option<String>,
    /// JSON array of expert persona keys, e.g. `["ceo","cto","munger"]`.
    pub expert_keys: String,
    /// Lifecycle: "draft" | "active" | "archived".
    pub status: String,
    pub created_at: TimestampMs,
    pub updated_at: TimestampMs,
}

/// Row mapping for the `team_members` table — one row per expert in a team's
/// roster. `member_key` is a persona key from the UI's EXPERT_PERSONAS; `#73`
/// will add an optional `agent_id` binding here once concrete agents are
/// resolved.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct TeamMemberRow {
    pub id: i64,
    pub team_member_id: String,
    pub team_id: String,
    pub member_key: String,
    /// "lead" | "member". The first selected expert is the lead.
    pub role: String,
    pub created_at: TimestampMs,
}
