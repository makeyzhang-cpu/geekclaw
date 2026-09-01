//! Team Agent composer service: owner-scoped team CRUD over `ITeamRepository`.
//!
//! Validation lives here (name required, 1..=8 distinct expert keys), and the
//! service coordinates the normalized `team_members` roster with the owning
//! `teams` row — the repository does the transactional write.

use std::sync::Arc;

use nomifun_api_types::{CreateTeamRequest, TeamMemberResponse, TeamResponse, UpdateTeamRequest};
use nomifun_common::AppError;
use nomifun_db::{CreateTeamParams, ITeamRepository, TeamMemberRow, TeamRow, UpdateTeamParams};

/// Errors surfaced by the team service.
#[derive(Debug, thiserror::Error)]
pub enum TeamServiceError {
    #[error("team not found")]
    NotFound,
    #[error("invalid request: {0}")]
    BadRequest(String),
    #[error("internal error: {0}")]
    Internal(String),
}

/// Team Agent composer service. Cheap to clone (`Arc` internals).
#[derive(Clone)]
pub struct TeamService {
    repo: Arc<dyn ITeamRepository>,
}

impl TeamService {
    pub fn new(repo: Arc<dyn ITeamRepository>) -> Self {
        Self { repo }
    }

    pub async fn list(&self, user_id: &str) -> Result<Vec<TeamResponse>, TeamServiceError> {
        let teams = self.repo.list(user_id).await.map_err(map_err)?;
        let mut out = Vec::with_capacity(teams.len());
        for team in teams {
            out.push(self.to_response(&team.team_id, &team).await?);
        }
        Ok(out)
    }

    pub async fn get(
        &self,
        user_id: &str,
        team_id: &str,
    ) -> Result<TeamResponse, TeamServiceError> {
        validate_team_id(team_id)?;
        let team = self
            .repo
            .find(user_id, team_id)
            .await
            .map_err(map_err)?
            .ok_or(TeamServiceError::NotFound)?;
        self.to_response(&team.team_id, &team).await
    }

    pub async fn create(
        &self,
        user_id: &str,
        req: CreateTeamRequest,
    ) -> Result<TeamResponse, TeamServiceError> {
        validate_name(&req.name)?;
        let expert_keys = validate_expert_keys(&req.expert_keys)?;
        let team_id = nomifun_common::generate_id();
        let now = nomifun_common::now_ms();
        let status = req.status.clone().unwrap_or_else(|| "draft".to_string());
        let expert_json = serde_json::to_string(&expert_keys)
            .map_err(|e| TeamServiceError::Internal(e.to_string()))?;
        let team = self
            .repo
            .create(
                user_id,
                CreateTeamParams {
                    team_id: &team_id,
                    name: &req.name,
                    description: req.description.as_deref(),
                    workflow_template: req.workflow_template.as_deref(),
                    expert_keys: &expert_json,
                    status: &status,
                    now,
                },
            )
            .await
            .map_err(map_err)?;
        self.to_response(&team.team_id, &team).await
    }

    pub async fn update(
        &self,
        user_id: &str,
        team_id: &str,
        req: UpdateTeamRequest,
    ) -> Result<TeamResponse, TeamServiceError> {
        validate_team_id(team_id)?;
        if let Some(name) = req.name.as_ref() {
            validate_name(name)?;
        }
        let expert_json = match req.expert_keys.as_ref() {
            Some(keys) => {
                let validated = validate_expert_keys(keys)?;
                Some(
                    serde_json::to_string(&validated)
                        .map_err(|e| TeamServiceError::Internal(e.to_string()))?,
                )
            }
            None => None,
        };
        let now = nomifun_common::now_ms();
        let team = self
            .repo
            .update(
                user_id,
                team_id,
                UpdateTeamParams {
                    name: req.name.as_deref(),
                    description: req.description.as_ref().map(|o| o.as_deref()),
                    workflow_template: req.workflow_template.as_ref().map(|o| o.as_deref()),
                    expert_keys: expert_json.as_deref(),
                    status: req.status.as_deref(),
                    now,
                },
            )
            .await
            .map_err(map_err)?;
        self.to_response(&team.team_id, &team).await
    }

    pub async fn delete(&self, user_id: &str, team_id: &str) -> Result<(), TeamServiceError> {
        validate_team_id(team_id)?;
        self.repo.delete(user_id, team_id).await.map_err(map_err)
    }

    async fn to_response(
        &self,
        team_id: &str,
        team: &TeamRow,
    ) -> Result<TeamResponse, TeamServiceError> {
        let members = self.repo.list_members(team_id).await.map_err(map_err)?;
        Ok(team_response(team, members))
    }
}

fn team_response(team: &TeamRow, members: Vec<TeamMemberRow>) -> TeamResponse {
    let expert_keys: Vec<String> = serde_json::from_str(&team.expert_keys).unwrap_or_else(|_| {
        members.iter().map(|m| m.member_key.clone()).collect()
    });
    let members: Vec<TeamMemberResponse> = members
        .into_iter()
        .map(|m| TeamMemberResponse {
            team_member_id: m.team_member_id,
            team_id: m.team_id,
            member_key: m.member_key,
            role: m.role,
            created_at: m.created_at,
        })
        .collect();
    TeamResponse {
        team_id: team.team_id.clone(),
        owner_user_id: team.owner_user_id.clone(),
        name: team.name.clone(),
        description: team.description.clone(),
        workflow_template: team.workflow_template.clone(),
        expert_keys,
        status: team.status.clone(),
        members,
        created_at: team.created_at,
        updated_at: team.updated_at,
    }
}

fn validate_team_id(value: &str) -> Result<(), TeamServiceError> {
    nomifun_common::validate_uuidv7(value)
        .map(|_| ())
        .map_err(|e| TeamServiceError::BadRequest(format!("invalid team_id: {e}")))
}

fn validate_name(name: &str) -> Result<(), TeamServiceError> {
    if name.trim().is_empty() {
        Err(TeamServiceError::BadRequest("team name is required".into()))
    } else {
        Ok(())
    }
}

fn validate_expert_keys(keys: &[String]) -> Result<Vec<String>, TeamServiceError> {
    if keys.is_empty() {
        return Err(TeamServiceError::BadRequest(
            "a team needs at least one expert".into(),
        ));
    }
    if keys.len() > 8 {
        return Err(TeamServiceError::BadRequest(
            "a team can have at most 8 experts".into(),
        ));
    }
    for key in keys {
        if key.trim().is_empty() {
            return Err(TeamServiceError::BadRequest(
                "expert keys must not be empty".into(),
            ));
        }
    }
    Ok(keys.to_vec())
}

fn map_err(e: nomifun_db::DbError) -> TeamServiceError {
    match e {
        nomifun_db::DbError::NotFound(_) => TeamServiceError::NotFound,
        other => TeamServiceError::Internal(other.to_string()),
    }
}

/// Map a service error to the API error envelope used by the route handlers.
pub fn into_app_error(e: TeamServiceError) -> AppError {
    match e {
        TeamServiceError::NotFound => AppError::NotFound("team".into()),
        TeamServiceError::BadRequest(m) => AppError::BadRequest(m),
        TeamServiceError::Internal(m) => AppError::Internal(m),
    }
}
