-- 045: 硬件押金订单（端侧算力盒子「押金 ¥10,000/台」）的履约信息
--
-- 背景（2026-09-16 用户反馈）：「套餐与定价」页的【押金10,000元/台】原先只是一段
-- 静态说明，既不能点击支付，收款后也没有收货地址回流，管理后台无从发货。用户
-- 要求「可以直接点击支付押金，支付押金后有一个提交收货地址，这个需要直接将数据
-- 同步到管理后台，管理后台可以根据地址来发货」。
--
-- 与 `orders` 表的分工（务必别把两张表混起来）：
-- 1. **支付流水仍然走 `orders`**。押金单在 `orders` 里落一行，`plan =
--    'hardware_deposit'`、`period = 'hardware_deposit'`、`credits = 0`。
--    这样收银宝「异步通知 / 主动查单 / 取消订单」三条既有链路一行都不用改，
--    订单号 `reqsn` 就是两张表之间的关联键（本表 reqsn UNIQUE）。
-- 2. **本表只承载「履约」信息**：押金金额快照 + 收货地址 + 发货状态。
--    收货地址是**支付完成后**才填写的，所以必须能与支付订单解耦地后置写入。
-- 3. `finalize_paid_order` 必须对 `plan = 'hardware_deposit'` 走**单独分支**：
--    押金不是套餐 —— 既不能 `set_plan`（会把用户已有档位覆盖成
--    'hardware_deposit' 而丢失套餐），也不能 `add_credits`（押金不送算力），
--    而是把本表的履约行标记为 `paid`，等用户提交地址后由后台发货。
--
-- id 契约：本表是**新增产品表**，必须同步登记进
-- `crates/backend/nomifun-db/src/id_schema_contract.rs` 的 `PRODUCT_TABLES`。
-- `validate_id_schema_contract` 断言「表集合与 sqlite_schema 完全相等」，
-- 漏登记会让桌面端 v3 引导直接失败（`v3 schema product-table registry mismatch`）。
-- 因此「建表 / 白名单 / 云端重新部署」三件事**不可拆分**。

CREATE TABLE hardware_deposits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- 买家 `user_id`（逻辑外键，与 orders.user_id 同口径，不建 FK 约束）
    user_id TEXT NOT NULL,
    -- 押金金额快照（分）。写死在下单时刻，之后调价不影响历史单。
    deposit_fen INTEGER NOT NULL,
    -- 商户订单号，与 `orders.reqsn` 一一对应；也是收银宝回传的 cusorderid。
    reqsn TEXT NOT NULL UNIQUE,
    -- ── 收货地址（支付完成后由买家提交，未提交时全为 NULL）──
    region TEXT,
    receiver_name TEXT,
    receiver_phone TEXT,
    detail_address TEXT,
    remark TEXT,
    -- 履约状态：created（已下单未付款）| paid（已付款待填地址/待发货）| shipped（已发货）
    status TEXT NOT NULL DEFAULT 'created',
    shipped_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 买家侧「我的押金单」按 user 查；后台发货台按状态 + 时间倒序查。
CREATE INDEX idx_hardware_deposits_user ON hardware_deposits (user_id, created_at DESC);
CREATE INDEX idx_hardware_deposits_status ON hardware_deposits (status, created_at DESC);
