//! `/api/customer-service/*` route handlers (REST 面, per Interfaces spec).

use std::sync::Arc;

use axum::Router;
use axum::extract::rejection::JsonRejection;
use axum::extract::{Extension, Json, Path, Query, State};
use axum::routing::get;

use nomifun_api_types::ApiResponse;
use nomifun_auth::CurrentUser;
use nomifun_common::AppError;
use nomifun_common::now_ms;
use nomifun_db::models::{
    CsAgentRow, CsChannelBindingRow, CsDialogueRow, CsInboxItem, CsMessageRow, CsNoteRow,
    CsTicketRow, NewCsTicketRow,
};
use serde::{Deserialize, Serialize};

use crate::dialogue::CsDialogueEngine;
use crate::service::{CreateCsAgentInput, CreateCsNoteInput, CustomerServiceService, UpdateCsAgentInput};

/// Router state for the customer-service domain.
#[derive(Clone)]
pub struct CustomerServiceRouterState {
    pub service: Arc<CustomerServiceService>,
    /// Channel repository used ONLY to validate that binding targets name
    /// live bot rows (binding 的 plugin id 存在性由 route 层查渠道仓储).
    pub channel_repo: Arc<dyn nomifun_db::IChannelRepository>,
    /// 原生 AI 对话引擎 — 与渠道消息循环（nomifun-channel 的 CsRouting 接缝）
    /// 共用同一实例；桌面内置聊天窗的 `POST /chat` 只是它的另一个入口。
    pub engine: Arc<CsDialogueEngine>,
}

pub fn customer_service_routes(state: CustomerServiceRouterState) -> Router {
    Router::new()
        .route("/api/customer-service/agents", get(list_agents).post(create_agent))
        .route(
            "/api/customer-service/agents/{cs_agent_id}",
            get(get_agent).patch(update_agent).delete(delete_agent),
        )
        .route(
            "/api/customer-service/agents/{cs_agent_id}/bindings",
            get(list_bindings).put(replace_bindings),
        )
        .route(
            "/api/customer-service/bindings",
            get(list_all_bindings),
        )
        .route("/api/customer-service/inbox", get(list_inbox))
        .route("/api/customer-service/notes", get(list_notes).post(create_note))
        .route(
            "/api/customer-service/notes/{cs_note_id}",
            axum::routing::patch(update_note).delete(delete_note),
        )
        .route("/api/customer-service/dialogues", get(list_dialogues))
        .route(
            "/api/customer-service/dialogues/active",
            get(list_active_dialogues),
        )
        .route(
            "/api/customer-service/dialogues/{cs_dialogue_id}/messages",
            get(list_dialogue_messages).post(post_human_message),
        )
        .route(
            "/api/customer-service/dialogues/{cs_dialogue_id}/takeover",
            axum::routing::post(takeover_dialogue),
        )
        .route(
            "/api/customer-service/dialogues/{cs_dialogue_id}/release",
            axum::routing::post(release_dialogue),
        )
        .route(
            "/api/customer-service/dialogues/{cs_dialogue_id}/close",
            axum::routing::post(close_dialogue),
        )
        .route(
            "/api/customer-service/tickets",
            get(list_tickets).post(create_ticket),
        )
        .route(
            "/api/customer-service/tickets/{cs_ticket_id}",
            get(get_ticket)
                .patch(update_ticket)
                .delete(delete_ticket),
        )
        .route("/api/customer-service/chat", axum::routing::post(chat))
        .with_state(state)
}

// ── agents ──────────────────────────────────────────────────────────

async fn list_agents(
    State(state): State<CustomerServiceRouterState>,
    Extension(_user): Extension<CurrentUser>,
) -> Result<Json<ApiResponse<Vec<CsAgentRow>>>, AppError> {
    Ok(Json(ApiResponse::ok(state.service.list_agents().await?)))
}

async fn create_agent(
    State(state): State<CustomerServiceRouterState>,
    Extension(_user): Extension<CurrentUser>,
    body: Result<Json<CreateCsAgentInput>, JsonRejection>,
) -> Result<Json<ApiResponse<CsAgentRow>>, AppError> {
    let Json(input) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;
    Ok(Json(ApiResponse::ok(state.service.create_agent(input).await?)))
}

async fn get_agent(
    State(state): State<CustomerServiceRouterState>,
    Extension(_user): Extension<CurrentUser>,
    Path(cs_agent_id): Path<String>,
) -> Result<Json<ApiResponse<CsAgentRow>>, AppError> {
    Ok(Json(ApiResponse::ok(state.service.get_agent(&cs_agent_id).await?)))
}

async fn update_agent(
    State(state): State<CustomerServiceRouterState>,
    Extension(_user): Extension<CurrentUser>,
    Path(cs_agent_id): Path<String>,
    body: Result<Json<UpdateCsAgentInput>, JsonRejection>,
) -> Result<Json<ApiResponse<CsAgentRow>>, AppError> {
    let Json(input) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;
    Ok(Json(ApiResponse::ok(
        state.service.update_agent(&cs_agent_id, input).await?,
    )))
}

async fn delete_agent(
    State(state): State<CustomerServiceRouterState>,
    Extension(_user): Extension<CurrentUser>,
    Path(cs_agent_id): Path<String>,
) -> Result<Json<ApiResponse<bool>>, AppError> {
    state.service.delete_agent(&cs_agent_id).await?;
    Ok(Json(ApiResponse::ok(true)))
}

// ── bindings ────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ReplaceBindingsRequest {
    channel_plugin_ids: Vec<String>,
}

/// Unified channel-management surface: every channel↔agent binding across all
/// agents (newest first). Lets the UI render "哪个 bot 绑给哪个客服" in one pass.
async fn list_all_bindings(
    State(state): State<CustomerServiceRouterState>,
    Extension(_user): Extension<CurrentUser>,
) -> Result<Json<ApiResponse<Vec<CsChannelBindingRow>>>, AppError> {
    Ok(Json(ApiResponse::ok(
        state.service.repo().list_all_bindings().await?,
    )))
}

async fn list_bindings(
    State(state): State<CustomerServiceRouterState>,
    Extension(_user): Extension<CurrentUser>,
    Path(cs_agent_id): Path<String>,
) -> Result<Json<ApiResponse<Vec<CsChannelBindingRow>>>, AppError> {
    Ok(Json(ApiResponse::ok(state.service.list_bindings(&cs_agent_id).await?)))
}

async fn replace_bindings(
    State(state): State<CustomerServiceRouterState>,
    Extension(_user): Extension<CurrentUser>,
    Path(cs_agent_id): Path<String>,
    body: Result<Json<ReplaceBindingsRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<Vec<CsChannelBindingRow>>>, AppError> {
    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;
    // Every listed plugin must name a live bot row owned by the
    // customer-service domain — companion-pool bots are never bindable here
    // (channel ownership is domain-exclusive since migration 020).
    for plugin_id in &req.channel_plugin_ids {
        let plugin = state
            .channel_repo
            .get_plugin(plugin_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| {
                AppError::BadRequest(format!("channel plugin '{plugin_id}' not found"))
            })?;
        if plugin.owner_domain != "customer_service" {
            return Err(AppError::BadRequest(format!(
                "channel bot {plugin_id} belongs to the companion domain; \
                 create a customer-service bot instead"
            )));
        }
    }
    Ok(Json(ApiResponse::ok(
        state
            .service
            .replace_bindings(&cs_agent_id, req.channel_plugin_ids)
            .await?,
    )))
}

// ── notes ───────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ListNotesQuery {
    #[serde(default)]
    cs_agent_id: Option<String>,
}

async fn list_notes(
    State(state): State<CustomerServiceRouterState>,
    Extension(_user): Extension<CurrentUser>,
    Query(query): Query<ListNotesQuery>,
) -> Result<Json<ApiResponse<Vec<CsNoteRow>>>, AppError> {
    Ok(Json(ApiResponse::ok(
        state.service.list_notes(query.cs_agent_id.as_deref()).await?,
    )))
}

async fn create_note(
    State(state): State<CustomerServiceRouterState>,
    Extension(_user): Extension<CurrentUser>,
    body: Result<Json<CreateCsNoteInput>, JsonRejection>,
) -> Result<Json<ApiResponse<CsNoteRow>>, AppError> {
    let Json(input) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;
    Ok(Json(ApiResponse::ok(state.service.create_note(input).await?)))
}

#[derive(Debug, Deserialize)]
struct UpdateNoteRequest {
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    enabled: Option<bool>,
}

async fn update_note(
    State(state): State<CustomerServiceRouterState>,
    Extension(_user): Extension<CurrentUser>,
    Path(cs_note_id): Path<String>,
    body: Result<Json<UpdateNoteRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<CsNoteRow>>, AppError> {
    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;
    Ok(Json(ApiResponse::ok(
        state
            .service
            .update_note(&cs_note_id, req.kind.as_deref(), req.content.as_deref(), req.enabled)
            .await?,
    )))
}

async fn delete_note(
    State(state): State<CustomerServiceRouterState>,
    Extension(_user): Extension<CurrentUser>,
    Path(cs_note_id): Path<String>,
) -> Result<Json<ApiResponse<bool>>, AppError> {
    state.service.delete_note(&cs_note_id).await?;
    Ok(Json(ApiResponse::ok(true)))
}

// ── dialogues (monitoring read surface) ─────────────────────────────

#[derive(Debug, Deserialize)]
struct ListDialoguesQuery {
    cs_agent_id: String,
}

async fn list_dialogues(
    State(state): State<CustomerServiceRouterState>,
    Extension(_user): Extension<CurrentUser>,
    Query(query): Query<ListDialoguesQuery>,
) -> Result<Json<ApiResponse<Vec<CsDialogueRow>>>, AppError> {
    Ok(Json(ApiResponse::ok(
        state.service.repo().list_dialogues(&query.cs_agent_id).await?,
    )))
}

async fn list_dialogue_messages(
    State(state): State<CustomerServiceRouterState>,
    Extension(_user): Extension<CurrentUser>,
    Path(cs_dialogue_id): Path<String>,
) -> Result<Json<ApiResponse<Vec<CsMessageRow>>>, AppError> {
    Ok(Json(ApiResponse::ok(
        state.service.repo().list_messages(&cs_dialogue_id).await?,
    )))
}

async fn list_active_dialogues(
    State(state): State<CustomerServiceRouterState>,
    Extension(_user): Extension<CurrentUser>,
    Query(query): Query<ListDialoguesQuery>,
) -> Result<Json<ApiResponse<Vec<CsDialogueRow>>>, AppError> {
    Ok(Json(ApiResponse::ok(
        state
            .service
            .repo()
            .list_active_dialogues(&query.cs_agent_id)
            .await?,
    )))
}

#[derive(Debug, Deserialize)]
struct ListInboxQuery {
    /// Optional state filter: `ai` | `human` | `closed`. Omitted = all.
    #[serde(default)]
    state: Option<String>,
    /// Optional channel platform filter (e.g. `weixin` / `wecom` / `whatsapp`).
    #[serde(default)]
    channel_type: Option<String>,
    #[serde(default = "default_inbox_limit")]
    limit: i64,
}

fn default_inbox_limit() -> i64 {
    200
}

/// Unified inbox across ALL customer-service agents — the "聚合 AI 客服收件箱".
/// Every dialogue lane is enriched with its channel platform/name, visitor
/// display name and the latest message preview so the operator sees real
/// conversations from every bound channel (WeChat/WeCom/WhatsApp/LINE/Email/…)
/// in one place.
async fn list_inbox(
    State(state): State<CustomerServiceRouterState>,
    Extension(_user): Extension<CurrentUser>,
    Query(query): Query<ListInboxQuery>,
) -> Result<Json<ApiResponse<Vec<CsInboxItem>>>, AppError> {
    let limit = query.limit.clamp(1, 1000) as usize;
    let channel_type = query.channel_type.as_deref().map(str::trim).filter(|s| !s.is_empty());
    Ok(Json(ApiResponse::ok(
        state
            .service
            .repo()
            .list_inbox(query.state.as_deref(), channel_type, limit)
            .await?,
    )))
}

#[derive(Debug, Deserialize)]
struct HumanMessageRequest {
    text: String,
}

async fn post_human_message(
    State(state): State<CustomerServiceRouterState>,
    Extension(_user): Extension<CurrentUser>,
    Path(cs_dialogue_id): Path<String>,
    body: Result<Json<HumanMessageRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<CsMessageRow>>, AppError> {
    let Json(input) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;
    let trimmed = input.text.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest("消息内容不能为空".into()));
    }
    let row = state
        .service
        .repo()
        .append_human_message(&cs_dialogue_id, trimmed, now_ms())
        .await?;
    Ok(Json(ApiResponse::ok(row)))
}

#[derive(Debug, Deserialize)]
struct TakeoverRequest {
    /// Operator user id (UUIDv7) that takes the dialogue. `state.service.repo`
    /// validates canonical UUIDv7 shape before writing the row.
    operator_id: String,
}

async fn takeover_dialogue(
    State(state): State<CustomerServiceRouterState>,
    Extension(_user): Extension<CurrentUser>,
    Path(cs_dialogue_id): Path<String>,
    body: Result<Json<TakeoverRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<CsDialogueRow>>, AppError> {
    let Json(input) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;
    let trimmed = input.operator_id.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest("operator_id 不能为空".into()));
    }
    let row = state
        .service
        .repo()
        .take_dialogue(&cs_dialogue_id, trimmed, now_ms())
        .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn release_dialogue(
    State(state): State<CustomerServiceRouterState>,
    Extension(_user): Extension<CurrentUser>,
    Path(cs_dialogue_id): Path<String>,
) -> Result<Json<ApiResponse<CsDialogueRow>>, AppError> {
    let row = state
        .service
        .repo()
        .release_dialogue(&cs_dialogue_id, now_ms())
        .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn close_dialogue(
    State(state): State<CustomerServiceRouterState>,
    Extension(_user): Extension<CurrentUser>,
    Path(cs_dialogue_id): Path<String>,
) -> Result<Json<ApiResponse<CsDialogueRow>>, AppError> {
    let row = state
        .service
        .repo()
        .close_dialogue(&cs_dialogue_id, now_ms())
        .await?;
    Ok(Json(ApiResponse::ok(row)))
}

// ── tickets (lightweight workbench CRUD) ────────────────────────────

#[derive(Debug, Deserialize)]
struct ListTicketsQuery {
    cs_agent_id: Option<String>,
    status: Option<String>,
    #[serde(default = "default_ticket_limit")]
    limit: i64,
}

fn default_ticket_limit() -> i64 {
    200
}

async fn list_tickets(
    State(state): State<CustomerServiceRouterState>,
    Extension(_user): Extension<CurrentUser>,
    Query(query): Query<ListTicketsQuery>,
) -> Result<Json<ApiResponse<Vec<CsTicketRow>>>, AppError> {
    let limit = query.limit.clamp(1, 500) as usize;
    Ok(Json(ApiResponse::ok(
        state
            .service
            .repo()
            .list_tickets(
                query.cs_agent_id.as_deref(),
                query.status.as_deref(),
                limit,
            )
            .await?,
    )))
}

#[derive(Debug, Deserialize)]
struct CreateTicketRequest {
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default = "default_ticket_priority")]
    priority: String,
    #[serde(default)]
    cs_dialogue_id: Option<String>,
    #[serde(default)]
    cs_agent_id: Option<String>,
    #[serde(default)]
    assignee_id: Option<String>,
    #[serde(default)]
    visitor_name: String,
    #[serde(default)]
    visitor_handle: String,
}

fn default_ticket_priority() -> String {
    "normal".to_owned()
}

async fn create_ticket(
    State(state): State<CustomerServiceRouterState>,
    Extension(_user): Extension<CurrentUser>,
    body: Result<Json<CreateTicketRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<CsTicketRow>>, AppError> {
    let Json(input) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;
    let now = now_ms();
    let row = state
        .service
        .repo()
        .create_ticket(&NewCsTicketRow {
            title: input.title,
            description: input.description,
            priority: input.priority,
            cs_dialogue_id: input.cs_dialogue_id,
            cs_agent_id: input.cs_agent_id,
            assignee_id: input.assignee_id,
            visitor_name: input.visitor_name,
            visitor_handle: input.visitor_handle,
            created_at: now,
            updated_at: now,
        })
        .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn get_ticket(
    State(state): State<CustomerServiceRouterState>,
    Extension(_user): Extension<CurrentUser>,
    Path(cs_ticket_id): Path<String>,
) -> Result<Json<ApiResponse<CsTicketRow>>, AppError> {
    let row = state
        .service
        .repo()
        .get_ticket(&cs_ticket_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("cs ticket {cs_ticket_id}")))?;
    Ok(Json(ApiResponse::ok(row)))
}

#[derive(Debug, Deserialize, Default)]
struct UpdateTicketRequest {
    title: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    description: Option<Option<String>>,
    status: Option<String>,
    priority: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    assignee_id: Option<Option<String>>,
    visitor_name: Option<String>,
    visitor_handle: Option<String>,
}

/// serde helper: emit `Some(None)` when the JSON key is present with `null`,
/// `None` when the key is absent. Lets the route distinguish "clear the
/// column" from "leave it untouched" (matches the double-Option contract on
/// the service layer).
fn double_option<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: serde::Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    serde::Deserialize::deserialize(deserializer).map(Some)
}

async fn update_ticket(
    State(state): State<CustomerServiceRouterState>,
    Extension(_user): Extension<CurrentUser>,
    Path(cs_ticket_id): Path<String>,
    body: Result<Json<UpdateTicketRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<CsTicketRow>>, AppError> {
    let Json(input) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;
    let params = nomifun_db::UpdateCsTicketParams {
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        assignee_id: input.assignee_id,
        visitor_name: input.visitor_name,
        visitor_handle: input.visitor_handle,
    };
    let row = state
        .service
        .repo()
        .update_ticket(&cs_ticket_id, &params, now_ms())
        .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn delete_ticket(
    State(state): State<CustomerServiceRouterState>,
    Extension(_user): Extension<CurrentUser>,
    Path(cs_ticket_id): Path<String>,
) -> Result<Json<ApiResponse<bool>>, AppError> {
    state.service.repo().delete_ticket(&cs_ticket_id).await?;
    Ok(Json(ApiResponse::ok(true)))
}

// ── chat (built-in desktop lane) ────────────────────────────────────

/// Built-in lane identifiers for the desktop chat window. The plugin/user
/// ids are FIXED canonical UUIDv7-format values (they must satisfy the
/// cs_dialogues CHECK constraints — short strings like "desktop" are
/// rejected) so the desktop conversation resumes across restarts; chat_id
/// is free-form. These ids are NOT channel_plugins rows — the desktop
/// window is not an IM channel and never appears in any binding.
pub const DESKTOP_CHANNEL_PLUGIN_ID: &str = "01978a3e-7c1d-7abc-9def-0123456789ab";
pub const DESKTOP_CHANNEL_USER_ID: &str = "01978a3e-7c1d-7abc-9def-0123456789ac";
pub const DESKTOP_CHAT_ID: &str = "desktop-chat";

#[derive(Debug, Deserialize)]
struct ChatRequest {
    cs_agent_id: String,
    text: String,
    /// Optional lane overrides（渠道语义下由渠道层提供；桌面端省略用默认值）.
    #[serde(default)]
    channel_plugin_id: Option<String>,
    #[serde(default)]
    channel_user_id: Option<String>,
    #[serde(default)]
    chat_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct ChatResponse {
    /// `None` = 该文本被合并进同 lane 的另一批次（由那个批次统一回复）。
    reply: Option<String>,
}

/// 桌面内置聊天窗：一条访客消息 → 原生 AI 引擎的一个回合。
///
/// 回答由 GeekClaw 已配置的 LLM（agent 的 provider/model）经
/// `CsDialogueEngine` 原生生成 — 无任何外部客服服务依赖。
async fn chat(
    State(state): State<CustomerServiceRouterState>,
    Extension(_user): Extension<CurrentUser>,
    body: Result<Json<ChatRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<ChatResponse>>, AppError> {
    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;
    let text = req.text.trim();
    if text.is_empty() {
        return Err(AppError::BadRequest("消息内容不能为空".into()));
    }
    let reply = state
        .engine
        .handle_visitor_message(
            &req.cs_agent_id,
            req.channel_plugin_id
                .as_deref()
                .unwrap_or(DESKTOP_CHANNEL_PLUGIN_ID),
            req.channel_user_id
                .as_deref()
                .unwrap_or(DESKTOP_CHANNEL_USER_ID),
            req.chat_id.as_deref().unwrap_or(DESKTOP_CHAT_ID),
            text,
        )
        .await
        .map_err(AppError::BadGateway)?;
    Ok(Json(ApiResponse::ok(ChatResponse { reply })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    use nomifun_db::models::NewChannelPluginRow;
    use nomifun_db::{
        CsDialogueKey, IChannelRepository, ICustomerServiceRepository, SqliteChannelRepository,
        SqliteCustomerServiceRepository,
    };
    use nomifun_realtime::UserEventSink;

    struct NoopSink;
    impl UserEventSink for NoopSink {
        fn send_to_user(
            &self,
            _user_id: &str,
            _event: nomifun_api_types::WebSocketMessage<serde_json::Value>,
        ) {
        }
    }

    /// Echo runner: the desktop lane needs a configured provider/model on
    /// the agent, but the stub never touches a real provider.
    struct EchoRunner;
    #[async_trait::async_trait]
    impl crate::TurnRunner for EchoRunner {
        async fn run(
            &self,
            req: nomifun_ai_agent::OneShotTurnRequest,
        ) -> Result<String, AppError> {
            Ok(format!("echo: {}", req.user_text))
        }
    }

    struct Fixture {
        _db: nomifun_db::Database,
        _tmp: tempfile::TempDir,
        repo: Arc<dyn ICustomerServiceRepository>,
    }

    async fn setup() -> (Fixture, CustomerServiceRouterState) {
        let db = nomifun_db::init_database_memory().await.unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let service = Arc::new(CustomerServiceService::new(Arc::new(
            SqliteCustomerServiceRepository::new(db.pool().clone()),
        )));
        let channel_repo: Arc<dyn IChannelRepository> =
            Arc::new(SqliteChannelRepository::new(db.pool().clone()));

        let emitter = nomifun_knowledge::KnowledgeEventEmitter::new(
            Arc::new(NoopSink),
            Arc::from("test-owner"),
        );
        let knowledge = Arc::new(nomifun_knowledge::KnowledgeService::new(
            Arc::new(nomifun_db::SqliteKnowledgeRepository::new(db.pool().clone())),
            tmp.path(),
            emitter,
        ));
        let repo: Arc<dyn ICustomerServiceRepository> = Arc::new(
            SqliteCustomerServiceRepository::new(db.pool().clone()),
        );
        let engine = Arc::new(CsDialogueEngine::new(
            Arc::clone(&repo),
            knowledge,
            Arc::new(EchoRunner),
        ));
        let state = CustomerServiceRouterState { service, channel_repo, engine };
        (Fixture { _db: db, _tmp: tmp, repo }, state)
    }

    fn user() -> CurrentUser {
        CurrentUser {
            id: nomifun_common::UserId::new(),
            username: "tester".into(),
            role: "user".into(),
            is_active: 1,
        }
    }

    async fn seed_bot(
        state: &CustomerServiceRouterState,
        name: &str,
        owner_domain: &str,
    ) -> String {
        let now = nomifun_common::now_ms();
        state
            .channel_repo
            .create_plugin(&NewChannelPluginRow {
                r#type: "telegram".into(),
                name: name.into(),
                enabled: false,
                config: "enc".into(),
                status: None,
                last_connected: None,
                companion_id: None,
                bot_key: None,
                owner_domain: owner_domain.into(),
                created_at: now,
                updated_at: now,
            })
            .await
            .unwrap()
            .channel_plugin_id
    }

    async fn seed_agent(state: &CustomerServiceRouterState) -> String {
        state
            .service
            .create_agent(CreateCsAgentInput {
                name: "客服A".into(),
                ..Default::default()
            })
            .await
            .unwrap()
            .cs_agent_id
    }

    /// Chat-ready agent: the engine requires provider/model on the row.
    /// provider_id must satisfy the canonical UUIDv7 CHECK constraint.
    async fn seed_chat_agent(state: &CustomerServiceRouterState) -> String {
        state
            .service
            .create_agent(CreateCsAgentInput {
                name: "AI 客服".into(),
                provider_id: Some(nomifun_common::ProviderId::new().into_string()),
                model: Some("test-model".into()),
                ..Default::default()
            })
            .await
            .unwrap()
            .cs_agent_id
    }

    async fn call_chat(
        state: &CustomerServiceRouterState,
        cs_agent_id: &str,
        text: &str,
    ) -> Result<Json<ApiResponse<ChatResponse>>, AppError> {
        chat(
            State(state.clone()),
            Extension(user()),
            Ok(Json(ChatRequest {
                cs_agent_id: cs_agent_id.to_owned(),
                text: text.to_owned(),
                channel_plugin_id: None,
                channel_user_id: None,
                chat_id: None,
            })),
        )
        .await
    }

    async fn put_bindings(
        state: &CustomerServiceRouterState,
        cs_agent_id: &str,
        ids: Vec<String>,
    ) -> Result<Json<ApiResponse<Vec<CsChannelBindingRow>>>, AppError> {
        replace_bindings(
            State(state.clone()),
            Extension(user()),
            Path(cs_agent_id.to_owned()),
            Ok(Json(ReplaceBindingsRequest { channel_plugin_ids: ids })),
        )
        .await
    }

    #[tokio::test]
    async fn replace_bindings_rejects_companion_domain_bot() {
        let (_db, state) = setup().await;
        let agent = seed_agent(&state).await;
        let companion_bot = seed_bot(&state, "Companion Bot", "companion").await;

        let err = put_bindings(&state, &agent, vec![companion_bot.clone()])
            .await
            .unwrap_err();
        match err {
            AppError::BadRequest(message) => {
                assert!(
                    message.contains(&format!(
                        "channel bot {companion_bot} belongs to the companion domain"
                    )) && message.contains("create a customer-service bot instead"),
                    "unexpected message: {message}"
                );
            }
            other => panic!("expected BadRequest, got {other:?}"),
        }
        assert!(
            state.service.list_bindings(&agent).await.unwrap().is_empty(),
            "a rejected PUT must not write any binding"
        );
    }

    #[tokio::test]
    async fn replace_bindings_rejects_missing_bot() {
        let (_db, state) = setup().await;
        let agent = seed_agent(&state).await;
        let missing = nomifun_common::ChannelPluginId::new().into_string();

        let err = put_bindings(&state, &agent, vec![missing]).await.unwrap_err();
        assert!(matches!(err, AppError::BadRequest(message) if message.contains("not found")));
    }

    #[tokio::test]
    async fn replace_bindings_accepts_cs_domain_bot_and_same_domain_rebind() {
        let (_fx, state) = setup().await;
        let agent_a = seed_agent(&state).await;
        let agent_b = seed_agent(&state).await;
        let cs_bot = seed_bot(&state, "CS Bot", "customer_service").await;

        let bound = put_bindings(&state, &agent_a, vec![cs_bot.clone()]).await.unwrap();
        assert_eq!(bound.0.data.as_ref().unwrap().len(), 1);

        // Same-domain re-bind moves the bot from A to B.
        let _ = put_bindings(&state, &agent_b, vec![cs_bot.clone()]).await.unwrap();
        assert!(state.service.list_bindings(&agent_a).await.unwrap().is_empty());
        assert_eq!(
            state
                .service
                .binding_for_plugin(&cs_bot)
                .await
                .unwrap()
                .as_deref(),
            Some(agent_b.as_str())
        );
    }

    // ── chat (built-in desktop lane) ──────────────────────────────────

    #[tokio::test]
    async fn chat_replies_over_the_built_in_desktop_lane() {
        let (fx, state) = setup().await;
        let agent = seed_chat_agent(&state).await;

        let Json(response) = call_chat(&state, &agent, "  你好  ").await.unwrap();
        let payload = response.data.expect("ok payload");
        assert_eq!(payload.reply.as_deref(), Some("echo: 你好"));

        // Transcript persisted under the built-in desktop lane, trimmed.
        let dialogues = fx.repo.list_dialogues(&agent).await.unwrap();
        assert_eq!(dialogues.len(), 1);
        assert_eq!(dialogues[0].channel_plugin_id, DESKTOP_CHANNEL_PLUGIN_ID);
        assert_eq!(dialogues[0].channel_user_id, DESKTOP_CHANNEL_USER_ID);
        assert_eq!(dialogues[0].chat_id, DESKTOP_CHAT_ID);
        let messages = fx
            .repo
            .list_messages(&dialogues[0].cs_dialogue_id)
            .await
            .unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!((messages[0].role.as_str(), messages[0].content.as_str()), ("visitor", "你好"));
        assert_eq!(messages[1].role, "agent");
    }

    #[tokio::test]
    async fn chat_resumes_the_same_lane_across_calls() {
        let (fx, state) = setup().await;
        let agent = seed_chat_agent(&state).await;

        call_chat(&state, &agent, "第一条").await.unwrap();
        call_chat(&state, &agent, "第二条").await.unwrap();

        // Same (desktop, local-user, desktop-chat) lane → one dialogue,
        // four transcript rows.
        let dialogues = fx.repo.list_dialogues(&agent).await.unwrap();
        assert_eq!(dialogues.len(), 1);
        let messages = fx
            .repo
            .list_messages(&dialogues[0].cs_dialogue_id)
            .await
            .unwrap();
        assert_eq!(messages.len(), 4);
    }

    #[tokio::test]
    async fn chat_rejects_blank_text() {
        let (_fx, state) = setup().await;
        let agent = seed_chat_agent(&state).await;

        let error = call_chat(&state, &agent, "   ").await.unwrap_err();
        assert!(matches!(error, AppError::BadRequest(message) if message.contains("消息内容不能为空")));
    }

    #[tokio::test]
    async fn chat_with_unknown_agent_returns_fixed_notice() {
        let (_fx, state) = setup().await;

        let error = call_chat(&state, "missing-agent", "hi")
            .await
            .unwrap_err();
        assert!(
            matches!(error, AppError::BadGateway(message)
                if message == crate::dialogue::FALLBACK_ERROR_NOTICE)
        );
    }

    // ── 5.0.22 workbench tests ────────────────────────────────────

    fn ids() -> (String, String) {
        (
            nomifun_common::ChannelPluginId::new().into_string(),
            nomifun_common::ChannelUserId::new().into_string(),
        )
    }

    fn dummy_operator_id() -> String {
        nomifun_common::UserId::new().into_string()
    }

    #[tokio::test]
    async fn take_then_release_round_trip_via_repo() {
        let (_fx, state) = setup().await;
        let agent = seed_chat_agent(&state).await;
        let repo = state.service.repo();
        let (plugin, visitor) = ids();
        let dialogue = repo
            .get_or_create_dialogue(
                &agent,
                &nomifun_db::CsDialogueKey {
                    channel_plugin_id: plugin,
                    channel_user_id: visitor,
                    chat_id: "chat-take".into(),
                },
                nomifun_common::now_ms(),
            )
            .await
            .unwrap();

        let operator = dummy_operator_id();
        let taken = repo
            .take_dialogue(&dialogue.cs_dialogue_id, &operator, nomifun_common::now_ms())
            .await
            .unwrap();
        assert_eq!(taken.state, "human");
        assert_eq!(taken.taken_by.as_deref(), Some(operator.as_str()));

        let released = repo
            .release_dialogue(&dialogue.cs_dialogue_id, nomifun_common::now_ms())
            .await
            .unwrap();
        assert_eq!(released.state, "ai");
        assert!(released.taken_by.is_none());

        let closed = repo
            .close_dialogue(&dialogue.cs_dialogue_id, nomifun_common::now_ms())
            .await
            .unwrap();
        assert_eq!(closed.state, "closed");
    }

    #[tokio::test]
    async fn take_then_close_is_idempotent_close_only() {
        let (_fx, state) = setup().await;
        let agent = seed_chat_agent(&state).await;
        let repo = state.service.repo();
        let (plugin, visitor) = ids();
        let dialogue = repo
            .get_or_create_dialogue(
                &agent,
                &nomifun_db::CsDialogueKey {
                    channel_plugin_id: plugin,
                    channel_user_id: visitor,
                    chat_id: "chat-idempotent".into(),
                },
                nomifun_common::now_ms(),
            )
            .await
            .unwrap();
        let operator = dummy_operator_id();
        repo.take_dialogue(&dialogue.cs_dialogue_id, &operator, nomifun_common::now_ms())
            .await
            .unwrap();
        repo.close_dialogue(&dialogue.cs_dialogue_id, nomifun_common::now_ms())
            .await
            .unwrap();
        // Second close is a no-op state-wise.
        let second = repo
            .close_dialogue(&dialogue.cs_dialogue_id, nomifun_common::now_ms())
            .await
            .unwrap();
        assert_eq!(second.state, "closed");
        // Re-take of a closed dialogue is rejected.
        let err = repo
            .take_dialogue(&dialogue.cs_dialogue_id, &operator, nomifun_common::now_ms())
            .await
            .err()
            .expect("take on closed must fail");
        let message = match &err {
            nomifun_db::DbError::Conflict(message) => message.clone(),
            other => panic!("unexpected error: {other:?}"),
        };
        assert!(
            message.contains("is closed"),
            "unexpected error message: {message}"
        );
    }

    #[tokio::test]
    async fn append_human_message_uses_sender_kind_human() {
        let (_fx, state) = setup().await;
        let agent = seed_chat_agent(&state).await;
        let repo = state.service.repo();
        let (plugin, visitor) = ids();
        let dialogue = repo
            .get_or_create_dialogue(
                &agent,
                &nomifun_db::CsDialogueKey {
                    channel_plugin_id: plugin,
                    channel_user_id: visitor,
                    chat_id: "chat-human".into(),
                },
                nomifun_common::now_ms(),
            )
            .await
            .unwrap();
        repo.take_dialogue(
            &dialogue.cs_dialogue_id,
            &dummy_operator_id(),
            nomifun_common::now_ms(),
        )
        .await
        .unwrap();
        let written = repo
            .append_human_message(
                &dialogue.cs_dialogue_id,
                "你好，我是坐席小张",
                nomifun_common::now_ms(),
            )
            .await
            .unwrap();
        assert_eq!(written.role, "agent");
        assert_eq!(written.sender_kind, "human");

        // A subsequent visitor turn goes through the engine (AI) — but because
        // state is `human`, the engine returns Ok(None) without invoking the
        // runner. Verify via list_messages: visitor message IS persisted, but
        // the runner recorded no turn.
        let dialogue_after = repo
            .list_active_dialogues(&agent)
            .await
            .unwrap()
            .into_iter()
            .find(|row| row.cs_dialogue_id == dialogue.cs_dialogue_id)
            .expect("dialogue should remain in active list under human takeover");
        assert_eq!(dialogue_after.state, "human");
    }

    #[tokio::test]
    async fn ticket_crud_via_repo_round_trip() {
        let (_fx, state) = setup().await;
        let agent = seed_chat_agent(&state).await;
        let repo = state.service.repo();

        let created = repo
            .create_ticket(&nomifun_db::models::NewCsTicketRow {
                title: "客户要求退款".into(),
                description: "客户使用后感觉效果不佳，要求部分退款".into(),
                priority: nomifun_db::models::CS_TICKET_PRIORITY_HIGH.into(),
                cs_dialogue_id: None,
                cs_agent_id: Some(agent.clone()),
                assignee_id: None,
                visitor_name: "李雷".into(),
                visitor_handle: "lilei@example.com".into(),
                created_at: 1_000,
                updated_at: 1_000,
            })
            .await
            .unwrap();
        assert_eq!(created.status, nomifun_db::models::CS_TICKET_STATUS_PENDING);

        let fetched = repo.get_ticket(&created.cs_ticket_id).await.unwrap().unwrap();
        assert_eq!(fetched.cs_ticket_id, created.cs_ticket_id);

        let params = nomifun_db::UpdateCsTicketParams {
            status: Some("in_progress".into()),
            assignee_id: Some(Some(dummy_operator_id())),
            ..Default::default()
        };
        let updated = repo
            .update_ticket(&created.cs_ticket_id, &params, 2_000)
            .await
            .unwrap();
        assert_eq!(updated.status, "in_progress");
        assert!(updated.assignee_id.is_some());

        let all = repo.list_tickets(Some(&agent), None, 100).await.unwrap();
        assert_eq!(all.len(), 1);
        let only_pending = repo
            .list_tickets(Some(&agent), Some("pending"), 100)
            .await
            .unwrap();
        assert!(only_pending.is_empty());

        repo.delete_ticket(&created.cs_ticket_id).await.unwrap();
        assert!(repo.get_ticket(&created.cs_ticket_id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn ticket_rejects_empty_title_and_unknown_status() {
        let (_fx, state) = setup().await;
        let agent = seed_chat_agent(&state).await;
        let repo = state.service.repo();

        let bad_title = repo
            .create_ticket(&nomifun_db::models::NewCsTicketRow {
                title: "   ".into(),
                description: String::new(),
                priority: "normal".into(),
                cs_dialogue_id: None,
                cs_agent_id: Some(agent.clone()),
                assignee_id: None,
                visitor_name: String::new(),
                visitor_handle: String::new(),
                created_at: 1,
                updated_at: 1,
            })
            .await;
        assert!(matches!(bad_title, Err(nomifun_db::DbError::Conflict(_))));

        let ok = repo
            .create_ticket(&nomifun_db::models::NewCsTicketRow {
                title: "标题不为空".into(),
                description: String::new(),
                priority: "normal".into(),
                cs_dialogue_id: None,
                cs_agent_id: Some(agent.clone()),
                assignee_id: None,
                visitor_name: String::new(),
                visitor_handle: String::new(),
                created_at: 1,
                updated_at: 1,
            })
            .await
            .unwrap();
        let bad_status = repo
            .update_ticket(
                &ok.cs_ticket_id,
                &nomifun_db::UpdateCsTicketParams {
                    status: Some("unknown".into()),
                    ..Default::default()
                },
                2,
            )
            .await;
        assert!(matches!(bad_status, Err(nomifun_db::DbError::Conflict(_))));
    }
}
