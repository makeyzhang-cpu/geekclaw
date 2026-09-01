-- GeekClaw payment orders for the 通联收银宝 (Allinpay Cashier) gateway.
--
-- Invariants (verified against id_schema_contract on every boot):
--   * New product table `orders` is added to PRODUCT_TABLES and has
--     `id INTEGER PRIMARY KEY AUTOINCREMENT`.
--   * `orders.user_id` is registered in NON_REFERENCE_ID_COLUMNS (a logical
--     link to users but no FK contract / uuidv7 check). All other columns are
--     deliberately NOT `_id`-suffixed to stay outside the logical-reference
--     contract (the Allinpay transaction handle `trxid` is an opaque remote
--     id, `reqsn` is our merchant order number, `qr_payinfo` the cashier QR).
--   * No physical foreign keys, triggers, or `rowid` aliases — matches the
--     v3 schema rules.

CREATE TABLE orders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT    NOT NULL,                              -- link to users (NON_REFERENCE_ID_COLUMNS)
    plan        TEXT    NOT NULL,                              -- free | pro | team
    period      TEXT    NOT NULL DEFAULT 'monthly',            -- monthly | quarterly | annual
    amount_fen  INTEGER NOT NULL,                              -- order total in 分 (1 CNY = 100 分)
    credits     INTEGER NOT NULL DEFAULT 0,                    -- credit grant applied on payment success
    status      TEXT    NOT NULL DEFAULT 'created',           -- created | paid | failed
    reqsn       TEXT    NOT NULL,                              -- merchant order no (our side, unique)
    trxid       TEXT,                                          -- Allinpay transaction id (set on notify)
    qr_payinfo  TEXT,                                          -- cashier QR string returned by unified order
    created_at  INTEGER NOT NULL,                              -- epoch millis
    paid_at     INTEGER                                        -- epoch millis, set when mark_order_paid runs
);

CREATE UNIQUE INDEX idx_orders_reqsn ON orders(reqsn);
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
