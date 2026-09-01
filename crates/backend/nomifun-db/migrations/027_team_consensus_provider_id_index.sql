-- GeekClaw #73: add the missing index on team_consensus_runs.provider_id.
-- Migration 026 created the column as nullable TEXT on already-shipped datasets;
-- this follow-up migration only adds the index required by id_schema_contract.
CREATE INDEX IF NOT EXISTS idx_team_consensus_runs_provider_id ON team_consensus_runs(provider_id);
