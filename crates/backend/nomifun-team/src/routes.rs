//! HTTP routes for `/api/teams`. Owner-scoped CRUD. Mounted under the
//! instance-owner guard by the app router (mirrors `ssh_host_routes`). Every
//! handler scopes to `CurrentUser.id`, so a cross-owner id is NotFound.

use axum::extract::rejection::JsonRejection;
use axum::extract::{Extension, Json, Path, State};
use axum::routing::{get, post};
use axum::Router;
use nomifun_api_types::{
    ApiResponse, ConsensusRunResponse, ConsensusStateResponse, CreateTeamRequest, StartConsensusRequest,
    TeamResponse, UpdateTeamRequest,
};
use nomifun_auth::CurrentUser;
use nomifun_common::AppError;

use crate::consensus::into_app_error as consensus_into_app_error;
use crate::service::into_app_error;
use crate::state::TeamRouterState;

pub fn team_routes(state: TeamRouterState) -> Router {
    Router::new()
        .route("/api/teams", get(list).post(create))
        .route(
            "/api/teams/{team_id}",
            get(get_one).put(update).delete(delete_one),
        )
        .route(
            "/api/teams/{team_id}/consensus",
            get(get_consensus).post(start_consensus),
        )
        .route(
            "/api/teams/{team_id}/consensus/cancel",
            post(cancel_consensus),
        )
        .route(
            "/api/teams/{team_id}/consensus/runs",
            get(list_runs),
        )
        .route(
            "/api/teams/{team_id}/consensus/runs/{run_id}",
            get(get_run_detail),
        )
        .with_state(state)
}

async fn list(
    State(state): State<TeamRouterState>,
    Extension(user): Extension<CurrentUser>,
) -> Result<Json<ApiResponse<Vec<TeamResponse>>>, AppError> {
    let items = state.service.list(user.id.as_str()).await.map_err(into_app_error)?;
    Ok(Json(ApiResponse::ok(items)))
}

async fn get_one(
    State(state): State<TeamRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(team_id): Path<String>,
) -> Result<Json<ApiResponse<TeamResponse>>, AppError> {
    let item = state
        .service
        .get(user.id.as_str(), &team_id)
        .await
        .map_err(into_app_error)?;
    Ok(Json(ApiResponse::ok(item)))
}

async fn create(
    State(state): State<TeamRouterState>,
    Extension(user): Extension<CurrentUser>,
    body: Result<Json<CreateTeamRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<TeamResponse>>, AppError> {
    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;
    let item = state
        .service
        .create(user.id.as_str(), req)
        .await
        .map_err(into_app_error)?;
    Ok(Json(ApiResponse::ok(item)))
}

async fn update(
    State(state): State<TeamRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(team_id): Path<String>,
    body: Result<Json<UpdateTeamRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<TeamResponse>>, AppError> {
    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;
    let item = state
        .service
        .update(user.id.as_str(), &team_id, req)
        .await
        .map_err(into_app_error)?;
    Ok(Json(ApiResponse::ok(item)))
}

async fn delete_one(
    State(state): State<TeamRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(team_id): Path<String>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    state
        .service
        .delete(user.id.as_str(), &team_id)
        .await
        .map_err(into_app_error)?;
    Ok(Json(ApiResponse::success()))
}

// ----- #73 consensus engine routes -----

async fn start_consensus(
    State(state): State<TeamRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(team_id): Path<String>,
    body: Result<Json<StartConsensusRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<ConsensusRunResponse>>, AppError> {
    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;
    let run = state
        .consensus
        .clone()
        .start(user.id.as_str(), &team_id, req)
        .await
        .map_err(consensus_into_app_error)?;
    Ok(Json(ApiResponse::ok(run)))
}

async fn get_consensus(
    State(state): State<TeamRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(team_id): Path<String>,
) -> Result<Json<ApiResponse<ConsensusStateResponse>>, AppError> {
    let state_resp = state
        .consensus
        .get_state(user.id.as_str(), &team_id)
        .await
        .map_err(consensus_into_app_error)?;
    Ok(Json(ApiResponse::ok(state_resp)))
}

async fn cancel_consensus(
    State(state): State<TeamRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(team_id): Path<String>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    state
        .consensus
        .cancel(user.id.as_str(), &team_id)
        .await
        .map_err(consensus_into_app_error)?;
    Ok(Json(ApiResponse::success()))
}

async fn list_runs(
    State(state): State<TeamRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(team_id): Path<String>,
) -> Result<Json<ApiResponse<Vec<ConsensusRunResponse>>>, AppError> {
    let runs = state
        .consensus
        .list_runs(user.id.as_str(), &team_id)
        .await
        .map_err(consensus_into_app_error)?;
    Ok(Json(ApiResponse::ok(runs)))
}

async fn get_run_detail(
    State(state): State<TeamRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path((team_id, run_id)): Path<(String, String)>,
) -> Result<Json<ApiResponse<ConsensusStateResponse>>, AppError> {
    let detail = state
        .consensus
        .get_run_detail(user.id.as_str(), &team_id, &run_id)
        .await
        .map_err(consensus_into_app_error)?;
    Ok(Json(ApiResponse::ok(detail)))
}
