//! 网页访客挂件 (web chat widget) — 匿名访客接入面。
//!
//! 让一个客服智能体可以被嵌进客户官网：一行 `<script>` 就能让陌生访客
//! 与 AI 客服对话。这是客服域的商业入口 —— 没有它，智能体只能被已经是
//! 企微/微信好友的人触达。
//!
//! # 为什么没有新表
//!
//! `cs_dialogues` 的 `channel_plugin_id` / `channel_user_id` 都是严格
//! uuidv7 且 NOT NULL，而网页访客天然没有 IM 账号。这里用两个手段复用
//! 现有表，从而完全避免新增产品表（新增表要同步 `PRODUCT_TABLES` 三处，
//! 漏一处会让线上数据集被隔离）：
//!
//! - `channel_plugin_id` = 固定虚拟插件 ID [`WEB_WIDGET_PLUGIN_ID`]。
//! - `channel_user_id`   = 后端签发的 uuidv7 访客 ID（装在不透明令牌里）。
//!
//! # 安全模型
//!
//! 访客令牌是**唯一凭证**，因此：
//! - 用实例级 AES-256-GCM 密钥加密（`encrypt_string`），访客无法伪造或篡改；
//! - 载荷钉死 `aid`（智能体）与 `did`（会话），一个令牌不能跨智能体重放；
//! - `widget_key` 是官网侧公开的站点标识，32 位 CSPRNG 随机串，可轮换；
//! - `widget_allowed_origins` 非空时只接受白名单来源页。
//!
//! 令牌的机密性只保护"这条会话"，不保护服务端任何资源；即便泄露，影响面
//! 也仅限单个访客的一段对话记录。

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;

use nomifun_common::{AppError, generate_id, now_ms};
use nomifun_db::{CsAgentRow, CsDialogueKey};
use nomifun_db::models::NewCsRatingRow;
use serde::{Deserialize, Serialize};

use crate::dialogue::CsDialogueEngine;
use crate::service::CustomerServiceService;

/// 所有网页挂件会话共用的虚拟渠道插件 ID。
///
/// `cs_dialogues.channel_plugin_id` 要求严格 uuidv7 且非空，但访客不是任何
/// IM 平台的用户，所以整个挂件面共用一个固定虚拟插件。选一个明显非随机的
/// 值（全零前缀）便于在库中一眼识别挂件来源。
///
/// 结构校验：`00000000-0000-7000-8000-000000000001`
/// 第三段首位 `7` = uuid v7，第四段首位 `8` = RFC 4122 variant。
pub const WEB_WIDGET_PLUGIN_ID: &str = "00000000-0000-7000-8000-000000000001";

/// 挂件会话的 `chat_id`。固定为 `web`：同一访客在站内不同页面间切换时仍然
/// 落在同一条会话上（一人一线 = bot + visitor + chat 三元组）。
const WEB_WIDGET_CHAT_ID: &str = "web";

/// 单条访客消息的最大字符数（防刷、防超长 prompt 注入）。
const MAX_VISITOR_TEXT_CHARS: usize = 2000;

// ── 公开端点限流 ─────────────────────────────────────────────────────
//
// 挂件端点不要求登录，而每条访客消息都会触发一次真实的大模型调用。不限流
// 等于把客户的账单敞给互联网，所以两个入口都做固定窗口限流。

/// 同一 IP 每个窗口内可新建的会话数。
const BOOTSTRAP_LIMIT_PER_WINDOW: u32 = 30;
/// 同一会话每个窗口内可发送的消息数。
const MESSAGE_LIMIT_PER_WINDOW: u32 = 40;
const RATE_LIMIT_WINDOW_MS: i64 = 60_000;

/// 极简固定窗口计数器。
///
/// 只用于"挡住明显异常流量"（脚本刷接口），不追求精确分布式语义：挂件流量
/// 天然分散，单实例内存计数足够。计数在进程内累积，窗口过期即重置。
#[derive(Default)]
struct FixedWindowLimiter {
    /// key -> (窗口起始毫秒, 窗口内计数)
    windows: Mutex<HashMap<String, (i64, u32)>>,
}

impl FixedWindowLimiter {
    /// 返回 `true` 表示本次请求在配额内。
    fn allow(&self, key: &str, limit: u32) -> bool {
        let now = now_ms();
        let mut windows = self
            .windows
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        // 条目过多时顺带回收过期窗口，避免长期运行下无限增长。
        if windows.len() > 10_000 {
            windows.retain(|_, (start, _)| now - *start < RATE_LIMIT_WINDOW_MS);
        }
        let entry = windows.entry(key.to_owned()).or_insert((now, 0));
        if now - entry.0 >= RATE_LIMIT_WINDOW_MS {
            entry.0 = now;
            entry.1 = 0;
        }
        entry.1 += 1;
        entry.1 <= limit
    }
}

/// 挂件配置（管理端读写视图）。
///
/// 与 [`CsAgentRow`] 上的四个 `widget_*` 列一一对应，但把两个 JSON 列解码成
/// 真正的结构，避免每个调用点各自 `serde_json::from_str`。
#[derive(Debug, Clone, Serialize)]
pub struct CsWidgetConfig {
    /// 是否接受来自官网的匿名访客。
    pub enabled: bool,
    /// 站点公开标识；`None` 表示尚未分配（挂件不可访问）。
    pub widget_key: Option<String>,
    /// 来源页白名单；空表示不限制。
    pub allowed_origins: Vec<String>,
    /// 外观配置（颜色 / 位置 / 标题等）。
    pub theme: serde_json::Value,
}

impl CsWidgetConfig {
    /// 从持久化行解码。JSON 列损坏时退化为"空配置"而不是让读路径失败，
    /// 以免一条脏数据让整个客服详情页打不开。
    pub fn from_agent(agent: &CsAgentRow) -> Self {
        Self {
            enabled: agent.widget_enabled,
            widget_key: agent.widget_key.clone(),
            allowed_origins: serde_json::from_str(&agent.widget_allowed_origins)
                .unwrap_or_default(),
            theme: serde_json::from_str(&agent.widget_theme).unwrap_or(serde_json::Value::Null),
        }
    }
}

/// 令牌载荷。加密后作为不透明字符串下发给浏览器，浏览器原样回传。
///
/// 类型本身对外可见（它是令牌编解码的输入/输出），但字段保持私有：调用方
/// 无法自行构造一个载荷，只能拿到 [`VisitorTokenCodec::read`] 解出的结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VisitorClaims {
    /// uuidv7 访客 ID，同时充当 `cs_dialogues.channel_user_id`。
    vid: String,
    /// 服务的客服智能体 ID。钉死以防令牌跨智能体重放。
    aid: String,
    /// 会话 ID。钉死以防借令牌读取同智能体下的他人会话。
    did: String,
    /// 签发时间（毫秒）。
    iat: i64,
}

/// 访客令牌的签发 / 校验。
#[derive(Clone)]
pub struct VisitorTokenCodec {
    key: [u8; 32],
}

impl VisitorTokenCodec {
    pub fn new(key: [u8; 32]) -> Self {
        Self { key }
    }

    /// 加密并序列化为不透明令牌。
    pub fn issue(&self, claims: &VisitorClaims) -> Result<String, AppError> {
        let json = serde_json::to_string(claims)
            .map_err(|error| AppError::Internal(format!("visitor token encode failed: {error}")))?;
        nomifun_common::encrypt_string(&json, &self.key)
    }

    /// 校验并解出载荷。任何伪造、篡改、密钥轮换后的旧令牌都返回 `None`，
    /// 调用方按"未认证"处理（不区分具体原因，避免给攻击者反馈）。
    pub fn read(&self, token: &str) -> Option<VisitorClaims> {
        if token.is_empty() || token.len() > 4096 {
            return None;
        }
        let json = nomifun_common::decrypt_string(token, &self.key).ok()?;
        serde_json::from_str::<VisitorClaims>(&json).ok()
    }
}

/// 挂件初始化时下发给浏览器的公开信息（不含任何内部 ID）。
#[derive(Debug, Clone, Serialize)]
pub struct WidgetBootstrap {
    /// 后续请求必须回传的会话令牌。
    pub token: String,
    /// 客服显示名。
    pub agent_name: String,
    /// 开场白。
    pub greeting: String,
    /// 主题配置（颜色 / 位置 / 标题等），原样透传给前端。
    pub theme: serde_json::Value,
    /// 历史消息，供刷新页面后恢复上下文。
    pub messages: Vec<WidgetMessage>,
    /// 会话是否已被人工接管或关闭（此时 AI 不再自动回复）。
    pub taken_over: bool,
}

/// 一条对话消息（访客视角只区分"我"和"客服"）。
#[derive(Debug, Clone, Serialize)]
pub struct WidgetMessage {
    /// `visitor` | `agent`。
    pub role: String,
    pub content: String,
    pub created_at: i64,
}

/// 访客发言的处理结果。
#[derive(Debug, Clone, Serialize)]
pub struct WidgetReply {
    /// AI 回复；`None` 表示当前没有可发送的内容（已转人工 / 会话关闭 /
    /// 消息被合并进上一个批次）。
    pub reply: Option<String>,
    /// 该会话已由人工坐席接管。
    pub taken_over: bool,
}

/// 网页挂件服务：匿名访客 ↔ 客服智能体。
pub struct CsWidgetService {
    service: Arc<CustomerServiceService>,
    engine: Arc<CsDialogueEngine>,
    codec: VisitorTokenCodec,
    limiter: FixedWindowLimiter,
}

impl CsWidgetService {
    pub fn new(
        service: Arc<CustomerServiceService>,
        engine: Arc<CsDialogueEngine>,
        encryption_key: [u8; 32],
    ) -> Self {
        Self {
            service,
            engine,
            codec: VisitorTokenCodec::new(encryption_key),
            limiter: FixedWindowLimiter::default(),
        }
    }

    /// 打开或恢复一个访客会话。
    ///
    /// `origin` 是访客所在页面的源（用于白名单校验，可为空）。
    /// `existing_token` 是浏览器上次拿到的令牌；有效且属于同一智能体时复用
    /// 原会话，让访客刷新页面后能看到历史对话。
    pub async fn bootstrap(
        &self,
        widget_key: &str,
        origin: &str,
        existing_token: Option<&str>,
        client_ip: &str,
    ) -> Result<WidgetBootstrap, AppError> {
        if !self
            .limiter
            .allow(&format!("boot:{client_ip}"), BOOTSTRAP_LIMIT_PER_WINDOW)
        {
            tracing::warn!(client_ip, "web widget bootstrap rate limited");
            return Err(AppError::RateLimited);
        }
        let agent = self.resolve_agent(widget_key, origin).await?;

        // 回访：令牌有效且仍指向同一智能体时复用原会话。
        let reused = existing_token
            .and_then(|token| self.codec.read(token))
            .filter(|claims| claims.aid == agent.cs_agent_id);

        let (visitor_id, dialogue) = match reused {
            Some(claims) => {
                let dialogue = self
                    .service
                    .repo()
                    .get_dialogue(&claims.did)
                    .await
                    .map_err(|error| AppError::Internal(error.to_string()))?
                    // 令牌有效但会话已被清理（例如智能体被删）：按失效处理，
                    // 前端会重新 bootstrap 开一条新会话。
                    .ok_or_else(|| AppError::Unauthorized("会话已失效，请重新开始".into()))?;
                (claims.vid, dialogue)
            }
            None => {
                let visitor_id = generate_id();
                let key = CsDialogueKey {
                    channel_plugin_id: WEB_WIDGET_PLUGIN_ID.to_owned(),
                    channel_user_id: visitor_id.clone(),
                    chat_id: WEB_WIDGET_CHAT_ID.to_owned(),
                };
                let dialogue = self
                    .service
                    .repo()
                    .get_or_create_dialogue(&agent.cs_agent_id, &key, now_ms())
                    .await
                    .map_err(|error| AppError::Internal(error.to_string()))?;
                (visitor_id, dialogue)
            }
        };

        let token = self.codec.issue(&VisitorClaims {
            vid: visitor_id,
            aid: agent.cs_agent_id.clone(),
            did: dialogue.cs_dialogue_id.clone(),
            iat: now_ms(),
        })?;

        let messages = self
            .load_messages(&dialogue.cs_dialogue_id)
            .await
            .unwrap_or_default();

        Ok(WidgetBootstrap {
            token,
            agent_name: agent.name.clone(),
            greeting: agent.greeting.clone(),
            theme: serde_json::from_str(&agent.widget_theme).unwrap_or(serde_json::Value::Null),
            messages,
            taken_over: dialogue.state != nomifun_db::models::CS_DIALOGUE_STATE_AI,
        })
    }

    /// 访客发言 → 交给对话引擎 → 返回 AI 回复。
    pub async fn post_message(&self, token: &str, text: &str) -> Result<WidgetReply, AppError> {
        let claims = self
            .codec
            .read(token)
            .ok_or_else(|| AppError::Unauthorized("访客会话无效或已过期".into()))?;
        if !self
            .limiter
            .allow(&format!("msg:{}", claims.did), MESSAGE_LIMIT_PER_WINDOW)
        {
            tracing::warn!(dialogue = %claims.did, "web widget message rate limited");
            return Err(AppError::RateLimited);
        }

        let text = text.trim();
        if text.is_empty() {
            return Err(AppError::BadRequest("消息内容不能为空".into()));
        }
        if text.chars().count() > MAX_VISITOR_TEXT_CHARS {
            return Err(AppError::BadRequest(format!(
                "消息内容超过 {MAX_VISITOR_TEXT_CHARS} 字"
            )));
        }

        // 令牌钉死了智能体与会话，这里再确认智能体仍启用挂件：管理员可能在
        // 访客停留期间关掉挂件或整个智能体。
        let agent = self
            .service
            .repo()
            .get_agent(&claims.aid)
            .await
            .map_err(|error| AppError::Internal(error.to_string()))?
            .ok_or_else(|| AppError::NotFound("客服不存在".into()))?;
        if !agent.enabled || !agent.widget_enabled {
            return Err(AppError::NotFound("该客服暂不提供服务".into()));
        }

        let reply = self
            .engine
            .handle_visitor_message(
                &claims.aid,
                WEB_WIDGET_PLUGIN_ID,
                &claims.vid,
                WEB_WIDGET_CHAT_ID,
                text,
            )
            .await
            .map_err(|notice| AppError::Internal(notice))?;

        let taken_over = self
            .service
            .repo()
            .get_dialogue(&claims.did)
            .await
            .map(|row| row.is_some_and(|row| row.state != nomifun_db::models::CS_DIALOGUE_STATE_AI))
            .unwrap_or(false);

        Ok(WidgetReply { reply, taken_over })
    }

    /// 轮询拉取会话消息（供人工坐席介入后访客侧看到人工回复）。
    pub async fn list_messages(&self, token: &str) -> Result<Vec<WidgetMessage>, AppError> {
        let claims = self
            .codec
            .read(token)
            .ok_or_else(|| AppError::Unauthorized("访客会话无效或已过期".into()))?;
        self.load_messages(&claims.did).await
    }

    /// 访客给本次会话打分（1–5 星，可附留言）。
    ///
    /// 一次会话只允许评价一条：迁移 043 在 `cs_ratings(cs_dialogue_id)` 上建了
    /// 部分唯一索引，重复提交会撞库，这里转成 409 让前端给出人话提示。
    /// 打分不校验 Origin —— 访客可能先关页面再从邮件链接回来，此时没有来源，
    /// 而令牌本身已经证明了他就是那段会话的当事人。
    pub async fn rate(&self, token: &str, score: i64, comment: &str) -> Result<(), AppError> {
        if !(1..=5).contains(&score) {
            return Err(AppError::BadRequest(
                "score must be between 1 and 5".into(),
            ));
        }
        if comment.chars().count() > 1000 {
            return Err(AppError::BadRequest(
                "comment exceeds 1000 characters".into(),
            ));
        }
        let claims = self
            .codec
            .read(token)
            .ok_or_else(|| AppError::Unauthorized("invalid visitor token".into()))?;
        // 令牌指向的会话必须还在：已删除的会话不该被追评。
        self.service
            .repo()
            .get_dialogue(&claims.did)
            .await?
            .ok_or_else(|| AppError::NotFound("dialogue not found".into()))?;
        match self
            .service
            .repo()
            .create_rating(&NewCsRatingRow {
                cs_ticket_id: None,
                cs_dialogue_id: Some(claims.did.clone()),
                cs_agent_id: Some(claims.aid.clone()),
                score,
                comment: comment.trim().to_owned(),
                source: "widget".into(),
            })
            .await
        {
            Ok(_) => Ok(()),
            Err(nomifun_db::DbError::Conflict(_)) => {
                Err(AppError::Conflict("该会话已经评价过了".into()))
            }
            Err(error) => Err(error.into()),
        }
    }

    async fn load_messages(&self, cs_dialogue_id: &str) -> Result<Vec<WidgetMessage>, AppError> {
        let rows = self
            .service
            .repo()
            .list_messages(cs_dialogue_id)
            .await
            .map_err(|error| AppError::Internal(error.to_string()))?;
        Ok(rows
            .into_iter()
            // `system` 消息是内部事件，不下发给访客。
            .filter(|row| row.role != "system")
            .map(|row| WidgetMessage {
                role: row.role,
                content: row.content,
                // `TimestampMs` is an `i64` alias.
                created_at: row.created_at,
            })
            .collect())
    }

    /// 用站点公开的 `widget_key` 反查智能体，并校验来源页白名单。
    async fn resolve_agent(&self, widget_key: &str, origin: &str) -> Result<CsAgentRow, AppError> {
        let agent = self
            .service
            .repo()
            .find_agent_by_widget_key(widget_key)
            .await
            .map_err(|error| AppError::Internal(error.to_string()))?
            .ok_or_else(|| AppError::NotFound("挂件未启用或标识无效".into()))?;

        if !agent.enabled || !agent.widget_enabled {
            return Err(AppError::NotFound("该客服暂不提供服务".into()));
        }
        if !origin_allowed(&agent, origin) {
            return Err(AppError::Forbidden("当前站点未获授权使用该客服".into()));
        }
        Ok(agent)
    }
}

/// 来源页白名单校验。空列表 = 不限制（先让客户能快速接入，之后再收紧）。
fn origin_allowed(agent: &CsAgentRow, origin: &str) -> bool {
    let allowed: Vec<String> =
        serde_json::from_str(&agent.widget_allowed_origins).unwrap_or_default();
    if allowed.is_empty() {
        return true;
    }
    // 浏览器可能不发送 Origin（例如从本地文件打开）；此时无法证明来源，
    // 配置了白名单就一律拒绝。
    if origin.trim().is_empty() {
        return false;
    }
    allowed.iter().any(|entry| {
        entry == origin
            || entry
                .strip_suffix('/')
                .is_some_and(|trimmed| trimmed == origin)
    })
}

#[cfg(test)]
mod tests {
    use nomifun_ai_agent::OneShotTurnRequest;
    use nomifun_db::SqliteCustomerServiceRepository;
    use nomifun_db::models::NewCsAgentRow;
    use nomifun_db::{ICustomerServiceRepository, UpdateCsAgentParams};
    use nomifun_knowledge::KnowledgeService;
    use nomifun_realtime::UserEventSink;

    use crate::dialogue::TurnRunner;
    use crate::service::CustomerServiceService;

    use super::*;

    const KEY: [u8; 32] = [7u8; 32];

    struct NoopSink;
    impl UserEventSink for NoopSink {
        fn send_to_user(
            &self,
            _user_id: &str,
            _event: nomifun_api_types::WebSocketMessage<serde_json::Value>,
        ) {
        }
    }

    /// 固定回复的替身引擎：挂件链路的测试不该依赖真实大模型。
    struct StubRunner;

    #[async_trait::async_trait]
    impl TurnRunner for StubRunner {
        async fn run(&self, _req: OneShotTurnRequest) -> Result<String, AppError> {
            Ok("这是测试回复".to_owned())
        }
    }

    struct Fx {
        _db: nomifun_db::Database,
        _tmp: tempfile::TempDir,
        repo: Arc<dyn ICustomerServiceRepository>,
        widget: CsWidgetService,
    }

    async fn fx() -> Fx {
        let db = nomifun_db::init_database_memory().await.unwrap();
        let repo: Arc<dyn ICustomerServiceRepository> =
            Arc::new(SqliteCustomerServiceRepository::new(db.pool().clone()));
        let tmp = tempfile::tempdir().unwrap();
        let emitter =
            nomifun_knowledge::KnowledgeEventEmitter::new(Arc::new(NoopSink), Arc::from("owner"));
        let knowledge = Arc::new(KnowledgeService::new(
            Arc::new(nomifun_db::SqliteKnowledgeRepository::new(
                db.pool().clone(),
            )),
            tmp.path(),
            emitter,
        ));
        let engine = Arc::new(CsDialogueEngine::new(
            repo.clone(),
            knowledge,
            Arc::new(StubRunner),
        ));
        let widget = CsWidgetService::new(Arc::new(CustomerServiceService::new(repo.clone())), engine, KEY);
        Fx {
            _db: db,
            _tmp: tmp,
            repo,
            widget,
        }
    }

    /// 建一个已启用挂件并分配了站点标识的客服。
    async fn widget_agent(repo: &Arc<dyn ICustomerServiceRepository>, origins: &str) -> CsAgentRow {
        let created = repo
            .create_agent(&NewCsAgentRow {
                cs_agent_id: generate_id(),
                name: "官网客服".into(),
                greeting: "您好，请问有什么可以帮您？".into(),
                persona: "耐心".into(),
                service_policy: String::new(),
                // `run_turn` 要求 provider/model 齐备，否则直接判定无法服务
                // （真实环境里就是"还没给这位客服配模型"）。
                provider_id: Some(generate_id()),
                model: Some("test-model".into()),
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
            })
            .await
            .unwrap();
        repo.update_agent(
            &created.cs_agent_id,
            &UpdateCsAgentParams {
                widget_enabled: Some(true),
                rotate_widget_key: Some(true),
                widget_allowed_origins: Some(origins.to_owned()),
                ..Default::default()
            },
            2,
        )
        .await
        .unwrap()
    }

    #[test]
    fn token_roundtrips_and_rejects_forgery() {
        let codec = VisitorTokenCodec::new(KEY);
        let claims = VisitorClaims {
            vid: generate_id(),
            aid: generate_id(),
            did: generate_id(),
            iat: now_ms(),
        };
        let token = codec.issue(&claims).unwrap();

        let back = codec.read(&token).expect("valid token must decode");
        assert_eq!(back.vid, claims.vid);
        assert_eq!(back.aid, claims.aid);

        // 篡改任意一个字节都必须失效，而不是解出脏数据。
        let mut tampered = token.clone();
        tampered.replace_range(0..1, if tampered.starts_with('A') { "B" } else { "A" });
        assert!(codec.read(&tampered).is_none());
        // 另一把密钥（模拟轮换）解不开旧令牌。
        assert!(VisitorTokenCodec::new([9u8; 32]).read(&token).is_none());
        assert!(codec.read("").is_none());
        assert!(codec.read("not-a-token").is_none());
    }

    #[test]
    fn virtual_plugin_id_is_valid_uuidv7() {
        nomifun_common::validate_uuidv7(WEB_WIDGET_PLUGIN_ID)
            .expect("virtual plugin id must satisfy the strict uuidv7 column check");
    }

    #[test]
    fn empty_origin_list_allows_everywhere() {
        let agent = CsAgentRow {
            cs_agent_id: generate_id(),
            name: "a".into(),
            greeting: String::new(),
            persona: String::new(),
            service_policy: String::new(),
            provider_id: None,
            model: None,
            knowledge_base_ids: "[]".into(),
            business_endpoints: "[]".into(),
            enabled: true,
            max_concurrent: 8,
            audit_retention_days: 30,
            created_at: 1,
            updated_at: 1,
            widget_enabled: true,
            widget_key: None,
            widget_allowed_origins: "[]".into(),
            widget_theme: "{}".into(),
        };
        assert!(origin_allowed(&agent, "https://example.com"));
        assert!(origin_allowed(&agent, ""));

        let mut restricted = agent.clone();
        restricted.widget_allowed_origins = r#"["https://example.com"]"#.to_owned();
        assert!(origin_allowed(&restricted, "https://example.com"));
        // 白名单一旦配置，未知来源与缺失来源都拒绝。
        assert!(!origin_allowed(&restricted, "https://evil.test"));
        assert!(!origin_allowed(&restricted, ""));
        // 尾斜杠容错。
        let mut slashed = agent.clone();
        slashed.widget_allowed_origins = r#"["https://example.com/"]"#.to_owned();
        assert!(origin_allowed(&slashed, "https://example.com"));
    }

    /// 默认关闭：升级上来的老客服不能凭空多出一个对外入口。
    #[tokio::test]
    async fn disabled_widget_never_serves_visitors() {
        let fx = fx().await;
        let agent = widget_agent(&fx.repo, "[]").await;
        let key = agent.widget_key.as_deref().unwrap();
        fx.repo
            .update_agent(
                &agent.cs_agent_id,
                &UpdateCsAgentParams {
                    widget_enabled: Some(false),
                    ..Default::default()
                },
                3,
            )
            .await
            .unwrap();

        let err = fx
            .widget
            .bootstrap(key, "https://shop.test", None, "1.2.3.4")
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "got {err:?}");
    }

    /// 主链路：开会话 → 发言拿到回复 → 带旧令牌回访能恢复历史。
    #[tokio::test]
    async fn bootstrap_and_message_round_trip() {
        let fx = fx().await;
        let agent = widget_agent(&fx.repo, "[]").await;
        let key = agent.widget_key.as_deref().unwrap();

        let boot = fx
            .widget
            .bootstrap(key, "https://shop.test", None, "1.2.3.4")
            .await
            .unwrap();
        assert!(!boot.token.is_empty());
        assert_eq!(boot.agent_name, "官网客服");
        assert_eq!(boot.greeting, "您好，请问有什么可以帮您？");
        assert!(boot.messages.is_empty());
        assert!(!boot.taken_over);

        let reply = fx.widget.post_message(&boot.token, "你好").await.unwrap();
        assert_eq!(reply.reply.as_deref(), Some("这是测试回复"));
        assert!(!reply.taken_over);

        // 回访：同一令牌必须落回同一条会话并带出历史。
        let again = fx
            .widget
            .bootstrap(key, "https://shop.test", Some(&boot.token), "1.2.3.4")
            .await
            .unwrap();
        assert_eq!(again.messages.len(), 2, "历史消息应完整恢复");
        assert_eq!(again.messages[0].role, "visitor");
        assert_eq!(again.messages[0].content, "你好");
        assert_eq!(again.messages[1].role, "agent");
        assert_eq!(again.messages[1].content, "这是测试回复");

        // list_messages 走令牌也能读到同样的内容。
        let listed = fx.widget.list_messages(&boot.token).await.unwrap();
        assert_eq!(listed.len(), 2);
    }

    #[tokio::test]
    async fn forged_token_and_empty_text_are_rejected() {
        let fx = fx().await;
        let agent = widget_agent(&fx.repo, "[]").await;
        let key = agent.widget_key.as_deref().unwrap();
        let boot = fx
            .widget
            .bootstrap(key, "https://shop.test", None, "1.2.3.4")
            .await
            .unwrap();

        let err = fx.widget.post_message("forged-token", "你好").await.unwrap_err();
        assert!(matches!(err, AppError::Unauthorized(_)), "got {err:?}");

        let err = fx.widget.post_message(&boot.token, "   ").await.unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)), "got {err:?}");

        // 超长输入
        let long = "啊".repeat(MAX_VISITOR_TEXT_CHARS + 1);
        let err = fx.widget.post_message(&boot.token, &long).await.unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)), "got {err:?}");

        let err = fx.widget.list_messages("forged").await.unwrap_err();
        assert!(matches!(err, AppError::Unauthorized(_)));
    }

    /// 来源白名单：防止别人把你的客服挂到自己的网站上。
    #[tokio::test]
    async fn origin_allowlist_blocks_other_sites() {
        let fx = fx().await;
        let agent = widget_agent(&fx.repo, r#"["https://shop.test"]"#).await;
        let key = agent.widget_key.as_deref().unwrap();

        let err = fx
            .widget
            .bootstrap(key, "https://evil.test", None, "1.2.3.4")
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Forbidden(_)), "got {err:?}");

        // 白名单已配置时，缺失 Origin 也必须拒绝（无法证明来源）。
        let err = fx.widget.bootstrap(key, "", None, "1.2.3.4").await.unwrap_err();
        assert!(matches!(err, AppError::Forbidden(_)), "got {err:?}");

        assert!(fx
            .widget
            .bootstrap(key, "https://shop.test", None, "1.2.3.4")
            .await
            .is_ok());

        // 未知站点标识
        let err = fx
            .widget
            .bootstrap("no-such-key", "https://shop.test", None, "1.2.3.4")
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "got {err:?}");
    }

    /// 会话被清理后，旧令牌必须失效而不是悄悄落到别人的会话上。
    #[tokio::test]
    async fn stale_token_does_not_resurrect_a_deleted_dialogue() {
        let fx = fx().await;
        let agent = widget_agent(&fx.repo, "[]").await;
        let key = agent.widget_key.as_deref().unwrap();
        let boot = fx
            .widget
            .bootstrap(key, "https://shop.test", None, "1.2.3.4")
            .await
            .unwrap();

        fx.repo.delete_agent(&agent.cs_agent_id).await.unwrap();
        // 删除客服会级联清掉会话；令牌仍在但指向不存在的会话。
        let err = fx
            .widget
            .bootstrap(key, "https://shop.test", Some(&boot.token), "1.2.3.4")
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::Unauthorized(_) | AppError::NotFound(_)),
            "got {err:?}"
        );
    }
}
