use serde::{Deserialize, Serialize};
use sqlx::FromRow;

// ═══════════════════════════════════════════════════════════════════════════
// 海外社媒矩阵（迁移 046）
//
// 域模型取自 Mixpost：一条 `social_posts` 对多账号，中间表
// `social_post_targets` **逐平台独立记 `status` / `error` / `provider_post_id`**
// —— 一次投 5 个平台允许 3 成功 2 失败，失败原因各自留存，不整条回滚。
// 平台差异化文案放 `social_post_versions`。
//
// ⚠️ `social_metrics` 是**采样表不是流水表**：每次回收写一行快照，读取时取每个
// target 的**最新采样**，绝不能 SUM —— 否则同一帖会被历史采样重复计数。
//
// ⚠️ 租户隔离：`social_accounts` / `social_media` / `social_posts` 都带 `user_id`
// （逻辑外键 → `users.user_id`）。云端是多租户，仓储层的读取方法一律按 `user_id`
// 过滤，否则 A 的排期帖会投到 B 的账号上。
// ═══════════════════════════════════════════════════════════════════════════

/// 引擎结构上支持的平台。与桌面端
/// `ui/src/renderer/pages/social-matrix/platforms.ts` 的平台键一一对应。
///
/// 注意「支持」与「首期开放」是两件事：`x` 在结构上支持，但因其写接口
/// 改成按次计费（含链接的帖子单价大幅上调），首期不开放，待后置接入。
pub const SOCIAL_PLATFORMS: &[&str] = &[
    "linkedin",
    "facebook",
    "instagram",
    "youtube",
    "x",
    "tiktok",
];

/// 首期开放接入的平台（不含 `x`）。
pub const SOCIAL_PLATFORMS_LAUNCH: &[&str] = &["linkedin", "facebook", "instagram", "youtube", "tiktok"];

/// 平台键是否受支持。
pub fn is_supported_platform(platform: &str) -> bool {
    SOCIAL_PLATFORMS.contains(&platform)
}

// ── 1. 发布驱动配置 ───────────────────────────────────────────────────────

/// 转聚合服务商。服务商已持各平台**过审应用**，因此本地不需要任何企业资质
/// 与平台审核 —— 这是当前默认驱动。
pub const SOCIAL_DRIVER_AGGREGATOR: &str = "aggregator";
/// 直连各平台官方 API。需企业资质 + 平台审核，待资质批下来后切换。
pub const SOCIAL_DRIVER_DIRECT: &str = "direct";
/// 半自动：只产出待发内容、不真发布。零审核、零成本、零封号风险。
pub const SOCIAL_DRIVER_MANUAL: &str = "manual";

/// 发布驱动配置（**实例级**，每实例一行）。密钥加密存放，不出服务器。
///
/// 刻意**不带 `user_id`**：平台方统一购一个聚合商密钥供全部用户使用，
/// 用户才不必自己再去买一份聚合商订阅 —— 这正是「用户零资质、开箱即用」
/// 得以成立的前提。
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SocialPublishConfigRow {
    pub id: i64,
    /// `aggregator` | `direct` | `manual`，见上方三个常量。
    pub driver: String,
    /// 厂商标识：aggregator 下为 `blotato` | `post_bridge` | `ayrshare` 等。
    pub vendor: Option<String>,
    /// 聚合商 API Key（加密存储）。**缺失即「待接入」一等状态，不是错误。**
    pub api_key_encrypted: Option<String>,
    /// 覆盖默认端点（自建代理 / 区域节点用）；为空则用驱动内置默认值。
    pub base_url: Option<String>,
    /// 入站 webhook 校验密钥。
    pub webhook_secret: Option<String>,
    pub is_active: bool,
    /// 厂商特有字段（额外请求头、时区、默认可见性等），JSON。
    pub extra_json: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

// ── 2. 已连接的平台账号 ───────────────────────────────────────────────────

/// 账号可用。
pub const SOCIAL_ACCOUNT_STATUS_ACTIVE: &str = "active";
/// 令牌过期，需重新授权。
pub const SOCIAL_ACCOUNT_STATUS_EXPIRED: &str = "expired";
/// 用户已在平台侧撤销授权。
pub const SOCIAL_ACCOUNT_STATUS_REVOKED: &str = "revoked";
/// 平台返回了持续性错误。
pub const SOCIAL_ACCOUNT_STATUS_ERROR: &str = "error";

/// 一个已接入的平台账号（Mixpost 的 `Account`）。
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SocialAccountRow {
    pub id: i64,
    /// 业务身份（规范 UUIDv7）。
    pub account_id: String,
    /// 归属用户（逻辑外键 → `users.user_id`）。账号矩阵按用户隔离。
    pub user_id: String,
    /// `linkedin` | `facebook` | `instagram` | `youtube` | `x` | `tiktok`。
    pub platform: String,
    /// 该账号在哪个驱动/厂商下接入的（换驱动后历史账号仍可辨识来源）。
    pub driver: String,
    pub vendor: Option<String>,
    /// 聚合商/平台侧的账号句柄。**不透明远端标识，不是本地关系。**
    pub provider_handle: Option<String>,
    /// 主页/组织句柄（聚合商的 `pageId`）。FB 主页、LinkedIn 组织这类
    /// **必须落到主页才能发**的目标记在这里；个人账号为 `None`。
    ///
    /// 因此**一行 = 一个可投递目标**：同一登录账号下 3 个 FB 主页就是 3 行
    /// （`provider_handle` 相同、`parent_handle` 不同）。
    pub parent_handle: Option<String>,
    pub display_name: Option<String>,
    /// 平台内的 @ 名 / 频道名（展示用）。
    pub handle: Option<String>,
    pub avatar_url: Option<String>,
    /// `profile` | `page` | `channel` | `business`。
    pub account_type: String,
    /// 见上方四个状态常量。
    pub status: String,
    /// 令牌过期时间（epoch millis）。聚合商托管令牌时为 NULL。
    pub token_expires_at: Option<i64>,
    /// 平台特有元信息（粉丝数、主页 ID 等），JSON。
    pub meta_json: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

// ── 3. 媒体库 ─────────────────────────────────────────────────────────────

/// 图片。
pub const SOCIAL_MEDIA_KIND_IMAGE: &str = "image";
/// 视频。
pub const SOCIAL_MEDIA_KIND_VIDEO: &str = "video";

/// 媒体库条目。类型判定以 `mime_type` 的**前缀**为准，不按文件后缀。
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SocialMediaRow {
    pub id: i64,
    pub media_id: String,
    /// 归属用户（逻辑外键 → `users.user_id`）。
    pub user_id: String,
    /// `image` | `video`。
    pub kind: String,
    /// 完整 MIME（如 `video/mp4`）。IG / YouTube / TikTok 的媒体校验以此为准。
    pub mime_type: String,
    pub file_name: Option<String>,
    pub url: String,
    pub bytes: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    pub created_at: i64,
}

// ── 4. 一条内容（对多账号） ───────────────────────────────────────────────

/// 草稿，尚未排期。
pub const SOCIAL_POST_STATUS_DRAFT: &str = "draft";
/// 已排期，等待到点投递。
pub const SOCIAL_POST_STATUS_SCHEDULED: &str = "scheduled";
/// 正在投递中。
pub const SOCIAL_POST_STATUS_PUBLISHING: &str = "publishing";
/// 所有目标平台全部成功。
pub const SOCIAL_POST_STATUS_PUBLISHED: &str = "published";
/// 部分平台成功、部分失败（**这是常态，不是异常**）。
pub const SOCIAL_POST_STATUS_PARTIAL: &str = "partial";
/// 所有目标平台全部失败。
pub const SOCIAL_POST_STATUS_FAILED: &str = "failed";
/// 用户取消。
pub const SOCIAL_POST_STATUS_CANCELED: &str = "canceled";

/// 内容创作来源：手动创作。
pub const SOCIAL_POST_SOURCE_COMPOSER: &str = "composer";
/// 由智能体生成。
pub const SOCIAL_POST_SOURCE_AGENT: &str = "agent";
/// 来自 RSS 订阅源。
pub const SOCIAL_POST_SOURCE_RSS: &str = "rss";

/// 一条内容。真正「发到哪几个平台、各自结果」在 `social_post_targets`。
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SocialPostRow {
    pub id: i64,
    pub post_id: String,
    /// 归属用户（逻辑外键 → `users.user_id`）。
    pub user_id: String,
    pub title: Option<String>,
    /// 主文案（一稿多投的基准文本）。平台改写版本见 `social_post_versions`。
    pub text: String,
    /// 媒体 id 列表（JSON 数组，引用 `social_media.media_id`）。
    pub media_json: Option<String>,
    /// 聚合状态，见上方状态常量。由各 target 的结果汇总得出。
    pub status: String,
    /// 排期时间（epoch millis）。为空表示立即投递或纯草稿。
    pub scheduled_at: Option<i64>,
    /// 首次成功投递时间。
    pub published_at: Option<i64>,
    /// 战役名（自由文本），把一组内容归到同一波推广里做复盘对比。
    pub campaign: Option<String>,
    /// 标签（JSON 数组字符串），内容库筛选用。
    pub tags_json: Option<String>,
    /// `composer` | `agent` | `rss`，见上方来源常量。
    pub source: String,
    pub created_at: i64,
    pub updated_at: i64,
}

// ── 5. 平台差异化文案 ─────────────────────────────────────────────────────

/// 同一内容在某个平台上的改写版本（Mixpost 的 `PostVersion`）。
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SocialPostVersionRow {
    pub id: i64,
    pub version_id: String,
    /// 逻辑外键 → `social_posts.post_id`。
    pub post_id: String,
    pub platform: String,
    pub text: String,
    pub created_at: i64,
    pub updated_at: i64,
}

// ── 6. 逐平台投递目标与结果 ───────────────────────────────────────────────

/// 待投递。
pub const SOCIAL_TARGET_STATUS_PENDING: &str = "pending";
/// 已进投递队列（等待服务商异步完成）。
pub const SOCIAL_TARGET_STATUS_QUEUED: &str = "queued";
/// 投递成功。
pub const SOCIAL_TARGET_STATUS_SUCCESS: &str = "success";
/// 投递失败（`error` 列存平台原文）。
pub const SOCIAL_TARGET_STATUS_FAILED: &str = "failed";
/// 前置校验不通过而跳过（如 IG 无媒体）——不算失败，但也没发出去。
pub const SOCIAL_TARGET_STATUS_SKIPPED: &str = "skipped";

/// 一次投递的某个平台/账号目标。**每行独立记录成败与失败原因**，互不影响。
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SocialPostTargetRow {
    pub id: i64,
    pub target_id: String,
    /// 逻辑外键 → `social_posts.post_id`。
    pub post_id: String,
    /// 逻辑外键 → `social_accounts.account_id`。
    pub account_id: String,
    pub platform: String,
    /// 见上方五个状态常量。
    pub status: String,
    /// 已尝试投递次数（重试计数）。
    pub attempts: i64,
    /// 聚合商/平台返回的帖子 ID。**远端标识**，用于拉指标与回链。
    pub provider_post_id: Option<String>,
    /// 平台侧可点击的回链。
    pub permalink: Option<String>,
    /// 失败原因原文（逐平台留存，回答「哪个平台为什么没发出去」）。
    pub error: Option<String>,
    /// 本次投递实际使用的文案留痕 —— 之后改版本不影响已发内容。
    pub text_snapshot: Option<String>,
    pub published_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

// ── 7. 指标采样（快照表，非流水） ─────────────────────────────────────────

/// 一次指标采样快照。读取时取每 target 的**最新一行**。
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SocialMetricRow {
    pub id: i64,
    /// 逻辑外键 → `social_post_targets.target_id`。
    pub target_id: String,
    pub platform: String,
    /// 采样时刻（epoch millis）。排序键。
    pub sampled_at: i64,
    pub likes: i64,
    pub comments: i64,
    pub shares: i64,
    pub views: Option<i64>,
    pub impressions: Option<i64>,
    pub saves: Option<i64>,
    /// 平台原始指标响应。便于新增指标时不必立刻改表。
    pub raw_json: Option<String>,
}

// ── 聚合视图（供路由层直接序列化） ────────────────────────────────────────

/// 投递记录台的一行：目标结果 + 所属账号展示信息（平铺，便于直接 `FromRow`）。
///
/// 账号被解绑删除后 `account_*` 全为 `None` —— 这正是 `KeepHistory` 策略要
/// 保留的效果：**历史投递记录不因账号解绑而消失**。
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SocialPostTargetDetail {
    pub target_id: String,
    pub post_id: String,
    pub account_id: String,
    pub platform: String,
    pub status: String,
    pub attempts: i64,
    pub provider_post_id: Option<String>,
    pub permalink: Option<String>,
    pub error: Option<String>,
    pub text_snapshot: Option<String>,
    pub published_at: Option<i64>,
    pub created_at: i64,
    /// 以下四列来自 `LEFT JOIN social_accounts`，账号已删除时为 `None`。
    pub account_display_name: Option<String>,
    pub account_handle: Option<String>,
    pub account_avatar_url: Option<String>,
    pub account_status: Option<String>,
}

/// 指标看板的一行：某个已成功投递目标的**最新**采样 + 帖子标题。
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SocialMetricLatestRow {
    pub target_id: String,
    pub post_id: String,
    /// 投递目标所属账号 —— 指标面板按账号聚合展示。
    pub account_id: String,
    /// 平台侧帖子 id —— 指标面板以它作为「同一条帖」的标识。
    pub provider_post_id: Option<String>,
    pub platform: String,
    pub title: Option<String>,
    pub permalink: Option<String>,
    pub published_at: Option<i64>,
    pub sampled_at: i64,
    pub likes: i64,
    pub comments: i64,
    pub shares: i64,
    pub views: Option<i64>,
    pub impressions: Option<i64>,
    pub saves: Option<i64>,
}

/// 调度器待处理的一条到期帖。
///
/// **不带 `user_id`**：调度器跨全部用户扫描到期帖（一次查询服务所有租户），
/// 投递时再按 `post_id` 取其目标，因此这里不需要租户维度。
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SocialDuePostRow {
    pub post_id: String,
    pub user_id: String,
    pub scheduled_at: Option<i64>,
}

// ── 8. 加装包额度（迁移 047，列落在 `users` 表上） ─────────────────────────

/// 社媒矩阵加装包额度。社媒**不进套餐**，所有用户都必须单独买加装包，
/// 因此「额度为 0」是**未购买**这一等状态，不是异常。
///
/// 单位是「品牌账号组」：1 组 = 1 个品牌 × 各平台 1 个账号。额度口径（各平台
/// 账号数的**最大值**，不是账号总数）与聚合商的 Profile 计费方式对齐，
/// 推导过程见迁移 047 的文件头 —— 改动前务必先读。
#[derive(Debug, Clone, Default, Serialize, Deserialize, FromRow)]
pub struct SocialEntitlement {
    /// 已购买的组数。`0` = 未购买。
    pub social_groups: i64,
    /// 到期时间（epoch millis）。`None` = 无到期（后台手工开通）。
    pub social_expires_at: Option<i64>,
}

impl SocialEntitlement {
    /// 是否已购买（组数 > 0）。**不含到期判断** —— 到期由调用方按当前时间判定，
    /// 因为本结构体刻意不带时钟依赖，便于单测。
    pub fn is_purchased(&self) -> bool {
        self.social_groups > 0
    }

    /// 在给定时刻是否仍然有效（已购买且未过期）。
    pub fn is_active_at(&self, now_ms: i64) -> bool {
        self.is_purchased() && self.social_expires_at.map(|t| t > now_ms).unwrap_or(true)
    }
}
