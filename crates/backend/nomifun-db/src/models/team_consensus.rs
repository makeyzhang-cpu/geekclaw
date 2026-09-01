use nomifun_common::TimestampMs;
use serde::{Deserialize, Serialize};

/// Row mapping for `team_consensus_runs` — one multi-round deliberation of a
/// team. The background loop mutates `status` / `current_round` / `summary`
/// as it progresses; the frontend polls `get_consensus` to render it.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ConsensusRunRow {
    pub id: i64,
    pub run_id: String,
    pub team_id: String,
    pub owner_user_id: String,
    /// idle | running | consensus_reached | max_rounds | cancelled | error
    pub status: String,
    pub current_round: i64,
    pub max_rounds: i64,
    pub topic: String,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    /// Final synthesizer output / error message once terminated.
    pub summary: Option<String>,
    pub started_at: Option<TimestampMs>,
    pub finished_at: Option<TimestampMs>,
    pub created_at: TimestampMs,
    pub updated_at: TimestampMs,
}

/// Row mapping for `team_consensus_messages` — a single turn produced by one
/// member persona (role = "member") or the synthesizer (role = "synthesis").
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ConsensusMessageRow {
    pub id: i64,
    pub message_id: String,
    pub run_id: String,
    pub team_id: String,
    pub round: i64,
    pub speaker_member_key: String,
    pub role: String,
    pub content: String,
    pub created_at: TimestampMs,
}
