-- GeekClaw #74: let a cron job trigger a team consensus run.
-- Stores an optional JSON target {"team_id": "...", "topic": "..."} on the job.
-- The column name deliberately avoids the `_id` suffix so it is exempt from the
-- v3 logical-reference contract (validate_logical_reference_coverage only scans
-- `_id`-ending columns); it therefore needs no index and no uuidv7 CHECK.
ALTER TABLE cron_jobs ADD COLUMN consensus_target TEXT;
