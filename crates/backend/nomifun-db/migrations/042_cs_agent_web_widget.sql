-- Customer-service: public web-chat widget (官网访客挂件).
--
-- Turns a CS agent into an embeddable website chat widget: a customer drops
-- one `<script>` tag on their site and visitors talk to the agent anonymously.
-- This is the commercial entry point of the customer-service domain — without
-- it the agent can only be reached over IM channels (WeCom / WeChat) that
-- require the visitor to already be on those platforms.
--
-- Design notes:
-- 1. NO new table. Visitor conversations reuse `cs_dialogues` + `cs_messages`
--    and the existing `CsDialogueEngine`. The domain's `channel_user_id`
--    column is strict-uuidv7, so the anonymous visitor is identified by a
--    backend-signed token carrying a uuidv7 visitor id — see the
--    `nomifun-customer-service` widget module. Adding a table here would
--    require registering it in `PRODUCT_TABLES` (three sync points) and risks
--    quarantining live datasets, so we deliberately avoid it.
-- 2. `widget_key` is the PUBLIC identifier embedded in the customer's site.
--    It is a random unguessable string (NOT the cs_agent_id, which appears in
--    other surfaces) and can be rotated without touching the agent identity.
-- 3. `widget_allowed_origins` is a JSON array of permitted page origins;
--    an empty array means "allow any origin" (easy start, tightened later).
-- 4. All four columns are non-`_id` columns (plain config payloads / flags),
--    so none of them need logical-reference registration.

ALTER TABLE cs_agents ADD COLUMN widget_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (widget_enabled IN (0, 1));

-- Nullable public identifier, lazily minted when the widget is first enabled.
-- Partial unique index so several agents can keep it NULL.
ALTER TABLE cs_agents ADD COLUMN widget_key TEXT;
CREATE UNIQUE INDEX idx_cs_agents_widget_key
    ON cs_agents(widget_key) WHERE widget_key IS NOT NULL;

ALTER TABLE cs_agents ADD COLUMN widget_allowed_origins TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(widget_allowed_origins) AND json_type(widget_allowed_origins) = 'array');

-- Theme/appearance payload: {color, position, title, subtitle, ...}.
ALTER TABLE cs_agents ADD COLUMN widget_theme TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(widget_theme) AND json_type(widget_theme) = 'object');
