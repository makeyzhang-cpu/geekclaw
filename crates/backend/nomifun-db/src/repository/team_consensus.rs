use async_trait::async_trait;

use crate::error::DbError;
use crate::models::{ConsensusMessageRow, ConsensusRunRow};
use nomifun_common::TimestampMs;

/// Parameters for inserting a new consensus run row.
pub struct CreateRunParams<'a> {
    pub run_id: &'a str,
    pub team_id: &'a str,
    pub owner_user_id: &'a str,
    pub max_rounds: i64,
    pub topic: &'a str,
    pub now: TimestampMs,
}

/// Parameters for inserting a single consensus message row.
pub struct CreateMessageParams<'a> {
    pub message_id: &'a str,
    pub run_id: &'a str,
    pub team_id: &'a str,
    pub round: i64,
    pub speaker_member_key: &'a str,
    pub role: &'a str,
    pub content: &'a str,
    pub created_at: TimestampMs,
}

/// Persistence surface for the #73 consensus engine. All reads are scoped by
/// `team_id` (and, for runs, `owner_user_id`) at the call site; the repository
/// itself just exposes the row-level operations.
#[async_trait]
pub trait ITeamConsensusRepository: Send + Sync {
    async fn create_run(&self, params: CreateRunParams<'_>) -> Result<ConsensusRunRow, DbError>;

    /// The single non-terminal run for a team, if any (status = "running").
    async fn find_active_run(&self, team_id: &str) -> Result<Option<ConsensusRunRow>, DbError>;

    /// Most recent run for a team (terminal or not), for poll/get.
    async fn find_latest_run(&self, team_id: &str) -> Result<Option<ConsensusRunRow>, DbError>;

    /// Every run still marked running (used for startup zombie cleanup).
    async fn list_running_runs(&self) -> Result<Vec<ConsensusRunRow>, DbError>;

    async fn get_run(&self, run_id: &str) -> Result<Option<ConsensusRunRow>, DbError>;

    /// All runs for a team, newest first (history view).
    async fn list_runs(&self, team_id: &str) -> Result<Vec<ConsensusRunRow>, DbError>;

    /// Flip a freshly-created run into "running" with its resolved provider.
    async fn mark_running(
        &self,
        run_id: &str,
        provider_id: &str,
        model: &str,
        started_at: TimestampMs,
    ) -> Result<(), DbError>;

    /// Advance the persisted round counter after each full round.
    async fn set_round(&self, run_id: &str, round: i64) -> Result<(), DbError>;

    /// Terminate a run (consensus_reached | max_rounds | cancelled | error).
    async fn finish_run(
        &self,
        run_id: &str,
        status: &str,
        summary: Option<&str>,
        finished_at: TimestampMs,
    ) -> Result<(), DbError>;

    async fn append_message(
        &self,
        params: CreateMessageParams<'_>,
    ) -> Result<ConsensusMessageRow, DbError>;

    async fn list_messages(&self, run_id: &str) -> Result<Vec<ConsensusMessageRow>, DbError>;
}
