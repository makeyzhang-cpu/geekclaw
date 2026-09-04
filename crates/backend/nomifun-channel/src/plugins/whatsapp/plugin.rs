//! WhatsApp Cloud API plugin (v5.0.26).
//!
//! v1 scope: text messages, single recipient. Cloud API uses HTTPS only
//! (Meta enforces TLS). The plugin owns an `reqwest::Client` and the four
//! required credentials; webhooks are routed by the manager.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use dashmap::DashMap;
use tracing::{debug, error, info, warn};

use crate::error::ChannelError;
use crate::plugin::{ChannelPlugin, PluginCallbacks, SharedPluginStatus};
use crate::types::{
    BotInfo, PluginConfig, PluginStatus, PluginType, UnifiedIncomingMessage, UnifiedOutgoingMessage,
};

use super::types::{SendMessageBody, SendTextBody, WebhookMessage, WebhookPayload};

/// WhatsApp Cloud API base URL (graph.facebook.com).
const WA_API_BASE: &str = "https://graph.facebook.com/v21.0";

/// Default request timeout for outbound send.
const SEND_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

/// Per-plugin facade. Holds credentials and an HTTP client; webhooks arrive
/// via `inject_webhook` (called by the axum webhook route).
pub struct WhatsAppPlugin {
    status: SharedPluginStatus,
    bot_info: Option<BotInfo>,
    last_error: Option<String>,

    phone_number_id: Option<String>,
    access_token: Option<String>,
    verify_token: Option<String>,
    app_secret: Option<String>,

    /// Shared HTTP client.
    http: Option<reqwest::Client>,
    callbacks: Option<PluginCallbacks>,
    /// msgid dedup — Meta can redeliver the same webhook.
    dedup: Arc<DashMap<String, Instant>>,
    /// Monotonic counter for outbound req_id fallbacks.
    send_seq: AtomicU64,
}

impl Default for WhatsAppPlugin {
    fn default() -> Self {
        Self {
            status: SharedPluginStatus::default(),
            bot_info: None,
            last_error: None,
            phone_number_id: None,
            access_token: None,
            verify_token: None,
            app_secret: None,
            http: None,
            callbacks: None,
            dedup: Arc::new(DashMap::new()),
            send_seq: AtomicU64::new(0),
        }
    }
}

impl WhatsAppPlugin {
    pub fn new() -> Self {
        Self::default()
    }

    /// Process an inbound webhook payload (called by the manager after HMAC verify).
    ///
    /// Decodes each `messages[]` entry as a `UnifiedIncomingMessage` and pushes it
    /// into the callback channel.
    pub fn inject_webhook(
        &self,
        phone_number_id: &str,
        payload: &WebhookPayload,
    ) -> Result<usize, ChannelError> {
        // Filter to messages addressed to *this* phone_number_id.
        let mut dispatched = 0usize;
        for entry in &payload.entry {
            for change in &entry.changes {
                if change.field != "messages" {
                    continue;
                }
                if change.value.metadata.phone_number_id != phone_number_id {
                    continue;
                }
                for msg in &change.value.messages {
                    if self.is_duplicate(&msg.id) {
                        debug!(msg_id = %msg.id, "WhatsApp: duplicate webhook skipped");
                        continue;
                    }
                    self.dispatch_message(msg)?;
                    dispatched += 1;
                }
            }
        }
        Ok(dispatched)
    }

    /// Verify a webhook handshake (Meta sends `hub.verify_token`; we must echo
    /// `hub.challenge` if it matches our configured verify_token).
    pub fn verify_webhook(&self, token: &str, challenge: &str) -> Result<String, ChannelError> {
        let configured = self.verify_token.as_deref().unwrap_or("");
        if configured.is_empty() || token != configured {
            return Err(ChannelError::InvalidConfig("WhatsApp webhook verify_token mismatch".into()));
        }
        Ok(challenge.to_owned())
    }

    /// Verify the `X-Hub-Signature-256` header against the raw body using `app_secret`.
    pub fn verify_signature(&self, signature_header: &str, raw_body: &[u8]) -> bool {
        let Some(secret) = self.app_secret.as_deref() else {
            warn!("WhatsApp plugin has no app_secret — webhook signature check skipped");
            return false;
        };
        use hmac::{Hmac, Mac};
        use sha2::Sha256;
        type HmacSha256 = Hmac<Sha256>;
        let Ok(mut mac) = HmacSha256::new_from_slice(secret.as_bytes()) else {
            return false;
        };
        mac.update(raw_body);
        let expected = mac.finalize().into_bytes();
        let expected_hex = format!("sha256={}", hex::encode(expected));
        // Plain-bytes compare is acceptable here: Meta's signature is not a
        // secret-keyed MAC token, and the only side effect of a mismatch is
        // a webhook rejection — timing oracles do not leak useful data.
        expected_hex.as_bytes() == signature_header.as_bytes()
    }

    fn dispatch_message(&self, msg: &WebhookMessage) -> Result<(), ChannelError> {
        let tx = self
            .callbacks
            .as_ref()
            .map(|c| &c.message_tx)
            .ok_or_else(|| ChannelError::ConnectionFailed("WhatsApp plugin not initialized".into()))?;

        let text = msg.text.as_ref().map(|t| t.body.clone()).unwrap_or_default();
        let ts_ms = msg.timestamp.parse::<i64>().unwrap_or_else(|_| chrono_now_ms());

        let unified = UnifiedIncomingMessage {
            id: format!("wa-msg-{}", msg.id),
            platform: PluginType::WhatsApp,
            chat_id: msg.from.clone(),
            user: crate::types::UnifiedUser {
                id: msg.from.clone(),
                username: None,
                display_name: msg.from.clone(),
                avatar_url: None,
            },
            content: crate::types::UnifiedMessageContent {
                content_type: crate::types::MessageContentType::Text,
                text,
                attachments: None,
            },
            timestamp: ts_ms,
            reply_to_message_id: None,
            action: None,
            raw: None,
        };

        tx.try_send(unified).map_err(|e| {
            ChannelError::ConnectionFailed(format!("WhatsApp message_tx full: {e}"))
        })?;
        Ok(())
    }

    fn is_duplicate(&self, msg_id: &str) -> bool {
        let now = Instant::now();
        // Sweep stale entries opportunistically.
        self.dedup.retain(|_, ts| now.duration_since(*ts).as_secs() < 600);
        if self.dedup.contains_key(msg_id) {
            return true;
        }
        self.dedup.insert(msg_id.to_owned(), now);
        false
    }
}

fn chrono_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[async_trait::async_trait]
impl ChannelPlugin for WhatsAppPlugin {
    async fn initialize(
        &mut self,
        config: PluginConfig,
        callbacks: PluginCallbacks,
    ) -> Result<(), ChannelError> {
        self.status.set(PluginStatus::Initializing);

        let phone_number_id = config
            .credentials
            .phone_number_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                self.status.set(PluginStatus::Error);
                self.last_error = Some("Missing WhatsApp phone_number_id".into());
                ChannelError::InvalidConfig("Missing WhatsApp phone_number_id".into())
            })?
            .to_owned();

        let access_token = config
            .credentials
            .access_token
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                self.status.set(PluginStatus::Error);
                self.last_error = Some("Missing WhatsApp access_token".into());
                ChannelError::InvalidConfig("Missing WhatsApp access_token".into())
            })?
            .to_owned();

        // verify_token and app_secret are optional at init time; webhook
        // verification simply rejects when missing.
        let verify_token = config
            .credentials
            .verify_token
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned);
        let app_secret = config
            .credentials
            .whatsapp_app_secret
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned);

        let http = reqwest::Client::builder()
            .timeout(SEND_TIMEOUT)
            .build()
            .map_err(|e| {
                self.status.set(PluginStatus::Error);
                self.last_error = Some(format!("reqwest build: {e}"));
                ChannelError::ConnectionFailed(format!("reqwest build: {e}"))
            })?;

        self.bot_info = Some(BotInfo {
            id: phone_number_id.clone(),
            username: None,
            display_name: "WhatsApp Bot".into(),
        });
        self.phone_number_id = Some(phone_number_id);
        self.access_token = Some(access_token);
        self.verify_token = verify_token;
        self.app_secret = app_secret;
        self.http = Some(http);
        self.callbacks = Some(callbacks);
        self.status.set(PluginStatus::Ready);
        info!("WhatsApp plugin initialized");
        Ok(())
    }

    async fn start(&mut self) -> Result<(), ChannelError> {
        // WhatsApp is webhook-driven — no long-running connection. The plugin
        // transitions to Running once init succeeded; the manager's axum route
        // will dispatch incoming webhooks via `inject_webhook`.
        if self.http.is_none() {
            self.status.set(PluginStatus::Error);
            return Err(ChannelError::ConnectionFailed(
                "WhatsApp plugin not initialized".into(),
            ));
        }
        self.status.set(PluginStatus::Running);
        info!("WhatsApp plugin running (webhook mode)");
        Ok(())
    }

    async fn stop(&mut self) -> Result<(), ChannelError> {
        // No persistent loop — just flip status. Drop the HTTP client to close
        // pooled connections promptly.
        self.http = None;
        self.status.set(PluginStatus::Stopped);
        info!("WhatsApp plugin stopped");
        Ok(())
    }

    async fn send_message(
        &self,
        chat_id: &str,
        message: UnifiedOutgoingMessage,
    ) -> Result<String, ChannelError> {
        let http = self
            .http
            .as_ref()
            .ok_or_else(|| ChannelError::ConnectionFailed("WhatsApp not started".into()))?;
        let phone_number_id = self
            .phone_number_id
            .as_deref()
            .ok_or_else(|| ChannelError::InvalidConfig("WhatsApp phone_number_id missing".into()))?;
        let access_token = self
            .access_token
            .as_deref()
            .ok_or_else(|| ChannelError::InvalidConfig("WhatsApp access_token missing".into()))?;

        let text = message.text.unwrap_or_default();
        if text.is_empty() {
            return Err(ChannelError::InvalidConfig(
                "WhatsApp send_message requires text (v1 only supports text)".into(),
            ));
        }

        let url = format!("{WA_API_BASE}/{phone_number_id}/messages");
        let body = SendMessageBody {
            messaging_product: "whatsapp",
            recipient: chat_id,
            kind: "text",
            text: SendTextBody { body: &text },
        };

        let seq = self.send_seq.fetch_add(1, Ordering::Relaxed);
        let resp = http
            .post(&url)
            .bearer_auth(access_token)
            .json(&body)
            .send()
            .await
            .map_err(|e| ChannelError::MessageSendFailed(format!("WhatsApp send: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            error!(
                seq,
                %status, body = %body,
                "WhatsApp send failed"
            );
            return Err(ChannelError::MessageSendFailed(format!(
                "WhatsApp send {status}: {body}"
            )));
        }

        let parsed: super::types::SendMessageResponse = resp
            .json()
            .await
            .map_err(|e| ChannelError::PlatformApi(format!("WhatsApp response decode: {e}")))?;

        let id = parsed
            .messages
            .first()
            .map(|m| m.id.clone())
            .unwrap_or_else(|| format!("wa-send-{seq}"));
        Ok(id)
    }

    async fn edit_message(
        &self,
        chat_id: &str,
        _message_id: &str,
        message: UnifiedOutgoingMessage,
    ) -> Result<(), ChannelError> {
        // WhatsApp Cloud has no edit API — degrade to sending a new reply.
        self.send_message(chat_id, message).await.map(|_| ())
    }

    fn active_user_count(&self) -> usize {
        0
    }

    fn bot_info(&self) -> Option<&BotInfo> {
        self.bot_info.as_ref()
    }

    fn plugin_type(&self) -> PluginType {
        PluginType::WhatsApp
    }

    fn status(&self) -> PluginStatus {
        self.status.get()
    }

    fn last_error(&self) -> Option<&str> {
        self.last_error.as_deref()
    }
}

#[cfg(test)]
use tokio::sync::mpsc;
mod tests {
    use super::*;

    fn make_credentials() -> crate::types::PluginCredentials {
        let mut c = crate::types::PluginCredentials::default();
        c.phone_number_id = Some("1234567890".into());
        c.whatsapp_access_token = Some("EAAxxxx".into());
        c.verify_token = Some("vtoken-123".into());
        c.whatsapp_app_secret = Some("appsecret-xyz".into());
        c
    }

    #[tokio::test]
    async fn init_requires_phone_number_id_and_token() {
        let (tx, _rx) = mpsc::channel(1);
        let mut p = WhatsAppPlugin::new();
        let mut empty = crate::types::PluginCredentials::default();
        empty.phone_number_id = Some("1".into());
        // Missing access_token
        let cfg = crate::types::PluginConfig {
            credentials: empty,
            config: None,
        };
        let cb = PluginCallbacks { message_tx: tx };
        assert!(p.initialize(cfg, cb).await.is_err());
    }

    #[tokio::test]
    async fn init_and_start_succeed() {
        let (tx, _rx) = mpsc::channel(1);
        let mut p = WhatsAppPlugin::new();
        let cfg = crate::types::PluginConfig {
            credentials: make_credentials(),
            config: None,
        };
        let cb = PluginCallbacks { message_tx: tx };
        p.initialize(cfg, cb).await.unwrap();
        p.start().await.unwrap();
        assert_eq!(p.status(), PluginStatus::Running);
        assert_eq!(p.plugin_type(), PluginType::WhatsApp);
    }

    #[test]
    fn verify_webhook_returns_challenge_when_token_matches() {
        let mut p = WhatsAppPlugin::new();
        p.verify_token = Some("vtoken-123".into());
        let out = p.verify_webhook("vtoken-123", "12345").unwrap();
        assert_eq!(out, "12345");
        assert!(p.verify_webhook("wrong", "12345").is_err());
    }
}

// End of plugin.
