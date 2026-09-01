-- GeekClaw unified economy: plan tiers + credits ledger + model pricing +
-- invitation bidirectional rewards (mirrors the WorkBuddy growth/billing loop).
--
-- Invariants (verified against id_schema_contract on every boot):
--   * New product tables `credit_transactions` and `model_pricing` are added to
--     PRODUCT_TABLES and each has `id INTEGER PRIMARY KEY AUTOINCREMENT`.
--   * `credit_transactions.user_id` is registered in NON_REFERENCE_ID_COLUMNS
--     (it is a logical link to users but carries no FK contract / uuidv7
--     check). `model_pricing` uses `provider` / `model` columns (deliberately
--     NOT `_id`-suffixed) so it stays outside the logical-reference contract.
--   * `users.plan` / `users.credits` and the new `invitations` columns are all
--     non-`_id` and need no reference registration.

-- 1. Plan tier + credits wallet on the existing users table.
ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN credits INTEGER NOT NULL DEFAULT 0;

-- One-time welcome grant for accounts that already existed before this
-- migration (new registrations receive SIGNUP_BONUS via the register flow).
-- 1000 is a demoable default; adjust to taste.
UPDATE users SET credits = 1000 WHERE credits = 0;

-- 2. Credits ledger: every balance change is an append-only row.
CREATE TABLE credit_transactions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT    NOT NULL,
    tx_type       TEXT    NOT NULL,   -- consume | grant | refund | invite_reward | signup_bonus | monthly_grant | adjust
    amount        INTEGER NOT NULL,   -- signed: positive = credit, negative = debit
    balance_after INTEGER NOT NULL,   -- wallet balance right after this tx
    ref_type      TEXT,               -- conversation | invitation | admin | system
    ref_value     TEXT,               -- related id / invitation code / admin note key
    note          TEXT,
    created_at    INTEGER NOT NULL
);

CREATE INDEX idx_credit_transactions_user_id ON credit_transactions(user_id);
CREATE INDEX idx_credit_transactions_created_at ON credit_transactions(created_at);

-- 3. Model pricing: cost in credits per 1k tokens, keyed by (provider, model, task).
--    `provider` / `model` store the same string values as `provider_models`
--    (provider_id / model) so the AI billing path can look the price up by the
--    exact model it just used. A DEFAULT_RATE fallback in code covers any model
--    not present here; admins edit these rows from the pricing UI.
CREATE TABLE model_pricing (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    provider                 TEXT    NOT NULL,
    model                    TEXT    NOT NULL,
    task                     TEXT    NOT NULL DEFAULT 'Chat',
    input_credits_per_1k     REAL    NOT NULL DEFAULT 0,
    output_credits_per_1k    REAL    NOT NULL DEFAULT 0,
    cache_read_credits_per_1k REAL   NOT NULL DEFAULT 0,
    currency                 TEXT    NOT NULL DEFAULT 'credits',
    updated_at               INTEGER NOT NULL,
    UNIQUE (provider, model, task)
);

CREATE INDEX idx_model_pricing_lookup ON model_pricing(provider, model, task);

-- Seed sensible default prices (credits per 1k tokens; ~1 credit ≈ $0.001).
-- These are starting points — override from the pricing UI per your real rates.
INSERT OR IGNORE INTO model_pricing
    (provider, model, task, input_credits_per_1k, output_credits_per_1k, cache_read_credits_per_1k, currency, updated_at)
VALUES
    ('openai',      'gpt-4o',           'Chat', 2.5,  10.0, 1.25, 'credits', 0),
    ('openai',      'gpt-4o-mini',      'Chat', 0.15, 0.6,  0.075,'credits', 0),
    ('anthropic',   'claude-3-5-sonnet','Chat', 3.0,  15.0, 0.375,'credits', 0),
    ('anthropic',   'claude-3-haiku',   'Chat', 0.25, 1.25, 0.03, 'credits', 0),
    ('google',      'gemini-1.5-pro',   'Chat', 1.25, 5.0,  0.31, 'credits', 0),
    ('google',      'gemini-1.5-flash', 'Chat', 0.075,0.3,  0.018,'credits', 0),
    ('deepseek',    'deepseek-chat',    'Chat', 0.27, 1.1,  0.07, 'credits', 0);

-- 4. Invitation codes can now carry a plan + credit rewards for the growth loop.
ALTER TABLE invitations ADD COLUMN plan TEXT;                    -- plan granted to the invitee (NULL = default)
ALTER TABLE invitations ADD COLUMN credits_grant INTEGER NOT NULL DEFAULT 0;     -- initial credits for the invitee
ALTER TABLE invitations ADD COLUMN reward_to_inviter INTEGER NOT NULL DEFAULT 0; -- credits rewarded to the inviter on success
