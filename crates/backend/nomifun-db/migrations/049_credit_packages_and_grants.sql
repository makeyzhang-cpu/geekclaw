-- 049: 积分加油包 SKU + 订阅积分发放规则 + 注册默认积分
--
-- 背景（v5.0.69 定价/计费重构，2026-09-18 定）：
-- 按用户决定，积分与 Token 1:1 兑换：
--   - 注册用户初始送 10 万 积分 = 10 万 Token
--   - 月度订阅送 100 万 积分 = 100 万 Token
--   - 年度订阅送 1 亿 积分 = 1 亿 Token
--   - 加油包：100 元 = 100 万 积分；500 元 = 500 万；2000 元 = 2000 万；10000 元 = 1 亿
--   - 本地模型 + 用户自配 provider 模型 → 不扣积分
--
-- 这条迁移做三件事：
--   ① 把 `users.credits` 的默认值改成 100000（新注册直接拿 10 万）
--   ② 给 `subscription_plans` 加 `credits_per_cycle` 列（每个订阅周期发的积分数）
--   ③ 插入 4 行加油包 SKU（plan_id=credit-100/500/2000/10000）
-- ④ 把所有月度订阅档的 `credits_per_cycle` 设成 1000000；年度订阅设成 100000000
-- ⑤ 社媒加装包 + 硬件押金的 credits_per_cycle = 0（不送积分）
--
-- ── 订阅积分发放位置 ───────────────────────────────────────────────
-- 月/年订阅的 `credits_per_cycle` 由 `subscribe_handler` 在 `plan_grants` 一并发放
-- （与 `expires_at` 同步推进）；履约逻辑见 `nomifun-auth::routes::subscribe_handler`
-- 的 `grant_subscription_credits` 调用点（本次 PR 同步加）。
--
-- ── 加油包下单模式 ─────────────────────────────────────────────────
-- 与 social_addon 完全一致：`backend_plan = 'credit_addon_<金额>'`，
-- `finalize_paid_order` 按前缀匹配发放额度（`users.credits += credits_per_cycle`）。
-- 因此 backend_plan 严禁改成其它形状，否则履约会落到套餐分支、写坏 users.plan。
--
-- ── 已存在的 registration_grant 迁移 ───────────────────────────────
-- 用户表 `registration_grant` 列早就有（v0.4.1 之前已加），表示注册时是否发过赠送；
-- 本迁移只改 credits 默认值，不动该列，保证老用户 history 不变。

-- (1) 新注册默认 10 万积分（100000 = 10万 Token；1:1）。
--     不 UPDATE 存量用户余额，避免破坏既有计费历史。
ALTER TABLE users ALTER COLUMN credits SET DEFAULT 100000;

-- (2) subscription_plans 加 credits_per_cycle（每个订阅周期发放的积分数）。
--     月度档 = 1,000,000；年度档 = 100,000,000；社媒加装包 / 硬件押金 = 0。
ALTER TABLE subscription_plans
    ADD COLUMN credits_per_cycle INTEGER NOT NULL DEFAULT 0;

-- (3) 把现有 5 档套餐的 credits_per_cycle 填值（月度档 100 万；年度档 1 亿）。
--     注意：plan_id 含 "year" 的视为年度档，其它月度档一律 100 万。
UPDATE subscription_plans
SET credits_per_cycle = CASE
    WHEN plan_id LIKE '%year%'  THEN 100000000  -- 1 亿
    WHEN plan_id IN ('basic', 'geo', 'trade-biz', 'trade-ops', 'trade-flagship') THEN 1000000  -- 100 万
    ELSE credits_per_cycle
END
WHERE plan_id NOT LIKE 'credit-%';

-- (4) 加油包 4 个 SKU（plan_id=credit-100/500/2000/10000）。
--     价格单位「分」(fen)；credits_per_cycle 是发放的积分数（=Token 数）。
INSERT OR IGNORE INTO subscription_plans
    (plan_id, name, backend_plan, price_fen, price_year_fen, credits, credits_per_cycle, description, sort_order, enabled, created_at, updated_at)
VALUES
    (
        'credit-100',
        '加油包 · 100 万积分',
        'credit_addon_100',
        10000,           -- 100 元
        1000000,         -- 10000 元/年（10×10000；月度加油包无年付优惠语义，但占位填 10000）
        1000000,         -- 历史兼容字段：credits = 100 万（与 credits_per_cycle 同值）
        1000000,         -- 实际履约发放 100 万积分
        '100 元 = 100 万 积分（= 100 万 Token，1:1）。适合个人试水与短期补量。',
        200,
        1,
        CAST(strftime('%s', 'now') AS INTEGER) * 1000,
        CAST(strftime('%s', 'now') AS INTEGER) * 1000
    ),
    (
        'credit-500',
        '加油包 · 500 万积分',
        'credit_addon_500',
        50000,           -- 500 元
        5000000,         -- 占位
        5000000,
        5000000,
        '500 元 = 500 万 积分。适合中等规模团队一两个月的会话消耗。',
        201,
        1,
        CAST(strftime('%s', 'now') AS INTEGER) * 1000,
        CAST(strftime('%s', 'now') AS INTEGER) * 1000
    ),
    (
        'credit-2000',
        '加油包 · 2000 万积分',
        'credit_addon_2000',
        200000,          -- 2000 元
        20000000,
        20000000,
        20000000,
        '2000 元 = 2000 万 积分。适合代运营 / 中小企业的稳定月耗。',
        202,
        1,
        CAST(strftime('%s', 'now') AS INTEGER) * 1000,
        CAST(strftime('%s', 'now') AS INTEGER) * 1000
    ),
    (
        'credit-10000',
        '加油包 · 1 亿积分',
        'credit_addon_10000',
        1000000,         -- 10000 元
        100000000,
        100000000,
        100000000,
        '10000 元 = 1 亿 积分。大型团队 / 企业年用量，单价最低。',
        203,
        1,
        CAST(strftime('%s', 'now') AS INTEGER) * 1000,
        CAST(strftime('%s', 'now') AS INTEGER) * 1000
    );