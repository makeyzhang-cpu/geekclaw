-- Customer-service: ticket SLA + CSAT ratings (商业闭环).
--
-- 5.0.31 打通了「官网访客 → 挂件 → AI 客服」这条入口，但入口本身不产生商业
-- 价值，客户买的是「可度量的服务质量」。本迁移补上两件能被写进合同的东西：
--
-- 1. 工单 SLA：首次响应时限 / 解决时限 / 违约判定 / 升级标记。
--    没有 SLA，工单就只是一张待办清单，无法对外承诺。
-- 2. CSAT 满意度：访客打分（1-5）+ 可选留言。
--    没有满意度，就没法证明 AI 客服「有用」，续费时拿不出数据。
--
-- 设计说明：
-- 1. SLA 全部做成 `cs_tickets` 上的**非 `_id` 列**，无需触碰 id 契约的三处
--    同步点，对线上数据集零风险（同 037 / 042 的做法）。
-- 2. `cs_ratings` 是**新表**，必须三处同步，缺一会让线上数据集被隔离：
--      a) 本迁移 SQL
--      b) `nomifun-db/src/id_schema_contract.rs` 的 `PRODUCT_TABLES`
--         + 两处 `("cs_ratings", "cs_rating_id")` 登记
--         + `text_ref!` 外键声明
--      c) `tests/id_schema_contract.rs` 的 `EXPECTED_PRODUCT_TABLES`
-- 3. `sla_state` 三态：`none` = 尚未到判定点（未响应/未解决，也未超时），
--    `met` = 在时限内完成，`breached` = 已超时。只有 `none` 态会被 SLA
--    扫描任务重新评估，`met` / `breached` 是终态，避免重复写审计事件。
-- 4. 一个会话只允许评价一次（部分唯一索引），防止刷分。

-- ── 工单 SLA ────────────────────────────────────────────────────────
ALTER TABLE cs_tickets ADD COLUMN first_response_due_at INTEGER;
ALTER TABLE cs_tickets ADD COLUMN first_responded_at INTEGER;
ALTER TABLE cs_tickets ADD COLUMN resolution_due_at INTEGER;
ALTER TABLE cs_tickets ADD COLUMN resolved_at INTEGER;
ALTER TABLE cs_tickets ADD COLUMN closed_at INTEGER;
ALTER TABLE cs_tickets ADD COLUMN sla_state TEXT NOT NULL DEFAULT 'none'
    CHECK (sla_state IN ('none', 'met', 'breached'));
ALTER TABLE cs_tickets ADD COLUMN sla_escalated INTEGER NOT NULL DEFAULT 0
    CHECK (sla_escalated IN (0, 1));

-- SLA 扫描只关心「还没首响」和「还没解决」的开放工单。
CREATE INDEX idx_cs_tickets_sla_first_response
    ON cs_tickets(first_response_due_at)
    WHERE first_responded_at IS NULL AND closed_at IS NULL;
CREATE INDEX idx_cs_tickets_sla_resolution
    ON cs_tickets(resolution_due_at)
    WHERE resolved_at IS NULL AND closed_at IS NULL;

-- ── CSAT 满意度 ─────────────────────────────────────────────────────
CREATE TABLE cs_ratings (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    cs_rating_id   TEXT NOT NULL UNIQUE
                   CHECK (
                       length(cs_rating_id) = 36
                       AND lower(cs_rating_id) = cs_rating_id
                       AND cs_rating_id GLOB '????????-????-7???-[89ab]???-????????????'
                       AND replace(cs_rating_id, '-', '') NOT GLOB '*[^0-9a-f]*'
                   ),
    -- 三个关联列都可空，且必须带「可空 + UUIDv7」的 CHECK：v3 id 契约要求
    -- 所有登记为 text_ref 的业务 id 列无条件满足裸 UUIDv7 形状。
    cs_ticket_id   TEXT
                   CHECK (
                       cs_ticket_id IS NULL
                       OR (
                           length(cs_ticket_id) = 36
                           AND lower(cs_ticket_id) = cs_ticket_id
                           AND cs_ticket_id GLOB '????????-????-7???-[89ab]???-????????????'
                           AND replace(cs_ticket_id, '-', '') NOT GLOB '*[^0-9a-f]*'
                       )
                   ),
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
    score          INTEGER NOT NULL CHECK (score >= 1 AND score <= 5),
    comment        TEXT NOT NULL DEFAULT '',
    source         TEXT NOT NULL DEFAULT 'widget'
                   CHECK (source IN ('widget', 'operator', 'system')),
    created_at     INTEGER NOT NULL
);

-- 部分唯一索引保证一次会话只评价一次；另外两个普通索引供 text_ref! 外键登记引用。
CREATE UNIQUE INDEX idx_cs_ratings_dialogue_unique
    ON cs_ratings(cs_dialogue_id)
    WHERE cs_dialogue_id IS NOT NULL;
CREATE INDEX idx_cs_ratings_dialogue ON cs_ratings(cs_dialogue_id);
CREATE INDEX idx_cs_ratings_ticket ON cs_ratings(cs_ticket_id);
CREATE INDEX idx_cs_ratings_agent ON cs_ratings(cs_agent_id, created_at);
CREATE INDEX idx_cs_ratings_created ON cs_ratings(created_at);
