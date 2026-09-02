//! Cloud-managed expert digital-twin catalog.
//!
//! The admin configures the expert marketplace (内置专家 + 自定义专家) in the
//! central web backend. Experts carry the four capabilities that get injected
//! into a hired Companion: 专属记忆 (`memory_seed`), 专属知识库
//! (`knowledge_markdown`), 自主进化 · 定时学习 (`learn_enabled`), 自主进化 ·
//! 技能进化 (`evolve_enabled`) — plus the existing 专属技能 (`default_skills`).
//!
//! This module serves both host modes of the single `nomifun-app` binary:
//! - **Web (cloud) backend**: admin CRUD (`/api/admin/experts`) + member read
//!   (`/api/store/experts`).
//! - **Desktop (local) backend**: `POST /api/experts/sync` pulls the enabled
//!   catalog from the cloud and upserts it into the local `expert_catalog`
//!   table as read-only `source = 'cloud'` rows (idempotent by `slug`).

use std::sync::Arc;

use axum::extract::{Extension, Json, Path, State};
use serde::{Deserialize, Serialize};

use nomifun_api_types::ApiResponse;
use nomifun_common::AppError;
use nomifun_db::{IExpertRepository, UpsertExpertParams, models::ExpertRow};

use crate::middleware::CurrentUser;
use crate::routes::{AuthRouterState, KV_CLOUD_AUTH_TOKEN, cloud_store_base, ensure_admin};

fn db_err(e: impl std::fmt::Display) -> AppError {
    AppError::Internal(format!("数据库错误: {e}"))
}

fn json_err(e: impl std::fmt::Display) -> AppError {
    AppError::Internal(format!("JSON 序列化错误: {e}"))
}

fn default_true() -> bool {
    true
}

fn default_persona_preset() -> String {
    "lively".to_owned()
}

fn default_character() -> String {
    "mochi".to_owned()
}

/// Admin request body for create/update of an expert.
#[derive(Debug, Deserialize)]
pub struct AdminExpertRequest {
    pub name: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub avatar: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub price_credits: i64,
    #[serde(default)]
    pub persona_custom: String,
    #[serde(default = "default_persona_preset")]
    pub persona_preset: String,
    #[serde(default = "default_character")]
    pub default_character: String,
    #[serde(default)]
    pub default_model_provider: Option<String>,
    #[serde(default)]
    pub default_model: Option<String>,
    #[serde(default)]
    pub default_skills: Vec<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub sort_order: Option<i64>,
    /// 专属记忆：初始记忆种子。
    #[serde(default)]
    pub memory_seed: String,
    /// 专属知识库：初始知识文档（Markdown）。
    #[serde(default)]
    pub knowledge_markdown: String,
    /// 自主进化 · 定时学习开关。
    #[serde(default = "default_true")]
    pub learn_enabled: bool,
    /// 自主进化 · 技能进化开关。
    #[serde(default = "default_true")]
    pub evolve_enabled: bool,
}

/// Full view of one expert, shared by admin list, member read, and desktop sync.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExpertView {
    pub expert_id: String,
    pub slug: String,
    pub name: String,
    pub title: String,
    pub description: Option<String>,
    pub avatar: Option<String>,
    pub tags: Vec<String>,
    pub category: Option<String>,
    pub price_credits: i64,
    pub persona_custom: String,
    pub persona_preset: String,
    pub default_character: String,
    pub default_model_provider: Option<String>,
    pub default_model: Option<String>,
    pub default_skills: Vec<String>,
    pub is_builtin: bool,
    pub creator_id: Option<String>,
    pub enabled: bool,
    pub sort_order: i64,
    pub created_at: i64,
    pub memory_seed: String,
    pub knowledge_markdown: String,
    pub learn_enabled: bool,
    pub evolve_enabled: bool,
    pub source: String,
}

/// Result reported by the desktop sync endpoint.
#[derive(Debug, Serialize)]
pub struct ExpertSyncResult {
    /// Number of cloud experts upserted into the local catalog.
    pub synced: u64,
    /// Number of stale local cloud experts pruned (removed server-side).
    pub pruned: u64,
    /// Total cloud-sourced expert rows now present locally.
    pub total_local: u64,
}

fn parse_json_string_array(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw)
        .unwrap_or_default()
        .into_iter()
        .filter(|s| !s.trim().is_empty())
        .collect()
}

/// Service backing the expert catalog handlers.
pub struct ExpertCatalogService {
    pub expert_repo: Arc<dyn IExpertRepository>,
}

impl ExpertCatalogService {
    pub fn from_state(state: &AuthRouterState) -> Self {
        Self {
            expert_repo: state.expert_repo.clone(),
        }
    }

    fn row_to_view(row: ExpertRow) -> ExpertView {
        ExpertView {
            expert_id: row.expert_id,
            slug: row.slug,
            name: row.name,
            title: row.title,
            description: row.description,
            avatar: row.avatar,
            tags: parse_json_string_array(&row.tags),
            category: row.category,
            price_credits: row.price_credits,
            persona_custom: row.persona_custom,
            persona_preset: row.persona_preset,
            default_character: row.default_character,
            default_model_provider: row.default_model_provider,
            default_model: row.default_model,
            default_skills: parse_json_string_array(&row.default_skills),
            is_builtin: row.is_builtin,
            creator_id: row.creator_id,
            enabled: row.enabled,
            sort_order: row.sort_order,
            created_at: row.created_at,
            memory_seed: row.memory_seed,
            knowledge_markdown: row.knowledge_markdown,
            learn_enabled: row.learn_enabled,
            evolve_enabled: row.evolve_enabled,
            source: row.source,
        }
    }

    fn validate(req: &AdminExpertRequest) -> Result<(), AppError> {
        if req.name.trim().is_empty() {
            return Err(AppError::BadRequest("专家名称不能为空".into()));
        }
        if req.title.trim().is_empty() {
            return Err(AppError::BadRequest("专家头衔不能为空".into()));
        }
        let _ = serde_json::to_string(&req.tags).map_err(json_err)?;
        let _ = serde_json::to_string(&req.default_skills).map_err(json_err)?;
        Ok(())
    }

    fn req_to_params(&self, req: &AdminExpertRequest, is_builtin: bool, creator_id: Option<String>) -> Result<UpsertExpertParams, AppError> {
        Ok(UpsertExpertParams {
            expert_id: String::new(),
            slug: String::new(),
            name: req.name.trim().to_owned(),
            title: req.title.trim().to_owned(),
            description: req.description.clone(),
            avatar: req.avatar.clone(),
            tags: serde_json::to_string(&req.tags).map_err(json_err)?,
            category: req.category.clone(),
            price_credits: req.price_credits.max(0),
            persona_custom: req.persona_custom.clone(),
            persona_preset: req.persona_preset.clone(),
            default_character: req.default_character.clone(),
            default_model_provider: req.default_model_provider.clone(),
            default_model: req.default_model.clone(),
            default_skills: serde_json::to_string(&req.default_skills).map_err(json_err)?,
            is_builtin,
            creator_id,
            enabled: req.enabled,
            sort_order: req.sort_order,
            memory_seed: req.memory_seed.clone(),
            knowledge_markdown: req.knowledge_markdown.clone(),
            learn_enabled: req.learn_enabled,
            evolve_enabled: req.evolve_enabled,
        })
    }

    fn view_to_params(view: &ExpertView) -> Result<UpsertExpertParams, AppError> {
        Ok(UpsertExpertParams {
            expert_id: view.expert_id.clone(),
            slug: view.slug.clone(),
            name: view.name.clone(),
            title: view.title.clone(),
            description: view.description.clone().unwrap_or_default(),
            avatar: view.avatar.clone(),
            tags: serde_json::to_string(&view.tags).map_err(json_err)?,
            category: view.category.clone(),
            price_credits: view.price_credits,
            persona_custom: view.persona_custom.clone(),
            persona_preset: view.persona_preset.clone(),
            default_character: view.default_character.clone(),
            default_model_provider: view.default_model_provider.clone(),
            default_model: view.default_model.clone(),
            default_skills: serde_json::to_string(&view.default_skills).map_err(json_err)?,
            is_builtin: view.is_builtin,
            creator_id: view.creator_id.clone(),
            enabled: view.enabled,
            sort_order: Some(view.sort_order),
            memory_seed: view.memory_seed.clone(),
            knowledge_markdown: view.knowledge_markdown.clone(),
            learn_enabled: view.learn_enabled,
            evolve_enabled: view.evolve_enabled,
        })
    }

    pub async fn admin_list(&self) -> Result<Vec<ExpertView>, AppError> {
        let rows = self.expert_repo.list_all().await.map_err(db_err)?;
        Ok(rows.into_iter().map(Self::row_to_view).collect())
    }

    /// Create a custom expert (admin). `slug` is auto-generated from the name.
    pub async fn admin_create(&self, req: AdminExpertRequest, creator_id: Option<String>) -> Result<ExpertView, AppError> {
        Self::validate(&req)?;
        let params = self.req_to_params(&req, false, creator_id)?;
        let row = self.expert_repo.upsert(params).await.map_err(db_err)?;
        Ok(Self::row_to_view(row))
    }

    /// Update an expert by `slug` or `expert_id` (admin). Preserves `is_builtin`.
    pub async fn admin_update(&self, id_or_slug: &str, req: AdminExpertRequest, creator_id: Option<String>) -> Result<ExpertView, AppError> {
        Self::validate(&req)?;
        let existing = self.expert_repo.get_by_id_or_slug(id_or_slug).await.map_err(db_err)?
            .ok_or_else(|| AppError::NotFound(format!("专家 '{id_or_slug}' 不存在")))?;
        let mut params = self.req_to_params(&req, existing.is_builtin, creator_id)?;
        params.expert_id = existing.expert_id;
        params.slug = existing.slug;
        let row = self.expert_repo.upsert(params).await.map_err(db_err)?;
        Ok(Self::row_to_view(row))
    }

    pub async fn admin_delete(&self, id_or_slug: &str) -> Result<(), AppError> {
        self.expert_repo.delete_by_id_or_slug(id_or_slug).await.map_err(db_err)
    }

    /// Enabled experts for member read / desktop sync.
    pub async fn member_list_enabled(&self) -> Result<Vec<ExpertView>, AppError> {
        let rows = self.expert_repo.list_enabled().await.map_err(db_err)?;
        Ok(rows.into_iter().map(Self::row_to_view).collect())
    }

    /// Upsert a batch of synced experts into the local catalog as `source='cloud'`.
    pub async fn sync_to_local(&self, items: Vec<ExpertView>) -> Result<ExpertSyncResult, AppError> {
        let mut keep_slugs: Vec<String> = Vec::with_capacity(items.len());
        let mut synced = 0u64;
        for item in &items {
            let params = Self::view_to_params(item)?;
            self.expert_repo.upsert_cloud(params).await.map_err(db_err)?;
            keep_slugs.push(item.slug.clone());
            synced += 1;
        }
        let pruned = self.expert_repo.delete_cloud_not_in(&keep_slugs).await.map_err(db_err)?;
        let total_local = self
            .expert_repo
            .list_all()
            .await
            .map_err(db_err)?
            .into_iter()
            .filter(|e| e.source == "cloud")
            .count() as u64;
        Ok(ExpertSyncResult { synced, pruned, total_local })
    }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/admin/experts — list all experts (admin).
pub async fn list_admin_experts_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
) -> Result<Json<ApiResponse<Vec<ExpertView>>>, AppError> {
    ensure_admin(&current_user)?;
    let svc = ExpertCatalogService::from_state(&state);
    let data = svc.admin_list().await?;
    Ok(Json(ApiResponse::ok(data)))
}

/// POST /api/admin/experts — create a custom expert (admin).
pub async fn create_admin_expert_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
    Json(req): Json<AdminExpertRequest>,
) -> Result<Json<ApiResponse<ExpertView>>, AppError> {
    ensure_admin(&current_user)?;
    let svc = ExpertCatalogService::from_state(&state);
    let creator_id = Some(current_user.id.as_str().to_owned());
    let data = svc.admin_create(req, creator_id).await?;
    Ok(Json(ApiResponse::with_message(data, "专家已创建")))
}

/// PUT /api/admin/experts/{id} — update an expert by slug or expert_id (admin).
pub async fn update_admin_expert_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(id_or_slug): Path<String>,
    Json(req): Json<AdminExpertRequest>,
) -> Result<Json<ApiResponse<ExpertView>>, AppError> {
    ensure_admin(&current_user)?;
    let svc = ExpertCatalogService::from_state(&state);
    let creator_id = Some(current_user.id.as_str().to_owned());
    let data = svc.admin_update(&id_or_slug, req, creator_id).await?;
    Ok(Json(ApiResponse::with_message(data, "专家已更新")))
}

/// DELETE /api/admin/experts/{id} — delete an expert (admin).
pub async fn delete_admin_expert_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(id_or_slug): Path<String>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    ensure_admin(&current_user)?;
    let svc = ExpertCatalogService::from_state(&state);
    svc.admin_delete(&id_or_slug).await?;
    Ok(Json(ApiResponse::message("专家已删除")))
}

/// GET /api/store/experts — member read-only list of enabled experts. Consumed
/// by the desktop sync flow (and available to the member web surface).
pub async fn list_public_experts_handler(
    State(state): State<AuthRouterState>,
    Extension(_current_user): Extension<CurrentUser>,
) -> Result<Json<ApiResponse<Vec<ExpertView>>>, AppError> {
    let svc = ExpertCatalogService::from_state(&state);
    let data = svc.member_list_enabled().await?;
    Ok(Json(ApiResponse::ok(data)))
}

/// POST /api/experts/sync — desktop shell only. Pulls enabled experts from the
/// cloud using the stored cloud JWT and upserts them into the local
/// `expert_catalog` table as `source = 'cloud'`.
pub async fn sync_experts_handler(
    State(state): State<AuthRouterState>,
) -> Result<Json<ApiResponse<ExpertSyncResult>>, AppError> {
    let token = state
        .user_repo
        .get_kv(KV_CLOUD_AUTH_TOKEN)
        .await
        .ok()
        .flatten()
        .filter(|t| !t.is_empty())
        .ok_or_else(|| AppError::Unauthorized("未登录云端账号，无法同步专家市场".into()))?;

    let url = format!("{}/api/store/experts", cloud_store_base().trim_end_matches('/'));
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {token}"))
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| AppError::BadGateway(format!("拉取云端专家失败: {e}")))?;
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| AppError::Internal(format!("读取云端专家响应失败: {e}")))?;
    if !status.is_success() {
        return Err(AppError::BadGateway(format!("云端专家接口返回 {status}: {body}")));
    }
    let cloud: ApiResponse<Vec<ExpertView>> = serde_json::from_str(&body)
        .map_err(|e| AppError::Internal(format!("解析云端专家失败: {e}")))?;
    let items = cloud.data.unwrap_or_default();

    let svc = ExpertCatalogService::from_state(&state);
    let result = svc.sync_to_local(items).await?;
    Ok(Json(ApiResponse::with_message(result, "专家市场已同步到本地")))
}
