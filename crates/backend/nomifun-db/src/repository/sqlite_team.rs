use serde_json::from_str as json_from_str;
use sqlx::SqlitePool;

use crate::error::DbError;
use crate::models::{TeamMemberRow, TeamRow};
use crate::repository::team::{CreateTeamParams, ITeamRepository, UpdateTeamParams};

/// SQLite-backed [`ITeamRepository`]. All team queries are owner-scoped; the
/// roster is kept in `team_members` and written in the same transaction as the
/// owning `teams` row (no physical FK in the SQLite sidecar).
#[derive(Clone, Debug)]
pub struct SqliteTeamRepository {
    pool: SqlitePool,
}

impl SqliteTeamRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait::async_trait]
impl ITeamRepository for SqliteTeamRepository {
    async fn list(&self, user_id: &str) -> Result<Vec<TeamRow>, DbError> {
        let rows = sqlx::query_as::<_, TeamRow>(
            "SELECT * FROM teams WHERE owner_user_id = ? ORDER BY updated_at DESC",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn find(&self, user_id: &str, team_id: &str) -> Result<Option<TeamRow>, DbError> {
        let row = sqlx::query_as::<_, TeamRow>(
            "SELECT * FROM teams WHERE owner_user_id = ? AND team_id = ?",
        )
        .bind(user_id)
        .bind(team_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    async fn create(
        &self,
        user_id: &str,
        params: CreateTeamParams<'_>,
    ) -> Result<TeamRow, DbError> {
        let mut tx = self.pool.begin().await?;
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO teams \
                (team_id, owner_user_id, name, description, workflow_template, \
                 expert_keys, status, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) \
             RETURNING id",
        )
        .bind(params.team_id)
        .bind(user_id)
        .bind(params.name)
        .bind(params.description)
        .bind(params.workflow_template)
        .bind(params.expert_keys)
        .bind(params.status)
        .bind(params.now)
        .bind(params.now)
        .fetch_one(&mut *tx)
        .await?;

        let members = parse_member_keys(params.expert_keys);
        for (idx, key) in members.iter().enumerate() {
            sqlx::query(
                "INSERT INTO team_members \
                    (team_member_id, team_id, member_key, role, created_at) \
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(nomifun_common::generate_id())
            .bind(params.team_id)
            .bind(key)
            .bind(if idx == 0 { "lead" } else { "member" })
            .bind(params.now)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;

        Ok(TeamRow {
            id,
            team_id: params.team_id.to_string(),
            owner_user_id: user_id.to_string(),
            name: params.name.to_string(),
            description: params.description.map(str::to_string),
            workflow_template: params.workflow_template.map(str::to_string),
            expert_keys: params.expert_keys.to_string(),
            status: params.status.to_string(),
            created_at: params.now,
            updated_at: params.now,
        })
    }

    async fn update(
        &self,
        user_id: &str,
        team_id: &str,
        params: UpdateTeamParams<'_>,
    ) -> Result<TeamRow, DbError> {
        let mut row = self
            .find(user_id, team_id)
            .await?
            .ok_or_else(|| DbError::NotFound("team".into()))?;

        if let Some(v) = params.name {
            row.name = v.to_string();
        }
        if let Some(v) = params.description {
            row.description = v.map(str::to_string);
        }
        if let Some(v) = params.workflow_template {
            row.workflow_template = v.map(str::to_string);
        }
        if let Some(v) = params.status {
            row.status = v.to_string();
        }
        if let Some(keys) = params.expert_keys {
            row.expert_keys = keys.to_string();
        }
        row.updated_at = params.now;

        let mut tx = self.pool.begin().await?;
        let affected = sqlx::query(
            "UPDATE teams SET name = ?, description = ?, workflow_template = ?, \
                expert_keys = ?, status = ?, updated_at = ? \
             WHERE owner_user_id = ? AND team_id = ?",
        )
        .bind(&row.name)
        .bind(&row.description)
        .bind(&row.workflow_template)
        .bind(&row.expert_keys)
        .bind(&row.status)
        .bind(row.updated_at)
        .bind(user_id)
        .bind(team_id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if affected == 0 {
            let _ = tx.rollback().await;
            return Err(DbError::NotFound("team".into()));
        }

        // A fresh expert_keys list replaces the entire roster.
        if params.expert_keys.is_some() {
            sqlx::query("DELETE FROM team_members WHERE team_id = ?")
                .bind(team_id)
                .execute(&mut *tx)
                .await?;
            let members = parse_member_keys(&row.expert_keys);
            for (idx, key) in members.iter().enumerate() {
                sqlx::query(
                    "INSERT INTO team_members \
                        (team_member_id, team_id, member_key, role, created_at) \
                     VALUES (?, ?, ?, ?, ?)",
                )
                .bind(nomifun_common::generate_id())
                .bind(team_id)
                .bind(key)
                .bind(if idx == 0 { "lead" } else { "member" })
                .bind(params.now)
                .execute(&mut *tx)
                .await?;
            }
        }
        tx.commit().await?;
        Ok(row)
    }

    async fn delete(&self, user_id: &str, team_id: &str) -> Result<(), DbError> {
        let mut tx = self.pool.begin().await?;
        let exists: Option<i64> = sqlx::query_scalar(
            "SELECT 1 FROM teams WHERE owner_user_id = ? AND team_id = ?",
        )
        .bind(user_id)
        .bind(team_id)
        .fetch_optional(&mut *tx)
        .await?;
        if exists.is_none() {
            let _ = tx.rollback().await;
            return Err(DbError::NotFound("team".into()));
        }
        sqlx::query("DELETE FROM team_members WHERE team_id = ?")
            .bind(team_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM teams WHERE owner_user_id = ? AND team_id = ?")
            .bind(user_id)
            .bind(team_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    async fn list_members(&self, team_id: &str) -> Result<Vec<TeamMemberRow>, DbError> {
        let rows = sqlx::query_as::<_, TeamMemberRow>(
            "SELECT * FROM team_members WHERE team_id = ? ORDER BY id ASC",
        )
        .bind(team_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }
}

/// Parse the JSON array of expert persona keys stored on `teams.expert_keys`.
/// A malformed value degrades to an empty roster rather than failing the write.
fn parse_member_keys(json: &str) -> Vec<String> {
    json_from_str::<Vec<String>>(json).unwrap_or_default()
}
