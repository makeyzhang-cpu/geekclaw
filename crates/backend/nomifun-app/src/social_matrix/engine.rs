/*
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

//! 海外社媒矩阵 —— 引擎核心。路由层与调度器共用同一份逻辑，避免两处实现漂移。
//!
//! 引擎持有**一个装配好的发布驱动**（[`PublishDriver`]）。驱动由数据库里的
//! 实例级配置决定（聚合 / 官方 / 半自动），配置变更后调 [`SocialEngine::reload_driver`]
//! 热切换 —— 业务代码与桌面 UI 都不受影响。

use std::collections::HashMap;
use std::sync::Arc;

use nomifun_common::{decrypt_string, encrypt_string, now_ms, AppError};
use nomifun_db::models::{
    SOCIAL_POST_STATUS_CANCELED, SOCIAL_POST_STATUS_DRAFT, SOCIAL_POST_STATUS_PUBLISHING,
    SOCIAL_POST_STATUS_SCHEDULED, SOCIAL_TARGET_STATUS_FAILED, SOCIAL_TARGET_STATUS_PENDING,
    SOCIAL_TARGET_STATUS_QUEUED, SOCIAL_TARGET_STATUS_SKIPPED, SOCIAL_TARGET_STATUS_SUCCESS,
};
use nomifun_db::{
    CreatePostParams, ISocialRepository, IUserRepository, RecordMetricParams, SocialPostRow,
    SqliteSocialRepository, TargetResultParams, UpdatePostParams, UpsertAccountParams,
    UpsertPublishConfigParams,
};
use sqlx::SqlitePool;
use tokio::sync::RwLock;

use super::driver::{
    build_driver, is_supported_platform, DriverKind, LinkInfo, ManualDriver, MetricTarget,
    OutcomeStatus, PublishDriver, PublishRequest, PublishTarget, SocialError, TargetOutcome,
    DEFAULT_VENDOR,
};
use super::quota::{self, SocialQuotaView};

/// 引擎共享状态。
pub struct SocialEngine {
    pool: SqlitePool,
    repo: Arc<dyn ISocialRepository>,
    /// 加装包额度存在 `users` 表上，所以引擎需要用户仓储才能读它。
    ///
    /// 刻意走仓储而不是在这里直接写 SQL：额度口径与「谁能改额度」必须在
    /// 一处定义，否则「履约写一个值、校验读另一个值」这种错会非常难查。
    user_repo: Arc<dyn IUserRepository>,
    /// 当前生效的驱动。`RwLock` 让配置热切换不必重启服务。
    driver: RwLock<Arc<dyn PublishDriver>>,
    encryption_key: [u8; 32],
    /// 每用户上次拉取远端账号的时间戳（epoch millis）。
    ///
    /// 聚合商模式下「已授权账号」的真源在服务商侧，本地只是缓存；为了让用户
    /// 在服务商后台连完账号、回到工作台刷新就能看到，矩阵快照会顺带拉一次。
    /// 但这会打聚合商接口，所以按用户做节流 —— 否则每次刷新页面都是一次外部调用。
    account_sync_at: std::sync::Mutex<std::collections::HashMap<String, i64>>,
}

/// 账号同步失败的两类原因。**必须分开**，因为界面语义完全不同：
/// 额度问题要引导「去购买 / 去续费 / 去断开账号」，网络问题只需一句「稍后重试」。
#[derive(Debug)]
pub enum SyncAccountsError {
    /// 额度不足 / 未购买 / 已到期。带上完整视图，调用方既能记日志也能原样展示。
    Quota(Box<SocialQuotaView>),
    /// 其它错误（网络、鉴权、数据库）。
    Other(AppError),
}

impl From<AppError> for SyncAccountsError {
    fn from(e: AppError) -> Self {
        SyncAccountsError::Other(e)
    }
}

/// 仓储层的 `DbError` 也要能 `?` 上来 —— `sync_accounts` 里多处对
/// `self.repo.*()` 用了 `?`。先经 `AppError`（它已有 `From<DbError>`）
/// 再包一层，避免在这里重复写一遍错误映射。
impl From<nomifun_db::DbError> for SyncAccountsError {
    fn from(e: nomifun_db::DbError) -> Self {
        SyncAccountsError::Other(AppError::from(e))
    }
}

/// [`SocialEngine::maybe_sync_accounts`] 的结果。
///
/// 区分四种情况而不是「成功/失败」两态，是因为调用方（矩阵快照）要把
/// **被额度拦下的真实用量**显示出来：用户已经在聚合商后台连了 3 组、自己只买了
/// 1 组时，若快照只显示本地那 1 组、还不显示任何原因，用户会以为「连接没生效」
/// 而反复重连。`Blocked` 携带视图就是为了让界面能说清「你连了 3 组，额度只有 1 组」。
#[derive(Debug)]
pub enum AccountSyncOutcome {
    /// 节流跳过，或驱动尚未就绪。**不是错误**，界面什么都不该显示。
    Skipped,
    /// 拉取并落库成功。
    Synced { accounts: usize },
    /// 拉取到了，但被额度闸门拦下，没有落库。
    Blocked(Box<SocialQuotaView>),
    /// 拉取失败（网络 / 密钥），沿用本地缓存。
    Failed,
}

/// 账号自动拉取的最小间隔（同一用户）。
const ACCOUNT_SYNC_MIN_INTERVAL_MS: i64 = 60_000;

/// 单条内容被限流后最多排队重试多少次，超过就如实转为失败。
///
/// 5 次配合下面的退避阶梯约覆盖 1 小时 15 分钟 —— 足够跨过聚合商的
/// 分钟级 / 小时级限流窗口；再往后就不是「限流」，而是真的发不出去了。
const MAX_PUBLISH_ATTEMPTS: i64 = 5;

/// 排队重试的退避阶梯（毫秒）：30s → 2min → 10min → 1h。
///
/// 聚合商的限流窗口从「每秒几次」到「每天配额」都有，所以阶梯必须跨数量级。
/// 传入的是**已经尝试过的次数**，超出阶梯长度时沿用最后一档。
fn retry_backoff_ms(attempts: i64) -> i64 {
    const STEPS: [i64; 4] = [30_000, 120_000, 600_000, 3_600_000];
    let idx = (attempts.max(1) as usize - 1).min(STEPS.len() - 1);
    STEPS[idx]
}

impl SocialEngine {
    /// 建引擎并按数据库配置装配驱动。
    ///
    /// `user_repo` 只用于读写加装包额度（`users.social_groups` /
    /// `users.social_expires_at`，见迁移 047）。
    pub async fn new(
        pool: SqlitePool,
        user_repo: Arc<dyn IUserRepository>,
        encryption_key: [u8; 32],
    ) -> Arc<Self> {
        let repo: Arc<dyn ISocialRepository> =
            Arc::new(SqliteSocialRepository::new(pool.clone()));
        let engine = Arc::new(Self {
            pool,
            repo,
            user_repo,
            driver: RwLock::new(Arc::new(ManualDriver)),
            encryption_key,
            account_sync_at: std::sync::Mutex::new(std::collections::HashMap::new()),
        });
        engine.reload_driver().await;
        engine
    }

    pub fn repo(&self) -> &Arc<dyn ISocialRepository> {
        &self.repo
    }

    /// 读用户的加装包额度原始行。用户不存在时返回 `None`（按未购买处理）。
    async fn entitlement(&self, user_id: &str) -> Option<nomifun_db::models::SocialEntitlement> {
        match self.user_repo.get_social_entitlement(user_id).await {
            Ok(v) => v,
            Err(e) => {
                // 读不到额度不能「当成有额度」放行，也不能让整个页面打不开。
                // 返回 `None` ⇒ 按未购买处理（最保守的一侧），同时留痕。
                tracing::error!("社媒引擎：读取加装包额度失败（按未购买处理）：{e}");
                None
            }
        }
    }

    /// 以**本地已落库的账号**为口径算出额度状态。供快照显示与投递前闸门使用。
    pub async fn quota_view(&self, user_id: &str) -> Result<SocialQuotaView, AppError> {
        let accounts = self.repo.list_accounts(user_id).await?;
        let entitlement = self.entitlement(user_id).await;
        Ok(quota::view(
            entitlement.as_ref(),
            quota::used_from_local(&accounts),
            now_ms(),
        ))
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    /// 取当前驱动（克隆 `Arc` 后立即释放读锁，避免跨 `await` 持锁）。
    pub async fn driver(&self) -> Arc<dyn PublishDriver> {
        self.driver.read().await.clone()
    }

    /// 已可真实投递的平台。**空集不是错误**，是「待接入」——界面据此显示引导。
    pub async fn configured_platforms(&self) -> Vec<String> {
        let driver = self.driver().await;
        if !driver.is_ready() {
            return Vec::new();
        }
        driver
            .configured_platforms()
            .into_iter()
            .filter(|p| is_supported_platform(p))
            .collect()
    }

    /// 当前驱动的可展示信息（供界面显示「聚合模式 / 半自动」与厂商标识）。
    pub async fn driver_brief(&self) -> DriverBrief {
        let driver = self.driver().await;
        let kind = driver.kind();
        DriverBrief {
            kind: driver_kind_id(kind).to_string(),
            vendor: driver.vendor().map(str::to_string),
            ready: driver.is_ready(),
            // 数据流向必须让用户知情：聚合模式下内容与媒体会经服务商服务器转发。
            // 半自动 / 官方直连没有这一层，如实为 None。
            data_flow_note: match kind {
                DriverKind::Aggregator => Some(super::driver::AggregatorDriver::data_flow_note()),
                _ => None,
            },
        }
    }

    /// 驱动配置的**脱敏**视图（管理台读口）。
    ///
    /// 只回报「配了什么、是否已配密钥、现在能发哪些平台」，绝不回传密钥。
    pub async fn publish_config_view(&self) -> Result<PublishConfigView, AppError> {
        let cfg = self.repo.get_publish_config().await?;
        let brief = self.driver_brief().await;
        Ok(PublishConfigView {
            driver: cfg
                .as_ref()
                .map(|c| c.driver.clone())
                .unwrap_or_else(|| driver_kind_id(DriverKind::Manual).to_string()),
            vendor: cfg.as_ref().and_then(|c| c.vendor.clone()),
            is_active: cfg.as_ref().map(|c| c.is_active).unwrap_or(false),
            has_api_key: cfg
                .as_ref()
                .and_then(|c| c.api_key_encrypted.as_deref())
                .is_some_and(|k| !k.trim().is_empty()),
            effective_driver: brief.kind.clone(),
            ready: brief.ready,
            configured_platforms: self.configured_platforms().await,
            vendors: super::driver::VENDORS
                .iter()
                .map(|v| VendorOption {
                    id: v.id,
                    label: v.label,
                    console_url: v.console_url,
                })
                .collect(),
            data_flow_note: brief.data_flow_note,
        })
    }

    /// 取某平台的授权入口（系统浏览器打开）。
    pub async fn link_url(&self, platform: &str) -> Result<LinkInfo, AppError> {
        if !is_supported_platform(platform) {
            return Err(AppError::BadRequest(format!("不支持的平台：{platform}")));
        }
        self.driver().await.link_url(platform).await.map_err(to_app_error)
    }

    /// 所有平台都还没配密钥（或驱动是半自动）→ 界面显示「待接入」。
    /// 这是**一等状态而非错误**，所以只返回布尔值。
    pub async fn is_driver_ready(&self) -> bool {
        self.driver().await.is_ready()
    }

    /// 节流版账号拉取：距上次成功拉取不足 [`ACCOUNT_SYNC_MIN_INTERVAL_MS`] 时跳过。
    ///
    /// 返回 [`AccountSyncOutcome`] 而不是 `Option<usize>`：额度被拦下时必须让调用方
    /// 知道**远端已用了多少组**，否则界面只能显示「没有账号」，用户会以为是自己
    /// 没连上而反复重连。网络失败仍然只记日志（拉不到不该让矩阵页面打不开）。
    pub async fn maybe_sync_accounts(&self, user_id: &str) -> AccountSyncOutcome {
        if !self.is_driver_ready().await {
            return AccountSyncOutcome::Skipped;
        }
        let now = now_ms();
        {
            let guard = match self.account_sync_at.lock() {
                Ok(g) => g,
                Err(poisoned) => poisoned.into_inner(),
            };
            if let Some(prev) = guard.get(user_id) {
                if now.saturating_sub(*prev) < ACCOUNT_SYNC_MIN_INTERVAL_MS {
                    return AccountSyncOutcome::Skipped;
                }
            }
        }
        // 先打时间戳再拉取：即使这次失败也不会在 60s 内反复重试打爆对方接口。
        {
            let mut guard = match self.account_sync_at.lock() {
                Ok(g) => g,
                Err(poisoned) => poisoned.into_inner(),
            };
            guard.insert(user_id.to_string(), now);
        }
        match self.sync_accounts(user_id).await {
            Ok(accounts) => AccountSyncOutcome::Synced { accounts },
            Err(SyncAccountsError::Quota(view)) => {
                tracing::info!("社交引擎：拉取到远端账号但超出加装包额度，未落库");
                AccountSyncOutcome::Blocked(view)
            }
            Err(SyncAccountsError::Other(e)) => {
                tracing::warn!("社交引擎：拉取远端账号失败（沿用本地缓存）：{e}");
                AccountSyncOutcome::Failed
            }
        }
    }

    /// 按数据库配置重新装配驱动。平台密钥缺失时**不是错误** ——
    /// 驱动会如实上报 `configured_platforms` 为空，界面显示「待接入」。
    pub async fn reload_driver(&self) {
        let next = self.load_driver().await;
        *self.driver.write().await = next;
    }

    async fn load_driver(&self) -> Arc<dyn PublishDriver> {
        let cfg = match self.repo.get_publish_config().await {
            Ok(Some(cfg)) if cfg.is_active => cfg,
            // 没有配置（或已停用）→ 半自动。这是安全的默认：不会误发任何东西。
            _ => return Arc::new(ManualDriver),
        };

        let kind = driver_kind_from_id(&cfg.driver);

        let api_key = cfg
            .api_key_encrypted
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .and_then(|enc| match decrypt_string(enc, &self.encryption_key) {
                Ok(plain) => Some(plain),
                Err(e) => {
                    // 密钥解不开是运维事故，必须留痕；但仍降级运行而不是让服务挂掉。
                    tracing::warn!("社交引擎：聚合商 API Key 解密失败（将按未配置处理）：{e}");
                    None
                }
            })
            .unwrap_or_default();

        Arc::from(build_driver(
            kind,
            cfg.vendor.as_deref().unwrap_or(DEFAULT_VENDOR),
            &api_key,
        ))
    }

    /// 写入驱动配置并热切换。
    ///
    /// `api_key` 语义：`None` = 不动已有密钥；`Some("")` = 清空（退回待接入）；
    /// `Some(k)` = 设为 k。密钥经 AES-256-GCM 加密后落库，**明文不出服务器**。
    pub async fn update_publish_config(
        &self,
        driver: &str,
        vendor: Option<&str>,
        api_key: Option<&str>,
        is_active: bool,
    ) -> Result<(), AppError> {
        let prev = self.repo.get_publish_config().await?;
        let encrypted = match api_key {
            None => prev.as_ref().and_then(|p| p.api_key_encrypted.clone()),
            Some(k) if k.trim().is_empty() => None,
            Some(k) => Some(encrypt_string(k.trim(), &self.encryption_key)?),
        };

        self.repo
            .upsert_publish_config(UpsertPublishConfigParams {
                driver: driver.to_string(),
                vendor: vendor.map(str::to_string).or_else(|| {
                    prev.as_ref().and_then(|p| p.vendor.clone())
                }),
                api_key_encrypted: encrypted,
                base_url: prev.as_ref().and_then(|p| p.base_url.clone()),
                webhook_secret: prev.as_ref().and_then(|p| p.webhook_secret.clone()),
                is_active,
                extra_json: prev.as_ref().and_then(|p| p.extra_json.clone()),
            })
            .await?;

        self.reload_driver().await;
        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────
    // 账号同步
    // ─────────────────────────────────────────────────────────────────────

    /// 从当前驱动拉取已授权账号并落库（按「平台 + 远端账号 + 主页」幂等）。
    ///
    /// 返回写入行数。聚合商模式下授权在服务商后台完成，这里是唯一的
    /// 「把远端账号搬进本地」的入口。
    ///
    /// **一行 = 一个可投递目标**：聚合商返回的账号若带子账号（FB 主页 /
    /// LinkedIn 组织），按子账号展开成多行 —— 个人号通常不能经 API 发帖，
    /// 必须落到主页上（发布时对应 vendor 的 `pageId`）。
    pub async fn sync_accounts(&self, user_id: &str) -> Result<usize, SyncAccountsError> {
        let driver = self.driver().await;
        let remote = driver.list_accounts().await.map_err(to_app_error)?;
        if remote.is_empty() {
            return Ok(0);
        }

        // 加装包额度闸门。判据用**远端**用量而不是本地：本地只是缓存，用户刚在
        // 聚合商后台多连了两个主页时本地还看不到，拿本地判等于放行超量。
        let used = quota::used_from_remote(&remote);
        if let Err(view) = quota::check(self.entitlement(user_id).await.as_ref(), used, now_ms()) {
            tracing::info!(
                "社交引擎：用户 {} 远端已连 {} 组（额度 {} 组 / 状态 {}），本次同步不落库",
                user_id,
                used,
                view.groups,
                view.status
            );
            return Err(SyncAccountsError::Quota(Box::new(view)));
        }

        let driver_id = driver_kind_id(driver.kind()).to_string();
        let vendor = driver.vendor().map(str::to_string);

        for acc in remote {
            // provider_handle 恒为聚合商侧账号 id：发布体的 accountId 用它是硬约定，
            // 不同主页共用同一个账号 id，靠 parent_handle（pageId）区分。
            let handle = acc.provider_account_id.clone();
            if acc.subaccounts.is_empty() {
                self.upsert_one(
                    user_id,
                    &acc.platform,
                    &driver_id,
                    vendor.as_deref(),
                    &handle,
                    None,
                    acc.display_name.clone(),
                    acc.handle.clone(),
                    acc.avatar_url.clone(),
                    "profile",
                )
                .await?;
                continue;
            }
            for sub in remote_subaccounts_of(&acc) {
                self.upsert_one(
                    user_id,
                    &acc.platform,
                    &driver_id,
                    vendor.as_deref(),
                    &handle,
                    Some(&sub.0),
                    Some(sub.1),
                    acc.handle.clone(),
                    acc.avatar_url.clone(),
                    "page",
                )
                .await?;
            }
        }

        let rows = self.repo.list_accounts(user_id).await?;
        Ok(rows.len())
    }

    #[allow(clippy::too_many_arguments)]
    async fn upsert_one(
        &self,
        user_id: &str,
        platform: &str,
        driver_id: &str,
        vendor: Option<&str>,
        provider_handle: &str,
        parent_handle: Option<&str>,
        display_name: Option<String>,
        handle: Option<String>,
        avatar_url: Option<String>,
        account_type: &str,
    ) -> Result<(), AppError> {
        self.repo
            .upsert_account(UpsertAccountParams {
                account_id: String::new(),
                user_id: user_id.to_string(),
                platform: platform.to_string(),
                driver: driver_id.to_string(),
                vendor: vendor.map(str::to_string),
                provider_handle: Some(provider_handle.to_string()),
                parent_handle: parent_handle.map(str::to_string),
                display_name,
                handle,
                avatar_url,
                account_type: account_type.to_string(),
                token_expires_at: None,
                meta_json: None,
            })
            .await?;
        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────
    // 投递
    // ─────────────────────────────────────────────────────────────────────

    /// 「重新发布」：先把失败/跳过的目标退回 pending，再投递一次。
    /// 已成功的目标**不动** —— 重发会往平台上投重复内容。
    pub async fn retry_post(&self, post_id: &str) -> Result<Vec<TargetOutcome>, AppError> {
        self.repo.reset_targets_for_retry(post_id).await?;
        self.dispatch_post(post_id).await
    }

    /// 投递一条内容的所有待发目标。
    ///
    /// **逐平台独立结果**：3 个平台成功 2 个失败时，失败的只影响自己那一行，
    /// 成功的不回滚。整体性故障（密钥无效、驱动未配置）才返回 `Err`。
    pub async fn dispatch_post(&self, post_id: &str) -> Result<Vec<TargetOutcome>, AppError> {
        let post = self
            .repo
            .get_post(post_id)
            .await?
            .ok_or_else(|| AppError::NotFound("内容不存在".to_string()))?;

        // 已取消的帖子不能再发 —— 调度器只在 status='scheduled' 时捞，
        // 但「立即发布」端点可能被用户点了取消之后又点到，这里兜一道。
        if post.status == SOCIAL_POST_STATUS_CANCELED {
            return Err(AppError::BadRequest("该内容已取消，不能再发布".to_string()));
        }

        // 加装包额度闸门。放在**投递前**而不是建帖前：草稿与排期是无害的，
        // 真正产生成本（聚合商额度）与合规风险的是「发出去」这一步。
        //
        // 额度不可用时**整帖不发**，而不是只挑额度内的目标发 —— 已经投出去的
        // 帖子在平台上收不回来，「发一半」比「不发」更难向客户解释。
        {
            let accounts = self.repo.list_accounts(&post.user_id).await?;
            if let Err(view) = quota::check(
                self.entitlement(&post.user_id).await.as_ref(),
                quota::used_from_local(&accounts),
                now_ms(),
            ) {
                let reason = view
                    .message
                    .unwrap_or_else(|| "社媒矩阵加装包额度不可用".to_string());
                tracing::info!(
                    "社交引擎：内容 {} 因额度不可用（{}）拒绝投递",
                    post_id,
                    view.status
                );
                return Err(AppError::BadRequest(reason));
            }
        }

        let targets = self.repo.list_targets(post_id).await?;
        if targets.is_empty() {
            return Err(AppError::BadRequest("该内容没有投递目标".to_string()));
        }
        // account_id → target_id：结果写回时直接用，不再逐条回查数据库。
        let target_index: HashMap<&str, &str> = targets
            .iter()
            .map(|t| (t.account_id.as_str(), t.target_id.as_str()))
            .collect();

        // `queued` 一并纳入：上一轮被限流的目标还在队列里，这次接着试。
        // （只看 `pending` 的话，排过队的内容会永远卡在队列里没人再碰。）
        let pending: Vec<_> = targets
            .iter()
            .filter(|t| {
                t.status == SOCIAL_TARGET_STATUS_PENDING || t.status == SOCIAL_TARGET_STATUS_QUEUED
            })
            .collect();
        if pending.is_empty() {
            return Ok(Vec::new());
        }

        // account_id → 本轮之前的已尝试次数：判断排队是否已经该停止。
        let attempts_of: HashMap<&str, i64> = targets
            .iter()
            .map(|t| (t.account_id.as_str(), t.attempts))
            .collect();

        // 先把帖标成「投递中」—— 调度器只捞 `scheduled`，这样本轮不会被重复拾取。
        let _ = self
            .repo
            .update_post(UpdatePostParams {
                post_id: post_id.to_string(),
                title: None,
                status: Some(SOCIAL_POST_STATUS_PUBLISHING.to_string()),
                scheduled_at: None,
            })
            .await;

        let media_urls = self
            .resolve_media_urls(&post.user_id, post.media_json.as_deref())
            .await?;
        let versions = self.repo.list_versions(post_id).await?;
        let accounts = self.repo.list_accounts(&post.user_id).await?;

        let mut out_targets = Vec::with_capacity(pending.len());
        for t in &pending {
            let Some(acc) = accounts.iter().find(|a| a.account_id == t.account_id) else {
                // 账号已被解绑：如实记为 skipped（不算失败，但也没发出去），
                // 并说明原因，界面据此提示「该账号已解绑」。
                self.mark_skipped(&t.target_id, "账号已解绑，本条已跳过").await;
                continue;
            };

            let Some(handle) = acc.provider_handle.clone().filter(|h| !h.trim().is_empty()) else {
                self.mark_skipped(&t.target_id, "账号缺少远端句柄，请重新同步账号")
                    .await;
                continue;
            };

            out_targets.push(PublishTarget {
                account_id: t.account_id.clone(),
                platform: t.platform.clone(),
                provider_handle: handle,
                parent_handle: acc.parent_handle.clone(),
                // 平台差异化文案优先；没有改写就用主文案（驱动侧回退）。
                text: versions
                    .iter()
                    .find(|v| v.platform == t.platform)
                    .map(|v| v.text.clone())
                    .filter(|s| !s.trim().is_empty()),
            });
        }

        if out_targets.is_empty() {
            self.repo.refresh_post_status(post_id).await?;
            return Ok(Vec::new());
        }

        let driver = self.driver().await;
        // 文案留痕：把这次实际用的文本记进 target，之后改版本不影响已发内容的复盘。
        // 键用 owned String —— `out_targets` 随后会被 move 进 `PublishRequest`。
        let text_of: HashMap<String, String> = out_targets
            .iter()
            .map(|t| {
                (
                    t.account_id.clone(),
                    t.text.clone().unwrap_or_else(|| post.text.clone()),
                )
            })
            .collect();

        let request = PublishRequest {
            text: post.text.clone(),
            media_urls,
            targets: out_targets,
        };

        let outcomes = match driver.publish(&request).await {
            Ok(o) => o,
            Err(e) if e.is_retryable() => {
                // 可重试的**整体性**故障（服务商限流 / 网络）：整批目标一起进退，
                // 所以退回排期队列而不是判死。走的是与逐目标排队同一条路径
                // （目标 → `queued`、`attempts` 自增），确保重试预算只有一套算法
                // —— 少了自增这一步就会变成无限重试。
                // 只给**本轮真正尝试过**的目标排队。前面已把「账号已解绑」的那几个
                // 记成 `skipped`，若照搬 `pending` 会把它们重新拉回队列 ——
                // 下一轮再解绑、再排队，`attempts` 空涨，最后莫名「重试超限」。
                // `text_of` 的键就是本轮实际投递过的 account_id。
                let next_tried = pending
                    .iter()
                    .filter(|t| text_of.contains_key(t.account_id.as_str()))
                    .map(|t| t.attempts)
                    .max()
                    .unwrap_or(0)
                    + 1;
                if next_tried < MAX_PUBLISH_ATTEMPTS {
                    for t in pending
                        .iter()
                        .filter(|t| text_of.contains_key(t.account_id.as_str()))
                    {
                        let _ = self
                            .repo
                            .mark_target_result(TargetResultParams {
                                target_id: t.target_id.clone(),
                                status: SOCIAL_TARGET_STATUS_QUEUED.to_string(),
                                provider_post_id: None,
                                permalink: None,
                                error: Some(format!("服务商限流 / 网络异常，已排队稍后重试：{e}")),
                                text_snapshot: None,
                            })
                            .await;
                    }
                    let delay = retry_backoff_ms(next_tried);
                    let _ = self
                        .repo
                        .update_post(UpdatePostParams {
                            post_id: post_id.to_string(),
                            title: None,
                            status: Some(SOCIAL_POST_STATUS_SCHEDULED.to_string()),
                            scheduled_at: Some(now_ms() + delay),
                        })
                        .await;
                    tracing::warn!(
                        post_id = %post_id,
                        queued = pending.len(),
                        retry_in_ms = delay,
                        "社交引擎：整体性限流，已把该内容退回排期队列稍后重试"
                    );
                } else {
                    self.fail_pending_targets(post_id, &e.to_string()).await;
                }
                return Err(to_app_error(e));
            }
            Err(e) => {
                // 其余整体性故障（密钥无效 / 驱动未配置）不会走逐目标结果回填，
                // 目标会一直悬在 `pending`，而帖子已被标成 `publishing` ——
                // 调度器只捞 `scheduled`，于是这条内容再也发不出去、状态也不对。
                // 所以这里必须把待发目标落实成 `failed` 并写明原因，让用户看到
                // 「为什么没发出去」并能点「重新发布」，而不是一条静默卡住的内容。
                self.fail_pending_targets(post_id, &e.to_string()).await;
                return Err(to_app_error(e));
            }
        };

        // 逐条写回结果。写不回也不能丢 —— 失败原因本身就是要给用户看的东西。
        let mut queued_remaining = 0usize;
        for o in &outcomes {
            let Some(target_id) = target_index.get(o.account_id.as_str()) else {
                continue;
            };
            let mut status = match o.status {
                OutcomeStatus::Success => SOCIAL_TARGET_STATUS_SUCCESS,
                OutcomeStatus::Failed => SOCIAL_TARGET_STATUS_FAILED,
                OutcomeStatus::Skipped => SOCIAL_TARGET_STATUS_SKIPPED,
                OutcomeStatus::Queued => SOCIAL_TARGET_STATUS_QUEUED,
            };
            let mut error = o.error.clone();

            // 排队也要有上限：一直排下去对用户等于「内容永远发不出去、
            // 界面也不报错」，比一次性失败更糟。超限时如实转为失败并写明次数。
            if o.status == OutcomeStatus::Queued {
                let tried = attempts_of.get(o.account_id.as_str()).copied().unwrap_or(0) + 1;
                if tried >= MAX_PUBLISH_ATTEMPTS {
                    status = SOCIAL_TARGET_STATUS_FAILED;
                    error = Some(format!(
                        "已排队重试 {tried} 次仍未成功，转为失败：{}",
                        o.error.clone().unwrap_or_default()
                    ));
                } else {
                    queued_remaining += 1;
                }
            }

            let _ = self
                .repo
                .mark_target_result(TargetResultParams {
                    target_id: (*target_id).to_string(),
                    status: status.to_string(),
                    provider_post_id: o.provider_post_id.clone(),
                    permalink: o.permalink.clone(),
                    error,
                    text_snapshot: text_of.get(o.account_id.as_str()).cloned(),
                })
                .await;
        }

        // 还有目标在排队 → 把帖子**退回排期队列**（而不是停在「投递中」），
        // 由常驻调度器到点接着发。
        //
        // 为什么不在这里 sleep 重试：限流窗口可能长达数十分钟，占着这一轮
        // 投递不放会拖垮同批的其他内容；而且进程一重启，等待状态就丢了。
        // 退回 `scheduled` 是唯一既能跨重启存活、又与既有调度器零冲突的形态
        // —— 调度器本来就只捞 `scheduled` 且到点的内容。
        if queued_remaining > 0 {
            let tried = outcomes
                .iter()
                .filter(|o| o.status == OutcomeStatus::Queued)
                .map(|o| attempts_of.get(o.account_id.as_str()).copied().unwrap_or(0))
                .max()
                .unwrap_or(0);
            let delay = retry_backoff_ms(tried);
            let _ = self
                .repo
                .update_post(UpdatePostParams {
                    post_id: post_id.to_string(),
                    title: None,
                    status: Some(SOCIAL_POST_STATUS_SCHEDULED.to_string()),
                    scheduled_at: Some(now_ms() + delay),
                })
                .await;
            tracing::info!(
                post_id = %post_id,
                queued = queued_remaining,
                retry_in_ms = delay,
                "社交引擎：触发限流，已把该内容退回排期队列稍后重试"
            );
            return Ok(outcomes);
        }

        // 由各目标结果汇总帖级状态（全成功 / 部分成功 / 全失败）。
        self.repo.refresh_post_status(post_id).await?;
        Ok(outcomes)
    }

    /// 整体性故障时把所有待发目标落实成 `failed`（写明原因），再汇总帖级状态。
    async fn fail_pending_targets(&self, post_id: &str, reason: &str) {
        let Ok(targets) = self.repo.list_targets(post_id).await else {
            return;
        };
        // `queued` 一并纳入。可重试故障走到这里时（重试预算用尽），目标正停在
        // 「排队重试」而不是 `pending`；只处理 `pending` 会让它们永远挂着 ——
        // 帖子状态汇总时 `queued` 计入未决，于是内容卡在「投递中」：既不再重试，
        // 也不报错（调度器只捞 `scheduled`）。这是最难排查的一类静默卡死。
        for t in targets.iter().filter(|t| {
            t.status == SOCIAL_TARGET_STATUS_PENDING || t.status == SOCIAL_TARGET_STATUS_QUEUED
        }) {
            let _ = self
                .repo
                .mark_target_result(TargetResultParams {
                    target_id: t.target_id.clone(),
                    status: SOCIAL_TARGET_STATUS_FAILED.to_string(),
                    provider_post_id: None,
                    permalink: None,
                    error: Some(reason.to_string()),
                    text_snapshot: None,
                })
                .await;
        }
        let _ = self.repo.refresh_post_status(post_id).await;
    }

    async fn mark_skipped(&self, target_id: &str, reason: &str) {
        let _ = self
            .repo
            .mark_target_result(TargetResultParams {
                target_id: target_id.to_string(),
                status: SOCIAL_TARGET_STATUS_SKIPPED.to_string(),
                provider_post_id: None,
                permalink: None,
                error: Some(reason.to_string()),
                text_snapshot: None,
            })
            .await;
    }

    /// 把 `media_json` 里的 media_id 解析成可投递的 URL。
    async fn resolve_media_urls(
        &self,
        user_id: &str,
        media_json: Option<&str>,
    ) -> Result<Vec<String>, AppError> {
        let Some(raw) = media_json else {
            return Ok(Vec::new());
        };
        let ids: Vec<String> = serde_json::from_str(raw).unwrap_or_default();
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let media = self.repo.list_media(user_id, 500).await?;
        Ok(ids
            .iter()
            .filter_map(|id| {
                media
                    .iter()
                    .find(|m| &m.media_id == id)
                    .map(|m| m.url.clone())
            })
            .collect())
    }

    // ─────────────────────────────────────────────────────────────────────
    // 指标回收
    // ─────────────────────────────────────────────────────────────────────

    /// 回收指标：取已成功投递、且平台侧留了帖子 id 的目标，向驱动拉一次快照。
    ///
    /// 写进 `social_metrics` 的每一行都是**采样快照**，读取时取每 target 的最新
    /// 一行 —— 绝不能 SUM。驱动尚未实现指标端点时返回 0 行，不是错误。
    pub async fn refresh_metrics(&self, user_id: &str, limit: i64) -> Result<usize, AppError> {
        let rows = self.repo.list_recent_targets(user_id, limit).await?;
        let targets: Vec<MetricTarget> = rows
            .iter()
            .filter(|r| r.status == SOCIAL_TARGET_STATUS_SUCCESS)
            .filter_map(|r| {
                let pid = r.provider_post_id.clone()?;
                if pid.trim().is_empty() {
                    return None;
                }
                Some(MetricTarget {
                    account_id: r.account_id.clone(),
                    platform: r.platform.clone(),
                    provider_post_id: pid,
                })
            })
            .collect();
        if targets.is_empty() {
            return Ok(0);
        }

        let vendor_samples = self
            .driver()
            .await
            .fetch_metrics(&targets)
            .await
            .map_err(to_app_error)?;
        if vendor_samples.is_empty() {
            return Ok(0);
        }

        // (账号, 平台侧帖 id) → (target_id, platform)。
        // 一条内容可能投到多个账号，同一个 provider_post_id 在不同账号下是不同的 target，
        // 所以两个维度都要参与定位。
        let index: HashMap<(&str, &str), (&str, &str)> = rows
            .iter()
            .filter_map(|r| {
                r.provider_post_id.as_deref().map(|p| {
                    (
                        (r.account_id.as_str(), p),
                        (r.target_id.as_str(), r.platform.as_str()),
                    )
                })
            })
            .collect();

        let mut written = 0usize;
        for s in vendor_samples {
            let Some((target_id, platform)) =
                index.get(&(s.account_id.as_str(), s.provider_post_id.as_str()))
            else {
                continue;
            };
            self.repo
                .record_metric(RecordMetricParams {
                    target_id: (*target_id).to_string(),
                    platform: (*platform).to_string(),
                    likes: s.likes.unwrap_or(0),
                    comments: s.comments.unwrap_or(0),
                    shares: s.shares.unwrap_or(0),
                    views: s.views,
                    impressions: s.impressions,
                    saves: s.saves,
                    // 驱动返回的原始响应留档在 vendor 侧；这里不重复序列化。
                    raw_json: None,
                })
                .await?;
            written += 1;
        }
        Ok(written)
    }

    // ─────────────────────────────────────────────────────────────────────
    // 辅助
    // ─────────────────────────────────────────────────────────────────────

    /// 建内容（含媒体关联与逐平台目标），供路由层调用。
    pub async fn create_post(&self, params: CreatePostParams) -> Result<SocialPostRow, AppError> {
        Ok(self.repo.create_post(params).await?)
    }

    /// 当前时间戳（毫秒），供路由层构造 `createdAt` 之类。
    pub fn now(&self) -> i64 {
        now_ms()
    }
}

/// 驱动的可展示摘要（给界面显示「聚合模式 / 半自动 + 厂商」）。
#[derive(Debug, Clone, serde::Serialize)]
pub struct DriverBrief {
    /// `aggregator` | `direct` | `manual`
    pub kind: String,
    /// 聚合商标识（`blotato` 等）；官方直连与半自动为 `None`。
    pub vendor: Option<String>,
    /// 是否已具备工作条件。
    pub ready: bool,
    /// 数据流向披露（聚合商模式下内容与媒体会经其服务器转发）。
    /// 界面应当展示给用户 —— 这不是装饰，是让他知道内容过了谁的手。
    pub data_flow_note: Option<&'static str>,
}

/// 驱动配置的**脱敏**视图（供管理台显示与回填）。
///
/// 刻意**不返回** `api_key_encrypted`，也不返回密钥明文 —— 只回报「是否已配置」。
/// 这是实例级最高敏感项：拿到它就等于拿到全部用户的发帖权限，所以连密文都不出服务器。
#[derive(Debug, Clone, serde::Serialize)]
pub struct PublishConfigView {
    /// 配置里写的驱动：`aggregator` | `direct` | `manual`。
    pub driver: String,
    /// 配置里写的聚合商标识（`blotato` 等）。
    pub vendor: Option<String>,
    /// 配置是否启用。停用等价于半自动 —— 不会误发任何东西。
    pub is_active: bool,
    /// **是否已配置密钥**（只回报布尔，不含密钥本身）。
    pub has_api_key: bool,
    /// 当前**实际生效**的驱动。可能与 `driver` 不同：配置停用或密钥缺失时会退回 `manual`。
    pub effective_driver: String,
    /// 当前是否具备真实投递能力。
    pub ready: bool,
    /// 已可投递的平台。**空集 = 「待接入」**，是一等状态而非错误。
    pub configured_platforms: Vec<String>,
    /// 预置聚合商清单（供管理台下拉选型）。
    pub vendors: Vec<VendorOption>,
    /// 数据流向披露：聚合模式下内容与媒体会经其服务器转发。
    pub data_flow_note: Option<&'static str>,
}

/// 聚合商下拉项。只暴露非敏感字段（端点、鉴权头等留在服务端）。
#[derive(Debug, Clone, serde::Serialize)]
pub struct VendorOption {
    pub id: &'static str,
    pub label: &'static str,
    /// 授权/取密钥的后台地址，引导运维去正确的地方领 key。
    pub console_url: Option<&'static str>,
}

/// 新建内容的默认状态：无排期 → 草稿；有排期 → 已排期。
pub fn initial_post_status(scheduled_at: Option<i64>) -> &'static str {
    if scheduled_at.is_some() {
        SOCIAL_POST_STATUS_SCHEDULED
    } else {
        SOCIAL_POST_STATUS_DRAFT
    }
}

fn remote_subaccounts_of(acc: &super::driver::LinkedAccount) -> Vec<(String, String)> {
    acc.subaccounts
        .iter()
        .map(|s| (s.id.clone(), s.name.clone()))
        .collect()
}

fn driver_kind_id(kind: DriverKind) -> &'static str {
    match kind {
        DriverKind::Aggregator => "aggregator",
        DriverKind::Direct => "direct",
        DriverKind::Manual => "manual",
    }
}

fn driver_kind_from_id(id: &str) -> DriverKind {
    match id {
        "direct" => DriverKind::Direct,
        "manual" => DriverKind::Manual,
        _ => DriverKind::Aggregator,
    }
}

/// `SocialError` → `AppError`，保留「未配置」与「平台未接入」的语义差别 ——
/// 前者是运维问题（503 更合适），后者是用户操作问题（400）。
fn to_app_error(e: SocialError) -> AppError {
    use SocialError as S;
    match e {
        S::PlatformNotConfigured(p) => AppError::BadRequest(format!("该平台尚未接入：{p}")),
        S::DriverNotConfigured(m) => AppError::BadRequest(format!("发布驱动未配置：{m}")),
        S::MissingParam(m) => AppError::BadRequest(format!("缺少参数：{m}")),
        other => AppError::Internal(format!("聚合接口调用失败：{other}")),
    }
}
