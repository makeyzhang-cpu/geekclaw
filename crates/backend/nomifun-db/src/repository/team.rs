use nomifun_common::TimestampMs;

use crate::error::DbError;
use crate::models::{TeamMemberRow, TeamRow};

/// Team Agent persistence. Every method takes `user_id` first and filters by
/// it, so a cross-owner id is indistinguishable from NotFound. The roster lives
/// in `team_members`; writes to `teams` and `team_members` are coordinated in a
/// transaction by the SQLite implementation (no physical FK in the sidecar).
#[async_trait::async_trait]
pub trait ITeamRepository: Send + Sync {
    /// All teams owned by `user_id`, most recently updated first.
    async fn list(&self, user_id: &str) -> Result<Vec<TeamRow>, DbError>;

    /// One team by id, scoped to `user_id`; `None` if absent or owned by another.
    async fn find(&self, user_id: &str, team_id: &str) -> Result<Option<TeamRow>, DbError>;

    /// Create a team owned by `user_id` plus its `expert_keys` roster; returns
    /// the inserted `teams` row (the roster is read back via [`Self::list_members`]).
    async fn create(&self, user_id: &str, params: CreateTeamParams<'_>) -> Result<TeamRow, DbError>;

    /// Update an owned team. `DbError::NotFound` if absent or not owned. A fresh
    /// `expert_keys` value replaces the entire roster.
    async fn update(
        &self,
        user_id: &str,
        team_id: &str,
        params: UpdateTeamParams<'_>,
    ) -> Result<TeamRow, DbError>;

    /// Delete an owned team and its roster. `DbError::NotFound` if absent or not owned.
    async fn delete(&self, user_id: &str, team_id: &str) -> Result<(), DbError>;

    /// The roster rows for a team (callers verify team ownership first).
    async fn list_members(&self, team_id: &str) -> Result<Vec<TeamMemberRow>, DbError>;
}

/// Parameters for creating a team. `expert_keys` is a JSON array string of
/// persona keys; the repository parses it to seed `team_members`.
#[derive(Debug, Default)]
pub struct CreateTeamParams<'a> {
    pub team_id: &'a str,
    pub name: &'a str,
    pub description: Option<&'a str>,
    pub workflow_template: Option<&'a str>,
    pub expert_keys: &'a str,
    pub status: &'a str,
    pub now: TimestampMs,
}

/// Parameters for updating a team. `None` fields are left unchanged; `expert_keys`
/// wrapped in `Some` replaces the roster (its `Option` layer signals "replace"
/// vs "leave", matching the partial-update `double_option` convention).
#[derive(Debug, Default)]
pub struct UpdateTeamParams<'a> {
    pub name: Option<&'a str>,
    pub description: Option<Option<&'a str>>,
    pub workflow_template: Option<Option<&'a str>>,
    pub expert_keys: Option<&'a str>,
    pub status: Option<&'a str>,
    pub now: TimestampMs,
}
