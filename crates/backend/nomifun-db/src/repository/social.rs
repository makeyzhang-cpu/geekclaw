use crate::error::DbError;
use crate::models::{
    SocialAccountRow, SocialDuePostRow, SocialMediaRow, SocialMetricLatestRow, SocialPostRow,
    SocialPostTargetDetail, SocialPostTargetRow, SocialPostVersionRow, SocialPublishConfigRow,
    SOCIAL_DRIVER_AGGREGATOR, SOCIAL_TARGET_STATUS_FAILED, SOCIAL_TARGET_STATUS_PENDING,
    SOCIAL_TARGET_STATUS_QUEUED, SOCIAL_TARGET_STATUS_SKIPPED, SOCIAL_TARGET_STATUS_SUCCESS,
};
use nomifun_common::{generate_id, now_ms};

/// 海外社媒矩阵数据访问（迁移 046）。
///
/// 关键语义：
/// - `social_metrics` 是**采样表**，`list_latest_metrics` 取每 target 的最新快照，
///   **不是** 累加。累加会把同一帖的历史采样重复计数。
/// - `refresh_post_status` 由各 target 的结果**汇总**出帖级状态；一次投递允许
///   部分平台成功部分失败（`partial`），因此帖级状态不能只看单个目标。
/// - 账号删除后 `list_recent_targets` 仍返回历史行（`account_*` 为 `None`），
///   对应契约里的 `KeepHistory` 删除策略。
#[async_trait::async_trait]
pub trait ISocialRepository: Send + Sync {
    // ── 发布驱动配置 ──────────────────────────────────────────────
    /// 当前生效的驱动配置（取最近更新的一行）。
    async fn get_publish_config(&self) -> Result<Option<SocialPublishConfigRow>, DbError>;
    /// 写入 / 覆盖驱动配置（以 `driver` 为幂等键）。
    async fn upsert_publish_config(
        &self,
        params: UpsertPublishConfigParams,
    ) -> Result<SocialPublishConfigRow, DbError>;

    // ── 平台账号 ──────────────────────────────────────────────────
    /// 只返回该用户自己的账号矩阵。
    async fn list_accounts(&self, user_id: &str) -> Result<Vec<SocialAccountRow>, DbError>;
    async fn get_account(&self, account_id: &str) -> Result<Option<SocialAccountRow>, DbError>;
    /// 按 `provider_handle` 幂等接入（重复授权同一账号不会产生重复行）。
    async fn upsert_account(&self, params: UpsertAccountParams) -> Result<SocialAccountRow, DbError>;
    /// 只能删自己的账号（`user_id` 不匹配时返回 `false`，不泄露存在性）。
    async fn delete_account(&self, account_id: &str, user_id: &str) -> Result<bool, DbError>;
    async fn update_account_status(&self, account_id: &str, status: &str) -> Result<bool, DbError>;

    // ── 媒体库 ────────────────────────────────────────────────────
    async fn list_media(&self, user_id: &str, limit: i64) -> Result<Vec<SocialMediaRow>, DbError>;
    async fn create_media(&self, params: CreateMediaParams) -> Result<SocialMediaRow, DbError>;
    async fn delete_media(&self, media_id: &str) -> Result<bool, DbError>;

    // ── 内容 ──────────────────────────────────────────────────────
    async fn list_posts(&self, user_id: &str, limit: i64) -> Result<Vec<SocialPostRow>, DbError>;
    async fn get_post(&self, post_id: &str) -> Result<Option<SocialPostRow>, DbError>;
    /// 单事务写入：帖子 + 平台差异化文案 + 逐平台投递目标。
    async fn create_post(&self, params: CreatePostParams) -> Result<SocialPostRow, DbError>;
    async fn update_post(&self, params: UpdatePostParams) -> Result<bool, DbError>;
    /// 级联删除该帖的文案 / 目标 / 指标（契约 `Cascade`）。
    async fn delete_post(&self, post_id: &str, user_id: &str) -> Result<bool, DbError>;
    /// 调度器用：已排期且到点的帖子。
    async fn list_due_posts(&self, now: i64, limit: i64) -> Result<Vec<SocialDuePostRow>, DbError>;
    /// 由各 target 结果汇总帖级状态，返回新状态（无目标时返回 `None`）。
    async fn refresh_post_status(&self, post_id: &str) -> Result<Option<String>, DbError>;

    // ── 逐平台目标 ────────────────────────────────────────────────
    async fn list_targets(&self, post_id: &str) -> Result<Vec<SocialPostTargetRow>, DbError>;
    /// 发布记录台：最近的投递结果（含账号展示信息，账号删除后仍保留行）。
    async fn list_recent_targets(
        &self,
        user_id: &str,
        limit: i64,
    ) -> Result<Vec<SocialPostTargetDetail>, DbError>;
    /// 写入单个平台的投递结果并自增尝试次数。
    async fn mark_target_result(&self, params: TargetResultParams) -> Result<bool, DbError>;
    /// 「重新发布」用：把失败/跳过的目标退回 `pending`，成功的保持不动
    /// —— 已发出去的不能重发（会重复投递到平台上）。
    async fn reset_targets_for_retry(&self, post_id: &str) -> Result<u64, DbError>;

    // ── 平台差异化文案 ────────────────────────────────────────────
    async fn list_versions(&self, post_id: &str) -> Result<Vec<SocialPostVersionRow>, DbError>;
    /// 矩阵快照用：一次取回该用户最近 N 条内容的全部改写版本，避免逐帖查询。
    async fn list_versions_for_user(
        &self,
        user_id: &str,
        limit: i64,
    ) -> Result<Vec<SocialPostVersionRow>, DbError>;

    // ── 指标采样 ──────────────────────────────────────────────────
    async fn record_metric(&self, params: RecordMetricParams) -> Result<(), DbError>;
    /// 每个 target 的**最新**一次采样（不是累加）。
    async fn list_latest_metrics(
        &self,
        user_id: &str,
        limit: i64,
    ) -> Result<Vec<SocialMetricLatestRow>, DbError>;
    /// 概览统计（账号数 / 帖数 / 待发 / 失败目标数）。
    async fn overview_totals(&self, user_id: &str) -> Result<SocialOverviewTotals, DbError>;
    /// 有社媒数据的用户 id（去重）。常驻调度器按此逐用户回收指标 ——
    /// 云端是多租户，指标回收必须带租户维度，不能一次全表扫。
    async fn list_social_user_ids(&self, limit: i64) -> Result<Vec<String>, DbError>;
}

#[derive(Debug, Clone, Default)]
pub struct UpsertPublishConfigParams {
    /// 空则默认 `aggregator`。
    pub driver: String,
    pub vendor: Option<String>,
    /// 已加密的 API Key。`None` 表示用户还没填 —— 这是「待接入」一等状态。
    pub api_key_encrypted: Option<String>,
    pub base_url: Option<String>,
    pub webhook_secret: Option<String>,
    pub is_active: bool,
    pub extra_json: Option<String>,
}

#[derive(Debug, Clone)]
pub struct UpsertAccountParams {
    /// 空则新发 UUIDv7。
    pub account_id: String,
    /// 归属用户（租户隔离，逻辑外键 → `users.user_id`）。
    pub user_id: String,
    pub platform: String,
    pub driver: String,
    pub vendor: Option<String>,
    pub provider_handle: Option<String>,
    pub parent_handle: Option<String>,
    pub display_name: Option<String>,
    pub handle: Option<String>,
    pub avatar_url: Option<String>,
    pub account_type: String,
    pub token_expires_at: Option<i64>,
    pub meta_json: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CreateMediaParams {
    pub media_id: String,
    /// 归属用户（租户隔离，逻辑外键 → `users.user_id`）。
    pub user_id: String,
    pub kind: String,
    pub mime_type: String,
    pub file_name: Option<String>,
    pub url: String,
    pub bytes: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct CreatePostParams {
    pub post_id: String,
    /// 归属用户（租户隔离，逻辑外键 → `users.user_id`）。
    pub user_id: String,
    /// 主文案（一稿多投的基准文本）。
    pub text: String,
    pub title: Option<String>,
    /// 媒体 id 列表（引用 `social_media.media_id`），落库为 `media_json`。
    pub media_ids: Vec<String>,
    pub status: String,
    pub scheduled_at: Option<i64>,
    pub source: String,
    /// `(platform, text)` —— 平台差异化文案。
    pub versions: Vec<(String, String)>,
    /// `(account_id, platform)` —— 逐平台投递目标。
    pub targets: Vec<(String, String)>,
    /// 战役名（自由文本）。
    pub campaign: Option<String>,
    /// 标签（落库为 `tags_json`）。
    pub tags: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct UpdatePostParams {
    pub post_id: String,
    pub title: Option<String>,
    pub status: Option<String>,
    pub scheduled_at: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct TargetResultParams {
    pub target_id: String,
    pub status: String,
    pub provider_post_id: Option<String>,
    pub permalink: Option<String>,
    pub error: Option<String>,
    pub text_snapshot: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RecordMetricParams {
    pub target_id: String,
    pub platform: String,
    pub likes: i64,
    pub comments: i64,
    pub shares: i64,
    pub views: Option<i64>,
    pub impressions: Option<i64>,
    pub saves: Option<i64>,
    pub raw_json: Option<String>,
}

/// 概览统计（桌面端顶部指标条）。
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct SocialOverviewTotals {
    pub accounts: i64,
    pub active_accounts: i64,
    pub posts: i64,
    pub scheduled_posts: i64,
    pub published_posts: i64,
    pub failed_targets: i64,
}

const CONFIG_COLUMNS: &str = "id, driver, vendor, api_key_encrypted, base_url, webhook_secret, \
    is_active, extra_json, created_at, updated_at";
const ACCOUNT_COLUMNS: &str = "id, account_id, user_id, platform, driver, vendor, \
    provider_handle, parent_handle, display_name, handle, avatar_url, account_type, status, \
    token_expires_at, meta_json, created_at, updated_at";
const MEDIA_COLUMNS: &str = "id, media_id, user_id, kind, mime_type, file_name, url, \
    bytes, width, height, duration_ms, created_at";
const POST_COLUMNS: &str = "id, post_id, user_id, text, title, media_json, status, \
    scheduled_at, published_at, campaign, tags_json, source, created_at, updated_at";
const VERSION_COLUMNS: &str =
    "id, version_id, post_id, platform, text, created_at, updated_at";
const TARGET_COLUMNS: &str = "id, target_id, post_id, account_id, platform, status, attempts, \
    provider_post_id, permalink, error, text_snapshot, published_at, created_at, updated_at";

#[derive(Clone, Debug)]
pub struct SqliteSocialRepository {
    pool: sqlx::SqlitePool,
}

impl SqliteSocialRepository {
    pub fn new(pool: sqlx::SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait::async_trait]
impl ISocialRepository for SqliteSocialRepository {
    async fn get_publish_config(&self) -> Result<Option<SocialPublishConfigRow>, DbError> {
        let row = sqlx::query_as::<_, SocialPublishConfigRow>(&format!(
            "SELECT {CONFIG_COLUMNS} FROM social_publish_configs \
             WHERE is_active = 1 ORDER BY updated_at DESC, id DESC LIMIT 1"
        ))
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    async fn upsert_publish_config(
        &self,
        params: UpsertPublishConfigParams,
    ) -> Result<SocialPublishConfigRow, DbError> {
        let now = now_ms();
        let driver = if params.driver.trim().is_empty() {
            SOCIAL_DRIVER_AGGREGATOR.to_owned()
        } else {
            params.driver
        };
        let existing = sqlx::query_as::<_, SocialPublishConfigRow>(&format!(
            "SELECT {CONFIG_COLUMNS} FROM social_publish_configs WHERE driver = ? LIMIT 1"
        ))
        .bind(&driver)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(prev) = existing {
            sqlx::query(
                "UPDATE social_publish_configs SET vendor = ?, api_key_encrypted = ?, base_url = ?, \
                 webhook_secret = ?, is_active = ?, extra_json = ?, updated_at = ? WHERE id = ?",
            )
            .bind(&params.vendor)
            .bind(&params.api_key_encrypted)
            .bind(&params.base_url)
            .bind(&params.webhook_secret)
            .bind(params.is_active)
            .bind(&params.extra_json)
            .bind(now)
            .bind(prev.id)
            .execute(&self.pool)
            .await?;
        } else {
            sqlx::query(
                "INSERT INTO social_publish_configs \
                 (driver, vendor, api_key_encrypted, base_url, webhook_secret, is_active, \
                  extra_json, created_at, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&driver)
            .bind(&params.vendor)
            .bind(&params.api_key_encrypted)
            .bind(&params.base_url)
            .bind(&params.webhook_secret)
            .bind(params.is_active)
            .bind(&params.extra_json)
            .bind(now)
            .bind(now)
            .execute(&self.pool)
            .await?;
        }

        let row = sqlx::query_as::<_, SocialPublishConfigRow>(&format!(
            "SELECT {CONFIG_COLUMNS} FROM social_publish_configs WHERE driver = ? LIMIT 1"
        ))
        .bind(&driver)
        .fetch_one(&self.pool)
        .await?;
        Ok(row)
    }

    async fn list_accounts(&self, user_id: &str) -> Result<Vec<SocialAccountRow>, DbError> {
        let rows = sqlx::query_as::<_, SocialAccountRow>(&format!(
            "SELECT {ACCOUNT_COLUMNS} FROM social_accounts WHERE user_id = ? \
             ORDER BY platform ASC, created_at DESC, id DESC"
        ))
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn get_account(&self, account_id: &str) -> Result<Option<SocialAccountRow>, DbError> {
        let row = sqlx::query_as::<_, SocialAccountRow>(&format!(
            "SELECT {ACCOUNT_COLUMNS} FROM social_accounts WHERE account_id = ? LIMIT 1"
        ))
        .bind(account_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    async fn upsert_account(
        &self,
        params: UpsertAccountParams,
    ) -> Result<SocialAccountRow, DbError> {
        let now = now_ms();
        // 幂等键优先用远端句柄（同一平台账号重复授权），否则用 account_id。
        //
        // `parent_handle` 必须一起参与：**一行 = 一个可投递目标**，同一个 FB 登录
        // 账号下的多个主页是同一个 `provider_handle` 的多笔数据，少了这一维就会
        // 互相覆盖，最后只剩一个主页可用。
        // `COALESCE(...,'')` 是为了让 NULL 也能参与等值比较（SQLite 里 NULL != NULL）。
        let existing = if let Some(handle) = params.provider_handle.as_deref() {
            sqlx::query_as::<_, SocialAccountRow>(&format!(
                "SELECT {ACCOUNT_COLUMNS} FROM social_accounts \
                 WHERE user_id = ? AND platform = ? AND provider_handle = ? \
                 AND COALESCE(parent_handle, '') = COALESCE(?, '') LIMIT 1"
            ))
            .bind(&params.user_id)
            .bind(&params.platform)
            .bind(handle)
            .bind(params.parent_handle.as_deref())
            .fetch_optional(&self.pool)
            .await?
        } else {
            None
        };

        if let Some(prev) = existing {
            sqlx::query(
                "UPDATE social_accounts SET driver = ?, vendor = ?, display_name = ?, handle = ?, \
                 avatar_url = ?, account_type = ?, status = ?, token_expires_at = ?, meta_json = ?, \
                 parent_handle = ?, updated_at = ? WHERE id = ?",
            )
            .bind(&params.driver)
            .bind(&params.vendor)
            .bind(&params.display_name)
            .bind(&params.handle)
            .bind(&params.avatar_url)
            .bind(&params.account_type)
            .bind(crate::models::SOCIAL_ACCOUNT_STATUS_ACTIVE)
            .bind(params.token_expires_at)
            .bind(&params.meta_json)
            .bind(&params.parent_handle)
            .bind(now)
            .bind(prev.id)
            .execute(&self.pool)
            .await?;

            // 按主键取回刚更新的行。远端句柄可能已被平台改名（如 Facebook Page
            // 更名），此时用「该平台最新一行」去猜会在并发下取到别的账号。
            let row = sqlx::query_as::<_, SocialAccountRow>(&format!(
                "SELECT {ACCOUNT_COLUMNS} FROM social_accounts WHERE id = ? LIMIT 1"
            ))
            .bind(prev.id)
            .fetch_one(&self.pool)
            .await?;
            return Ok(row);
        }

        let account_id = if params.account_id.trim().is_empty() {
            generate_id()
        } else {
            params.account_id.clone()
        };
        {
            sqlx::query(
                "INSERT INTO social_accounts \
                 (account_id, user_id, platform, driver, vendor, provider_handle, \
                  parent_handle, display_name, handle, avatar_url, account_type, status, \
                  token_expires_at, meta_json, created_at, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&account_id)
            .bind(&params.user_id)
            .bind(&params.platform)
            .bind(&params.driver)
            .bind(&params.vendor)
            .bind(&params.provider_handle)
            .bind(&params.parent_handle)
            .bind(&params.display_name)
            .bind(&params.handle)
            .bind(&params.avatar_url)
            .bind(&params.account_type)
            .bind(crate::models::SOCIAL_ACCOUNT_STATUS_ACTIVE)
            .bind(params.token_expires_at)
            .bind(&params.meta_json)
            .bind(now)
            .bind(now)
            .execute(&self.pool)
            .await?;
        }

        let row = sqlx::query_as::<_, SocialAccountRow>(&format!(
            "SELECT {ACCOUNT_COLUMNS} FROM social_accounts WHERE account_id = ? LIMIT 1"
        ))
        .bind(&account_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(row)
    }

    async fn delete_account(&self, account_id: &str, user_id: &str) -> Result<bool, DbError> {
        let res =
            sqlx::query("DELETE FROM social_accounts WHERE account_id = ? AND user_id = ?")
                .bind(account_id)
                .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }

    async fn update_account_status(&self, account_id: &str, status: &str) -> Result<bool, DbError> {
        let res = sqlx::query(
            "UPDATE social_accounts SET status = ?, updated_at = ? WHERE account_id = ?",
        )
        .bind(status)
        .bind(now_ms())
        .bind(account_id)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() > 0)
    }

    async fn list_media(&self, user_id: &str, limit: i64) -> Result<Vec<SocialMediaRow>, DbError> {
        let rows = sqlx::query_as::<_, SocialMediaRow>(&format!(
            "SELECT {MEDIA_COLUMNS} FROM social_media WHERE user_id = ? \
             ORDER BY created_at DESC, id DESC LIMIT ?"
        ))
        .bind(user_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn create_media(&self, params: CreateMediaParams) -> Result<SocialMediaRow, DbError> {
        let media_id = if params.media_id.trim().is_empty() {
            generate_id()
        } else {
            params.media_id
        };
        let now = now_ms();
        sqlx::query(
            "INSERT INTO social_media \
             (media_id, user_id, kind, mime_type, file_name, url, bytes, width, height, \
              duration_ms, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&media_id)
        .bind(&params.user_id)
        .bind(&params.kind)
        .bind(&params.mime_type)
        .bind(&params.file_name)
        .bind(&params.url)
        .bind(params.bytes)
        .bind(params.width)
        .bind(params.height)
        .bind(params.duration_ms)
        .bind(now)
        .execute(&self.pool)
        .await?;

        let row = sqlx::query_as::<_, SocialMediaRow>(&format!(
            "SELECT {MEDIA_COLUMNS} FROM social_media WHERE media_id = ? LIMIT 1"
        ))
        .bind(&media_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(row)
    }

    async fn delete_media(&self, media_id: &str) -> Result<bool, DbError> {
        let res = sqlx::query("DELETE FROM social_media WHERE media_id = ?")
            .bind(media_id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }

    async fn list_posts(&self, user_id: &str, limit: i64) -> Result<Vec<SocialPostRow>, DbError> {
        let rows = sqlx::query_as::<_, SocialPostRow>(&format!(
            "SELECT {POST_COLUMNS} FROM social_posts WHERE user_id = ? \
             ORDER BY created_at DESC, id DESC LIMIT ?"
        ))
        .bind(user_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn get_post(&self, post_id: &str) -> Result<Option<SocialPostRow>, DbError> {
        let row = sqlx::query_as::<_, SocialPostRow>(&format!(
            "SELECT {POST_COLUMNS} FROM social_posts WHERE post_id = ? LIMIT 1"
        ))
        .bind(post_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    async fn create_post(&self, params: CreatePostParams) -> Result<SocialPostRow, DbError> {
        let post_id = if params.post_id.trim().is_empty() {
            generate_id()
        } else {
            params.post_id
        };
        let now = now_ms();
        // 媒体 id 列表随帖落库 —— 排期帖到点投递时 HTTP 请求早已结束，
        // 没法再向客户端索取媒体，而 IG 强制要求带媒体。
        let media_json = if params.media_ids.is_empty() {
            None
        } else {
            Some(serde_json::to_string(&params.media_ids).unwrap_or_else(|_| "[]".to_string()))
        };
        let tags_json = if params.tags.is_empty() {
            None
        } else {
            Some(serde_json::to_string(&params.tags).unwrap_or_else(|_| "[]".to_string()))
        };
        let mut tx = self.pool.begin().await?;

        sqlx::query(
            "INSERT INTO social_posts \
             (post_id, user_id, text, title, media_json, status, scheduled_at, campaign, \
              tags_json, source, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&post_id)
        .bind(&params.user_id)
        .bind(&params.text)
        .bind(&params.title)
        .bind(&media_json)
        .bind(&params.status)
        .bind(params.scheduled_at)
        .bind(&params.campaign)
        .bind(&tags_json)
        .bind(&params.source)
        .bind(now)
        .bind(now)
        .execute(&mut *tx)
        .await?;

        for (platform, text) in &params.versions {
            sqlx::query(
                "INSERT INTO social_post_versions \
                 (version_id, post_id, platform, text, created_at, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(generate_id())
            .bind(&post_id)
            .bind(platform)
            .bind(text)
            .bind(now)
            .bind(now)
            .execute(&mut *tx)
            .await?;
        }

        for (account_id, platform) in &params.targets {
            sqlx::query(
                "INSERT INTO social_post_targets \
                 (target_id, post_id, account_id, platform, status, attempts, created_at, updated_at) \
                 VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
            )
            .bind(generate_id())
            .bind(&post_id)
            .bind(account_id)
            .bind(platform)
            .bind(SOCIAL_TARGET_STATUS_PENDING)
            .bind(now)
            .bind(now)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;

        let row = sqlx::query_as::<_, SocialPostRow>(&format!(
            "SELECT {POST_COLUMNS} FROM social_posts WHERE post_id = ? LIMIT 1"
        ))
        .bind(&post_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(row)
    }

    async fn update_post(&self, params: UpdatePostParams) -> Result<bool, DbError> {
        let mut sets: Vec<&str> = Vec::new();
        if params.title.is_some() {
            sets.push("title = ?");
        }
        if params.status.is_some() {
            sets.push("status = ?");
        }
        if params.scheduled_at.is_some() {
            sets.push("scheduled_at = ?");
        }
        if sets.is_empty() {
            return Ok(false);
        }
        sets.push("updated_at = ?");
        let sql = format!(
            "UPDATE social_posts SET {} WHERE post_id = ?",
            sets.join(", ")
        );
        let mut q = sqlx::query(&sql);
        if let Some(title) = &params.title {
            q = q.bind(title);
        }
        if let Some(status) = &params.status {
            q = q.bind(status);
        }
        if let Some(scheduled_at) = params.scheduled_at {
            q = q.bind(scheduled_at);
        }
        q = q.bind(now_ms()).bind(&params.post_id);
        let res = q.execute(&self.pool).await?;
        Ok(res.rows_affected() > 0)
    }

    async fn delete_post(&self, post_id: &str, user_id: &str) -> Result<bool, DbError> {
        // 先校验归属：不能删别人的帖（不匹配时返回 false，不泄露存在性）。
        let owned: Option<i64> =
            sqlx::query_scalar("SELECT 1 FROM social_posts WHERE post_id = ? AND user_id = ?")
                .bind(post_id)
                .bind(user_id)
                .fetch_optional(&self.pool)
                .await?;
        if owned.is_none() {
            return Ok(false);
        }
        let mut tx = self.pool.begin().await?;
        // 契约声明的级联：文案 / 目标 → 指标。SQLite 无 FK 约束，手动执行。
        sqlx::query(
            "DELETE FROM social_metrics WHERE target_id IN \
             (SELECT target_id FROM social_post_targets WHERE post_id = ?)",
        )
        .bind(post_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query("DELETE FROM social_post_targets WHERE post_id = ?")
            .bind(post_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM social_post_versions WHERE post_id = ?")
            .bind(post_id)
            .execute(&mut *tx)
            .await?;
        let res = sqlx::query("DELETE FROM social_posts WHERE post_id = ?")
            .bind(post_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(res.rows_affected() > 0)
    }

    async fn list_due_posts(&self, now: i64, limit: i64) -> Result<Vec<SocialDuePostRow>, DbError> {
        let rows = sqlx::query_as::<_, SocialDuePostRow>(
            "SELECT post_id, user_id, scheduled_at FROM social_posts \
             WHERE status = ? AND scheduled_at IS NOT NULL AND scheduled_at <= ? \
             ORDER BY scheduled_at ASC LIMIT ?",
        )
        .bind(crate::models::SOCIAL_POST_STATUS_SCHEDULED)
        .bind(now)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn refresh_post_status(&self, post_id: &str) -> Result<Option<String>, DbError> {
        // 一次取回各状态计数，避免多次往返。
        let row: Option<(i64, i64, i64, i64)> = sqlx::query_as(
            "SELECT \
                COALESCE(SUM(CASE WHEN status = ? THEN 1 ELSE 0 END), 0), \
                COALESCE(SUM(CASE WHEN status IN (?, ?) THEN 1 ELSE 0 END), 0), \
                COALESCE(SUM(CASE WHEN status IN (?, ?) THEN 1 ELSE 0 END), 0), \
                COUNT(*) \
             FROM social_post_targets WHERE post_id = ?",
        )
        .bind(SOCIAL_TARGET_STATUS_SUCCESS)
        .bind(SOCIAL_TARGET_STATUS_FAILED)
        .bind(SOCIAL_TARGET_STATUS_SKIPPED)
        .bind(SOCIAL_TARGET_STATUS_PENDING)
        .bind(SOCIAL_TARGET_STATUS_QUEUED)
        .bind(post_id)
        .fetch_optional(&self.pool)
        .await?;

        let Some((success, bad, pending, total)) = row else {
            return Ok(None);
        };
        if total == 0 {
            return Ok(None);
        }

        let status = if pending > 0 {
            crate::models::SOCIAL_POST_STATUS_PUBLISHING
        } else if success == total {
            crate::models::SOCIAL_POST_STATUS_PUBLISHED
        } else if success > 0 {
            crate::models::SOCIAL_POST_STATUS_PARTIAL
        } else if bad > 0 {
            crate::models::SOCIAL_POST_STATUS_FAILED
        } else {
            crate::models::SOCIAL_POST_STATUS_PUBLISHING
        };

        let published_at = if success > 0 { Some(now_ms()) } else { None };
        sqlx::query(
            "UPDATE social_posts SET status = ?, \
             published_at = COALESCE(published_at, ?), updated_at = ? WHERE post_id = ?",
        )
        .bind(status)
        .bind(published_at)
        .bind(now_ms())
        .bind(post_id)
        .execute(&self.pool)
        .await?;

        Ok(Some(status.to_owned()))
    }

    async fn list_targets(&self, post_id: &str) -> Result<Vec<SocialPostTargetRow>, DbError> {
        let rows = sqlx::query_as::<_, SocialPostTargetRow>(&format!(
            "SELECT {TARGET_COLUMNS} FROM social_post_targets WHERE post_id = ? ORDER BY id ASC"
        ))
        .bind(post_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn list_recent_targets(
        &self,
        user_id: &str,
        limit: i64,
    ) -> Result<Vec<SocialPostTargetDetail>, DbError> {
        let rows = sqlx::query_as::<_, SocialPostTargetDetail>(
            "SELECT t.target_id, t.post_id, t.account_id, t.platform, t.status, t.attempts, \
                    t.provider_post_id, t.permalink, t.error, t.text_snapshot, t.published_at, \
                    t.created_at, \
                    a.display_name AS account_display_name, a.handle AS account_handle, \
                    a.avatar_url AS account_avatar_url, a.status AS account_status \
             FROM social_post_targets t \
             JOIN social_posts p ON p.post_id = t.post_id \
             LEFT JOIN social_accounts a ON a.account_id = t.account_id AND a.user_id = ? \
             WHERE p.user_id = ? \
             ORDER BY t.created_at DESC, t.id DESC LIMIT ?",
        )
        .bind(user_id)
        .bind(user_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn mark_target_result(&self, params: TargetResultParams) -> Result<bool, DbError> {
        let res = sqlx::query(
            "UPDATE social_post_targets SET status = ?, attempts = attempts + 1, \
             provider_post_id = COALESCE(?, provider_post_id), permalink = COALESCE(?, permalink), \
             error = ?, text_snapshot = COALESCE(?, text_snapshot), \
             published_at = CASE WHEN ? = ? THEN ? ELSE published_at END, updated_at = ? \
             WHERE target_id = ?",
        )
        .bind(&params.status)
        .bind(&params.provider_post_id)
        .bind(&params.permalink)
        .bind(&params.error)
        .bind(&params.text_snapshot)
        .bind(&params.status)
        .bind(SOCIAL_TARGET_STATUS_SUCCESS)
        .bind(now_ms())
        .bind(now_ms())
        .bind(&params.target_id)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() > 0)
    }

    async fn reset_targets_for_retry(&self, post_id: &str) -> Result<u64, DbError> {
        let res = sqlx::query(
            "UPDATE social_post_targets SET status = ?, error = NULL, updated_at = ? \
             WHERE post_id = ? AND status IN (?, ?)",
        )
        .bind(SOCIAL_TARGET_STATUS_PENDING)
        .bind(now_ms())
        .bind(post_id)
        .bind(SOCIAL_TARGET_STATUS_FAILED)
        .bind(SOCIAL_TARGET_STATUS_SKIPPED)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected())
    }

    async fn list_versions(&self, post_id: &str) -> Result<Vec<SocialPostVersionRow>, DbError> {
        let rows = sqlx::query_as::<_, SocialPostVersionRow>(&format!(
            "SELECT {VERSION_COLUMNS} FROM social_post_versions WHERE post_id = ? ORDER BY id ASC"
        ))
        .bind(post_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn list_versions_for_user(
        &self,
        user_id: &str,
        limit: i64,
    ) -> Result<Vec<SocialPostVersionRow>, DbError> {
        // JOIN 父表做租户过滤：versions 本身不带 user_id（靠 post_id 间接归属）。
        let rows = sqlx::query_as::<_, SocialPostVersionRow>(&format!(
            "SELECT v.id, v.version_id, v.post_id, v.platform, v.text, v.created_at, \
                    v.updated_at \
             FROM social_post_versions v \
             JOIN social_posts p ON p.post_id = v.post_id \
             WHERE p.user_id = ? \
             ORDER BY v.id DESC LIMIT ?"
        ))
        .bind(user_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn record_metric(&self, params: RecordMetricParams) -> Result<(), DbError> {
        sqlx::query(
            "INSERT INTO social_metrics \
             (target_id, platform, sampled_at, likes, comments, shares, views, impressions, saves, \
              raw_json) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&params.target_id)
        .bind(&params.platform)
        .bind(now_ms())
        .bind(params.likes)
        .bind(params.comments)
        .bind(params.shares)
        .bind(params.views)
        .bind(params.impressions)
        .bind(params.saves)
        .bind(&params.raw_json)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn list_latest_metrics(
        &self,
        user_id: &str,
        limit: i64,
    ) -> Result<Vec<SocialMetricLatestRow>, DbError> {
        // 取每个 target 的**最新采样**。
        //
        // 用「按 (sampled_at, id) 倒序取第一行」的相关子查询，而不是
        // `MAX(sampled_at)` + `GROUP BY`：同一毫秒内写入两次采样时
        // `sampled_at` 会打平，`MAX` 无法区分，`GROUP BY` 会任取一行
        // （SQLite 对裸列不保证取值），指标面板就会随机显示旧数据。
        // `id` 是 AUTOINCREMENT，天然给出确定的先后。
        let rows = sqlx::query_as::<_, SocialMetricLatestRow>(
            "SELECT t.target_id, t.post_id, t.account_id, t.provider_post_id, t.platform, \
                    p.title, t.permalink, t.published_at, \
                    m.sampled_at, m.likes, m.comments, m.shares, m.views, m.impressions, m.saves \
             FROM social_post_targets t \
             JOIN social_posts p ON p.post_id = t.post_id \
             JOIN social_metrics m ON m.id = ( \
                     SELECT m2.id FROM social_metrics m2 \
                     WHERE m2.target_id = t.target_id \
                     ORDER BY m2.sampled_at DESC, m2.id DESC LIMIT 1 \
                  ) \
             WHERE t.status = ? AND p.user_id = ? \
             ORDER BY t.published_at DESC, t.id DESC LIMIT ?",
        )
        .bind(SOCIAL_TARGET_STATUS_SUCCESS)
        .bind(user_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn overview_totals(&self, user_id: &str) -> Result<SocialOverviewTotals, DbError> {
        let accounts: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM social_accounts WHERE user_id = ?")
                .bind(user_id)
                .fetch_one(&self.pool)
                .await?;
        let active_accounts: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM social_accounts WHERE user_id = ? AND status = 'active'",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;
        let posts: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM social_posts WHERE user_id = ?")
                .bind(user_id)
                .fetch_one(&self.pool)
                .await?;
        let scheduled_posts: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM social_posts WHERE user_id = ? AND status = 'scheduled'",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;
        let published_posts: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM social_posts WHERE user_id = ? \
             AND status IN ('published', 'partial')",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;
        let failed_targets: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM social_post_targets t \
             JOIN social_posts p ON p.post_id = t.post_id \
             WHERE p.user_id = ? AND t.status = 'failed'",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(SocialOverviewTotals {
            accounts,
            active_accounts,
            posts,
            scheduled_posts,
            published_posts,
            failed_targets,
        })
    }

    async fn list_social_user_ids(&self, limit: i64) -> Result<Vec<String>, DbError> {
        // 有账号或有内容的用户都要纳入（只连了账号还没发帖的用户也得回收）。
        let rows: Vec<String> = sqlx::query_scalar(
            "SELECT user_id FROM social_accounts \
             UNION \
             SELECT user_id FROM social_posts \
             LIMIT ?",
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }
}
