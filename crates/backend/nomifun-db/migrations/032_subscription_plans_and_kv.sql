-- 032: 会员套餐（后台可管理）+ 系统键值存储（支付配置等）
--
-- subscription_plans: 替代原先硬编码在 nomifun-auth 的 SUBSCRIBE_CATALOG。
--   后台可增删改；前台 /api/plans 只返回 enabled=1 的套餐，实现三端一致。
-- system_kv: 通用 key/value 存储，用于存放收银宝商户号/密钥/回调地址等
--   敏感配置（DB 优先、环境变量兜底），使支付接口可在后台配置与管理。

CREATE TABLE subscription_plans (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id      TEXT    NOT NULL,
    name         TEXT    NOT NULL,
    backend_plan TEXT    NOT NULL DEFAULT 'pro',
    price_fen    INTEGER NOT NULL,
    credits      INTEGER NOT NULL DEFAULT 0,
    description  TEXT    NOT NULL DEFAULT '',
    sort_order   INTEGER NOT NULL DEFAULT 0,
    enabled      INTEGER NOT NULL DEFAULT 1,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_subscription_plans_plan_id ON subscription_plans(plan_id);
CREATE INDEX idx_subscription_plans_sort ON subscription_plans(sort_order);

CREATE TABLE system_kv (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    key        TEXT NOT NULL UNIQUE,
    value      TEXT,
    updated_at INTEGER NOT NULL
);
