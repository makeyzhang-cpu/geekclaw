use async_trait::async_trait;
use sqlx::SqlitePool;

use crate::error::DbError;
use crate::models::{ConsensusMessageRow, ConsensusRunRow};
use crate::repository::team_consensus::{
    CreateMessageParams, CreateRunParams, ITeamConsensusRepository,
};
use nomifun_common::TimestampMs;

#[derive(Clone)]
pub struct SqliteTeamConsensusRepository {
    pool: SqlitePool,
}

impl SqliteTeamConsensusRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ITeamConsensusRepository for SqliteTeamConsensusRepository {
    async fn create_run(&self, p: CreateRunParams<'_>) -> Result<ConsensusRunRow, DbError> {
        sqlx::query_as::<_, ConsensusRunRow>(
            "INSERT INTO team_consensus_runs
                (run_id, team_id, owner_user_id, status, current_round, max_rounds, topic, created_at, updated_at)
             VALUES (?, ?, ?, 'idle', 0, ?, ?, ?, ?)
             RETURNING *",
        )
        .bind(p.run_id)
        .bind(p.team_id)
        .bind(p.owner_user_id)
        .bind(p.max_rounds)
        .bind(p.topic)
        .bind(p.now)
        .bind(p.now)
        .fetch_one(&self.pool)
        .await
        .map_err(DbError::Query)
    }

    async fn find_active_run(&self, team_id: &str) -> Result<Option<ConsensusRunRow>, DbError> {
        sqlx::query_as::<_, ConsensusRunRow>(
            "SELECT * FROM team_consensus_runs WHERE team_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1",
        )
        .bind(team_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(DbError::Query)
    }

    async fn find_latest_run(&self, team_id: &str) -> Result<Option<ConsensusRunRow>, DbError> {
        sqlx::query_as::<_, ConsensusRunRow>(
            "SELECT * FROM team_consensus_runs WHERE team_id = ? ORDER BY created_at DESC LIMIT 1",
        )
        .bind(team_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(DbError::Query)
    }

    async fn list_running_runs(&self) -> Result<Vec<ConsensusRunRow>, DbError> {
        sqlx::query_as::<_, ConsensusRunRow>(
            "SELECT * FROM team_consensus_runs WHERE status = 'running' ORDER BY created_at ASC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(DbError::Query)
    }

    async fn get_run(&self, run_id: &str) -> Result<Option<ConsensusRunRow>, DbError> {
        sqlx::query_as::<_, ConsensusRunRow>("SELECT * FROM team_consensus_runs WHERE run_id = ?")
            .bind(run_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(DbError::Query)
    }

    async fn list_runs(&self, team_id: &str) -> Result<Vec<ConsensusRunRow>, DbError> {
        sqlx::query_as::<_, ConsensusRunRow>(
            "SELECT * FROM team_consensus_runs WHERE team_id = ? ORDER BY created_at DESC",
        )
        .bind(team_id)
        .fetch_all(&self.pool)
        .await
        .map_err(DbError::Query)
    }

    async fn mark_running(
        &self,
        run_id: &str,
        provider_id: &str,
        model: &str,
        started_at: TimestampMs,
    ) -> Result<(), DbError> {
        sqlx::query(
            "UPDATE team_consensus_runs
             SET status = 'running', provider_id = ?, model = ?, started_at = ?, updated_at = ?
             WHERE run_id = ?",
        )
        .bind(provider_id)
        .bind(model)
        .bind(started_at)
        .bind(started_at)
        .bind(run_id)
        .execute(&self.pool)
        .await
        .map_err(DbError::Query)?;
        Ok(())
    }

    async fn set_round(&self, run_id: &str, round: i64) -> Result<(), DbError> {
        sqlx::query(
            "UPDATE team_consensus_runs SET current_round = ?, updated_at = ? WHERE run_id = ?",
        )
        .bind(round)
        .bind(round)
        .bind(run_id)
        .execute(&self.pool)
        .await
        .map_err(DbError::Query)?;
        Ok(())
    }

    async fn finish_run(
        &self,
        run_id: &str,
        status: &str,
        summary: Option<&str>,
        finished_at: TimestampMs,
    ) -> Result<(), DbError> {
        sqlx::query(
            "UPDATE team_consensus_runs
             SET status = ?, summary = ?, finished_at = ?, updated_at = ?
             WHERE run_id = ?",
        )
        .bind(status)
        .bind(summary)
        .bind(finished_at)
        .bind(finished_at)
        .bind(run_id)
        .execute(&self.pool)
        .await
        .map_err(DbError::Query)?;
        Ok(())
    }

    async fn append_message(
        &self,
        p: CreateMessageParams<'_>,
    ) -> Result<ConsensusMessageRow, DbError> {
        sqlx::query_as::<_, ConsensusMessageRow>(
            "INSERT INTO team_consensus_messages
                (message_id, run_id, team_id, round, speaker_member_key, role, content, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             RETURNING *",
        )
        .bind(p.message_id)
        .bind(p.run_id)
        .bind(p.team_id)
        .bind(p.round)
        .bind(p.speaker_member_key)
        .bind(p.role)
        .bind(p.content)
        .bind(p.created_at)
        .fetch_one(&self.pool)
        .await
        .map_err(DbError::Query)
    }

    async fn list_messages(&self, run_id: &str) -> Result<Vec<ConsensusMessageRow>, DbError> {
        sqlx::query_as::<_, ConsensusMessageRow>(
            "SELECT * FROM team_consensus_messages WHERE run_id = ? ORDER BY id ASC",
        )
        .bind(run_id)
        .fetch_all(&self.pool)
        .await
        .map_err(DbError::Query)
    }
}
