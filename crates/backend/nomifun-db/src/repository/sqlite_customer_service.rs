use nomifun_common::{TimestampMs, validate_uuidv7};
use rand::Rng;
use rand::SeedableRng;
use rand::rngs::StdRng;
use sqlx::SqlitePool;

use crate::error::DbError;
use crate::models::{
    CsAgentRow, CsAuditEventRow, CsChannelBindingRow, CsDialogueRow, CsInboxItem, CsMessageRow,
    CsNoteRow, CsOverviewStats, CsRatingRow, CsTicketRow, CsTicketSlaPatch, NewCsAgentRow,
    NewCsRatingRow, NewCsTicketRow,
};
use crate::repository::customer_service::{
    CsDialogueKey, ICustomerServiceRepository, UpdateCsAgentParams, UpdateCsTicketParams,
};

const AGENT_COLUMNS: &str = "cs_agent_id, name, greeting, persona, service_policy, provider_id, \
     model, knowledge_base_ids, business_endpoints, enabled, max_concurrent, audit_retention_days, \
     created_at, updated_at, widget_enabled, widget_key, widget_allowed_origins, widget_theme";
const DIALOGUE_COLUMNS: &str = "cs_dialogue_id, cs_agent_id, channel_plugin_id, channel_user_id, \
     chat_id, state, taken_by, created_at, last_activity";
const MESSAGE_COLUMNS: &str = "cs_message_id, cs_dialogue_id, role, content, sender_kind, created_at";
const NOTE_COLUMNS: &str = "cs_note_id, cs_agent_id, kind, content, enabled, created_at, updated_at";
const TICKET_COLUMNS: &str = "cs_ticket_id, title, description, status, priority, cs_dialogue_id, \
     cs_agent_id, assignee_id, visitor_name, visitor_handle, created_at, updated_at, \
     first_response_due_at, first_responded_at, resolution_due_at, resolved_at, closed_at, \
     sla_state, sla_escalated";
/// 插入时只写业务字段，SLA 列走数据库默认值；SLA 策略由服务层在插入后
/// 通过 `update_ticket_sla` 落定 —— 存储层不该知道「紧急工单 30 分钟首响」
/// 这类会随套餐变化的商务规则。
const TICKET_INSERT_COLUMNS: &str = "cs_ticket_id, title, description, status, priority, \
     cs_dialogue_id, cs_agent_id, assignee_id, visitor_name, visitor_handle, created_at, updated_at";
const RATING_COLUMNS: &str = "cs_rating_id, cs_ticket_id, cs_dialogue_id, cs_agent_id, \
     score, comment, source, created_at";

/// Mint a fresh public widget key.
///
/// Drawn from a CSPRNG rather than a timestamp-derived value: the key is the
/// ONLY credential a website visitor presents, so it must be unguessable.
/// 32 alphanumeric characters ≈ 190 bits of entropy.
fn new_widget_key() -> String {
    let mut rng = StdRng::from_entropy();
    (0..32)
        .map(|_| rng.sample(rand::distributions::Alphanumeric) as char)
        .collect()
}

fn canonical_id(kind: &str, value: &str) -> Result<(), DbError> {
    validate_uuidv7(value)
        .map(|_| ())
        .map_err(|error| DbError::Conflict(format!("invalid {kind} '{value}': {error}")))
}

#[derive(Clone, Debug)]
pub struct SqliteCustomerServiceRepository {
    pool: SqlitePool,
}

impl SqliteCustomerServiceRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait::async_trait]
impl ICustomerServiceRepository for SqliteCustomerServiceRepository {
    // ── cs_agents ────────────────────────────────────────────────────

    async fn create_agent(&self, row: &NewCsAgentRow) -> Result<CsAgentRow, DbError> {
        canonical_id("cs_agent_id", &row.cs_agent_id)?;
        let sql = format!(
            "INSERT INTO cs_agents ({AGENT_COLUMNS}) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
             RETURNING {AGENT_COLUMNS}"
        );
        let inserted = sqlx::query_as::<_, CsAgentRow>(&sql)
            .bind(&row.cs_agent_id)
            .bind(&row.name)
            .bind(&row.greeting)
            .bind(&row.persona)
            .bind(&row.service_policy)
            .bind(&row.provider_id)
            .bind(&row.model)
            .bind(&row.knowledge_base_ids)
            .bind(&row.business_endpoints)
            .bind(row.enabled)
            .bind(row.max_concurrent)
            .bind(row.audit_retention_days)
            .bind(row.created_at)
            .bind(row.updated_at)
            .bind(row.widget_enabled)
            .bind(&row.widget_key)
            .bind(&row.widget_allowed_origins)
            .bind(&row.widget_theme)
            .fetch_one(&self.pool)
            .await?;
        Ok(inserted)
    }

    async fn get_agent(&self, cs_agent_id: &str) -> Result<Option<CsAgentRow>, DbError> {
        let sql = format!("SELECT {AGENT_COLUMNS} FROM cs_agents WHERE cs_agent_id = ?");
        Ok(sqlx::query_as::<_, CsAgentRow>(&sql)
            .bind(cs_agent_id)
            .fetch_optional(&self.pool)
            .await?)
    }

    async fn find_agent_by_widget_key(
        &self,
        widget_key: &str,
    ) -> Result<Option<CsAgentRow>, DbError> {
        // Reject blank keys explicitly: an empty string must never match a
        // row whose key is NULL (SQLite would not match NULL anyway, but a
        // caller bug passing "" should not silently look "not found").
        if widget_key.trim().is_empty() {
            return Ok(None);
        }
        let sql = format!("SELECT {AGENT_COLUMNS} FROM cs_agents WHERE widget_key = ?");
        Ok(sqlx::query_as::<_, CsAgentRow>(&sql)
            .bind(widget_key)
            .fetch_optional(&self.pool)
            .await?)
    }

    async fn list_agents(&self) -> Result<Vec<CsAgentRow>, DbError> {
        let sql = format!("SELECT {AGENT_COLUMNS} FROM cs_agents ORDER BY created_at DESC, id DESC");
        Ok(sqlx::query_as::<_, CsAgentRow>(&sql)
            .fetch_all(&self.pool)
            .await?)
    }

    async fn update_agent(
        &self,
        cs_agent_id: &str,
        params: &UpdateCsAgentParams,
        now: TimestampMs,
    ) -> Result<CsAgentRow, DbError> {
        if let Some(Some(provider_id)) = &params.provider_id {
            canonical_id("provider_id", provider_id)?;
        }
        let sql = format!(
            "UPDATE cs_agents SET \
                name = COALESCE(?, name), \
                greeting = COALESCE(?, greeting), \
                persona = COALESCE(?, persona), \
                service_policy = COALESCE(?, service_policy), \
                provider_id = CASE WHEN ? THEN ? ELSE provider_id END, \
                model = CASE WHEN ? THEN ? ELSE model END, \
                knowledge_base_ids = COALESCE(?, knowledge_base_ids), \
                business_endpoints = COALESCE(?, business_endpoints), \
                enabled = COALESCE(?, enabled), \
                max_concurrent = COALESCE(?, max_concurrent), \
                audit_retention_days = COALESCE(?, audit_retention_days), \
                widget_enabled = COALESCE(?, widget_enabled), \
                widget_key = CASE WHEN ? THEN ? WHEN ? THEN NULL ELSE widget_key END, \
                widget_allowed_origins = COALESCE(?, widget_allowed_origins), \
                widget_theme = COALESCE(?, widget_theme), \
                updated_at = ? \
             WHERE cs_agent_id = ? \
             RETURNING {AGENT_COLUMNS}"
        );
        let updated = sqlx::query_as::<_, CsAgentRow>(&sql)
            .bind(&params.name)
            .bind(&params.greeting)
            .bind(&params.persona)
            .bind(&params.service_policy)
            .bind(params.provider_id.is_some())
            .bind(params.provider_id.clone().flatten())
            .bind(params.model.is_some())
            .bind(params.model.clone().flatten())
            .bind(&params.knowledge_base_ids)
            .bind(&params.business_endpoints)
            .bind(params.enabled)
            .bind(params.max_concurrent)
            .bind(params.audit_retention_days)
            .bind(params.widget_enabled)
            .bind(params.rotate_widget_key == Some(true))
            .bind(match params.rotate_widget_key {
                Some(true) => Some(new_widget_key()),
                _ => None,
            })
            .bind(params.rotate_widget_key == Some(false))
            .bind(&params.widget_allowed_origins)
            .bind(&params.widget_theme)
            .bind(now)
            .bind(cs_agent_id)
            .fetch_optional(&self.pool)
            .await?;
        updated.ok_or_else(|| DbError::NotFound(format!("cs agent {cs_agent_id}")))
    }

    async fn delete_agent(&self, cs_agent_id: &str) -> Result<(), DbError> {
        let mut tx = self.pool.begin().await?;
        let locked = sqlx::query(
            "UPDATE cs_agents SET updated_at = updated_at WHERE cs_agent_id = ?",
        )
        .bind(cs_agent_id)
        .execute(&mut *tx)
        .await?;
        if locked.rows_affected() == 0 {
            return Err(DbError::NotFound(format!("cs agent {cs_agent_id}")));
        }
        sqlx::query("DELETE FROM cs_channel_bindings WHERE cs_agent_id = ?")
            .bind(cs_agent_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "DELETE FROM cs_messages WHERE cs_dialogue_id IN \
             (SELECT cs_dialogue_id FROM cs_dialogues WHERE cs_agent_id = ?)",
        )
        .bind(cs_agent_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query("DELETE FROM cs_dialogues WHERE cs_agent_id = ?")
            .bind(cs_agent_id)
            .execute(&mut *tx)
            .await?;
        // Private notes cascade; shared notes (NULL owner) survive.
        sqlx::query("DELETE FROM cs_notes WHERE cs_agent_id = ?")
            .bind(cs_agent_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM cs_agents WHERE cs_agent_id = ?")
            .bind(cs_agent_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    // ── cs_channel_bindings ──────────────────────────────────────────

    async fn replace_agent_bindings(
        &self,
        cs_agent_id: &str,
        channel_plugin_ids: &[String],
        now: TimestampMs,
    ) -> Result<Vec<CsChannelBindingRow>, DbError> {
        canonical_id("cs_agent_id", cs_agent_id)?;
        for plugin_id in channel_plugin_ids {
            canonical_id("channel_plugin_id", plugin_id)?;
        }
        let mut tx = self.pool.begin().await?;
        let exists: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM cs_agents WHERE cs_agent_id = ?")
                .bind(cs_agent_id)
                .fetch_one(&mut *tx)
                .await?;
        if exists == 0 {
            return Err(DbError::NotFound(format!("cs agent {cs_agent_id}")));
        }
        sqlx::query("DELETE FROM cs_channel_bindings WHERE cs_agent_id = ?")
            .bind(cs_agent_id)
            .execute(&mut *tx)
            .await?;
        for plugin_id in channel_plugin_ids {
            // A plugin listed here is stolen from any other agent: the UNIQUE
            // index on channel_plugin_id is the authority (同 bot 重绑替换).
            sqlx::query("DELETE FROM cs_channel_bindings WHERE channel_plugin_id = ?")
                .bind(plugin_id)
                .execute(&mut *tx)
                .await?;
            sqlx::query(
                "INSERT INTO cs_channel_bindings (cs_agent_id, channel_plugin_id, created_at) \
                 VALUES (?, ?, ?)",
            )
            .bind(cs_agent_id)
            .bind(plugin_id)
            .bind(now)
            .execute(&mut *tx)
            .await?;
        }
        let rows = sqlx::query_as::<_, CsChannelBindingRow>(
            "SELECT cs_agent_id, channel_plugin_id, created_at \
             FROM cs_channel_bindings WHERE cs_agent_id = ? ORDER BY id",
        )
        .bind(cs_agent_id)
        .fetch_all(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(rows)
    }

    async fn list_agent_bindings(
        &self,
        cs_agent_id: &str,
    ) -> Result<Vec<CsChannelBindingRow>, DbError> {
        Ok(sqlx::query_as::<_, CsChannelBindingRow>(
            "SELECT cs_agent_id, channel_plugin_id, created_at \
             FROM cs_channel_bindings WHERE cs_agent_id = ? ORDER BY id",
        )
        .bind(cs_agent_id)
        .fetch_all(&self.pool)
        .await?)
    }

    async fn binding_for_plugin(
        &self,
        channel_plugin_id: &str,
    ) -> Result<Option<CsChannelBindingRow>, DbError> {
        Ok(sqlx::query_as::<_, CsChannelBindingRow>(
            "SELECT cs_agent_id, channel_plugin_id, created_at \
             FROM cs_channel_bindings WHERE channel_plugin_id = ?",
        )
        .bind(channel_plugin_id)
        .fetch_optional(&self.pool)
        .await?)
    }

    async fn list_all_bindings(&self) -> Result<Vec<CsChannelBindingRow>, DbError> {
        Ok(sqlx::query_as::<_, CsChannelBindingRow>(
            "SELECT cs_agent_id, channel_plugin_id, created_at \
             FROM cs_channel_bindings ORDER BY created_at DESC, id DESC",
        )
        .fetch_all(&self.pool)
        .await?)
    }

    // ── cs_dialogues / cs_messages ───────────────────────────────────

    async fn get_or_create_dialogue(
        &self,
        cs_agent_id: &str,
        key: &CsDialogueKey,
        now: TimestampMs,
    ) -> Result<CsDialogueRow, DbError> {
        canonical_id("cs_agent_id", cs_agent_id)?;
        canonical_id("channel_plugin_id", &key.channel_plugin_id)?;
        canonical_id("channel_user_id", &key.channel_user_id)?;
        let cs_dialogue_id = nomifun_common::generate_id();
        // Upsert on the identity triple: a replayed visitor keeps the lane,
        // gets a fresh last_activity, and follows the bot's CURRENT agent.
        // Re-taken (`state = 'human'`) lanes are RESET to `ai` on new inbound
        // activity so the engine can resume after an operator handoff.
        let sql = format!(
            "INSERT INTO cs_dialogues \
                 (cs_dialogue_id, cs_agent_id, channel_plugin_id, channel_user_id, chat_id, \
                  state, taken_by, created_at, last_activity) \
             VALUES (?, ?, ?, ?, ?, 'ai', NULL, ?, ?) \
             ON CONFLICT(channel_plugin_id, channel_user_id, chat_id) DO UPDATE SET \
                 cs_agent_id = excluded.cs_agent_id, \
                 state = CASE WHEN state = 'closed' THEN 'closed' ELSE 'ai' END, \
                 taken_by = CASE WHEN state = 'closed' THEN taken_by ELSE NULL END, \
                 last_activity = excluded.last_activity \
             RETURNING {DIALOGUE_COLUMNS}"
        );
        Ok(sqlx::query_as::<_, CsDialogueRow>(&sql)
            .bind(&cs_dialogue_id)
            .bind(cs_agent_id)
            .bind(&key.channel_plugin_id)
            .bind(&key.channel_user_id)
            .bind(&key.chat_id)
            .bind(now)
            .bind(now)
            .fetch_one(&self.pool)
            .await?)
    }

    async fn get_dialogue(&self, cs_dialogue_id: &str) -> Result<Option<CsDialogueRow>, DbError> {
        let sql = format!("SELECT {DIALOGUE_COLUMNS} FROM cs_dialogues WHERE cs_dialogue_id = ?");
        Ok(sqlx::query_as::<_, CsDialogueRow>(&sql)
            .bind(cs_dialogue_id)
            .fetch_optional(&self.pool)
            .await?)
    }

    async fn list_dialogues(&self, cs_agent_id: &str) -> Result<Vec<CsDialogueRow>, DbError> {
        let sql = format!(
            "SELECT {DIALOGUE_COLUMNS} FROM cs_dialogues \
             WHERE cs_agent_id = ? ORDER BY last_activity DESC, id DESC"
        );
        Ok(sqlx::query_as::<_, CsDialogueRow>(&sql)
            .bind(cs_agent_id)
            .fetch_all(&self.pool)
            .await?)
    }

    async fn append_message(
        &self,
        cs_dialogue_id: &str,
        role: &str,
        content: &str,
        now: TimestampMs,
    ) -> Result<CsMessageRow, DbError> {
        canonical_id("cs_dialogue_id", cs_dialogue_id)?;
        let cs_message_id = nomifun_common::generate_id();
        let mut tx = self.pool.begin().await?;
        let touched = sqlx::query(
            "UPDATE cs_dialogues SET last_activity = ? WHERE cs_dialogue_id = ?",
        )
        .bind(now)
        .bind(cs_dialogue_id)
        .execute(&mut *tx)
        .await?;
        if touched.rows_affected() == 0 {
            return Err(DbError::NotFound(format!("cs dialogue {cs_dialogue_id}")));
        }
        let sql = format!(
            "INSERT INTO cs_messages (cs_message_id, cs_dialogue_id, role, content, sender_kind, created_at) \
             VALUES (?, ?, ?, ?, 'ai', ?) RETURNING {MESSAGE_COLUMNS}"
        );
        let inserted = sqlx::query_as::<_, CsMessageRow>(&sql)
            .bind(&cs_message_id)
            .bind(cs_dialogue_id)
            .bind(role)
            .bind(content)
            .bind(now)
            .fetch_one(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(inserted)
    }

    async fn recent_messages(
        &self,
        cs_dialogue_id: &str,
        limit: usize,
        char_budget: usize,
    ) -> Result<Vec<CsMessageRow>, DbError> {
        let sql = format!(
            "SELECT {MESSAGE_COLUMNS} FROM cs_messages \
             WHERE cs_dialogue_id = ? ORDER BY id DESC LIMIT ?"
        );
        let newest_first = sqlx::query_as::<_, CsMessageRow>(&sql)
            .bind(cs_dialogue_id)
            .bind(limit as i64)
            .fetch_all(&self.pool)
            .await?;
        // Newest messages win the budget; then restore chronological order.
        let mut kept: Vec<CsMessageRow> = Vec::with_capacity(newest_first.len());
        let mut used: usize = 0;
        for message in newest_first {
            let cost = message.content.chars().count();
            if !kept.is_empty() && used + cost > char_budget {
                break;
            }
            used += cost;
            kept.push(message);
        }
        kept.reverse();
        Ok(kept)
    }

    async fn list_messages(&self, cs_dialogue_id: &str) -> Result<Vec<CsMessageRow>, DbError> {
        let sql = format!(
            "SELECT {MESSAGE_COLUMNS} FROM cs_messages WHERE cs_dialogue_id = ? ORDER BY id"
        );
        Ok(sqlx::query_as::<_, CsMessageRow>(&sql)
            .bind(cs_dialogue_id)
            .fetch_all(&self.pool)
            .await?)
    }

    async fn take_dialogue(
        &self,
        cs_dialogue_id: &str,
        operator_id: &str,
        now: TimestampMs,
    ) -> Result<CsDialogueRow, DbError> {
        canonical_id("cs_dialogue_id", cs_dialogue_id)?;
        canonical_id("operator_id", operator_id)?;
        // The `state != 'closed'` guard runs BEFORE the assignment — otherwise
        // RETURNING would surface the freshly-updated row and miss the closed
        // case entirely.
        let sql = format!(
            "UPDATE cs_dialogues \
             SET state = 'human', taken_by = ?, last_activity = ? \
             WHERE cs_dialogue_id = ? AND state != 'closed' \
             RETURNING {DIALOGUE_COLUMNS}"
        );
        let row = sqlx::query_as::<_, CsDialogueRow>(&sql)
            .bind(operator_id)
            .bind(now)
            .bind(cs_dialogue_id)
            .fetch_optional(&self.pool)
            .await?;
        match row {
            Some(row) => Ok(row),
            None => {
                // Either the dialogue is missing or it is already closed.
                // Distinguish so the route layer can return 404 vs 409.
                let exists: Option<String> = sqlx::query_scalar(
                    "SELECT state FROM cs_dialogues WHERE cs_dialogue_id = ?",
                )
                .bind(cs_dialogue_id)
                .fetch_optional(&self.pool)
                .await?;
                match exists.as_deref() {
                    Some("closed") => Err(DbError::Conflict(format!(
                        "cs dialogue {cs_dialogue_id} is closed"
                    ))),
                    _ => Err(DbError::NotFound(format!("cs dialogue {cs_dialogue_id}"))),
                }
            }
        }
    }

    async fn release_dialogue(
        &self,
        cs_dialogue_id: &str,
        now: TimestampMs,
    ) -> Result<CsDialogueRow, DbError> {
        canonical_id("cs_dialogue_id", cs_dialogue_id)?;
        let sql = format!(
            "UPDATE cs_dialogues \
             SET state = 'ai', taken_by = NULL, last_activity = ? \
             WHERE cs_dialogue_id = ? \
             RETURNING {DIALOGUE_COLUMNS}"
        );
        sqlx::query_as::<_, CsDialogueRow>(&sql)
            .bind(now)
            .bind(cs_dialogue_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| DbError::NotFound(format!("cs dialogue {cs_dialogue_id}")))
    }

    async fn close_dialogue(
        &self,
        cs_dialogue_id: &str,
        now: TimestampMs,
    ) -> Result<CsDialogueRow, DbError> {
        canonical_id("cs_dialogue_id", cs_dialogue_id)?;
        let sql = format!(
            "UPDATE cs_dialogues \
             SET state = 'closed', last_activity = ? \
             WHERE cs_dialogue_id = ? \
             RETURNING {DIALOGUE_COLUMNS}"
        );
        sqlx::query_as::<_, CsDialogueRow>(&sql)
            .bind(now)
            .bind(cs_dialogue_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| DbError::NotFound(format!("cs dialogue {cs_dialogue_id}")))
    }

    async fn append_human_message(
        &self,
        cs_dialogue_id: &str,
        content: &str,
        now: TimestampMs,
    ) -> Result<CsMessageRow, DbError> {
        canonical_id("cs_dialogue_id", cs_dialogue_id)?;
        let cs_message_id = nomifun_common::generate_id();
        let mut tx = self.pool.begin().await?;
        let touched = sqlx::query(
            "UPDATE cs_dialogues SET last_activity = ? WHERE cs_dialogue_id = ? \
             AND state IN ('ai', 'human')",
        )
        .bind(now)
        .bind(cs_dialogue_id)
        .execute(&mut *tx)
        .await?;
        if touched.rows_affected() == 0 {
            return Err(DbError::NotFound(format!("cs dialogue {cs_dialogue_id}")));
        }
        let sql = format!(
            "INSERT INTO cs_messages (cs_message_id, cs_dialogue_id, role, content, sender_kind, created_at) \
             VALUES (?, ?, 'agent', ?, 'human', ?) RETURNING {MESSAGE_COLUMNS}"
        );
        let inserted = sqlx::query_as::<_, CsMessageRow>(&sql)
            .bind(&cs_message_id)
            .bind(cs_dialogue_id)
            .bind(content)
            .bind(now)
            .fetch_one(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(inserted)
    }

    async fn list_active_dialogues(
        &self,
        cs_agent_id: &str,
    ) -> Result<Vec<CsDialogueRow>, DbError> {
        canonical_id("cs_agent_id", cs_agent_id)?;
        let sql = format!(
            "SELECT {DIALOGUE_COLUMNS} FROM cs_dialogues \
             WHERE cs_agent_id = ? AND state IN ('ai', 'human') \
             ORDER BY last_activity DESC, id DESC"
        );
        Ok(sqlx::query_as::<_, CsDialogueRow>(&sql)
            .bind(cs_agent_id)
            .fetch_all(&self.pool)
            .await?)
    }

    async fn list_inbox(
        &self,
        state: Option<&str>,
        channel_type: Option<&str>,
        limit: usize,
    ) -> Result<Vec<CsInboxItem>, DbError> {
        // Validate the optional state filter before building SQL.
        if let Some(s) = state {
            if !matches!(s, "ai" | "human" | "closed") {
                return Err(DbError::Conflict(format!("unknown dialogue state '{s}'")));
            }
        }
        let mut where_clause = String::new();
        if state.is_some() {
            where_clause.push_str(" WHERE d.state = ?");
        }
        if channel_type.is_some() {
            if where_clause.is_empty() {
                where_clause.push_str(" WHERE ");
            } else {
                where_clause.push_str(" AND ");
            }
            where_clause.push_str("cp.type = ?");
        }
        // Two correlated subqueries surface the latest message without a GROUP
        // BY on the outer query (keeps the shape a flat FromRow).
        let sql = format!(
            "SELECT \
                 d.cs_dialogue_id, d.cs_agent_id, COALESCE(a.name, '') AS agent_name, \
                 d.channel_plugin_id, COALESCE(cp.type, 'unknown') AS channel_type, \
                 COALESCE(cp.name, '') AS channel_name, d.channel_user_id, \
                 cu.display_name AS visitor_name, d.chat_id, d.state, d.taken_by, \
                 d.created_at, d.last_activity, \
                 (SELECT m.content FROM cs_messages m \
                    WHERE m.cs_dialogue_id = d.cs_dialogue_id \
                    ORDER BY m.id DESC LIMIT 1) AS last_message_preview, \
                 (SELECT m.role FROM cs_messages m \
                    WHERE m.cs_dialogue_id = d.cs_dialogue_id \
                    ORDER BY m.id DESC LIMIT 1) AS last_message_role \
             FROM cs_dialogues d \
             JOIN cs_agents a ON a.cs_agent_id = d.cs_agent_id \
             LEFT JOIN channel_plugins cp ON cp.channel_plugin_id = d.channel_plugin_id \
             LEFT JOIN channel_users cu ON cu.channel_user_id = d.channel_user_id \
             {where_clause} \
             ORDER BY d.last_activity DESC, d.id DESC LIMIT ?"
        );
        let mut q = sqlx::query_as::<_, CsInboxItem>(&sql);
        if let Some(s) = state {
            q = q.bind(s);
        }
        if let Some(t) = channel_type {
            q = q.bind(t);
        }
        q = q.bind(limit as i64);
        Ok(q.fetch_all(&self.pool).await?)
    }

    // ── cs_tickets (5.0.22) ─────────────────────────────────────────

    async fn create_ticket(&self, row: &NewCsTicketRow) -> Result<CsTicketRow, DbError> {
        if row.title.trim().is_empty() {
            return Err(DbError::Conflict(
                "ticket title cannot be empty".into(),
            ));
        }
        if let Some(agent_id) = &row.cs_agent_id {
            canonical_id("cs_agent_id", agent_id)?;
        }
        if let Some(dialogue_id) = &row.cs_dialogue_id {
            canonical_id("cs_dialogue_id", dialogue_id)?;
        }
        if let Some(assignee) = &row.assignee_id {
            canonical_id("assignee_id", assignee)?;
        }
        let cs_ticket_id = nomifun_common::generate_id();
        let sql = format!(
            "INSERT INTO cs_tickets \
                 ({TICKET_INSERT_COLUMNS}) \
             VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?) \
             RETURNING {TICKET_COLUMNS}"
        );
        let row = sqlx::query_as::<_, CsTicketRow>(&sql)
            .bind(&cs_ticket_id)
            .bind(&row.title)
            .bind(&row.description)
            .bind(&row.priority)
            .bind(&row.cs_dialogue_id)
            .bind(&row.cs_agent_id)
            .bind(&row.assignee_id)
            .bind(&row.visitor_name)
            .bind(&row.visitor_handle)
            .bind(row.created_at)
            .bind(row.updated_at)
            .fetch_one(&self.pool)
            .await?;
        Ok(row)
    }

    async fn get_ticket(&self, cs_ticket_id: &str) -> Result<Option<CsTicketRow>, DbError> {
        canonical_id("cs_ticket_id", cs_ticket_id)?;
        let sql = format!("SELECT {TICKET_COLUMNS} FROM cs_tickets WHERE cs_ticket_id = ?");
        Ok(sqlx::query_as::<_, CsTicketRow>(&sql)
            .bind(cs_ticket_id)
            .fetch_optional(&self.pool)
            .await?)
    }

    async fn list_tickets(
        &self,
        cs_agent_id: Option<&str>,
        status: Option<&str>,
        limit: usize,
    ) -> Result<Vec<CsTicketRow>, DbError> {
        if let Some(agent_id) = cs_agent_id {
            canonical_id("cs_agent_id", agent_id)?;
        }
        if let Some(status_value) = status {
            if !matches!(
                status_value,
                "pending" | "in_progress" | "resolved" | "cancelled"
            ) {
                return Err(DbError::Conflict(format!(
                    "unknown ticket status '{status_value}'"
                )));
            }
        }
        let sql = match (cs_agent_id, status) {
            (None, None) => format!(
                "SELECT {TICKET_COLUMNS} FROM cs_tickets \
                 ORDER BY updated_at DESC, id DESC LIMIT ?"
            ),
            (Some(_), None) => format!(
                "SELECT {TICKET_COLUMNS} FROM cs_tickets \
                 WHERE cs_agent_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?"
            ),
            (None, Some(_)) => format!(
                "SELECT {TICKET_COLUMNS} FROM cs_tickets \
                 WHERE status = ? ORDER BY updated_at DESC, id DESC LIMIT ?"
            ),
            (Some(_), Some(_)) => format!(
                "SELECT {TICKET_COLUMNS} FROM cs_tickets \
                 WHERE cs_agent_id = ? AND status = ? \
                 ORDER BY updated_at DESC, id DESC LIMIT ?"
            ),
        };
        let mut q = sqlx::query_as::<_, CsTicketRow>(&sql);
        if let Some(agent_id) = cs_agent_id {
            q = q.bind(agent_id);
        }
        if let Some(status_value) = status {
            q = q.bind(status_value);
        }
        q = q.bind(limit as i64);
        Ok(q.fetch_all(&self.pool).await?)
    }

    async fn update_ticket(
        &self,
        cs_ticket_id: &str,
        params: &UpdateCsTicketParams,
        now: TimestampMs,
    ) -> Result<CsTicketRow, DbError> {
        canonical_id("cs_ticket_id", cs_ticket_id)?;
        if let Some(status) = &params.status {
            if !matches!(status.as_str(), "pending" | "in_progress" | "resolved" | "cancelled") {
                return Err(DbError::Conflict(format!(
                    "unknown ticket status '{status}'"
                )));
            }
        }
        if let Some(priority) = &params.priority {
            if !matches!(priority.as_str(), "low" | "normal" | "high" | "urgent") {
                return Err(DbError::Conflict(format!(
                    "unknown ticket priority '{priority}'"
                )));
            }
        }
        if let Some(title) = &params.title {
            if title.trim().is_empty() {
                return Err(DbError::Conflict(
                    "ticket title cannot be empty".into(),
                ));
            }
        }
        let mut sets: Vec<&'static str> = Vec::new();
        let mut tx = self.pool.begin().await?;
        if let Some(value) = params.title.as_deref() {
            sets.push("title = ?");
            // The bind below re-uses `value` directly.
            let _ = value;
        }
        if let Some(_) = params.description {
            sets.push("description = ?");
        }
        if params.status.is_some() {
            sets.push("status = ?");
        }
        if params.priority.is_some() {
            sets.push("priority = ?");
        }
        if params.assignee_id.is_some() {
            sets.push("assignee_id = ?");
        }
        if params.visitor_name.is_some() {
            sets.push("visitor_name = ?");
        }
        if params.visitor_handle.is_some() {
            sets.push("visitor_handle = ?");
        }
        sets.push("updated_at = ?");
        let sql = format!(
            "UPDATE cs_tickets SET {} WHERE cs_ticket_id = ? \
             RETURNING {TICKET_COLUMNS}",
            sets.join(", ")
        );
        let mut q = sqlx::query_as::<_, CsTicketRow>(&sql);
        if let Some(value) = &params.title {
            q = q.bind(value);
        }
        if let Some(value_opt) = &params.description {
            q = q.bind(value_opt.as_deref());
        }
        if let Some(value) = &params.status {
            q = q.bind(value);
        }
        if let Some(value) = &params.priority {
            q = q.bind(value);
        }
        if let Some(value_opt) = &params.assignee_id {
            q = q.bind(value_opt.as_deref());
        }
        if let Some(value) = &params.visitor_name {
            q = q.bind(value);
        }
        if let Some(value) = &params.visitor_handle {
            q = q.bind(value);
        }
        q = q.bind(now).bind(cs_ticket_id);
        let row = q.fetch_optional(&mut *tx).await?;
        let updated = row.ok_or_else(|| DbError::NotFound(format!("cs ticket {cs_ticket_id}")))?;
        tx.commit().await?;
        Ok(updated)
    }

    async fn delete_ticket(&self, cs_ticket_id: &str) -> Result<(), DbError> {
        canonical_id("cs_ticket_id", cs_ticket_id)?;
        let touched = sqlx::query("DELETE FROM cs_tickets WHERE cs_ticket_id = ?")
            .bind(cs_ticket_id)
            .execute(&self.pool)
            .await?;
        if touched.rows_affected() == 0 {
            return Err(DbError::NotFound(format!("cs ticket {cs_ticket_id}")));
        }
        Ok(())
    }

    // ── cs_notes ─────────────────────────────────────────────────────

    async fn create_note(&self, row: &CsNoteRow) -> Result<CsNoteRow, DbError> {
        canonical_id("cs_note_id", &row.cs_note_id)?;
        if let Some(agent_id) = &row.cs_agent_id {
            canonical_id("cs_agent_id", agent_id)?;
        }
        let sql = format!(
            "INSERT INTO cs_notes ({NOTE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?) \
             RETURNING {NOTE_COLUMNS}"
        );
        Ok(sqlx::query_as::<_, CsNoteRow>(&sql)
            .bind(&row.cs_note_id)
            .bind(&row.cs_agent_id)
            .bind(&row.kind)
            .bind(&row.content)
            .bind(row.enabled)
            .bind(row.created_at)
            .bind(row.updated_at)
            .fetch_one(&self.pool)
            .await?)
    }

    async fn list_notes(&self, cs_agent_id: Option<&str>) -> Result<Vec<CsNoteRow>, DbError> {
        let rows = match cs_agent_id {
            Some(agent_id) => {
                let sql = format!(
                    "SELECT {NOTE_COLUMNS} FROM cs_notes \
                     WHERE cs_agent_id = ? OR cs_agent_id IS NULL \
                     ORDER BY created_at DESC, id DESC"
                );
                sqlx::query_as::<_, CsNoteRow>(&sql)
                    .bind(agent_id)
                    .fetch_all(&self.pool)
                    .await?
            }
            None => {
                let sql = format!(
                    "SELECT {NOTE_COLUMNS} FROM cs_notes ORDER BY created_at DESC, id DESC"
                );
                sqlx::query_as::<_, CsNoteRow>(&sql).fetch_all(&self.pool).await?
            }
        };
        Ok(rows)
    }

    async fn search_notes(
        &self,
        cs_agent_id: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<CsNoteRow>, DbError> {
        let escaped = query.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
        let pattern = format!("%{escaped}%");
        let sql = format!(
            "SELECT {NOTE_COLUMNS} FROM cs_notes \
             WHERE (cs_agent_id = ? OR cs_agent_id IS NULL) AND enabled = 1 \
               AND content LIKE ? ESCAPE '\\' \
             ORDER BY created_at DESC, id DESC LIMIT ?"
        );
        Ok(sqlx::query_as::<_, CsNoteRow>(&sql)
            .bind(cs_agent_id)
            .bind(&pattern)
            .bind(limit as i64)
            .fetch_all(&self.pool)
            .await?)
    }

    async fn update_note(
        &self,
        cs_note_id: &str,
        kind: Option<&str>,
        content: Option<&str>,
        enabled: Option<bool>,
        now: TimestampMs,
    ) -> Result<CsNoteRow, DbError> {
        let sql = format!(
            "UPDATE cs_notes SET \
                kind = COALESCE(?, kind), \
                content = COALESCE(?, content), \
                enabled = COALESCE(?, enabled), \
                updated_at = ? \
             WHERE cs_note_id = ? RETURNING {NOTE_COLUMNS}"
        );
        sqlx::query_as::<_, CsNoteRow>(&sql)
            .bind(kind)
            .bind(content)
            .bind(enabled)
            .bind(now)
            .bind(cs_note_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| DbError::NotFound(format!("cs note {cs_note_id}")))
    }

    async fn delete_note(&self, cs_note_id: &str) -> Result<(), DbError> {
        let result = sqlx::query("DELETE FROM cs_notes WHERE cs_note_id = ?")
            .bind(cs_note_id)
            .execute(&self.pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(DbError::NotFound(format!("cs note {cs_note_id}")));
        }
        Ok(())
    }

    // ── cs_audit_events ──────────────────────────────────────────────

    async fn insert_audit_event(&self, row: &CsAuditEventRow) -> Result<(), DbError> {
        canonical_id("cs_agent_id", &row.cs_agent_id)?;
        sqlx::query(
            "INSERT INTO cs_audit_events (cs_agent_id, kind, platform, detail, created_at) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&row.cs_agent_id)
        .bind(&row.kind)
        .bind(&row.platform)
        .bind(&row.detail)
        .bind(row.created_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn list_audit_events(
        &self,
        cs_agent_id: &str,
        limit: usize,
    ) -> Result<Vec<CsAuditEventRow>, DbError> {
        Ok(sqlx::query_as::<_, CsAuditEventRow>(
            "SELECT cs_agent_id, kind, platform, detail, created_at \
             FROM cs_audit_events WHERE cs_agent_id = ? \
             ORDER BY created_at DESC, id DESC LIMIT ?",
        )
        .bind(cs_agent_id)
        .bind(limit as i64)
        .fetch_all(&self.pool)
        .await?)
    }

    async fn cleanup_audit_events(&self, now: TimestampMs) -> Result<u64, DbError> {
        const DAY_MS: i64 = 24 * 60 * 60 * 1000;
        let result = sqlx::query(
            "DELETE FROM cs_audit_events WHERE id IN (\
                 SELECT event.id FROM cs_audit_events event \
                 JOIN cs_agents agent ON agent.cs_agent_id = event.cs_agent_id \
                 WHERE event.created_at < ? - agent.audit_retention_days * ?\
             )",
        )
        .bind(now)
        .bind(DAY_MS)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
    }

    // ── 5.0.32 商业闭环：SLA 与满意度 ────────────────────────────────────

    async fn update_ticket_sla(
        &self,
        cs_ticket_id: &str,
        patch: CsTicketSlaPatch,
        now: TimestampMs,
    ) -> Result<CsTicketRow, DbError> {
        canonical_id("cs_ticket_id", cs_ticket_id)?;
        if let Some(state) = patch.sla_state.as_deref() {
            if !matches!(state, "none" | "met" | "breached") {
                return Err(DbError::Conflict(format!("unknown sla_state '{state}'")));
            }
        }
        let timestamps: [(&'static str, Option<Option<TimestampMs>>); 5] = [
            ("first_response_due_at", patch.first_response_due_at),
            ("first_responded_at", patch.first_responded_at),
            ("resolution_due_at", patch.resolution_due_at),
            ("resolved_at", patch.resolved_at),
            ("closed_at", patch.closed_at),
        ];
        let mut sets: Vec<String> = Vec::new();
        let mut pending: Vec<Option<TimestampMs>> = Vec::new();
        for (column, value) in timestamps {
            if let Some(value) = value {
                sets.push(format!("{column} = ?"));
                pending.push(value);
            }
        }
        let state_bind = patch.sla_state.clone();
        if state_bind.is_some() {
            sets.push("sla_state = ?".into());
        }
        if patch.sla_escalated.is_some() {
            sets.push("sla_escalated = ?".into());
        }
        if sets.is_empty() {
            // 没有可写字段时退化成一次读取，让调用方不必特判空补丁。
            return self
                .get_ticket(cs_ticket_id)
                .await?
                .ok_or_else(|| DbError::NotFound(format!("cs ticket {cs_ticket_id}")));
        }
        sets.push("updated_at = ?".into());
        let sql = format!(
            "UPDATE cs_tickets SET {} WHERE cs_ticket_id = ? RETURNING {TICKET_COLUMNS}",
            sets.join(", ")
        );
        let mut q = sqlx::query_as::<_, CsTicketRow>(&sql);
        for value in pending {
            q = q.bind(value);
        }
        if let Some(state) = state_bind {
            q = q.bind(state);
        }
        if let Some(flag) = patch.sla_escalated {
            q = q.bind(flag);
        }
        let row = q
            .bind(now)
            .bind(cs_ticket_id)
            .fetch_optional(&self.pool)
            .await?;
        row.ok_or_else(|| DbError::NotFound(format!("cs ticket {cs_ticket_id}")))
    }

    async fn list_tickets_with_open_sla(&self, now: TimestampMs) -> Result<Vec<CsTicketRow>, DbError> {
        // 只捞「还没到终态」的工单：未首响 或 未解决，且未关闭、未定终态。
        // SLA 扫描每分钟跑一次，全表扫描不可接受，故走迁移 043 建的两个部分索引。
        let sql = format!(
            "SELECT {TICKET_COLUMNS} FROM cs_tickets \
             WHERE closed_at IS NULL AND sla_state = 'none' \
               AND ( \
                    (first_responded_at IS NULL AND first_response_due_at IS NOT NULL) \
                 OR (resolved_at IS NULL AND resolution_due_at IS NOT NULL) \
               ) \
             ORDER BY created_at ASC LIMIT 500"
        );
        let _ = now;
        Ok(sqlx::query_as::<_, CsTicketRow>(&sql)
            .fetch_all(&self.pool)
            .await?)
    }

    async fn create_rating(&self, row: &NewCsRatingRow) -> Result<CsRatingRow, DbError> {
        if !(1..=5).contains(&row.score) {
            return Err(DbError::Conflict(format!(
                "rating score must be 1..=5, got {}",
                row.score
            )));
        }
        if !matches!(row.source.as_str(), "widget" | "operator" | "system") {
            return Err(DbError::Conflict(format!(
                "unknown rating source '{}'",
                row.source
            )));
        }
        for (label, value) in [
            ("cs_ticket_id", &row.cs_ticket_id),
            ("cs_dialogue_id", &row.cs_dialogue_id),
            ("cs_agent_id", &row.cs_agent_id),
        ] {
            if let Some(id) = value {
                canonical_id(label, id)?;
            }
        }
        if row.comment.chars().count() > 1000 {
            return Err(DbError::Conflict("rating comment exceeds 1000 chars".into()));
        }
        let cs_rating_id = nomifun_common::generate_id();
        let sql = format!(
            "INSERT INTO cs_ratings ({RATING_COLUMNS}) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?) \
             RETURNING {RATING_COLUMNS}"
        );
        let row = sqlx::query_as::<_, CsRatingRow>(&sql)
            .bind(&cs_rating_id)
            .bind(&row.cs_ticket_id)
            .bind(&row.cs_dialogue_id)
            .bind(&row.cs_agent_id)
            .bind(row.score)
            .bind(&row.comment)
            .bind(&row.source)
            .bind(nomifun_common::now_ms())
            .fetch_one(&self.pool)
            .await?;
        Ok(row)
    }

    async fn list_ratings(
        &self,
        cs_agent_id: Option<&str>,
        since: Option<TimestampMs>,
        limit: usize,
    ) -> Result<Vec<CsRatingRow>, DbError> {
        if let Some(agent_id) = cs_agent_id {
            canonical_id("cs_agent_id", agent_id)?;
        }
        let mut sql = format!("SELECT {RATING_COLUMNS} FROM cs_ratings");
        let mut conditions: Vec<&'static str> = Vec::new();
        if cs_agent_id.is_some() {
            conditions.push("cs_agent_id = ?");
        }
        if since.is_some() {
            conditions.push("created_at >= ?");
        }
        if !conditions.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&conditions.join(" AND "));
        }
        sql.push_str(" ORDER BY created_at DESC LIMIT ?");
        let mut q = sqlx::query_as::<_, CsRatingRow>(&sql);
        if let Some(agent_id) = cs_agent_id {
            q = q.bind(agent_id);
        }
        if let Some(since) = since {
            q = q.bind(since);
        }
        Ok(q.bind(limit as i64).fetch_all(&self.pool).await?)
    }

    async fn cs_overview_stats(
        &self,
        cs_agent_id: Option<&str>,
        since: Option<TimestampMs>,
    ) -> Result<CsOverviewStats, DbError> {
        if let Some(agent_id) = cs_agent_id {
            canonical_id("cs_agent_id", agent_id)?;
        }
        let since = since.unwrap_or(0);
        // cs_dialogues / cs_tickets / cs_ratings 三张表都带 cs_agent_id，
        // 所以同一段过滤条件可以复用；不传客服时统计全域。
        let agent = if cs_agent_id.is_some() {
            " AND cs_agent_id = ?"
        } else {
            ""
        };
        let mut stats = CsOverviewStats::default();

        let sql = format!(
            "SELECT COUNT(*), \
                    COALESCE(SUM(CASE WHEN state = 'human' THEN 1 ELSE 0 END), 0) \
             FROM cs_dialogues WHERE created_at >= ?{agent}"
        );
        let mut q = sqlx::query_as::<_, (i64, i64)>(&sql).bind(since);
        if let Some(agent_id) = cs_agent_id {
            q = q.bind(agent_id);
        }
        let (dialogues_total, dialogues_taken_over) = q.fetch_one(&self.pool).await?;
        stats.dialogues_total = dialogues_total;
        stats.dialogues_taken_over = dialogues_taken_over;

        let sql = format!(
            "SELECT COUNT(*), \
                    COALESCE(SUM(CASE WHEN closed_at IS NULL AND resolved_at IS NULL THEN 1 ELSE 0 END), 0), \
                    COALESCE(SUM(CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE 0 END), 0), \
                    COALESCE(SUM(CASE WHEN sla_state = 'breached' THEN 1 ELSE 0 END), 0), \
                    COALESCE(SUM(CASE WHEN sla_state = 'met' THEN 1 ELSE 0 END), 0), \
                    COALESCE(SUM(CASE WHEN sla_escalated = 1 THEN 1 ELSE 0 END), 0), \
                    COALESCE(SUM(CASE WHEN first_responded_at IS NOT NULL THEN 1 ELSE 0 END), 0), \
                    COALESCE(SUM(CASE WHEN first_responded_at IS NOT NULL \
                                      THEN first_responded_at - created_at ELSE 0 END), 0) \
             FROM cs_tickets WHERE created_at >= ?{agent}"
        );
        let mut q = sqlx::query_as::<_, (i64, i64, i64, i64, i64, i64, i64, i64)>(&sql).bind(since);
        if let Some(agent_id) = cs_agent_id {
            q = q.bind(agent_id);
        }
        let (total, open, resolved, breached, met, escalated, responded, response_sum) =
            q.fetch_one(&self.pool).await?;
        stats.tickets_total = total;
        stats.tickets_open = open;
        stats.tickets_resolved = resolved;
        stats.tickets_breached = breached;
        stats.tickets_met = met;
        stats.tickets_escalated = escalated;
        stats.tickets_responded = responded;
        stats.first_response_ms_sum = response_sum;

        let sql = format!(
            "SELECT COUNT(*), COALESCE(SUM(score), 0) FROM cs_ratings WHERE created_at >= ?{agent}"
        );
        let mut q = sqlx::query_as::<_, (i64, i64)>(&sql).bind(since);
        if let Some(agent_id) = cs_agent_id {
            q = q.bind(agent_id);
        }
        let (ratings_count, ratings_score_sum) = q.fetch_one(&self.pool).await?;
        stats.ratings_count = ratings_count;
        stats.ratings_score_sum = ratings_score_sum;

        let sql = format!(
            "SELECT score, COUNT(*) FROM cs_ratings WHERE created_at >= ?{agent} GROUP BY score"
        );
        let mut q = sqlx::query_as::<_, (i64, i64)>(&sql).bind(since);
        if let Some(agent_id) = cs_agent_id {
            q = q.bind(agent_id);
        }
        for (score, count) in q.fetch_all(&self.pool).await? {
            if let Some(slot) = stats.ratings_histogram.get_mut((score - 1) as usize) {
                *slot = count;
            }
        }
        Ok(stats)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_database_memory;
    use nomifun_common::{ChannelPluginId, ChannelUserId, generate_id};

    async fn repo() -> (crate::Database, SqliteCustomerServiceRepository) {
        let db = init_database_memory().await.unwrap();
        let repo = SqliteCustomerServiceRepository::new(db.pool().clone());
        (db, repo)
    }

    fn new_agent(name: &str) -> NewCsAgentRow {
        NewCsAgentRow {
            cs_agent_id: generate_id(),
            name: name.into(),
            greeting: "您好，我是客服".into(),
            persona: "耐心友好".into(),
            service_policy: "只回答业务问题".into(),
            provider_id: None,
            model: Some("model-a".into()),
            knowledge_base_ids: "[]".into(),
            business_endpoints: "[]".into(),
            enabled: true,
            max_concurrent: 8,
            audit_retention_days: 30,
            created_at: 1,
            updated_at: 1,
            widget_enabled: false,
            widget_key: None,
            widget_allowed_origins: "[]".into(),
            widget_theme: "{}".into(),
        }
    }

    fn dialogue_key() -> CsDialogueKey {
        CsDialogueKey {
            channel_plugin_id: ChannelPluginId::new().into_string(),
            channel_user_id: ChannelUserId::new().into_string(),
            chat_id: "chat-1".into(),
        }
    }

    #[tokio::test]
    async fn agent_crud_roundtrip() {
        let (_db, repo) = repo().await;
        let created = repo.create_agent(&new_agent("小助")).await.unwrap();
        assert_eq!(created.name, "小助");
        assert_eq!(created.max_concurrent, 8);

        let fetched = repo.get_agent(&created.cs_agent_id).await.unwrap().unwrap();
        assert_eq!(fetched.cs_agent_id, created.cs_agent_id);

        let updated = repo
            .update_agent(
                &created.cs_agent_id,
                &UpdateCsAgentParams {
                    name: Some("小助2".into()),
                    enabled: Some(false),
                    model: Some(None),
                    ..Default::default()
                },
                7,
            )
            .await
            .unwrap();
        assert_eq!(updated.name, "小助2");
        assert!(!updated.enabled);
        assert_eq!(updated.model, None);
        assert_eq!(updated.greeting, created.greeting, "unspecified fields keep values");
        assert_eq!(updated.updated_at, 7);

        assert_eq!(repo.list_agents().await.unwrap().len(), 1);
        repo.delete_agent(&created.cs_agent_id).await.unwrap();
        assert!(repo.get_agent(&created.cs_agent_id).await.unwrap().is_none());
        assert!(matches!(
            repo.delete_agent(&created.cs_agent_id).await.unwrap_err(),
            DbError::NotFound(_)
        ));
    }

    #[tokio::test]
    async fn agent_rejects_invalid_business_id() {
        let (_db, repo) = repo().await;
        let mut row = new_agent("bad");
        row.cs_agent_id = "not-a-uuid".into();
        assert!(matches!(
            repo.create_agent(&row).await.unwrap_err(),
            DbError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn binding_replace_is_full_put_and_steals_plugins() {
        let (_db, repo) = repo().await;
        let agent_a = repo.create_agent(&new_agent("A")).await.unwrap();
        let agent_b = repo.create_agent(&new_agent("B")).await.unwrap();
        let plugin_1 = ChannelPluginId::new().into_string();
        let plugin_2 = ChannelPluginId::new().into_string();

        let rows = repo
            .replace_agent_bindings(&agent_a.cs_agent_id, &[plugin_1.clone(), plugin_2.clone()], 1)
            .await
            .unwrap();
        assert_eq!(rows.len(), 2);

        // Rebinding plugin_1 to B steals it from A (同 bot 重绑替换).
        repo.replace_agent_bindings(&agent_b.cs_agent_id, &[plugin_1.clone()], 2)
            .await
            .unwrap();
        let owner = repo.binding_for_plugin(&plugin_1).await.unwrap().unwrap();
        assert_eq!(owner.cs_agent_id, agent_b.cs_agent_id);
        let a_rows = repo.list_agent_bindings(&agent_a.cs_agent_id).await.unwrap();
        assert_eq!(a_rows.len(), 1);
        assert_eq!(a_rows[0].channel_plugin_id, plugin_2);

        // Empty PUT clears the set.
        repo.replace_agent_bindings(&agent_a.cs_agent_id, &[], 3).await.unwrap();
        assert!(repo.list_agent_bindings(&agent_a.cs_agent_id).await.unwrap().is_empty());
        assert!(repo.binding_for_plugin(&plugin_2).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn dialogue_get_or_create_upserts_on_identity_triple() {
        let (_db, repo) = repo().await;
        let agent = repo.create_agent(&new_agent("A")).await.unwrap();
        let other = repo.create_agent(&new_agent("B")).await.unwrap();
        let key = dialogue_key();

        let first = repo.get_or_create_dialogue(&agent.cs_agent_id, &key, 10).await.unwrap();
        let second = repo.get_or_create_dialogue(&agent.cs_agent_id, &key, 20).await.unwrap();
        assert_eq!(first.cs_dialogue_id, second.cs_dialogue_id, "same lane");
        assert_eq!(second.last_activity, 20);
        assert_eq!(second.created_at, 10, "created_at is immutable");

        // Bot rebound to another agent: the lane follows the current agent.
        let third = repo.get_or_create_dialogue(&other.cs_agent_id, &key, 30).await.unwrap();
        assert_eq!(third.cs_dialogue_id, first.cs_dialogue_id);
        assert_eq!(third.cs_agent_id, other.cs_agent_id);

        // A different chat in the same plugin gets its own lane.
        let mut other_chat = key.clone();
        other_chat.chat_id = "chat-2".into();
        let lane2 = repo.get_or_create_dialogue(&agent.cs_agent_id, &other_chat, 40).await.unwrap();
        assert_ne!(lane2.cs_dialogue_id, first.cs_dialogue_id);
    }

    #[tokio::test]
    async fn messages_append_window_and_budget() {
        let (_db, repo) = repo().await;
        let agent = repo.create_agent(&new_agent("A")).await.unwrap();
        let dialogue = repo
            .get_or_create_dialogue(&agent.cs_agent_id, &dialogue_key(), 1)
            .await
            .unwrap();

        for index in 0..5 {
            repo.append_message(
                &dialogue.cs_dialogue_id,
                if index % 2 == 0 { "visitor" } else { "agent" },
                &format!("msg-{index}"),
                10 + index,
            )
            .await
            .unwrap();
        }

        let all = repo.list_messages(&dialogue.cs_dialogue_id).await.unwrap();
        assert_eq!(all.len(), 5);
        assert_eq!(all[0].content, "msg-0");
        assert_eq!(all[4].content, "msg-4");

        // Limit window: newest 3, chronological order.
        let window = repo.recent_messages(&dialogue.cs_dialogue_id, 3, 10_000).await.unwrap();
        assert_eq!(
            window.iter().map(|m| m.content.as_str()).collect::<Vec<_>>(),
            vec!["msg-2", "msg-3", "msg-4"]
        );

        // Char budget: each message is 5 chars; budget 11 keeps newest two
        // (the newest always survives even under a tiny budget).
        let tight = repo.recent_messages(&dialogue.cs_dialogue_id, 30, 11).await.unwrap();
        assert_eq!(
            tight.iter().map(|m| m.content.as_str()).collect::<Vec<_>>(),
            vec!["msg-3", "msg-4"]
        );
        let tiny = repo.recent_messages(&dialogue.cs_dialogue_id, 30, 1).await.unwrap();
        assert_eq!(tiny.len(), 1, "newest message always survives");

        // Appending bumps last_activity.
        let refreshed = repo.get_dialogue(&dialogue.cs_dialogue_id).await.unwrap().unwrap();
        assert_eq!(refreshed.last_activity, 14);

        // Unknown dialogue → NotFound.
        assert!(matches!(
            repo.append_message(&generate_id(), "visitor", "x", 1).await.unwrap_err(),
            DbError::NotFound(_)
        ));
    }

    #[tokio::test]
    async fn notes_scope_shared_plus_private_and_search() {
        let (_db, repo) = repo().await;
        let agent_a = repo.create_agent(&new_agent("A")).await.unwrap();
        let agent_b = repo.create_agent(&new_agent("B")).await.unwrap();

        let make_note = |owner: Option<String>, content: &str, enabled: bool| CsNoteRow {
            cs_note_id: generate_id(),
            cs_agent_id: owner,
            kind: "faq".into(),
            content: content.into(),
            enabled,
            created_at: 1,
            updated_at: 1,
        };
        repo.create_note(&make_note(None, "shared 退货政策", true)).await.unwrap();
        repo.create_note(&make_note(Some(agent_a.cs_agent_id.clone()), "A 私有 发货时间", true))
            .await
            .unwrap();
        repo.create_note(&make_note(Some(agent_b.cs_agent_id.clone()), "B 私有 发货时间", true))
            .await
            .unwrap();
        repo.create_note(&make_note(Some(agent_a.cs_agent_id.clone()), "A 停用 发货时间", false))
            .await
            .unwrap();

        // Visible scope = shared + own private.
        let visible = repo.list_notes(Some(&agent_a.cs_agent_id)).await.unwrap();
        assert_eq!(visible.len(), 3);
        assert!(visible.iter().all(|note| note.cs_agent_id.as_deref() != Some(agent_b.cs_agent_id.as_str())));
        assert_eq!(repo.list_notes(None).await.unwrap().len(), 4);

        // Search: enabled only, scope-filtered.
        let hits = repo.search_notes(&agent_a.cs_agent_id, "发货", 10).await.unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].content, "A 私有 发货时间");
        let shared_hits = repo.search_notes(&agent_b.cs_agent_id, "退货", 10).await.unwrap();
        assert_eq!(shared_hits.len(), 1);

        // LIKE metacharacters in the query are literals, not wildcards.
        assert!(repo.search_notes(&agent_a.cs_agent_id, "%", 10).await.unwrap().is_empty());

        // Update and delete.
        let note = &repo.list_notes(Some(&agent_a.cs_agent_id)).await.unwrap()[0];
        let updated = repo
            .update_note(&note.cs_note_id, Some("policy"), None, Some(false), 9)
            .await
            .unwrap();
        assert_eq!(updated.kind, "policy");
        assert!(!updated.enabled);
        repo.delete_note(&note.cs_note_id).await.unwrap();
        assert!(matches!(
            repo.delete_note(&note.cs_note_id).await.unwrap_err(),
            DbError::NotFound(_)
        ));
    }

    #[tokio::test]
    async fn delete_agent_cascades_own_rows_keeps_shared_notes() {
        let (_db, repo) = repo().await;
        let agent = repo.create_agent(&new_agent("A")).await.unwrap();
        let plugin = ChannelPluginId::new().into_string();
        repo.replace_agent_bindings(&agent.cs_agent_id, std::slice::from_ref(&plugin), 1)
            .await
            .unwrap();
        let dialogue = repo
            .get_or_create_dialogue(&agent.cs_agent_id, &dialogue_key(), 1)
            .await
            .unwrap();
        repo.append_message(&dialogue.cs_dialogue_id, "visitor", "hi", 2).await.unwrap();
        repo.create_note(&CsNoteRow {
            cs_note_id: generate_id(),
            cs_agent_id: Some(agent.cs_agent_id.clone()),
            kind: "faq".into(),
            content: "private".into(),
            enabled: true,
            created_at: 1,
            updated_at: 1,
        })
        .await
        .unwrap();
        repo.create_note(&CsNoteRow {
            cs_note_id: generate_id(),
            cs_agent_id: None,
            kind: "faq".into(),
            content: "shared".into(),
            enabled: true,
            created_at: 1,
            updated_at: 1,
        })
        .await
        .unwrap();

        repo.delete_agent(&agent.cs_agent_id).await.unwrap();
        assert!(repo.binding_for_plugin(&plugin).await.unwrap().is_none());
        assert!(repo.get_dialogue(&dialogue.cs_dialogue_id).await.unwrap().is_none());
        assert!(repo.list_messages(&dialogue.cs_dialogue_id).await.unwrap().is_empty());
        let remaining = repo.list_notes(None).await.unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].content, "shared");
    }

    #[tokio::test]
    async fn audit_insert_list_and_retention_cleanup() {
        let (_db, repo) = repo().await;
        let mut short_lived = new_agent("short");
        short_lived.audit_retention_days = 1;
        let agent = repo.create_agent(&short_lived).await.unwrap();

        const DAY_MS: i64 = 24 * 60 * 60 * 1000;
        let now = 10 * DAY_MS;
        for (kind, at) in [("turn", now - 3 * DAY_MS), ("turn", now - 1), ("turn_error", now)] {
            repo.insert_audit_event(&CsAuditEventRow {
                cs_agent_id: agent.cs_agent_id.clone(),
                kind: kind.into(),
                platform: "telegram".into(),
                detail: "d".into(),
                created_at: at,
            })
            .await
            .unwrap();
        }
        assert_eq!(repo.list_audit_events(&agent.cs_agent_id, 10).await.unwrap().len(), 3);

        let removed = repo.cleanup_audit_events(now).await.unwrap();
        assert_eq!(removed, 1, "only the 3-day-old event exceeds 1-day retention");
        let events = repo.list_audit_events(&agent.cs_agent_id, 10).await.unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].kind, "turn_error", "newest first");
    }

    #[tokio::test]
    async fn inbox_joins_agent_name_and_last_message_across_agents() {
        let (_db, repo) = repo().await;
        let agent_a = repo.create_agent(&new_agent("客服A")).await.unwrap();
        let agent_b = repo.create_agent(&new_agent("客服B")).await.unwrap();

        let lane_a = repo
            .get_or_create_dialogue(&agent_a.cs_agent_id, &dialogue_key(), 100)
            .await
            .unwrap();
        repo.append_message(&lane_a.cs_dialogue_id, "visitor", "请问发货时间", 110)
            .await
            .unwrap();
        repo.append_message(&lane_a.cs_dialogue_id, "agent", "48 小时内发货", 120)
            .await
            .unwrap();

        let mut key_b = dialogue_key();
        key_b.chat_id = "chat-b".into();
        let lane_b = repo
            .get_or_create_dialogue(&agent_b.cs_agent_id, &key_b, 200)
            .await
            .unwrap();
        repo.append_message(&lane_b.cs_dialogue_id, "visitor", "B 的访客", 210)
            .await
            .unwrap();

        // No channel_plugins/channel_users rows → LEFT JOIN yields 'unknown' /
        // NULL labels, but the row must still surface with agent name + preview.
        let inbox = repo.list_inbox(None, None, 100).await.unwrap();
        assert_eq!(inbox.len(), 2);
        // Newest activity first (B at 210, A at 120).
        assert_eq!(inbox[0].cs_dialogue_id, lane_b.cs_dialogue_id);
        assert_eq!(inbox[0].agent_name, "客服B");
        assert_eq!(inbox[0].channel_type, "unknown");
        assert_eq!(inbox[0].visitor_name, None);
        assert_eq!(inbox[0].last_message_preview.as_deref(), Some("B 的访客"));
        assert_eq!(inbox[0].last_message_role.as_deref(), Some("visitor"));

        assert_eq!(inbox[1].cs_dialogue_id, lane_a.cs_dialogue_id);
        assert_eq!(inbox[1].agent_name, "客服A");
        assert_eq!(inbox[1].last_message_preview.as_deref(), Some("48 小时内发货"));

        // State filter narrows to active only.
        let active = repo.list_inbox(Some("ai"), None, 100).await.unwrap();
        assert_eq!(active.len(), 2);

        // Closing A's lane then filtering 'ai' drops it.
        repo.close_dialogue(&lane_a.cs_dialogue_id, 300).await.unwrap();
        let active_after = repo.list_inbox(Some("ai"), None, 100).await.unwrap();
        assert_eq!(active_after.len(), 1);
        assert_eq!(active_after[0].cs_dialogue_id, lane_b.cs_dialogue_id);

        // Unknown state is rejected.
        assert!(matches!(
            repo.list_inbox(Some("bogus"), None, 100).await.unwrap_err(),
            DbError::Conflict(_)
        ));
    }
}
