-- 034: 修复 system_kv 表以符合 v3 schema 契约
--
-- system_kv 在 032 中以 `key TEXT PRIMARY KEY` 创建，缺少 v3 PRODUCT_TABLES 要求的
-- `id INTEGER PRIMARY KEY AUTOINCREMENT` 自增主键，导致启动时 DbError::Init。
-- 本迁移通过重命名重建表，保留已有 key/value 数据。

CREATE TABLE system_kv_new (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    key        TEXT NOT NULL UNIQUE,
    value      TEXT,
    updated_at INTEGER NOT NULL
);

INSERT INTO system_kv_new (key, value, updated_at)
SELECT key, value, updated_at FROM system_kv;

DROP TABLE system_kv;
ALTER TABLE system_kv_new RENAME TO system_kv;

-- key 仍是业务主键，保持唯一索引以兼容既有查询与约束。
CREATE UNIQUE INDEX idx_system_kv_key ON system_kv(key);
