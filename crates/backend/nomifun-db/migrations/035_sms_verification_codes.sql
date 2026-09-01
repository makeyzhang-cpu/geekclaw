-- SMS verification codes for phone-number registration / login / password reset.
--
-- Invariants (verified against id_schema_contract on every boot):
--   * `sms_verification_codes` is a fresh product table: it MUST be listed in
--     PRODUCT_TABLES, has `id INTEGER PRIMARY KEY AUTOINCREMENT`, and uses
--     `phone` (deliberately NOT `_id`-suffixed) so it stays outside the
--     logical-reference contract. No `user_id` column is stored, so no
--     reference registration is required.

CREATE TABLE sms_verification_codes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    phone       TEXT NOT NULL,
    code        TEXT NOT NULL,
    purpose     TEXT NOT NULL,        -- 'register' | 'reset'
    expires_at  INTEGER NOT NULL,     -- epoch ms
    created_at  INTEGER NOT NULL,     -- epoch ms
    used        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_sms_codes_phone_purpose ON sms_verification_codes(phone, purpose);
CREATE INDEX idx_sms_codes_created_at ON sms_verification_codes(created_at);
