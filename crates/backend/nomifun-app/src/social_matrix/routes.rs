/*
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

//! 海外社媒矩阵 —— 云端 HTTP 接口。
//!
//! ## 路径与调用方
//!
//! 这些端点是**云端**的原生面（`/api/social/*`）。桌面端不直接调用，而是走
//! 本地后端代理 `/api/store/social/*`（见 `nomifun-auth::routes::forward_cloud_social`），
//! 由代理带上已登录的云端 JWT —— 与硬件押金（`/api/store/hardware/*`）同一套模式。
//! 这样桌面端**不持有任何平台密钥**，密钥不出服务器。
//!
//! ## 多租户
//!
//! 云端是多租户，所以每个 handler 都从 `Extension<CurrentUser>` 取 `user_id`，
//! 仓储层的读取一律按用户过滤。这里刻意**不用** `protect_instance_owner` ——
//! 那是「实例所有者」门禁（桌面单机场景），社媒矩阵是每个用户各自使用的能力。
//!
//! ## 响应形状
//!
//! 全部包在 `ApiResponse<T>` 里（`{success, data}`）；桌面端的 `httpRequest`
//! 会自动解包 `data`。字段名刻意用 `snake_case` 与前端 `cloudApi.ts` 的宽松
//! 解析对齐（那边两种命名都收，但以 snake_case 为准）。

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Extension, Path, State};
use axum::response::Json;
use axum::routing::{delete, get, post};
use axum::Router;
use serde::{Deserialize, Serialize};

use nomifun_api_types::ApiResponse;
use nomifun_auth::CurrentUser;
use nomifun_common::AppError;
use nomifun_db::models::{
    is_supported_platform, SocialAccountRow, SocialMediaRow, SocialMetricLatestRow, SocialPostRow,
    SocialPostTargetDetail, SocialPostVersionRow, SOCIAL_ACCOUNT_STATUS_ACTIVE,
    SOCIAL_ACCOUNT_STATUS_ERROR, SOCIAL_ACCOUNT_STATUS_EXPIRED, SOCIAL_ACCOUNT_STATUS_REVOKED,
    SOCIAL_POST_STATUS_CANCELED, SOCIAL_POST_STATUS_PUBLISHED,
};
use nomifun_db::CreatePostParams;

use super::engine::{
    initial_post_status, AccountSyncOutcome, DriverBrief, PublishConfigView, SocialEngine,
    SyncAccountsError,
};
use super::quota::SocialQuotaView;

/// 路由状态：只需要引擎（引擎自带仓储与驱动）。
#[derive(Clone)]
pub struct SocialMatrixRouterState {
    pub engine: Arc<SocialEngine>,
}

pub fn social_matrix_routes(state: SocialMatrixRouterState) -> Router {
    Router::new()
        // 一次性快照：账号 + 内容 + 指标 + 服务端已配置平台。
        // 分开拉会往返多次且可能互相不一致（刚发的帖还没进指标），所以一次返回。
        .route("/api/social/matrix", get(matrix_snapshot))
        // 拉取远端已授权账号（显式刷新；快照里也会按 60s 节流自动拉一次）。
        .route("/api/social/accounts/sync", post(sync_accounts))
        // 取平台授权入口地址（由服务端生成 state/PKCE，前端只负责跳转）。
        .route("/api/social/accounts/{platform}/connect", post(connect_account))
        .route("/api/social/accounts/{account_id}", delete(disconnect_account))
        .route("/api/social/posts", post(create_post))
        .route("/api/social/posts/{post_id}/publish", post(publish_post_now))
        .route("/api/social/posts/{post_id}/cancel", post(cancel_post))
        .route("/api/social/posts/{post_id}", delete(delete_post))
        // 指标回收（显式触发；常驻调度器另有周期回收）。
        .route("/api/social/metrics/refresh", post(refresh_metrics))
        // 驱动配置（**实例级**，admin 门禁）：读/写聚合商密钥并热切换。
        // 刻意与用户面的 `/api/social/*` 同前缀 —— 它同样走 `auth_middleware`，
        // 管理员判定在 handler 内部完成（与 `nomifun-auth::routes::ensure_admin` 同范式）。
        .route(
            "/api/social/publish-config",
            get(get_publish_config_handler).put(put_publish_config_handler),
        )
        .with_state(state)
}

// ─────────────────────────────────────────────────────────────────────────
// 响应 DTO —— 形状以桌面端 `pages/social-matrix/cloudApi.ts` 的解析器为准
// ─────────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct MatrixSnapshot {
    pub accounts: Vec<AccountView>,
    pub posts: Vec<PostView>,
    pub metrics: Vec<MetricView>,
    /// 服务端已配好、可真实投递的平台。**不含**未接入的平台 —— 界面据此显示
    /// 「待接入」而不是把它们当成错误。
    pub configured_platforms: Vec<String>,
    /// 当前驱动（聚合 / 官方 / 半自动 + 厂商），供界面显示模式说明。
    pub driver: DriverBrief,
    /// 加装包额度状态。社媒**不进套餐**，所有用户都要单独买加装包，因此
    /// 界面必须能区分「未购买 / 已到期 / 超出额度 / 正常」四种情形 ——
    /// 少一个，用户就会把「没买」误读成「功能坏了」。
    pub entitlement: SocialQuotaView,
}

#[derive(Debug, Serialize)]
pub struct AccountView {
    pub id: String,
    pub platform: String,
    pub name: String,
    pub handle: Option<String>,
    pub avatar_url: Option<String>,
    pub account_type: String,
    /// 桌面端只区分 `connected` 与 `expired` / `error` / `revoked`。
    pub status: String,
    pub driver: String,
    pub vendor: Option<String>,
    pub expires_at: Option<i64>,
    pub connected_at: i64,
    /// 该登录账号下可投递的子目标（FB 主页等）。本引擎把每个目标铺成独立账号行，
    /// 所以这里恒为空数组 —— 保留字段是为了和桌面端类型对齐。
    pub targets: Vec<serde_json::Value>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PostView {
    pub id: String,
    pub status: String,
    pub text: String,
    pub media: Vec<MediaView>,
    pub versions: Vec<VersionView>,
    pub targets: Vec<TargetView>,
    pub scheduled_at: Option<i64>,
    pub published_at: Option<i64>,
    pub created_at: i64,
    pub campaign: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct MediaView {
    pub id: String,
    pub url: String,
    pub mime_type: String,
    pub name: Option<String>,
    pub size: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct VersionView {
    pub platform: String,
    pub text: String,
    /// 该改写版本面向的子目标 id。本引擎以账号为投递单位，故恒为空数组。
    pub target_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct TargetView {
    pub account_id: String,
    pub platform: String,
    pub target_id: String,
    /// 账号展示名（账号已解绑时为 `None`，但**行仍然返回** —— 历史记录要留存）。
    pub target_name: Option<String>,
    pub status: String,
    pub provider_post_id: Option<String>,
    pub permalink: Option<String>,
    /// 失败原因原文。这是「哪个平台为什么没发出去」的唯一答案。
    pub error: Option<String>,
    pub published_at: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct MetricView {
    pub account_id: String,
    pub platform: String,
    pub provider_post_id: Option<String>,
    /// 采样时刻。桌面端字段名是 `captured_at`。
    pub captured_at: i64,
    pub impressions: Option<i64>,
    pub likes: i64,
    pub comments: i64,
    pub shares: i64,
    pub views: Option<i64>,
    pub saves: Option<i64>,
    /// 平台原始指标里可能有、但本地表未落库的指标（如点击）。
    pub clicks: Option<i64>,
}

impl AccountView {
    fn from_row(r: &SocialAccountRow) -> Self {
        // 桌面端把非 connected 的账号一律当成「需要重新授权」，所以这里把
        // 本地的 `active` 归一成 `connected`，其余原样透出。
        let status = match r.status.as_str() {
            SOCIAL_ACCOUNT_STATUS_EXPIRED => "expired",
            SOCIAL_ACCOUNT_STATUS_REVOKED => "revoked",
            SOCIAL_ACCOUNT_STATUS_ERROR => "error",
            _ => "connected",
        };
        Self {
            id: r.account_id.clone(),
            platform: r.platform.clone(),
            name: r
                .display_name
                .clone()
                .or_else(|| r.handle.clone())
                .unwrap_or_else(|| r.account_id.clone()),
            handle: r.handle.clone(),
            avatar_url: r.avatar_url.clone(),
            account_type: r.account_type.clone(),
            status: status.to_string(),
            driver: r.driver.clone(),
            vendor: r.vendor.clone(),
            expires_at: r.token_expires_at,
            connected_at: r.created_at,
            targets: Vec::new(),
            // 账号级错误原文（若有）放在这里，界面用来解释「为什么会掉线」。
            error: if r.status == SOCIAL_ACCOUNT_STATUS_ACTIVE {
                None
            } else {
                Some(format!("账号状态：{}，请重新授权", r.status))
            },
        }
    }
}

impl MediaView {
    fn from_row(r: &SocialMediaRow) -> Self {
        Self {
            id: r.media_id.clone(),
            url: r.url.clone(),
            mime_type: r.mime_type.clone(),
            name: r.file_name.clone(),
            size: r.bytes,
            width: r.width,
            height: r.height,
        }
    }
}

impl TargetView {
    fn from_detail(r: &SocialPostTargetDetail) -> Self {
        Self {
            account_id: r.account_id.clone(),
            platform: r.platform.clone(),
            target_id: r.target_id.clone(),
            target_name: r
                .account_display_name
                .clone()
                .or_else(|| r.account_handle.clone()),
            status: r.status.clone(),
            provider_post_id: r.provider_post_id.clone(),
            permalink: r.permalink.clone(),
            error: r.error.clone(),
            published_at: r.published_at,
        }
    }
}

impl MetricView {
    fn from_row(r: &SocialMetricLatestRow) -> Self {
        Self {
            account_id: r.account_id.clone(),
            platform: r.platform.clone(),
            provider_post_id: r.provider_post_id.clone(),
            captured_at: r.sampled_at,
            impressions: r.impressions,
            likes: r.likes,
            comments: r.comments,
            shares: r.shares,
            views: r.views,
            saves: r.saves,
            // 本地表没落点击列；驱动侧也没给就如实为 None（不编造 0）。
            clicks: None,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────
// 快照
// ─────────────────────────────────────────────────────────────────────────

/// 单次快照里各集合的上限。桌面端是多面板同屏展示（账号矩阵 / 日历 / 记录台 /
/// 指标），全量拉取没有意义；分页留待后续按需加。
const SNAPSHOT_POST_LIMIT: i64 = 100;
const SNAPSHOT_VERSION_LIMIT: i64 = 800;
const SNAPSHOT_TARGET_LIMIT: i64 = 1000;
const SNAPSHOT_METRIC_LIMIT: i64 = 500;
const SNAPSHOT_MEDIA_LIMIT: i64 = 500;

async fn matrix_snapshot(
    State(state): State<SocialMatrixRouterState>,
    Extension(user): Extension<CurrentUser>,
) -> Result<Json<ApiResponse<MatrixSnapshot>>, AppError> {
    let user_id = user.id.as_str();
    let engine = &state.engine;
    let repo = engine.repo();

    // 顺带按 60s 节流拉一次远端账号：用户在聚合商后台连完账号、回工作台刷新
    // 就能看到。拉取失败不影响快照（本地缓存照样显示），但**被额度拦下**要
    // 保留结果 —— 那是唯一能拿到「远端真实用量」的地方。
    let sync = engine.maybe_sync_accounts(user_id).await;

    let accounts = repo.list_accounts(user_id).await?;
    let posts = repo.list_posts(user_id, SNAPSHOT_POST_LIMIT).await?;
    let media = repo.list_media(user_id, SNAPSHOT_MEDIA_LIMIT).await?;
    let versions = repo.list_versions_for_user(user_id, SNAPSHOT_VERSION_LIMIT).await?;
    let targets = repo.list_recent_targets(user_id, SNAPSHOT_TARGET_LIMIT).await?;
    let metrics = repo.list_latest_metrics(user_id, SNAPSHOT_METRIC_LIMIT).await?;

    // 媒体 id → 行：一次建表，避免每个帖子线性扫 media。
    let media_by_id: HashMap<&str, &SocialMediaRow> =
        media.iter().map(|m| (m.media_id.as_str(), m)).collect();
    // post_id → 改写版本 / 投递目标。
    let mut versions_by_post: HashMap<&str, Vec<&SocialPostVersionRow>> = HashMap::new();
    for v in &versions {
        versions_by_post.entry(v.post_id.as_str()).or_default().push(v);
    }
    let mut targets_by_post: HashMap<&str, Vec<&SocialPostTargetDetail>> = HashMap::new();
    for t in &targets {
        targets_by_post.entry(t.post_id.as_str()).or_default().push(t);
    }

    let post_views: Vec<PostView> = posts
        .iter()
        .map(|p| {
            let media_ids: Vec<String> = p
                .media_json
                .as_deref()
                .and_then(|raw| serde_json::from_str(raw).ok())
                .unwrap_or_default();
            PostView {
                id: p.post_id.clone(),
                status: p.status.clone(),
                text: p.text.clone(),
                media: media_ids
                    .iter()
                    .filter_map(|id| media_by_id.get(id.as_str()).map(|m| MediaView::from_row(m)))
                    .collect(),
                versions: versions_by_post
                    .get(p.post_id.as_str())
                    .map(|vs| {
                        vs.iter()
                            .map(|v| VersionView {
                                platform: v.platform.clone(),
                                text: v.text.clone(),
                                target_ids: Vec::new(),
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
                targets: targets_by_post
                    .get(p.post_id.as_str())
                    .map(|ts| ts.iter().map(|t| TargetView::from_detail(t)).collect())
                    .unwrap_or_default(),
                scheduled_at: p.scheduled_at,
                published_at: p.published_at,
                created_at: p.created_at,
                campaign: p.campaign.clone(),
                tags: p
                    .tags_json
                    .as_deref()
                    .and_then(|raw| serde_json::from_str(raw).ok())
                    .unwrap_or_default(),
            }
        })
        .collect();

    // 额度状态：默认按**本地已落库账号**算。若本轮同步因额度被拦下，则用那一次的
    // 视图覆盖 —— 里面的 `used` 是**远端真实用量**，比本地准（用户可能刚在聚合商
    // 后台多连了几个主页，本地还没同步到）。不覆盖的话，界面会显示「额度正常、
    // 但一个账号都没有」，用户只会以为是自己没连上而反复重连。
    let entitlement = match sync {
        AccountSyncOutcome::Blocked(view) => *view,
        _ => engine.quota_view(user_id).await?,
    };

    Ok(Json(ApiResponse::ok(MatrixSnapshot {
        accounts: accounts.iter().map(AccountView::from_row).collect(),
        posts: post_views,
        metrics: metrics.iter().map(MetricView::from_row).collect(),
        configured_platforms: engine.configured_platforms().await,
        driver: engine.driver_brief().await,
        entitlement,
    })))
}

// ─────────────────────────────────────────────────────────────────────────
// 账号
// ─────────────────────────────────────────────────────────────────────────

async fn sync_accounts(
    State(state): State<SocialMatrixRouterState>,
    Extension(user): Extension<CurrentUser>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    if !state.engine.is_driver_ready().await {
        return Err(AppError::BadRequest(
            "发布驱动尚未配置（缺少聚合商 API Key），暂时无法拉取账号".to_string(),
        ));
    }
    let count = match state.engine.sync_accounts(user.id.as_str()).await {
        Ok(count) => count,
        // 额度问题要把**原始文案**透出去：它已经写清了「已用 N 组 / 额度 M 组 /
        // 该去买还是该断开」，再包一层「同步失败」只会把关键信息冲淡。
        Err(SyncAccountsError::Quota(view)) => {
            let view = *view;
            let reason = view
                .message
                .unwrap_or_else(|| "社媒矩阵加装包额度不可用".to_string());
            return Err(AppError::BadRequest(reason));
        }
        Err(SyncAccountsError::Other(e)) => return Err(e),
    };
    Ok(Json(ApiResponse::ok(serde_json::json!({
        "accounts": count,
    }))))
}

async fn connect_account(
    State(state): State<SocialMatrixRouterState>,
    Extension(_user): Extension<CurrentUser>,
    Path(platform): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let info = state.engine.link_url(&platform).await?;
    match info.url {
        Some(url) => Ok(Json(ApiResponse::ok(serde_json::json!({
            "auth_url": url,
            "hint": info.hint,
        })))),
        // 聚合商模式下授权在服务商后台完成，没有可跳转的地址 —— 这不是错误，
        // 是「去后台连接」的操作引导。返回 400 让桌面端弹出说明文案。
        None => Err(AppError::BadRequest(info.hint)),
    }
}

async fn disconnect_account(
    State(state): State<SocialMatrixRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(account_id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let removed = state
        .engine
        .repo()
        .delete_account(&account_id, user.id.as_str())
        .await?;
    if !removed {
        // 归属不符时同样返回 NotFound，不泄露「该 id 是否存在」。
        return Err(AppError::NotFound("账号不存在".to_string()));
    }
    Ok(Json(ApiResponse::ok(serde_json::json!({ "disconnected": true }))))
}

// ─────────────────────────────────────────────────────────────────────────
// 内容
// ─────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct VersionInput {
    platform: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    #[allow(dead_code)]
    target_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct TargetInput {
    account_id: String,
    #[serde(default)]
    #[allow(dead_code)]
    target_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CreatePostBody {
    #[serde(default)]
    text: String,
    #[serde(default)]
    versions: Vec<VersionInput>,
    #[serde(default)]
    targets: Vec<TargetInput>,
    #[serde(default)]
    media_ids: Vec<String>,
    #[serde(default)]
    scheduled_at: Option<i64>,
    #[serde(default)]
    campaign: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    /// `true` = 不排期，创建后立刻投递。
    #[serde(default)]
    publish_now: bool,
}

async fn create_post(
    State(state): State<SocialMatrixRouterState>,
    Extension(user): Extension<CurrentUser>,
    Json(body): Json<CreatePostBody>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let user_id = user.id.as_str();
    let text = body.text.trim().to_string();
    if text.is_empty() && body.media_ids.is_empty() {
        return Err(AppError::BadRequest(
            "请填写文案或至少附带一个媒体".to_string(),
        ));
    }
    if body.targets.is_empty() {
        return Err(AppError::BadRequest("请至少选择一个投放账号".to_string()));
    }

    let accounts = state.engine.repo().list_accounts(user_id).await?;
    let mut targets: Vec<(String, String)> = Vec::new();
    for t in &body.targets {
        // 平台从账号行推导，**不采信客户端传的平台** —— 否则可以把内容
        // 投到与账号不符的平台上。
        let Some(acc) = accounts.iter().find(|a| a.account_id == t.account_id) else {
            return Err(AppError::NotFound(format!(
                "账号不存在或不属于当前用户：{}",
                t.account_id
            )));
        };
        if targets.iter().any(|(id, _)| id == &t.account_id) {
            continue;
        }
        targets.push((acc.account_id.clone(), acc.platform.clone()));
    }
    if targets.is_empty() {
        return Err(AppError::BadRequest("没有有效的投放账号".to_string()));
    }

    // 只保留与目标平台匹配的改写版本；空文本的版本直接丢弃（等于「不改写」）。
    let target_platforms: Vec<&str> = targets.iter().map(|(_, p)| p.as_str()).collect();
    let versions: Vec<(String, String)> = body
        .versions
        .iter()
        .filter(|v| {
            target_platforms.contains(&v.platform.as_str())
                && is_supported_platform(&v.platform)
                && !v.text.trim().is_empty()
        })
        .map(|v| (v.platform.clone(), v.text.clone()))
        .collect();

    let now = state.engine.now();
    // 排期时间已过（或要求立即发）→ 不走排期，创建后直接投递。
    let due_now = body.publish_now || body.scheduled_at.is_some_and(|ts| ts <= now);
    let scheduled_at = if due_now { None } else { body.scheduled_at };

    let row = state
        .engine
        .create_post(CreatePostParams {
            post_id: String::new(),
            user_id: user_id.to_string(),
            text: text.clone(),
            title: None,
            media_ids: body.media_ids.clone(),
            status: initial_post_status(scheduled_at).to_string(),
            scheduled_at,
            source: "composer".to_string(),
            versions,
            targets,
            campaign: body
                .campaign
                .clone()
                .filter(|c| !c.trim().is_empty()),
            tags: body
                .tags
                .iter()
                .filter(|t| !t.trim().is_empty())
                .cloned()
                .collect(),
        })
        .await?;

    if due_now {
        // 投递失败不吞掉：内容已经落库，把结果如实回报给用户。
        state.engine.dispatch_post(&row.post_id).await?;
    }

    let fresh = state
        .engine
        .repo()
        .get_post(&row.post_id)
        .await?
        .unwrap_or(row);
    Ok(Json(ApiResponse::ok(serde_json::json!({
        "post": post_payload(&state, user_id, &fresh).await?,
    }))))
}

/// 单条内容的完整视图（含媒体 / 改写版本 / 逐平台结果）。
async fn post_payload(
    state: &SocialMatrixRouterState,
    user_id: &str,
    post: &SocialPostRow,
) -> Result<PostView, AppError> {
    let repo = state.engine.repo();
    let media = repo.list_media(user_id, SNAPSHOT_MEDIA_LIMIT).await?;
    let media_by_id: HashMap<&str, &SocialMediaRow> =
        media.iter().map(|m| (m.media_id.as_str(), m)).collect();
    let media_ids: Vec<String> = post
        .media_json
        .as_deref()
        .and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or_default();
    let versions = repo.list_versions(&post.post_id).await?;
    let targets = repo.list_targets(&post.post_id).await?;
    let accounts = repo.list_accounts(user_id).await?;

    Ok(PostView {
        id: post.post_id.clone(),
        status: post.status.clone(),
        text: post.text.clone(),
        media: media_ids
            .iter()
            .filter_map(|id| media_by_id.get(id.as_str()).map(|m| MediaView::from_row(m)))
            .collect(),
        versions: versions
            .iter()
            .map(|v| VersionView {
                platform: v.platform.clone(),
                text: v.text.clone(),
                target_ids: Vec::new(),
            })
            .collect(),
        targets: targets
            .iter()
            .map(|t| TargetView {
                account_id: t.account_id.clone(),
                platform: t.platform.clone(),
                target_id: t.target_id.clone(),
                target_name: accounts
                    .iter()
                    .find(|a| a.account_id == t.account_id)
                    .and_then(|a| a.display_name.clone().or_else(|| a.handle.clone())),
                status: t.status.clone(),
                provider_post_id: t.provider_post_id.clone(),
                permalink: t.permalink.clone(),
                error: t.error.clone(),
                published_at: t.published_at,
            })
            .collect(),
        scheduled_at: post.scheduled_at,
        published_at: post.published_at,
        created_at: post.created_at,
        campaign: post.campaign.clone(),
        tags: post
            .tags_json
            .as_deref()
            .and_then(|raw| serde_json::from_str(raw).ok())
            .unwrap_or_default(),
    })
}

async fn publish_post_now(
    State(state): State<SocialMatrixRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(post_id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let user_id = user.id.as_str();
    let post = load_owned_post(&state, user_id, &post_id).await?;
    if post.status == SOCIAL_POST_STATUS_PUBLISHED {
        return Err(AppError::BadRequest("该内容已全部发布成功".to_string()));
    }
    // `retry_post` 会把失败/跳过的目标退回 pending 再投递；已成功的不重发。
    state.engine.retry_post(&post_id).await?;

    let fresh = state
        .engine
        .repo()
        .get_post(&post_id)
        .await?
        .unwrap_or(post);
    Ok(Json(ApiResponse::ok(serde_json::json!({
        "post": post_payload(&state, user_id, &fresh).await?,
    }))))
}

async fn cancel_post(
    State(state): State<SocialMatrixRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(post_id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let user_id = user.id.as_str();
    let post = load_owned_post(&state, user_id, &post_id).await?;
    if post.status == SOCIAL_POST_STATUS_PUBLISHED {
        return Err(AppError::BadRequest(
            "该内容已经发出去了，撤销排期无法撤回平台上的帖子".to_string(),
        ));
    }
    state
        .engine
        .repo()
        .update_post(nomifun_db::UpdatePostParams {
            post_id: post_id.clone(),
            title: None,
            status: Some(SOCIAL_POST_STATUS_CANCELED.to_string()),
            scheduled_at: None,
        })
        .await?;
    Ok(Json(ApiResponse::ok(serde_json::json!({ "canceled": true }))))
}

async fn delete_post(
    State(state): State<SocialMatrixRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(post_id): Path<String>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let removed = state
        .engine
        .repo()
        .delete_post(&post_id, user.id.as_str())
        .await?;
    if !removed {
        return Err(AppError::NotFound("内容不存在".to_string()));
    }
    Ok(Json(ApiResponse::ok(serde_json::json!({ "deleted": true }))))
}

async fn refresh_metrics(
    State(state): State<SocialMatrixRouterState>,
    Extension(user): Extension<CurrentUser>,
) -> Result<Json<ApiResponse<serde_json::Value>>, AppError> {
    let written = state
        .engine
        .refresh_metrics(user.id.as_str(), SNAPSHOT_TARGET_LIMIT)
        .await?;
    Ok(Json(ApiResponse::ok(serde_json::json!({ "samples": written }))))
}

/// 取一条内容并校验归属。不属于当前用户时返回 `NotFound`（不泄露存在性）。
async fn load_owned_post(
    state: &SocialMatrixRouterState,
    user_id: &str,
    post_id: &str,
) -> Result<SocialPostRow, AppError> {
    let post = state
        .engine
        .repo()
        .get_post(post_id)
        .await?
        .ok_or_else(|| AppError::NotFound("内容不存在".to_string()))?;
    if post.user_id != user_id {
        return Err(AppError::NotFound("内容不存在".to_string()));
    }
    Ok(post)
}

// ─────────────────────────────────────────────────────────────────────────
// 驱动配置（**实例级**资源，admin 门禁）
// ─────────────────────────────────────────────────────────────────────────

/// 写入驱动配置的请求体。
///
/// `api_key` 是**三态**（与 `SocialEngine::update_publish_config` 一致）：
/// - **不传该字段** → `None` → 保留现有密钥不动（只想改 driver/vendor 时用）；
/// - **传空串** → 清空密钥（退回「待接入」）；
/// - **传非空值** → 设为该值（服务端用 AES-256-GCM 加密后落库）。
#[derive(Debug, Deserialize)]
struct UpdatePublishConfigBody {
    /// `aggregator` | `direct` | `manual`。
    driver: String,
    /// 聚合商标识；`None` 表示沿用现有值。
    #[serde(default)]
    vendor: Option<String>,
    #[serde(default)]
    api_key: Option<String>,
    /// 是否启用；`None` 视为启用（管理台的默认意图是「保存并启用」）。
    #[serde(default)]
    is_active: Option<bool>,
}

/// `GET /api/social/publish-config` —— 读驱动配置（**脱敏**，admin）。
async fn get_publish_config_handler(
    State(state): State<SocialMatrixRouterState>,
    Extension(user): Extension<CurrentUser>,
) -> Result<Json<ApiResponse<PublishConfigView>>, AppError> {
    ensure_social_admin(&user)?;
    let view = state.engine.publish_config_view().await?;
    Ok(Json(ApiResponse::ok(view)))
}

/// `PUT /api/social/publish-config` —— 写驱动配置并**热切换**（admin）。
///
/// 密钥错误不会让写入失败：驱动会如实上报 `configured_platforms` 为空，
/// 界面显示「待接入」—— 这是设计上的一等状态，不是异常。
async fn put_publish_config_handler(
    State(state): State<SocialMatrixRouterState>,
    Extension(user): Extension<CurrentUser>,
    Json(body): Json<UpdatePublishConfigBody>,
) -> Result<Json<ApiResponse<PublishConfigView>>, AppError> {
    ensure_social_admin(&user)?;
    if !matches!(body.driver.as_str(), "aggregator" | "direct" | "manual") {
        return Err(AppError::BadRequest(format!(
            "未知的驱动类型：{}（可选 aggregator / direct / manual）",
            body.driver
        )));
    }
    state
        .engine
        .update_publish_config(
            &body.driver,
            body.vendor.as_deref(),
            body.api_key.as_deref(),
            body.is_active.unwrap_or(true),
        )
        .await?;
    // 回读：让管理台立刻看到「生效驱动」与「已可投递平台」是否随之变化。
    let view = state.engine.publish_config_view().await?;
    Ok(Json(ApiResponse::with_message(view, "配置已保存并生效")))
}

/// 社媒矩阵的 admin 门禁。
///
/// 判据与 `nomifun-auth::routes::ensure_admin` 完全一致（`role == "admin"`），
/// 但那个函数是 `pub(crate)`，跨 crate 用不了，所以在这里等价实现。
/// 驱动配置是**实例级**资源 —— 一把密钥服务全部用户，只有实例管理员能读写。
fn ensure_social_admin(user: &CurrentUser) -> Result<(), AppError> {
    if user.role != "admin" {
        return Err(AppError::Forbidden("需要管理员权限".to_string()));
    }
    Ok(())
}
