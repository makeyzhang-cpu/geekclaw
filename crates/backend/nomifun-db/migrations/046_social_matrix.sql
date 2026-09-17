-- 046: 海外社媒矩阵（多平台账号矩阵 + 一稿多投 + 排期 + 指标回收）
--
-- 背景：「AI出海智能体」分组新增【海外社媒矩阵工作台】。桌面侧只做编排与展示，
-- 真正的发布引擎常驻云端 —— 因为**排期帖必须由服务端发出**（用户关掉电脑也要按时
-- 投递），且 OAuth 回调必须是公网可达的固定地址。
--
-- 发布驱动是**可插拔**的，分三类（见 `social_publish_configs.driver`）：
-- - `aggregator`：转聚合服务商（Blotato / Post Bridge / AdaptlyPost / Ayrshare / Outstand）。
--   服务商已持各平台过审应用，因此**本地不需要任何企业资质与平台审核**。
-- - `direct`：直连各平台官方 API（需企业资质 + 平台审核，待资质批下来后切换）。
-- - `manual`：半自动（只产出待发内容，不真发布），零审核零成本零封号风险。
-- 业务代码只依赖驱动抽象，换驱动不改业务逻辑。
--
-- ── 领域模型来源 ──────────────────────────────────────────────────────────
-- 表结构取 Mixpost（inovector/mixpost）的成熟域模型，而不是自创：
-- 一条内容 `social_posts` 对多个账号，**中间表 `social_post_targets` 逐平台独立
-- 记 `status` / `error` / `provider_post_id`** —— 一次投 5 个平台允许 3 成功 2 失败，
-- 失败原因各自留存，不整条回滚。平台差异化文案放 `social_post_versions`。
--
-- ⚠️ `social_metrics` 是**采样表不是流水表**：每次回收写一行快照，读取时取
-- **每个 target 的最新采样**，不能 SUM —— 同一帖会被历史采样重复计数。
--
-- ── 租户隔离（与 045 押金表同口径）────────────────────────────────────────
-- `social_accounts` / `social_posts` / `social_media` 都带 `user_id`
-- （逻辑外键 → `users.user_id`，不建 FK 约束）。云端是多租户：不带这一列的
-- 话，A 的排期帖会被投到 B 的账号上。子表（versions / targets / metrics）
-- 通过父表 `post_id` 间接归属，不重复冗余。
--
-- `social_publish_configs` 例外：它是**实例级**配置（每实例一行），不是 per-user。
-- 平台方（GeekClaw）统一购一个聚合商密钥供全部用户使用，用户才不必自己再去买
-- 一份聚合商订阅 —— 这正是「用户零资质、开箱即用」得以成立的前提。
--
-- id 契约：本迁移新增 7 张产品表，必须同步登记进
-- `crates/backend/nomifun-db/src/id_schema_contract.rs` 的 `PRODUCT_TABLES`、
-- `UUIDV7_BUSINESS_COLUMNS`、`NON_REFERENCE_ID_COLUMNS` 与 `LOGICAL_REFERENCES`
-- 四处。`validate_id_schema_contract` 断言「表集合与 sqlite_schema 完全相等」，
-- 漏登记会让桌面端 v3 引导直接失败（`v3 schema product-table registry mismatch`）。
-- 因此「建表 / 登记 / 云端重新部署」三件事**不可拆分**。

-- ── 1. 发布驱动配置（每实例一行；密钥加密存放，不出服务器）──────────────
CREATE TABLE social_publish_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- 驱动类型：`aggregator` | `direct` | `manual`
    driver TEXT NOT NULL,
    -- 厂商标识：aggregator 下为 `blotato` | `post_bridge` | `adaptlypost` |
    -- `ayrshare` | `outstand`；direct 下为 `native`；manual 下为空。
    vendor TEXT,
    -- 聚合商的 API Key（实例级加密存储；缺失即「待接入」一等状态，不是错误）
    api_key_encrypted TEXT,
    -- 覆盖默认端点（自建代理/区域节点用），为空则用驱动内置默认值
    base_url TEXT,
    -- 回调/入站 webhook 校验密钥
    webhook_secret TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    -- 厂商特有字段（额外请求头、时区、默认可见性等），JSON
    extra_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- ── 2. 已连接的平台账号（Mixpost `Account`）─────────────────────────────
-- 一行 = 一个可投递目标。聚合商返回的账号若带子账号（FB 主页 / LinkedIn 组织），
-- 按子账号展开成多行 —— 个人号通常不能经 API 发帖，必须落到主页上。
CREATE TABLE social_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- 业务身份（规范 UUIDv7）
    account_id TEXT NOT NULL UNIQUE
        CHECK (
            length(account_id) = 36
            AND lower(account_id) = account_id
            AND account_id GLOB '????????-????-7???-[89ab]???-????????????'
            AND replace(account_id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
    -- 归属用户（逻辑外键 → users.user_id）：账号矩阵按用户隔离
    user_id TEXT NOT NULL
        CHECK (
            length(user_id) = 36
            AND lower(user_id) = user_id
            AND user_id GLOB '????????-????-7???-[89ab]???-????????????'
            AND replace(user_id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
    -- 平台：`linkedin` | `facebook` | `instagram` | `youtube` | `x` | `tiktok`
    platform TEXT NOT NULL,
    -- 该账号是在哪个驱动/厂商下接入的（换驱动后历史账号仍可辨识来源）
    driver TEXT NOT NULL,
    vendor TEXT,
    -- 聚合商/平台侧的账号句柄（**不透明远端标识**，不是本地关系）
    provider_handle TEXT,
    -- IG 由 FB 主页关联带入时，这里记归属的 FB 主页句柄（同属远端标识）
    parent_handle TEXT,
    display_name TEXT,
    handle TEXT,
    avatar_url TEXT,
    -- 账号类型：`profile` | `page` | `channel` | `business`
    account_type TEXT NOT NULL DEFAULT 'profile',
    -- `active` | `expired` | `revoked` | `error`
    status TEXT NOT NULL DEFAULT 'active',
    -- 令牌过期时间（epoch millis），聚合商托管时为 NULL
    token_expires_at INTEGER,
    -- 平台特有元信息（粉丝数、主页 ID 等），JSON
    meta_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 账号矩阵按用户 + 平台聚合展示
CREATE INDEX idx_social_accounts_user ON social_accounts (user_id, created_at DESC);
CREATE INDEX idx_social_accounts_platform ON social_accounts (platform, created_at DESC);
CREATE INDEX idx_social_accounts_status ON social_accounts (status, created_at DESC);

-- ── 3. 媒体库（图片 / 视频；类型判定按 MIME 前缀，不按文件后缀）──────────
CREATE TABLE social_media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id TEXT NOT NULL UNIQUE
        CHECK (
            length(media_id) = 36
            AND lower(media_id) = media_id
            AND media_id GLOB '????????-????-7???-[89ab]???-????????????'
            AND replace(media_id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
    -- 归属用户（逻辑外键 → users.user_id）
    user_id TEXT NOT NULL
        CHECK (
            length(user_id) = 36
            AND lower(user_id) = user_id
            AND user_id GLOB '????????-????-7???-[89ab]???-????????????'
            AND replace(user_id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
    -- `image` | `video`
    kind TEXT NOT NULL,
    -- 完整 MIME（如 `video/mp4`）。IG/YouTube/TikTok 的媒体校验以此为准。
    mime_type TEXT NOT NULL,
    file_name TEXT,
    url TEXT NOT NULL,
    bytes INTEGER,
    width INTEGER,
    height INTEGER,
    duration_ms INTEGER,
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_social_media_user ON social_media (user_id, created_at DESC);

-- ── 4. 一条内容（对多账号）─────────────────────────────────────────────
CREATE TABLE social_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id TEXT NOT NULL UNIQUE
        CHECK (
            length(post_id) = 36
            AND lower(post_id) = post_id
            AND post_id GLOB '????????-????-7???-[89ab]???-????????????'
            AND replace(post_id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
    -- 归属用户（逻辑外键 → users.user_id）：内容与排期按用户隔离
    user_id TEXT NOT NULL
        CHECK (
            length(user_id) = 36
            AND lower(user_id) = user_id
            AND user_id GLOB '????????-????-7???-[89ab]???-????????????'
            AND replace(user_id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
    -- 主文案（一稿多投的基准文本）；各平台的改写版本在 social_post_versions。
    text TEXT NOT NULL DEFAULT '',
    title TEXT,
    -- `draft` 草稿 | `scheduled` 已排期 | `publishing` 投递中 | `published` 全成功 |
    -- `partial` 部分成功 | `failed` 全失败 | `canceled` 已取消
    status TEXT NOT NULL DEFAULT 'draft',
    -- 排期时间（epoch millis）；为空表示立即投递或纯草稿
    scheduled_at INTEGER,
    -- 媒体 id 列表（JSON 数组，元素引用 social_media.media_id）。
    -- **必须随帖持久化**：排期帖在到点投递时请求早已结束，没法再向客户端
    -- 要媒体；而 Instagram 强制要求带媒体，缺了这一列排期帖必然发不出去。
    media_json TEXT,
    -- 首次成功投递时间
    published_at INTEGER,
    -- 战役名（自由文本，用于把一组内容归到同一波推广里做对比复盘）
    campaign TEXT,
    -- 标签（JSON 数组），用于内容库筛选
    tags_json TEXT,
    -- 创建来源：`composer` 手动创作 | `agent` 智能体生成 | `rss` 订阅源
    source TEXT NOT NULL DEFAULT 'composer',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 调度器每分钟扫「到期待发」——**跨用户**扫描，故不加 user_id 前缀；
-- 内容列表 / 日历按用户过滤走 idx_social_posts_user。
CREATE INDEX idx_social_posts_due ON social_posts (status, scheduled_at);
CREATE INDEX idx_social_posts_user ON social_posts (user_id, created_at DESC);
CREATE INDEX idx_social_posts_created ON social_posts (created_at DESC);

-- ── 5. 平台差异化文案（同一内容在不同平台的改写版本）───────────────────
CREATE TABLE social_post_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version_id TEXT NOT NULL UNIQUE
        CHECK (
            length(version_id) = 36
            AND lower(version_id) = version_id
            AND version_id GLOB '????????-????-7???-[89ab]???-????????????'
            AND replace(version_id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
    -- 逻辑外键 → social_posts.post_id
    post_id TEXT NOT NULL
        CHECK (
            length(post_id) = 36
            AND lower(post_id) = post_id
            AND post_id GLOB '????????-????-7???-[89ab]???-????????????'
            AND replace(post_id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
    platform TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX idx_social_post_versions_post ON social_post_versions (post_id);

-- ── 6. 逐平台投递目标与结果（Mixpost `post_accounts`）──────────────────
-- 一次投递的每个平台/账号一行，**独立记录成败与失败原因**，互不影响。
CREATE TABLE social_post_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_id TEXT NOT NULL UNIQUE
        CHECK (
            length(target_id) = 36
            AND lower(target_id) = target_id
            AND target_id GLOB '????????-????-7???-[89ab]???-????????????'
            AND replace(target_id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
    -- 逻辑外键 → social_posts.post_id
    post_id TEXT NOT NULL
        CHECK (
            length(post_id) = 36
            AND lower(post_id) = post_id
            AND post_id GLOB '????????-????-7???-[89ab]???-????????????'
            AND replace(post_id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
    -- 逻辑外键 → social_accounts.account_id
    -- 保留策略 KeepHistory：账号解绑后**历史投递记录必须留存**（审计与复盘），
    -- 所以这里刻意不做级联删除。
    account_id TEXT NOT NULL
        CHECK (
            length(account_id) = 36
            AND lower(account_id) = account_id
            AND account_id GLOB '????????-????-7???-[89ab]???-????????????'
            AND replace(account_id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
    platform TEXT NOT NULL,
    -- `pending` 待投 | `queued` 已进队 | `success` 成功 | `failed` 失败 | `skipped` 跳过
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    -- 聚合商/平台返回的帖子 ID（**远端标识**，用于拉指标与回链）
    provider_post_id TEXT,
    permalink TEXT,
    -- 失败原因原文（逐平台留存，便于「哪个平台为什么没发出去」）
    error TEXT,
    -- 本次投递实际使用的文案（留痕：之后改版本不影响已发内容）
    text_snapshot TEXT,
    published_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX idx_social_post_targets_post ON social_post_targets (post_id);
CREATE INDEX idx_social_post_targets_account ON social_post_targets (account_id);
-- 指标回收按「有 provider_post_id 且已成功」的 target 扫
CREATE INDEX idx_social_post_targets_metrics
    ON social_post_targets (status, published_at DESC);

-- ── 7. 指标采样（**快照表，非累加流水**）───────────────────────────────
CREATE TABLE social_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- 逻辑外键 → social_post_targets.target_id
    target_id TEXT NOT NULL
        CHECK (
            length(target_id) = 36
            AND lower(target_id) = target_id
            AND target_id GLOB '????????-????-7???-[89ab]???-????????????'
            AND replace(target_id, '-', '') NOT GLOB '*[^0-9a-f]*'
        ),
    platform TEXT NOT NULL,
    -- 采样时刻（epoch millis）。读取时取每 target 的最新一行，绝不 SUM。
    sampled_at INTEGER NOT NULL,
    likes INTEGER NOT NULL DEFAULT 0,
    comments INTEGER NOT NULL DEFAULT 0,
    shares INTEGER NOT NULL DEFAULT 0,
    views INTEGER,
    impressions INTEGER,
    saves INTEGER,
    -- 平台原始指标响应（便于新增指标时不必立刻改表）
    raw_json TEXT
);

CREATE INDEX idx_social_metrics_target ON social_metrics (target_id, sampled_at DESC);
