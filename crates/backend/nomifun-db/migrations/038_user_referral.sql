-- Per-user self-serve referral ("分享邀约有奖分销") support.
--
-- Each user gets a personal, unique `invite_code` used to build their share
-- link (https://www.geekclaw.ai/register?invite=<code>). When someone
-- registers with another user's code we stamp `invited_by` on the new account
-- and grant bidirectional credits (signup bonus to the invitee + an affiliate
-- reward to the referrer) via the existing `credit_transactions` ledger.
--
-- Both columns are nullable, non-`_id` TEXT, so neither needs registration in
-- the v3 logical-reference contract (mirrors the `phone` column added in
-- 036_add_user_phone.sql).

ALTER TABLE users ADD COLUMN invite_code TEXT;
ALTER TABLE users ADD COLUMN invited_by TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_code ON users(invite_code);
