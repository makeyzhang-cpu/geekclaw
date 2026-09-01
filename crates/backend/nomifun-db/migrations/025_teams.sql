-- Team Agent composer: persisted teams and their member roster (GeekClaw #72).
--
-- Phase 1 persists the composer result: a named team owned by one user, a
-- selected workflow template, and a roster of expert persona keys (2..=5). The
-- roster is normalized into `team_members` so later phases (#73 consensus engine,
-- #74 cron/requirement fusion) can bind each member to a concrete agent_id and
-- run them as a coordinated unit.
--
-- Invariants (verified against id_schema_contract on every boot):
--   * Each table has `id INTEGER PRIMARY KEY AUTOINCREMENT` + a bare UUIDv7
--     business id with the standard GLOB/length/lowercase CHECK.
--   * No physical FOREIGN KEY. `owner_user_id` is a logical reference to
--     users.user_id (Cascade); `team_members.team_id` is a logical reference to
--     teams.team_id (Cascade) — deleting a team also drops its roster at the
--     repository layer (no FK in the SQLite sidecar).
--   * `owner_user_id` and `team_members.team_id` are CanonicalUuidV7 logical
--     references, so they carry the same UUIDv7 CHECK the contract requires
--     (mirrors terminal_sessions.user_id / ssh_hosts.user_id).

CREATE TABLE teams (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id                 TEXT NOT NULL UNIQUE
                            CHECK (
                                length(team_id) = 36
                                AND lower(team_id) = team_id
                                AND team_id GLOB '????????-????-7???-[89ab]???-????????????'
                                AND replace(team_id, '-', '') NOT GLOB '*[^0-9a-f]*'
                            ),
    owner_user_id           TEXT NOT NULL
                            CHECK (
                                length(owner_user_id) = 36
                                AND lower(owner_user_id) = owner_user_id
                                AND owner_user_id GLOB '????????-????-7???-[89ab]???-????????????'
                                AND replace(owner_user_id, '-', '') NOT GLOB '*[^0-9a-f]*'
                            ),
    name                    TEXT NOT NULL,
    description             TEXT,
    -- Selected workflow template key (see ui WORKFLOW_TEMPLATES), e.g.
    -- "productEvaluation" | "featureDev" | "productLaunch" | "pricing" |
    -- "review" | "opportunity". Null until a workflow is chosen.
    workflow_template       TEXT,
    -- JSON array of expert persona keys (see ui EXPERT_PERSONAS), e.g.
    -- ["ceo","cto","munger"]. Mirrors the Phase 1 selectedExperts set.
    expert_keys             TEXT NOT NULL DEFAULT '[]',
    -- Lifecycle: "draft" | "active" | "archived". Composer starts at "draft".
    status                  TEXT NOT NULL DEFAULT 'draft',
    created_at              INTEGER NOT NULL,
    updated_at              INTEGER NOT NULL
);

CREATE INDEX idx_teams_owner_user_id ON teams(owner_user_id);

CREATE TABLE team_members (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    team_member_id         TEXT NOT NULL UNIQUE
                            CHECK (
                                length(team_member_id) = 36
                                AND lower(team_member_id) = team_member_id
                                AND team_member_id GLOB '????????-????-7???-[89ab]???-????????????'
                                AND replace(team_member_id, '-', '') NOT GLOB '*[^0-9a-f]*'
                            ),
    team_id                 TEXT NOT NULL
                            CHECK (
                                length(team_id) = 36
                                AND lower(team_id) = team_id
                                AND team_id GLOB '????????-????-7???-[89ab]???-????????????'
                                AND replace(team_id, '-', '') NOT GLOB '*[^0-9a-f]*'
                            ),
    -- Persona key from EXPERT_PERSONAS (e.g. "ceo"). #73 will add an optional
    -- agent_id binding here once concrete agents are resolved.
    member_key              TEXT NOT NULL,
    -- "lead" | "member". The first selected expert is the lead.
    role                    TEXT NOT NULL DEFAULT 'member',
    created_at              INTEGER NOT NULL
);

CREATE INDEX idx_team_members_team_id ON team_members(team_id);
