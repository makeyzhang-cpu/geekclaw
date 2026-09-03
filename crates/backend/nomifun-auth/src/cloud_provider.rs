//! Cloud-managed model provider catalog.
//!
//! The admin configures provider credentials (e.g. the `GeekClawAI` dashscope
//! endpoint) in the central web backend. Those rows live in
//! `cloud_provider_catalog`, with the API key encrypted at rest using the
//! cloud's data-encryption key. Members read the *public* subset (with the key
//! decrypted to plaintext over the authenticated TLS channel) and the desktop
//! backend re-encrypts each key with the local machine key, landing it in the
//! local `providers` table as a read-only `source = 'cloud'` row.
//!
//! This module serves both host modes of the single `nomifun-app` binary:
//! - **Web (cloud) backend**: admin CRUD + member read (`/api/store/cloud-providers`).
//! - **Desktop (local) backend**: `POST /api/cloud-providers/sync` pulls from the
//!   cloud and upserts into the local `providers` table.

use std::sync::Arc;

use axum::extract::{Extension, Json, Path, State};
use serde::{Deserialize, Serialize};

use nomifun_api_types::ApiResponse;
use nomifun_common::{decrypt_string, encrypt_string, AppError};
use nomifun_db::{
    ICloudProviderRepository, IProviderRepository,
    UpsertCloudProviderLocalParams, UpsertCloudProviderParams,
    models::CloudProviderRow,
};

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

/// Admin request body for create/update of a cloud-managed provider.
#[derive(Debug, Deserialize)]
pub struct AdminCloudProviderRequest {
    /// Stable, unique key used for idempotent upsert (e.g. `geekclawai`).
    pub provider_key: String,
    pub name: String,
    pub platform: String,
    pub base_url: String,
    /// Plaintext API key as entered by the admin. Encrypted at rest with the
    /// cloud data-encryption key before persisting.
    pub api_key: String,
    #[serde(default = "default_true")]
    pub is_public: bool,
    #[serde(default)]
    pub is_full_url: bool,
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(default)]
    pub sort_order: Option<i64>,
}

/// Admin view: returns the plaintext key (the admin owns the credential).
#[derive(Debug, Serialize)]
pub struct CloudProviderAdminView {
    pub provider_key: String,
    pub name: String,
    pub platform: String,
    pub base_url: String,
    pub api_key: String,
    pub is_public: bool,
    pub is_full_url: bool,
    pub models: Vec<String>,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Member view: rows eligible for sync. `api_key` is the *decrypted* plaintext
/// so the desktop backend can re-encrypt it with the local key on sync.
#[derive(Debug, Serialize, Deserialize)]
pub struct CloudProviderPublicView {
    pub provider_key: String,
    pub name: String,
    pub platform: String,
    pub base_url: String,
    pub api_key: String,
    pub is_full_url: bool,
    pub models: Vec<String>,
    pub sort_order: i64,
}

/// Result reported by the desktop sync endpoint.
#[derive(Debug, Serialize)]
pub struct CloudProviderSyncResult {
    /// Number of cloud providers upserted into the local providers table.
    pub synced: u64,
    /// Number of stale local cloud providers pruned (removed server-side).
    pub pruned: u64,
    /// Total cloud-sourced provider rows now present locally.
    pub total_local: u64,
}

/// Service backing the cloud provider catalog handlers.
pub struct CloudProviderService {
    pub cloud_provider_repo: Arc<dyn ICloudProviderRepository>,
    pub provider_repo: Arc<dyn IProviderRepository>,
    /// Cloud key on the web backend, local key on the desktop backend.
    pub encryption_key: [u8; 32],
}

impl CloudProviderService {
    /// Build from the shared auth router state.
    pub fn from_state(state: &AuthRouterState) -> Self {
        Self {
            cloud_provider_repo: state.cloud_provider_repo.clone(),
            provider_repo: state.provider_repo.clone(),
            encryption_key: state.encryption_key,
        }
    }

    fn row_to_admin_view(&self, row: CloudProviderRow) -> Result<CloudProviderAdminView, AppError> {
        let api_key = decrypt_string(&row.api_key_encrypted, &self.encryption_key)?;
        let models: Vec<String> = serde_json::from_str(&row.models).unwrap_or_default();
        Ok(CloudProviderAdminView {
            provider_key: row.provider_key,
            name: row.name,
            platform: row.platform,
            base_url: row.base_url,
            api_key,
            is_public: row.is_public,
            is_full_url: row.is_full_url,
            models,
            sort_order: row.sort_order,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }

    fn row_to_public_view(&self, row: CloudProviderRow) -> Result<CloudProviderPublicView, AppError> {
        let api_key = decrypt_string(&row.api_key_encrypted, &self.encryption_key)?;
        let models: Vec<String> = serde_json::from_str(&row.models).unwrap_or_default();
        Ok(CloudProviderPublicView {
            provider_key: row.provider_key,
            name: row.name,
            platform: row.platform,
            base_url: row.base_url,
            api_key,
            is_full_url: row.is_full_url,
            models,
            sort_order: row.sort_order,
        })
    }

    fn validate(req: &AdminCloudProviderRequest) -> Result<(), AppError> {
        if req.provider_key.trim().is_empty() {
            return Err(AppError::BadRequest("provider_key 不能为空".into()));
        }
        if req.name.trim().is_empty() {
            return Err(AppError::BadRequest("name 不能为空".into()));
        }
        if req.platform.trim().is_empty() {
            return Err(AppError::BadRequest("platform 不能为空".into()));
        }
        if req.base_url.trim().is_empty() {
            return Err(AppError::BadRequest("base_url 不能为空".into()));
        }
        if req.api_key.trim().is_empty() {
            return Err(AppError::BadRequest("api_key 不能为空".into()));
        }
        // Ensure models is serializable to a JSON array (it already is a Vec, but
        // guard against pathological content).
        let _ = serde_json::to_string(&req.models).map_err(json_err)?;
        Ok(())
    }

    fn encrypt_req(&self, req: &AdminCloudProviderRequest) -> Result<(String, String), AppError> {
        let api_key_encrypted = encrypt_string(&req.api_key, &self.encryption_key)?;
        let models_json = serde_json::to_string(&req.models).map_err(json_err)?;
        Ok((api_key_encrypted, models_json))
    }

    /// List all catalog rows (admin). Returns plaintext keys.
    pub async fn admin_list(&self) -> Result<Vec<CloudProviderAdminView>, AppError> {
        let rows = self.cloud_provider_repo.list_all().await.map_err(db_err)?;
        rows.into_iter().map(|r| self.row_to_admin_view(r)).collect()
    }

    /// Create or update a catalog row by `provider_key` (admin).
    pub async fn admin_upsert(&self, req: AdminCloudProviderRequest) -> Result<CloudProviderAdminView, AppError> {
        Self::validate(&req)?;
        let (api_key_encrypted, models_json) = self.encrypt_req(&req)?;
        let row = self
            .cloud_provider_repo
            .upsert_by_key(UpsertCloudProviderParams {
                provider_key: &req.provider_key,
                name: &req.name,
                platform: &req.platform,
                base_url: &req.base_url,
                api_key_encrypted: &api_key_encrypted,
                is_public: req.is_public,
                is_full_url: req.is_full_url,
                models: &models_json,
                sort_order: req.sort_order,
            })
            .await
            .map_err(db_err)?;
        self.row_to_admin_view(row)
    }

    /// Delete a catalog row by `provider_key` (admin).
    pub async fn admin_delete(&self, key: &str) -> Result<(), AppError> {
        self.cloud_provider_repo.delete_by_key(key).await.map_err(db_err)
    }

    /// List public catalog rows with decrypted plaintext keys (member sync source).
    pub async fn member_list_public(&self) -> Result<Vec<CloudProviderPublicView>, AppError> {
        let rows = self.cloud_provider_repo.list_public().await.map_err(db_err)?;
        rows.into_iter().map(|r| self.row_to_public_view(r)).collect()
    }

    /// Upsert a batch of synced providers into the local `providers` table,
    /// re-encrypting each plaintext key with the local data-encryption key, then
    /// prune local cloud providers no longer present server-side.
    pub async fn sync_to_local(
        &self,
        items: Vec<CloudProviderPublicView>,
    ) -> Result<CloudProviderSyncResult, AppError> {
        let mut keep_keys: Vec<String> = Vec::with_capacity(items.len());
        let mut synced = 0u64;
        for item in &items {
            let api_key_encrypted = encrypt_string(&item.api_key, &self.encryption_key)?;
            let models_json = serde_json::to_string(&item.models).map_err(json_err)?;
            self.provider_repo
                .upsert_cloud_provider(UpsertCloudProviderLocalParams {
                    cloud_key: &item.provider_key,
                    platform: &item.platform,
                    name: &item.name,
                    base_url: &item.base_url,
                    api_key_encrypted: &api_key_encrypted,
                    is_full_url: item.is_full_url,
                    models: &models_json,
                    sort_order: Some(item.sort_order),
                })
                .await
                .map_err(db_err)?;
            keep_keys.push(item.provider_key.clone());
            synced += 1;
        }
        let pruned = self
            .provider_repo
            .delete_cloud_providers_not_in(&keep_keys)
            .await
            .map_err(db_err)?;
        let total_local = self
            .provider_repo
            .list()
            .await
            .map_err(db_err)?
            .into_iter()
            .filter(|p| p.source == "cloud")
            .count() as u64;
        Ok(CloudProviderSyncResult {
            synced,
            pruned,
            total_local,
        })
    }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/admin/cloud-providers — list all catalog providers (admin).
pub async fn list_admin_cloud_providers_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
) -> Result<Json<ApiResponse<Vec<CloudProviderAdminView>>>, AppError> {
    ensure_admin(&current_user)?;
    let svc = CloudProviderService::from_state(&state);
    let data = svc.admin_list().await?;
    Ok(Json(ApiResponse::ok(data)))
}

/// POST /api/admin/cloud-providers — create a cloud-managed provider (admin).
pub async fn create_admin_cloud_provider_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
    Json(req): Json<AdminCloudProviderRequest>,
) -> Result<Json<ApiResponse<CloudProviderAdminView>>, AppError> {
    ensure_admin(&current_user)?;
    let svc = CloudProviderService::from_state(&state);
    let data = svc.admin_upsert(req).await?;
    Ok(Json(ApiResponse::with_message(data, "云端模型接口已添加")))
}

/// PUT /api/admin/cloud-providers/{provider_key} — update (admin).
pub async fn update_admin_cloud_provider_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(provider_key): Path<String>,
    Json(req): Json<AdminCloudProviderRequest>,
) -> Result<Json<ApiResponse<CloudProviderAdminView>>, AppError> {
    ensure_admin(&current_user)?;
    // The path key is authoritative for identifying the row; the body may omit it.
    let mut req = req;
    if req.provider_key.trim().is_empty() {
        req.provider_key = provider_key.clone();
    }
    let svc = CloudProviderService::from_state(&state);
    let data = svc.admin_upsert(req).await?;
    Ok(Json(ApiResponse::with_message(data, "云端模型接口已更新")))
}

/// DELETE /api/admin/cloud-providers/{provider_key} — delete (admin).
pub async fn delete_admin_cloud_provider_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(provider_key): Path<String>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    ensure_admin(&current_user)?;
    let svc = CloudProviderService::from_state(&state);
    svc.admin_delete(&provider_key).await?;
    Ok(Json(ApiResponse::message("云端模型接口已删除")))
}

/// GET /api/store/cloud-providers — member read-only list of public providers
/// with decrypted plaintext keys. Consumed by the desktop sync flow.
pub async fn list_public_cloud_providers_handler(
    State(state): State<AuthRouterState>,
    Extension(_current_user): Extension<CurrentUser>,
) -> Result<Json<ApiResponse<Vec<CloudProviderPublicView>>>, AppError> {
    let svc = CloudProviderService::from_state(&state);
    let data = svc.member_list_public().await?;
    Ok(Json(ApiResponse::ok(data)))
}

/// POST /api/cloud-providers/sync — desktop shell only. Pulls public cloud
/// providers (plaintext keys) using the stored cloud JWT, re-encrypts with the
/// local key, and upserts into the local providers table as `source = 'cloud'`.
pub async fn sync_cloud_providers_handler(
    State(state): State<AuthRouterState>,
) -> Result<Json<ApiResponse<CloudProviderSyncResult>>, AppError> {
    // 1. Read the stored cloud JWT (members must be logged into the cloud).
    let token = state
        .user_repo
        .get_kv(KV_CLOUD_AUTH_TOKEN)
        .await
        .ok()
        .flatten()
        .filter(|t| !t.is_empty())
        .ok_or_else(|| AppError::Unauthorized("未登录云端账号，无法同步云端模型".into()))?;

    // 2. Fetch the public catalog from the central cloud backend.
    let url = format!("{}/api/store/cloud-providers", cloud_store_base().trim_end_matches('/'));
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {token}"))
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| AppError::BadGateway(format!("拉取云端模型失败: {e}")))?;
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| AppError::Internal(format!("读取云端模型响应失败: {e}")))?;
    if !status.is_success() {
        // 上游返回 401/403 通常是桌面端存的云端 JWT 失效（admin 改密轮换 secret 等），
        // 翻译成 Unauthorized 让前端能精确识别「云端登录失效」，不要包成 BadGateway 误导为网络问题。
        if status.as_u16() == 401 || status.as_u16() == 403 {
            return Err(AppError::Unauthorized(
                "云端账号登录已失效，请重新登录云端账号".into(),
            ));
        }
        return Err(AppError::BadGateway(format!("云端模型接口返回 {status}: {body}")));
    }
    let cloud: ApiResponse<Vec<CloudProviderPublicView>> = serde_json::from_str(&body)
        .map_err(|e| AppError::Internal(format!("解析云端模型失败: {e}")))?;
    let items = cloud.data.unwrap_or_default();

    // 3. Re-encrypt and upsert locally.
    let svc = CloudProviderService::from_state(&state);
    let result = svc.sync_to_local(items).await?;
    Ok(Json(ApiResponse::with_message(result, "云端模型已同步到本地")))
}
