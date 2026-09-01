//! Collaborative co-agent ("协同共答") HTTP endpoint.
//!
//! `POST /api/co-agent/run`
//!
//! Request body carries the [`CoAgentConfig`] (so the frontend owns the
//! toggle UI and no DB migration is needed for v1), the current `message`,
//! and recent `history`. The handler applies the gradient switch
//! (`should_run`): when the automatic gate is off for this message it returns
//! `Ok(None)` (no collaborator block) without spending any tokens. Otherwise
//! it runs the co-agent against the system-configured provider/key and returns
//! the signed [`CoAgentResult`].
//!
//! This is fully additive — the main conversation turn is never touched.

use std::path::PathBuf;
use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use axum::routing::post;
use axum::Router;
use nomifun_api_types::ApiResponse;
use nomifun_auth::CurrentUser;
use nomifun_common::AppError;
use nomifun_db::{IProviderModelRepository, IProviderRepository};
use serde::Deserialize;

use crate::co_agent::{
    CoAgentConfig, CoAgentLlm, CoAgentOrchestrator, CoAgentResult, SystemProviderCoAgent,
};

/// Router state for the co-agent endpoint. Carries exactly what
/// [`SystemProviderCoAgent`] needs to resolve the system provider/key.
#[derive(Clone)]
pub struct CoAgentRouterState {
    pub provider_repo: Arc<dyn IProviderRepository>,
    pub provider_model_repo: Arc<dyn IProviderModelRepository>,
    pub encryption_key: [u8; 32],
    pub data_dir: PathBuf,
}

/// Request body for `POST /api/co-agent/run`.
#[derive(Debug, Deserialize)]
pub struct RunCoAgentRequest {
    pub config: CoAgentConfig,
    pub message: String,
    #[serde(default)]
    pub history: Vec<String>,
}

pub fn co_agent_routes(state: CoAgentRouterState) -> Router {
    Router::new()
        .route("/api/co-agent/run", post(run_co_agent))
        .with_state(state)
}

async fn run_co_agent(
    State(state): State<CoAgentRouterState>,
    axum::extract::Extension(_user): axum::extract::Extension<CurrentUser>,
    Json(req): Json<RunCoAgentRequest>,
) -> Result<Json<ApiResponse<Option<CoAgentResult>>>, AppError> {
    // Gradient switch: never spend tokens when the gate is closed for this
    // message. The caller (frontend) still controls the mode via `config`.
    if !req.config.mode.should_run(&req.message, &req.config.keywords) {
        return Ok(Json(ApiResponse::ok(None)));
    }

    let runner: Arc<dyn CoAgentLlm> = Arc::new(SystemProviderCoAgent {
        provider_repo: state.provider_repo,
        provider_model_repo: state.provider_model_repo,
        encryption_key: state.encryption_key,
        workspace: state.data_dir,
        provider_id: req.config.provider_id.clone(),
        model: req.config.model.clone(),
    });
    let orch = CoAgentOrchestrator::new(runner, req.config);

    let result = orch.run(&req.message, &req.history).await?;

    Ok(Json(ApiResponse::ok(Some(result))))
}
