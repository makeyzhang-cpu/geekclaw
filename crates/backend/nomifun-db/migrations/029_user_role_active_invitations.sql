-- User management: per-user role + active flag, and invitation codes
-- (GeekClaw user-management closed-loop).
--
-- Invariants (verified against id_schema_contract on every boot):
--   * `users` gains two non-`_id` columns (role, is_active) — no logical
--     reference registration required.
--   * `invitations` is a fresh product table: it MUST be added to
--     PRODUCT_TABLES, has `id INTEGER PRIMARY KEY AUTOINCREMENT`, and uses
--     `created_by` / `used_by` (deliberately NOT `_id`-suffixed) so it stays
--     outside the logical-reference contract. The `code` is the user-facing
--     random token (UNIQUE), distinct from the autoincrement `id`.

-- 1. Role + active flag on the existing users table.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

-- Seed the oldest existing account as admin so an upgraded single-user install
-- keeps management access. On a fresh install (no users yet) this affects 0
-- rows and setup_handler provisions the owner as admin explicitly.
UPDATE users SET "role" = 'admin' WHERE id = (SELECT MIN(id) FROM users);

-- 2. Invitation codes created by admins and consumed on registration.
CREATE TABLE invitations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT NOT NULL UNIQUE,
    created_by  TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    used_by     TEXT,
    used_at     INTEGER
);

CREATE INDEX idx_invitations_created_by ON invitations(created_by);
CREATE INDEX idx_invitations_used_by ON invitations(used_by);
