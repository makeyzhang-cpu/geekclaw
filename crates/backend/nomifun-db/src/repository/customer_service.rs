use nomifun_common::TimestampMs;

use crate::error::DbError;
use crate::models::{
    CsAgentRow, CsAuditEventRow, CsChannelBindingRow, CsDialogueRow, CsMessageRow, CsNoteRow,
    CsTicketRow, NewCsAgentRow, NewCsTicketRow,
};

/// Identity triple that pins a visitor dialogue lane (一人一线).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CsDialogueKey {
    pub channel_plugin_id: String,
    pub channel_user_id: String,
    pub chat_id: String,
}

/// Mutable columns accepted when updating a `cs_agents` row. `None` keeps the
/// stored value.
#[derive(Debug, Clone, Default)]
pub struct UpdateCsAgentParams {
    pub name: Option<String>,
    pub greeting: Option<String>,
    pub persona: Option<String>,
    pub service_policy: Option<String>,
    /// `Some(None)` clears the provider binding; `None` keeps it.
    pub provider_id: Option<Option<String>>,
    pub model: Option<Option<String>>,
    /// JSON array string (`CsAgentRow::encode_knowledge_base_ids`).
    pub knowledge_base_ids: Option<String>,
    /// JSON array string (`CsAgentRow::encode_business_endpoints`).
    pub business_endpoints: Option<String>,
    pub enabled: Option<bool>,
    pub max_concurrent: Option<i64>,
    pub audit_retention_days: Option<i64>,
}

/// Mutable columns accepted when updating a `cs_tickets` row. `None` keeps
/// the stored value; `Some(None)` clears a nullable column. Status transitions
/// surface `DbError::InvalidArgument` for unknown values.
#[derive(Debug, Clone, Default)]
pub struct UpdateCsTicketParams {
    pub title: Option<String>,
    pub description: Option<Option<String>>,
    /// New status. Must be one of `pending`/`in_progress`/`resolved`/`cancelled`.
    pub status: Option<String>,
    /// New priority. Must be one of `low`/`normal`/`high`/`urgent`.
    pub priority: Option<String>,
    /// `Some(None)` unassigns the ticket.
    pub assignee_id: Option<Option<String>>,
    pub visitor_name: Option<String>,
    pub visitor_handle: Option<String>,
}

/// Data access abstraction for the customer-service (`cs_`) tables.
///
/// Object-safe via `async_trait` to support `Arc<dyn ICustomerServiceRepository>`.
#[async_trait::async_trait]
pub trait ICustomerServiceRepository: Send + Sync {
    // ── cs_agents CRUD ───────────────────────────────────────────────

    /// Insert a new customer-service agent and return the persisted row.
    async fn create_agent(&self, row: &NewCsAgentRow) -> Result<CsAgentRow, DbError>;

    /// Return one agent by business ID, or `None`.
    async fn get_agent(&self, cs_agent_id: &str) -> Result<Option<CsAgentRow>, DbError>;

    /// Return all agents ordered by creation time descending.
    async fn list_agents(&self) -> Result<Vec<CsAgentRow>, DbError>;

    /// Patch the mutable columns of an agent. Returns the updated row.
    /// `DbError::NotFound` if absent.
    async fn update_agent(
        &self,
        cs_agent_id: &str,
        params: &UpdateCsAgentParams,
        now: TimestampMs,
    ) -> Result<CsAgentRow, DbError>;

    /// Delete an agent and cascade its bindings, dialogues (with messages) and
    /// private notes in one transaction. Shared notes (`cs_agent_id IS NULL`)
    /// and audit events are retained. `DbError::NotFound` if absent.
    async fn delete_agent(&self, cs_agent_id: &str) -> Result<(), DbError>;

    // ── cs_channel_bindings ──────────────────────────────────────────

    /// Replace the full binding set of one agent (PUT semantics): every listed
    /// plugin ends up bound to `cs_agent_id` (rebinding steals a plugin from
    /// any other agent), and bindings of this agent not listed are removed.
    async fn replace_agent_bindings(
        &self,
        cs_agent_id: &str,
        channel_plugin_ids: &[String],
        now: TimestampMs,
    ) -> Result<Vec<CsChannelBindingRow>, DbError>;

    /// Bindings of one agent, newest first.
    async fn list_agent_bindings(
        &self,
        cs_agent_id: &str,
    ) -> Result<Vec<CsChannelBindingRow>, DbError>;

    /// The binding owning `channel_plugin_id`, or `None` (a bot serves at most
    /// one agent).
    async fn binding_for_plugin(
        &self,
        channel_plugin_id: &str,
    ) -> Result<Option<CsChannelBindingRow>, DbError>;

    // ── cs_dialogues / cs_messages ───────────────────────────────────

    /// Fetch or create the dialogue lane for an identity triple. On reuse the
    /// row's `last_activity` (and `cs_agent_id`, if the bot was rebound) is
    /// refreshed.
    async fn get_or_create_dialogue(
        &self,
        cs_agent_id: &str,
        key: &CsDialogueKey,
        now: TimestampMs,
    ) -> Result<CsDialogueRow, DbError>;

    /// Return one dialogue by business ID, or `None`.
    async fn get_dialogue(&self, cs_dialogue_id: &str) -> Result<Option<CsDialogueRow>, DbError>;

    /// Dialogues of one agent ordered by last activity descending.
    async fn list_dialogues(&self, cs_agent_id: &str) -> Result<Vec<CsDialogueRow>, DbError>;

    /// Append one transcript message and bump the dialogue's `last_activity`.
    async fn append_message(
        &self,
        cs_dialogue_id: &str,
        role: &str,
        content: &str,
        now: TimestampMs,
    ) -> Result<CsMessageRow, DbError>;

    /// The most recent messages of a dialogue in CHRONOLOGICAL order, capped
    /// at `limit` rows and (approximately) `char_budget` total content chars.
    /// The newest messages win when the budget truncates.
    async fn recent_messages(
        &self,
        cs_dialogue_id: &str,
        limit: usize,
        char_budget: usize,
    ) -> Result<Vec<CsMessageRow>, DbError>;

    /// Full transcript of a dialogue in chronological order.
    async fn list_messages(&self, cs_dialogue_id: &str) -> Result<Vec<CsMessageRow>, DbError>;

    /// Transition a dialogue into operator (`human`) mode. Idempotent: if
    /// already `human`, the existing `taken_by` is preserved and `last_activity`
    /// is refreshed. `DbError::NotFound` if the dialogue is absent. A dialogue
    /// that is `closed` cannot be re-taken — return `DbError::InvalidState`.
    async fn take_dialogue(
        &self,
        cs_dialogue_id: &str,
        operator_id: &str,
        now: TimestampMs,
    ) -> Result<CsDialogueRow, DbError>;

    /// Return a dialogue to `ai` mode after operator takeover. Idempotent.
    /// `DbError::NotFound` if absent.
    async fn release_dialogue(
        &self,
        cs_dialogue_id: &str,
        now: TimestampMs,
    ) -> Result<CsDialogueRow, DbError>;

    /// Close a dialogue (terminal state). Idempotent.
    /// `DbError::NotFound` if absent.
    async fn close_dialogue(
        &self,
        cs_dialogue_id: &str,
        now: TimestampMs,
    ) -> Result<CsDialogueRow, DbError>;

    /// Append a HUMAN-authored agent message. Used by the operator workbench
    /// when a real person replies inside the AI dialogue. The dialogue's
    /// `last_activity` is refreshed.
    async fn append_human_message(
        &self,
        cs_dialogue_id: &str,
        content: &str,
        now: TimestampMs,
    ) -> Result<CsMessageRow, DbError>;

    /// List active (non-closed) dialogues of an agent ordered by last activity
    /// descending. The workbench surfaces these as the "inbox".
    async fn list_active_dialogues(
        &self,
        cs_agent_id: &str,
    ) -> Result<Vec<CsDialogueRow>, DbError>;

    // ── cs_notes CRUD ────────────────────────────────────────────────

    /// Insert a note (private when `cs_agent_id` is set, shared when `None`).
    async fn create_note(&self, row: &CsNoteRow) -> Result<CsNoteRow, DbError>;

    /// Notes visible to one agent: its private notes plus every shared note.
    /// `None` lists ALL notes (management surface).
    async fn list_notes(&self, cs_agent_id: Option<&str>) -> Result<Vec<CsNoteRow>, DbError>;

    /// Enabled notes visible to one agent whose content matches `query`
    /// (case-insensitive LIKE), newest first, capped at `limit`.
    async fn search_notes(
        &self,
        cs_agent_id: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<CsNoteRow>, DbError>;

    /// Patch `kind`/`content`/`enabled` of a note. `DbError::NotFound` if absent.
    async fn update_note(
        &self,
        cs_note_id: &str,
        kind: Option<&str>,
        content: Option<&str>,
        enabled: Option<bool>,
        now: TimestampMs,
    ) -> Result<CsNoteRow, DbError>;

    /// Delete a note by business ID. `DbError::NotFound` if absent.
    async fn delete_note(&self, cs_note_id: &str) -> Result<(), DbError>;

    // ── cs_audit_events ──────────────────────────────────────────────

    /// Append one audit event.
    async fn insert_audit_event(&self, row: &CsAuditEventRow) -> Result<(), DbError>;

    /// Audit events of one agent, newest first, capped at `limit`.
    async fn list_audit_events(
        &self,
        cs_agent_id: &str,
        limit: usize,
    ) -> Result<Vec<CsAuditEventRow>, DbError>;

    /// Prune audit events older than each agent's `audit_retention_days`.
    /// Returns the number of deleted rows.
    async fn cleanup_audit_events(&self, now: TimestampMs) -> Result<u64, DbError>;

    // ── cs_tickets (5.0.22 workbench) ────────────────────────────────

    /// Insert a new ticket and return the persisted row.
    async fn create_ticket(&self, row: &NewCsTicketRow) -> Result<CsTicketRow, DbError>;

    /// Return one ticket by business ID, or `None`.
    async fn get_ticket(&self, cs_ticket_id: &str) -> Result<Option<CsTicketRow>, DbError>;

    /// List tickets, optionally filtered by status and agent. Newest first.
    async fn list_tickets(
        &self,
        cs_agent_id: Option<&str>,
        status: Option<&str>,
        limit: usize,
    ) -> Result<Vec<CsTicketRow>, DbError>;

    /// Patch the mutable columns of a ticket. Status transitions to a closed
    /// state (`resolved`/`cancelled`) refresh `updated_at`. `DbError::NotFound`
    /// if absent. Invalid status values surface as `DbError::InvalidArgument`.
    async fn update_ticket(
        &self,
        cs_ticket_id: &str,
        params: &UpdateCsTicketParams,
        now: TimestampMs,
    ) -> Result<CsTicketRow, DbError>;

    /// Delete a ticket by business ID. `DbError::NotFound` if absent.
    async fn delete_ticket(&self, cs_ticket_id: &str) -> Result<(), DbError>;
}
