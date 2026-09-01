-- Team consensus engine (GeekClaw #73).
--
-- A "consensus run" is a multi-round deliberation loop where each member
-- persona of a team takes a turn (via the stateless one-shot LLM turn
-- primitive) and a synthesizer persona produces a round summary / convergence
-- assessment. The loop runs in the background until consensus is reached or
-- max_rounds is hit. This is the persistence layer for that state machine;
-- it is intentionally decoupled from `conversations`/`messages` so the team
-- lifecycle (and its future #74 cron / requirement fusion) stays self-contained.
--
-- Invariants (verified against id_schema_contract on every boot):
--   * Each table has `id INTEGER PRIMARY KEY AUTOINCREMENT` + a bare UUIDv7
--     business id with the standard GLOB/length/lowercase CHECK.
--   * No physical FOREIGN KEY; team_id / run_id / owner_user_id are logical
--     references (Cascade) registered in LOGICAL_REFERENCES.
--   * owner_user_id carries the same UUIDv7 CHECK users.user_id requires
--     (mirrors ssh_hosts.user_id / terminal_sessions.user_id).

CREATE TABLE team_consensus_runs (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id                  TEXT NOT NULL UNIQUE
                            CHECK (
                                length(run_id) = 36
                                AND lower(run_id) = run_id
                                AND run_id GLOB '????????-????-7???-[89ab]???-????????????'
                                AND replace(run_id, '-', '') NOT GLOB '*[^0-9a-f]*'
                            ),
    team_id                 TEXT NOT NULL
                            CHECK (
                                length(team_id) = 36
                                AND lower(team_id) = team_id
                                AND team_id GLOB '????????-????-7???-[89ab]???-????????????'
                                AND replace(team_id, '-', '') NOT GLOB '*[^0-9a-f]*'
                            ),
    owner_user_id           TEXT NOT NULL,
    -- idle | running | consensus_reached | max_rounds | cancelled | error
    status                  TEXT NOT NULL DEFAULT 'idle',
    current_round           INTEGER NOT NULL DEFAULT 0,
    max_rounds              INTEGER NOT NULL DEFAULT 6,
    topic                   TEXT NOT NULL,
    provider_id             TEXT,
    model                   TEXT,
    -- Final synthesizer output / error message once the run terminates.
    summary                 TEXT,
    started_at              INTEGER,
    finished_at             INTEGER,
    created_at              INTEGER NOT NULL,
    updated_at              INTEGER NOT NULL,
    CHECK (length(owner_user_id) = 36 AND lower(owner_user_id) = owner_user_id AND owner_user_id GLOB '????????-????-7???-[89ab]???-????????????' AND replace(owner_user_id, '-', '') NOT GLOB '*[^0-9a-f]*')
);

CREATE INDEX idx_team_consensus_runs_team_id ON team_consensus_runs(team_id);
CREATE INDEX idx_team_consensus_runs_owner_user_id ON team_consensus_runs(owner_user_id);

CREATE TABLE team_consensus_messages (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id              TEXT NOT NULL UNIQUE
                            CHECK (
                                length(message_id) = 36
                                AND lower(message_id) = message_id
                                AND message_id GLOB '????????-????-7???-[89ab]???-????????????'
                                AND replace(message_id, '-', '') NOT GLOB '*[^0-9a-f]*'
                            ),
    run_id                  TEXT NOT NULL
                            CHECK (
                                length(run_id) = 36
                                AND lower(run_id) = run_id
                                AND run_id GLOB '????????-????-7???-[89ab]???-????????????'
                                AND replace(run_id, '-', '') NOT GLOB '*[^0-9a-f]*'
                            ),
    team_id                 TEXT NOT NULL
                            CHECK (
                                length(team_id) = 36
                                AND lower(team_id) = team_id
                                AND team_id GLOB '????????-????-7???-[89ab]???-????????????'
                                AND replace(team_id, '-', '') NOT GLOB '*[^0-9a-f]*'
                            ),
    -- Round number this message belongs to (1-based).
    round                   INTEGER NOT NULL DEFAULT 1,
    -- The persona key (member_key) that produced this message.
    speaker_member_key      TEXT NOT NULL,
    -- member | synthesis | system
    role                    TEXT NOT NULL DEFAULT 'member',
    content                 TEXT NOT NULL,
    created_at              INTEGER NOT NULL,
    CHECK (length(team_id) = 36 AND lower(team_id) = team_id AND team_id GLOB '????????-????-7???-[89ab]???-????????????' AND replace(team_id, '-', '') NOT GLOB '*[^0-9a-f]*')
);

CREATE INDEX idx_team_consensus_messages_run_id ON team_consensus_messages(run_id);
CREATE INDEX idx_team_consensus_messages_team_id ON team_consensus_messages(team_id);
