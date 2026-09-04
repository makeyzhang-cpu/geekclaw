//! LINE Messaging API plugin (v5.0.26).
//!
//! v1 scope: text messages, single recipient, webhook-only (no long-polling).
//! Webhooks are routed by the manager; this plugin owns credentials + the
//! HTTP client and exposes `verify_signature` / `inject_webhook` for the
//! axum route.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use dashmap::DashMap;
use tracing::{debug, error, info};

use crate::error::ChannelError;
use crate::plugin::{ChannelPlugin, PluginCallbacks, SharedPluginStatus};
use crate::types::{
    BotInfo, PluginConfig, PluginStatus, PluginType, UnifiedIncomingMessage, UnifiedOutgoingMessage,
};

use super::types::{PushTextBody, WebhookEvents};

/// LINE Messaging API push endpoint.
const LINE_PUSH_URL: &str = "https://api.line.me/v2/bot/message/push";

/// Default outbound request timeout.
const SEND_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

/// Per-plugin facade.
pub struct LinePlugin {
    status: SharedPluginStatus,
    bot_info: Option<BotInfo>,
    last_error: Option<String>,

    channel_id: Option<String>,
    channel_access_token: Option<String>,
    channel_secret: Option<String>,

    http: Option<reqwest::Client>,
    callbacks: Option<PluginCallbacks>,
    dedup: Arc<DashMap<String, Instant>>,
    send_seq: AtomicU64,
}

impl Default for LinePlugin {
    fn default() -> Self {
        Self {
            status: SharedPluginStatus::default(),
            bot_info: None,
            last_error: None,
            channel_id: None,
            channel_access_token: None,
            channel_secret: None,
            http: None,
            callbacks: None,
            dedup: Arc::new(DashMap::new()),
            send_seq: AtomicU64::new(0),
        }
    }
}

impl LinePlugin {
    pub fn new() -> Self {
        Self::default()
    }

    /// Verify the `X-Line-Signature` header (base64 HMAC-SHA256 of body using channel_secret).
    pub fn verify_signature(&self, signature_header: &str, raw_body: &[u8]) -> bool {
        let Some(secret) = self.channel_secret.as_deref() else {
            tracing::warn!("LINE plugin has no channel_secret — signature check skipped");
            return false;
        };
        use base64::Engine;
        use hmac::{Hmac, Mac};
        use sha2::Sha256;
        type HmacSha256 = Hmac<Sha256>;
        let Ok(mut mac) = HmacSha256::new_from_slice(secret.as_bytes()) else {
            return false;
        };
        mac.update(raw_body);
        let expected = mac.finalize().into_bytes();
        let expected_b64 = base64::engine::general_purpose::STANDARD.encode(expected);
        expected_b64.as_bytes() == signature_header.as_bytes()
    }

    /// Dispatch one validated webhook event into the callback channel.
    pub fn inject_webhook(&self, payload: &WebhookEvents) -> Result<usize, ChannelError> {
        let mut dispatched = 0usize;
        for event in &payload.events {
            if event.kind != "message" {
                continue;
            }
            let Some(msg) = &event.message else { continue };
            if self.is_duplicate(&msg.id) {
                debug!(msg_id = %msg.id, "LINE: duplicate event skipped");
                continue;
            }
            // LINE source: userId / groupId / roomId.
            let (chat_id, is_group) = if event.source.kind == "group" {
                let g = event.source.groupId.clone().unwrap_or_default();
                (g, true)
            } else if event.source.kind == "room" {
                let r = event.source.roomId.clone().unwrap_or_default();
                (r, true)
            } else {
                (event.source.userId.clone().unwrap_or_default(), false)
            };
            let text = msg.text.clone().unwrap_or_default();

            let unified = UnifiedIncomingMessage {
                id: format!("line-msg-{}", msg.id),
                platform: PluginType::Line,
                chat_id: chat_id.clone(),
                user: crate::types::UnifiedUser {
                    id: chat_id.clone(),
                    username: None,
                    display_name: chat_id,
                    avatar_url: None,
                },
                content: crate::types::UnifiedMessageContent {
                    content_type: crate::types::MessageContentType::Text,
                    text,
                    attachments: None,
                },
                timestamp: event.timestamp,
                reply_to_message_id: None,
                action: None,
                raw: None,
            };
            let _ = is_group;

            self.dispatch(unified)?;
            dispatched += 1;
        }
        Ok(dispatched)
    }

    fn dispatch(&self, unified: UnifiedIncomingMessage) -> Result<(), ChannelError> {
        let tx = self
            .callbacks
            .as_ref()
            .map(|c| &c.message_tx)
            .ok_or_else(|| ChannelError::PlatformApi("LINE plugin not initialized".into()))?;
        tx.try_send(unified)
            .map_err(|e| ChannelError::PlatformApi(format!("LINE message_tx full: {e}")))
    }

    fn is_duplicate(&self, msg_id: &str) -> bool {
        let now = Instant::now();
        self.dedup.retain(|_, ts| now.duration_since(*ts).as_secs() < 600);
        if self.dedup.contains_key(msg_id) {
            return true;
        }
        self.dedup.insert(msg_id.to_owned(), now);
        false
    }
}

#[async_trait::async_trait]
impl ChannelPlugin for LinePlugin {
    async fn initialize(
        &mut self,
        config: PluginConfig,
        callbacks: PluginCallbacks,
    ) -> Result<(), ChannelError> {
        self.status.set(PluginStatus::Initializing);

        let channel_id = config
            .credentials
            .channel_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                self.status.set(PluginStatus::Error);
                self.last_error = Some("Missing LINE channel_id".into());
                ChannelError::InvalidConfig("Missing LINE channel_id".into())
            })?
            .to_owned();

        let channel_access_token = config
            .credentials
            .channel_access_token
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                self.status.set(PluginStatus::Error);
                self.last_error = Some("Missing LINE channel_access_token".into());
                ChannelError::InvalidConfig("Missing LINE channel_access_token".into())
            })?
            .to_owned();

        let channel_secret = config
            .credentials
            .channel_secret
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
            id: channel_id.clone(),
            username: None,
            display_name: "LINE Bot".into(),
        });
        self.channel_id = Some(channel_id);
        self.channel_access_token = Some(channel_access_token);
        self.channel_secret = channel_secret;
        self.http = Some(http);
        self.callbacks = Some(callbacks);
        self.status.set(PluginStatus::Ready);
        info!("LINE plugin initialized");
        Ok(())
    }

    async fn start(&mut self) -> Result<(), ChannelError> {
        if self.http.is_none() {
            self.status.set(PluginStatus::Error);
            return Err(ChannelError::ConnectionFailed(
                "LINE plugin not initialized".into(),
            ));
        }
        self.status.set(PluginStatus::Running);
        info!("LINE plugin running (webhook mode)");
        Ok(())
    }

    async fn stop(&mut self) -> Result<(), ChannelError> {
        self.http = None;
        self.status.set(PluginStatus::Stopped);
        info!("LINE plugin stopped");
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
            .ok_or_else(|| ChannelError::ConnectionFailed("LINE not started".into()))?;
        let access_token = self
            .channel_access_token
            .as_deref()
            .ok_or_else(|| ChannelError::InvalidConfig("LINE access_token missing".into()))?;

        let text = message.text.unwrap_or_default();
        if text.is_empty() {
            return Err(ChannelError::InvalidConfig(
                "LINE send_message requires text (v1)".into(),
            ));
        }

        let body = PushTextBody {
            to: chat_id,
            kind: "text",
            text: &text,
        };

        let seq = self.send_seq.fetch_add(1, Ordering::Relaxed);
        let resp = http
            .post(LINE_PUSH_URL)
            .bearer_auth(access_token)
            .json(&body)
            .send()
            .await
            .map_err(|e| ChannelError::MessageSendFailed(format!("LINE push: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            error!(seq, %status, body = %body, "LINE push failed");
            return Err(ChannelError::MessageSendFailed(format!(
                "LINE push {status}: {body}"
            )));
        }

        // LINE push returns `{}` on success; no message id is returned by v1 push.
        Ok(format!("line-push-{seq}"))
    }

    async fn edit_message(
        &self,
        _chat_id: &str,
        _message_id: &str,
        _message: UnifiedOutgoingMessage,
    ) -> Result<(), ChannelError> {
        // LINE has no edit API in this scope.
        Err(ChannelError::PlatformApi(
            "LINE does not support edit_message in v1".into(),
        ))
    }

    fn active_user_count(&self) -> usize {
        0
    }

    fn bot_info(&self) -> Option<&BotInfo> {
        self.bot_info.as_ref()
    }

    fn plugin_type(&self) -> PluginType {
        PluginType::Line
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
        c.channel_id = Some("2001234567".into());
        c.channel_access_token = Some("LINE-token-xyz".into());
        c.channel_secret = Some("line-secret".into());
        c
    }

    #[tokio::test]
    async fn init_requires_credentials() {
        let (tx, _rx) = mpsc::channel(1);
        let mut p = LinePlugin::new();
        let empty = crate::types::PluginCredentials::default();
        let cfg = crate::types::PluginConfig {
            credentials: empty,
            config: None,
        };
        let cb = PluginCallbacks { message_tx: tx };
        assert!(p.initialize(cfg, cb).await.is_err());
    }

    #[tokio::test]
    async fn init_and_start() {
        let (tx, _rx) = mpsc::channel(1);
        let mut p = LinePlugin::new();
        let cfg = crate::types::PluginConfig {
            credentials: make_credentials(),
            config: None,
        };
        let cb = PluginCallbacks { message_tx: tx };
        p.initialize(cfg, cb).await.unwrap();
        p.start().await.unwrap();
        assert_eq!(p.status(), PluginStatus::Running);
        assert_eq!(p.plugin_type(), PluginType::Line);
    }
}
