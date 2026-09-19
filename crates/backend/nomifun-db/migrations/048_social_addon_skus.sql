-- 048: 海外社媒矩阵加装包 SKU（4 个档位）
--
-- 背景（定价 v2，2026-09-17 定）：社媒矩阵**完全不进套餐** —— basic → trade-flagship
-- 五档一律 0 组，任何用户想用都必须单独购买加装包。因此加装包必须是**可下单的
-- 一等 SKU**，不能只是定价页上的一段文字说明。
--
-- 计价单位「品牌账号组」的口径见迁移 047 的文件头（各平台账号数的最大值）。
--
-- ── 关于 backend_plan 的编码（改动前必读）──────────────────────────────
-- `subscribe_handler` 把 `backend_plan` 原样写进 `orders.plan`，而
-- `finalize_paid_order` 只看 `orders.plan` 分流。因此这里用**前缀 + 组数**编码：
--   backend_plan = 'social_addon_1' / 'social_addon_3' / 'social_addon_6' / 'social_addon_10'
-- 后端 `PLAN_SOCIAL_ADDON_PREFIX` 解析出组数直接发放额度。若把 backend_plan 改成
-- 别的形状（比如只写 'social'），履约会掉进套餐分支、把 `users.plan` 写成
-- 'social_addon_x' —— 用户的套餐档位会被静默写坏。改这里必须同步改
-- `nomifun-auth::routes::social_addon_groups`。
--
-- ── 年价为什么不是一个公式算出来的 ──────────────────────────────────────
-- 年付优惠按档位不同：1 组 / 3 组 = **11 个月价**，6 组 / 10 组 = **10 个月价**。
-- 与 044 迁移的说明一致 —— 全局折扣系数算不出这些数，所以逐档写死 `price_year_fen`。
--
-- ── 定价依据（2026-09-17 核算）──────────────────────────────────────────
-- 起步期单组 **¥1,299** 是**保本线**：聚合商 Ayrshare Premium 档 $149/月
-- ≈ ¥1,073，低于它每卖一个客户就亏一个。主推 3 组包 ¥2,999（约 28% 毛利），
-- 6 组 ¥4,999（约 57%）、10 组 ¥6,999（约 69%）用于拉高客单。
-- **单组包绝不参与任何套餐折扣**（见前端 `planCatalog.ts` 的 `SOCIAL_ADDON_SKUS`）。
--
-- 用 `INSERT OR IGNORE`：万一运营已手工建过同名 SKU，不要覆盖他调好的价格。
-- 建完仍可继续在管理后台改价（`subscription_plans` 是价格真源）。

INSERT OR IGNORE INTO subscription_plans
    (plan_id, name, backend_plan, price_fen, price_year_fen, credits, description, sort_order, enabled, created_at, updated_at)
VALUES
    (
        'social-1',
        '海外社媒矩阵 · 1 组',
        'social_addon_1',
        129900,          -- ¥1,299 / 月
        1428900,         -- ¥14,289 / 年（= 11 个月价）
        0,               -- 加装包**不送算力**：额度记在 users.social_groups 上
        '1 个品牌账号组：1 个品牌可在 LinkedIn / Facebook / Instagram / YouTube / TikTok 各连 1 个账号。不包含在任何套餐内，需单独购买。',
        100,
        1,
        CAST(strftime('%s', 'now') AS INTEGER) * 1000,
        CAST(strftime('%s', 'now') AS INTEGER) * 1000
    ),
    (
        'social-3',
        '海外社媒矩阵 · 3 组（主推）',
        'social_addon_3',
        299900,          -- ¥2,999 / 月
        3298900,         -- ¥32,989 / 年（= 11 个月价）
        0,
        '3 个品牌账号组：适合同时运营 3 个品牌 / 站点的团队。相比单组包单价更省，是我们推荐的主力档位。',
        101,
        1,
        CAST(strftime('%s', 'now') AS INTEGER) * 1000,
        CAST(strftime('%s', 'now') AS INTEGER) * 1000
    ),
    (
        'social-6',
        '海外社媒矩阵 · 6 组',
        'social_addon_6',
        499900,          -- ¥4,999 / 月
        4999000,         -- ¥49,990 / 年（= 10 个月价）
        0,
        '6 个品牌账号组：矩阵化运营与代运营团队的常用规模。年付按 10 个月计费。',
        102,
        1,
        CAST(strftime('%s', 'now') AS INTEGER) * 1000,
        CAST(strftime('%s', 'now') AS INTEGER) * 1000
    ),
    (
        'social-10',
        '海外社媒矩阵 · 10 组',
        'social_addon_10',
        699900,          -- ¥6,999 / 月
        6999000,         -- ¥69,990 / 年（= 10 个月价）
        0,
        '10 个品牌账号组：多品牌 / 多市场矩阵的批量档位，单组成本最低。年付按 10 个月计费。',
        103,
        1,
        CAST(strftime('%s', 'now') AS INTEGER) * 1000,
        CAST(strftime('%s', 'now') AS INTEGER) * 1000
    );
