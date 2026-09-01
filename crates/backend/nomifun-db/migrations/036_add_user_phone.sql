-- Bind a phone number to the existing users table for phone-number
-- registration / login / password reset.
--
-- `phone` is a nullable, non-`_id` column, so it needs no logical-reference
-- registration. Left nullable (not UNIQUE) because the username is already
-- UNIQUE and phone-number accounts reuse the phone as their username, so a
-- UNIQUE phone would be redundant and would reject username-only accounts.

ALTER TABLE users ADD COLUMN phone TEXT;
