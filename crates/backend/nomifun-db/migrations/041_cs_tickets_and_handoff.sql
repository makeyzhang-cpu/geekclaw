-- Lightweight tickets + human takeover plumbing for the customer-service
-- console (workbench) introduced in 5.0.22.
--
-- Design goals:
-- 1. `cs_tickets` is a flat standalone aggregate: a single ticket row can
--    optionally anchor a dialogue (when raised from a chat) but the workbench
--    can also create tickets proactively (no chat). No physical FKs.
-- 2. `cs_dialogues.state` is widened so the AI routing layer can observe a
--    `human` takeover mode without going around it (the engine simply returns
--    `Ok("")` for human-taken dialogues).
-- 3. `cs_messages.sender_kind` distinguishes AI vs. human-authored messages
--    so the workbench UI can render the operator's badge separately.
--
-- All timestamps are unix epoch seconds (matches cs_* sibling tables).

-- ── 1. Extend cs_messages with sender_kind ──────────────────────────────────
ALTER TABLE cs_messages ADD COLUMN sender_kind TEXT NOT NULL DEFAULT 'ai'
    CHECK (sender_kind IN ('ai', 'human'));

-- ── 2. Extend cs_dialogues state to include human takeover ─────────────────
-- SQLite CHECK constraints cannot be relaxed in place, so rebuild the table.
CREATE TABLE cs_dialogues_new (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    cs_dialogue_id    TEXT NOT NULL UNIQUE
                      CHECK (
                          length(cs_dialogue_id) = 36
                          AND lower(cs_dialogue_id) = cs_dialogue_id
                          AND cs_dialogue_id GLOB '????????-????-7???-[89ab]???-????????????'
                          AND replace(cs_dialogue_id, '-', '') NOT GLOB '*[^0-9a-f]*'
                      ),
    cs_agent_id       TEXT NOT NULL
                      CHECK (
                          length(cs_agent_id) = 36
                          AND lower(cs_agent_id) = cs_agent_id
                          AND cs_agent_id GLOB '????????-????-7???-[89ab]???-????????????'
                          AND replace(cs_agent_id, '-', '') NOT GLOB '*[^0-9a-f]*'
                      ),
    channel_plugin_id TEXT NOT NULL
                      CHECK (
                          length(channel_plugin_id) = 36
                          AND lower(channel_plugin_id) = channel_plugin_id
                          AND channel_plugin_id GLOB '????????-????-7???-[89ab]???-????????????'
                          AND replace(channel_plugin_id, '-', '') NOT GLOB '*[^0-9a-f]*'
                      ),
    channel_user_id   TEXT NOT NULL
                      CHECK (
                          length(channel_user_id) = 36
                          AND lower(channel_user_id) = channel_user_id
                          AND channel_user_id GLOB '????????-????-7???-[89ab]???-????????????'
                          AND replace(channel_user_id, '-', '') NOT GLOB '*[^0-9a-f]*'
                      ),
    chat_id           TEXT NOT NULL,
    state             TEXT NOT NULL DEFAULT 'ai'
                      CHECK (state IN ('ai', 'human', 'closed')),
    taken_by          TEXT
                      CHECK (
                          taken_by IS NULL
                          OR (
                              length(taken_by) = 36
                              AND lower(taken_by) = taken_by
                              AND taken_by GLOB '????????-????-7???-[89ab]???-????????????'
                              AND replace(taken_by, '-', '') NOT GLOB '*[^0-9a-f]*'
                          )
                      ),
    created_at        INTEGER NOT NULL,
    last_activity     INTEGER NOT NULL
);
INSERT INTO cs_dialogues_new (
    id, cs_dialogue_id, cs_agent_id, channel_plugin_id, channel_user_id,
    chat_id, state, taken_by, created_at, last_activity
)
SELECT
    id, cs_dialogue_id, cs_agent_id, channel_plugin_id, channel_user_id,
    chat_id,
    CASE WHEN state = 'closed' THEN 'closed' ELSE 'ai' END,
    NULL,
    created_at,
    last_activity
FROM cs_dialogues;
DROP TABLE cs_dialogues;
ALTER TABLE cs_dialogues_new RENAME TO cs_dialogues;
-- 一人一线: one dialogue per (bot, visitor, chat) triple.
CREATE UNIQUE INDEX idx_cs_dialogues_identity
    ON cs_dialogues(channel_plugin_id, channel_user_id, chat_id);
CREATE INDEX idx_cs_dialogues_agent ON cs_dialogues(cs_agent_id, last_activity);
CREATE INDEX idx_cs_dialogues_channel_user ON cs_dialogues(channel_user_id);
CREATE INDEX idx_cs_dialogues_state ON cs_dialogues(state, last_activity);
CREATE INDEX idx_cs_dialogues_taken_by ON cs_dialogues(taken_by) WHERE taken_by IS NOT NULL;

-- ── 3. cs_tickets ───────────────────────────────────────────────────────────
-- Lightweight operator-side tickets. Distinct from cs_dialogues (which is the
-- visitor's chat conversation). One ticket may reference a dialogue; one
-- dialogue may produce multiple tickets over its lifetime.
CREATE TABLE cs_tickets (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    cs_ticket_id   TEXT NOT NULL UNIQUE
                   CHECK (
                       length(cs_ticket_id) = 36
                       AND lower(cs_ticket_id) = cs_ticket_id
                       AND cs_ticket_id GLOB '????????-????-7???-[89ab]???-????????????'
                       AND replace(cs_ticket_id, '-', '') NOT GLOB '*[^0-9a-f]*'
                   ),
    title          TEXT NOT NULL CHECK (trim(title) <> ''),
    description    TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'in_progress', 'resolved', 'cancelled')),
    priority       TEXT NOT NULL DEFAULT 'normal'
                   CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    -- Optional linkage to the visitor conversation that spawned the ticket.
    cs_dialogue_id TEXT
                   CHECK (
                       cs_dialogue_id IS NULL
                       OR (
                           length(cs_dialogue_id) = 36
                           AND lower(cs_dialogue_id) = cs_dialogue_id
                           AND cs_dialogue_id GLOB '????????-????-7???-[89ab]???-????????????'
                           AND replace(cs_dialogue_id, '-', '') NOT GLOB '*[^0-9a-f]*'
                       )
                   ),
    -- The AI agent under which the ticket is filed (for routing + permissions).
    cs_agent_id    TEXT
                   CHECK (
                       cs_agent_id IS NULL
                       OR (
                           length(cs_agent_id) = 36
                           AND lower(cs_agent_id) = cs_agent_id
                           AND cs_agent_id GLOB '????????-????-7???-[89ab]???-????????????'
                           AND replace(cs_agent_id, '-', '') NOT GLOB '*[^0-9a-f]*'
                       )
                   ),
    -- Operator user id (v3 cs_user_id) currently assigned. NULL = unassigned.
    assignee_id    TEXT
                   CHECK (
                       assignee_id IS NULL
                       OR (
                           length(assignee_id) = 36
                           AND lower(assignee_id) = assignee_id
                           AND assignee_id GLOB '????????-????-7???-[89ab]???-????????????'
                           AND replace(assignee_id, '-', '') NOT GLOB '*[^0-9a-f]*'
                       )
                   ),
    visitor_name   TEXT NOT NULL DEFAULT '',
    visitor_handle TEXT NOT NULL DEFAULT '',
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
);
CREATE INDEX idx_cs_tickets_status ON cs_tickets(status, updated_at);
CREATE INDEX idx_cs_tickets_agent ON cs_tickets(cs_agent_id, status);
CREATE INDEX idx_cs_tickets_assignee ON cs_tickets(assignee_id, status);
CREATE INDEX idx_cs_tickets_dialogue ON cs_tickets(cs_dialogue_id);
