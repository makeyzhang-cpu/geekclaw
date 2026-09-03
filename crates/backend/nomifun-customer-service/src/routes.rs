//! `/api/customer-service/*` route handlers (REST 面, per Interfaces spec).

use std::sync::Arc;

use axum::Router;
use axum::extract::rejection::JsonRejection;
use axum::extract::{Extension, Json, Path, Query, State};
use axum::routing::get;

use nomifun_api_types::ApiResponse;
use nomifun_auth::CurrentUser;
use nomifun_common::AppError;
use nomifun_db::models::{
    CsAgentRow, CsChannelBindingRow, CsDialogueRow, CsMessageRow, CsNoteRow,
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
        .route("/api/customer-service/notes", get(list_notes).post(create_note))
        .route(
            "/api/customer-service/notes/{cs_note_id}",
            axum::routing::patch(update_note).delete(delete_note),
        )
        .route("/api/customer-service/dialogues", get(list_dialogues))
        .route(
            "/api/customer-service/dialogues/{cs_dialogue_id}/messages",
            get(list_dialogue_messages),
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
        IChannelRepository, ICustomerServiceRepository, SqliteChannelRepository,
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
}
