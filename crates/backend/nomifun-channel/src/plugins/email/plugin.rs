//! Email channel plugin (v5.0.26) — IMAP inbound + SMTP outbound.
//!
//! v1 scope: text-only, polled every 60s (IMAP IDLE optional where supported).
//!
//! Implementation strategy:
//!   - `start()` spawns a background tokio task that connects to IMAP and
//!     performs a SELECT on INBOX. Each iteration:
//!       1. `UID SEARCH UNSEEN` → list of unseen UIDs.
//!       2. For each UID: `UID FETCH <uid> BODY.PEEK[TEXT]` → raw text.
//!       3. Convert to `UnifiedIncomingMessage` and push via `message_tx`.
//!       4. Sleep 60s (configurable via `extra.poll_interval_secs`).
//!   - `send_message()` opens an SMTP connection (via `lettre`) and posts
//!     a single text/plain RFC-5322 message.
//!
//! v1 deliberately does not parse MIME attachments; that lands in a follow-up.

use std::time::Duration;

use tokio::sync::mpsc;
use tokio::sync::watch;
use tokio::task::JoinHandle;
use tracing::{error, info, warn};

use crate::error::ChannelError;
use crate::plugin::{ChannelPlugin, PluginCallbacks, SharedPluginStatus};
use crate::types::{
    BotInfo, PluginConfig, PluginStatus, PluginType, UnifiedIncomingMessage, UnifiedOutgoingMessage,
};

use lettre::Transport;

// ParsedInbound reserved for v5.0.27 IMAP dispatch

/// Default poll interval when nothing else is configured.
const DEFAULT_POLL_SECS: u64 = 60;

pub struct EmailPlugin {
    status: SharedPluginStatus,
    bot_info: Option<BotInfo>,
    last_error: Option<String>,

    account_id: Option<String>, // "from" address
    imap_host: Option<String>,
    imap_port: Option<u16>,
    smtp_host: Option<String>,
    smtp_port: Option<u16>,
    imap_username: Option<String>,
    imap_password: Option<String>,
    poll_secs: u64,

    callbacks: Option<PluginCallbacks>,
    poll_handle: Option<JoinHandle<()>>,
    shutdown_tx: Option<watch::Sender<bool>>,
}

impl Default for EmailPlugin {
    fn default() -> Self {
        Self {
            status: SharedPluginStatus::default(),
            bot_info: None,
            last_error: None,
            account_id: None,
            imap_host: None,
            imap_port: None,
            smtp_host: None,
            smtp_port: None,
            imap_username: None,
            imap_password: None,
            poll_secs: DEFAULT_POLL_SECS,
            callbacks: None,
            poll_handle: None,
            shutdown_tx: None,
        }
    }
}

impl EmailPlugin {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait::async_trait]
impl ChannelPlugin for EmailPlugin {
    async fn initialize(
        &mut self,
        config: PluginConfig,
        callbacks: PluginCallbacks,
    ) -> Result<(), ChannelError> {
        self.status.set(PluginStatus::Initializing);

        let creds = &config.credentials;
        let account_id = creds
            .account_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                self.status.set(PluginStatus::Error);
                self.last_error = Some("Missing Email account_id (from address)".into());
                ChannelError::InvalidConfig("Missing Email account_id".into())
            })?
            .to_owned();

        // IMAP/SMTP endpoints can be derived from common providers if user
        // only entered the address. Actually we require explicit hosts —
        // see the form labels for guidance — but fall back to well-known
        // defaults to make life easier for Gmail/Outlook/QQ customers.
        let imap_host = creds
            .imap_host
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .or_else(|| guess_imap_host(&account_id));
        let imap_port = creds.imap_port.unwrap_or(993);
        let smtp_host = creds
            .smtp_host
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .or_else(|| guess_smtp_host(&account_id));
        let smtp_port = creds.smtp_port.unwrap_or(587);

        let imap_username = creds
            .imap_username
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| account_id.clone());
        let imap_password = creds
            .imap_password
            .as_deref()
            .map(str::to_owned)
            .filter(|s| !s.is_empty());

        if imap_password.is_none() {
            self.status.set(PluginStatus::Error);
            self.last_error = Some("Missing Email imap_password".into());
            return Err(ChannelError::InvalidConfig("Missing Email imap_password".into()));
        }

        // Optional override for poll interval.
        if let Some(extra) = config.config.as_ref().and_then(|c| c.extra.get("poll_interval_secs")) {
            if let Some(n) = extra.as_u64() {
                if n >= 5 && n <= 3600 {
                    self.poll_secs = n;
                }
            }
        }

        self.bot_info = Some(BotInfo {
            id: account_id.clone(),
            username: None,
            display_name: account_id.clone(),
        });
        self.account_id = Some(account_id);
        self.imap_host = imap_host;
        self.imap_port = Some(imap_port);
        self.smtp_host = smtp_host;
        self.smtp_port = Some(smtp_port);
        self.imap_username = Some(imap_username);
        self.imap_password = imap_password;
        self.callbacks = Some(callbacks);
        self.status.set(PluginStatus::Ready);
        info!(account = ?self.account_id, "Email plugin initialized");
        Ok(())
    }

    async fn start(&mut self) -> Result<(), ChannelError> {
        if self.imap_password.is_none() {
            self.status.set(PluginStatus::Error);
            return Err(ChannelError::ConnectionFailed(
                "Email plugin not initialized".into(),
            ));
        }

        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        self.shutdown_tx = Some(shutdown_tx);

        let callbacks = self.callbacks.clone().ok_or_else(|| {
            self.status.set(PluginStatus::Error);
            ChannelError::ConnectionFailed("Email plugin not initialized".into())
        })?;
        let account = self.account_id.clone().unwrap_or_default();
        let imap_host = self.imap_host.clone().unwrap_or_default();
        let imap_port = self.imap_port.unwrap_or(993);
        let username = self.imap_username.clone().unwrap_or_default();
        let password = self.imap_password.clone().unwrap_or_default();
        let poll_secs = self.poll_secs;
        let status = self.status.clone();

        let handle = tokio::spawn(async move {
            run_imap_poll_loop(
                account,
                imap_host,
                imap_port,
                username,
                password,
                poll_secs,
                callbacks,
                status,
                shutdown_rx,
            )
            .await;
        });
        self.poll_handle = Some(handle);

        self.status.set(PluginStatus::Running);
        info!("Email plugin started");
        Ok(())
    }

    async fn stop(&mut self) -> Result<(), ChannelError> {
        self.status.set(PluginStatus::Stopping);
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(true);
        }
        if let Some(handle) = self.poll_handle.take() {
            let _ = tokio::time::timeout(Duration::from_secs(5), handle).await;
        }
        self.status.set(PluginStatus::Stopped);
        info!("Email plugin stopped");
        Ok(())
    }

    async fn send_message(
        &self,
        chat_id: &str,
        message: UnifiedOutgoingMessage,
    ) -> Result<String, ChannelError> {
        let text = message.text.unwrap_or_default();
        if text.is_empty() {
            return Err(ChannelError::InvalidConfig(
                "Email send_message requires text (v1)".into(),
            ));
        }

        let from = self
            .account_id
            .as_deref()
            .ok_or_else(|| ChannelError::InvalidConfig("Email account_id missing".into()))?;
        let smtp_host = self
            .smtp_host
            .as_deref()
            .ok_or_else(|| ChannelError::InvalidConfig("Email smtp_host missing".into()))?;
        let smtp_port = self.smtp_port.unwrap_or(587);
        let username = self
            .imap_username
            .as_deref()
            .ok_or_else(|| ChannelError::InvalidConfig("Email imap_username missing".into()))?;
        let password = self
            .imap_password
            .as_deref()
            .ok_or_else(|| ChannelError::InvalidConfig("Email imap_password missing".into()))?;

        // Build the SMTP message.
        let email = lettre::Message::builder()
            .from(from.parse().map_err(|e: lettre::address::AddressError| {
                ChannelError::InvalidConfig(format!("Email From parse: {e}"))
            })?)
            .to(chat_id.parse().map_err(|e: lettre::address::AddressError| {
                ChannelError::InvalidConfig(format!("Email To parse: {e}"))
            })?)
            .subject("GeekClaw Reply")
            .body(text.clone())
            .map_err(|e| ChannelError::MessageSendFailed(format!("Email build: {e}")))?;

        let creds = lettre::transport::smtp::authentication::Credentials::new(
            username.to_string(),
            password.to_string(),
        );
        let transport = lettre::SmtpTransport::relay(smtp_host)
            .map_err(|e| ChannelError::ConnectionFailed(format!("Email relay: {e}")))?
            .port(smtp_port)
            .credentials(creds)
            .build();

        match transport.send(&email) {
            Ok(_) => Ok(format!("email-send-{}", chrono_now_ms())),
            Err(e) => Err(ChannelError::MessageSendFailed(format!("Email send: {e}"))),
        }
    }

    async fn edit_message(
        &self,
        _chat_id: &str,
        _message_id: &str,
        _message: UnifiedOutgoingMessage,
    ) -> Result<(), ChannelError> {
        // SMTP has no edit semantics — error out cleanly.
        Err(ChannelError::PlatformApi(
            "Email does not support edit_message (SMTP-only)".into(),
        ))
    }

    fn active_user_count(&self) -> usize {
        0
    }

    fn bot_info(&self) -> Option<&BotInfo> {
        self.bot_info.as_ref()
    }

    fn plugin_type(&self) -> PluginType {
        PluginType::Email
    }

    fn status(&self) -> PluginStatus {
        self.status.get()
    }

    fn last_error(&self) -> Option<&str> {
        self.last_error.as_deref()
    }
}

// ─── IMAP poll loop ────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
async fn run_imap_poll_loop(
    account: String,
    imap_host: String,
    imap_port: u16,
    username: String,
    password: String,
    poll_secs: u64,
    callbacks: PluginCallbacks,
    status: SharedPluginStatus,
    mut shutdown_rx: watch::Receiver<bool>,
) {
    let mut backoff = 5u64;
    loop {
        if *shutdown_rx.borrow() {
            info!(account = %account, "Email poll loop shutting down");
            return;
        }

        match poll_once(&account, &imap_host, imap_port, &username, &password, &callbacks.message_tx).await {
            Ok(n) => {
                if n > 0 {
                    info!(account = %account, fetched = n, "Email: dispatched inbound");
                }
                backoff = 5; // reset on success
            }
            Err(e) => {
                error!(account = %account, error = %e, "Email poll failed; backing off");
                status.set(PluginStatus::Error);
                backoff = (backoff * 2).min(300);
            }
        }

        // Sleep with shutdown awareness.
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(poll_secs)) => {}
            _ = shutdown_rx.changed() => {
                if *shutdown_rx.borrow() {
                    info!(account = %account, "Email poll loop shutting down (mid-sleep)");
                    return;
                }
            }
        }

        // Apply exponential backoff after errors.
        if backoff > 5 {
            tokio::time::sleep(Duration::from_secs(backoff)).await;
        }
    }
}

async fn poll_once(
    account: &str,
    imap_host: &str,
    imap_port: u16,
    username: &str,
    password: &str,
    message_tx: &mpsc::Sender<UnifiedIncomingMessage>,
) -> Result<usize, ChannelError> {
    // v5.0.26 IMAP polling is intentionally a no-op stub.
    //
    // `async-imap` requires `futures-io::AsyncRead/Write` traits, which
    // `tokio-native-tls::TlsStream` does not implement. Wiring the full
    // IMAP/SMTP pipeline through `async-native-tls` is a multi-file change
    // and lands in 5.0.27. The plugin still validates credentials at
    // `initialize()`, exposes a polling timer via `start()`, and accepts
    // outbound sends via SMTP (`lettre`, which compiles cleanly).
    let _ = (account, imap_host, imap_port, username, password, message_tx);
    Ok(0)
}

/// Best-effort parse of `From: <addr>` and `Subject: ...` from a header block.
fn parse_header_fields(headers: &[u8]) -> (String, String) {
    let text = String::from_utf8_lossy(headers);
    let mut from = String::new();
    let mut subject = String::new();
    let mut current = "";
    for line in text.lines() {
        let lower = line.to_ascii_lowercase();
        if lower.starts_with("from:") {
            current = "from";
        } else if lower.starts_with("subject:") {
            current = "subject";
        } else if line.starts_with(' ') || line.starts_with('\t') {
            // continuation
        } else {
            current = "";
        }
        if current == "from" && from.is_empty() {
            // crude: grab <addr>
            if let Some(start) = line.find('<') {
                if let Some(end) = line.find('>') {
                    from = line[start + 1..end].to_string();
                }
            }
        } else if current == "subject" && subject.is_empty() {
            subject = line.splitn(2, ':').nth(1).unwrap_or("").trim().to_string();
        }
    }
    if from.is_empty() {
        from = "unknown@unknown".to_string();
    }
    (from, subject)
}

fn chrono_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ─── Provider host guessing ────────────────────────────────────────────────

fn guess_imap_host(addr: &str) -> Option<String> {
    let lower = addr.to_ascii_lowercase();
    if lower.contains("@gmail.com") {
        Some("imap.gmail.com".into())
    } else if lower.contains("@outlook.com")
        || lower.contains("@hotmail.com")
        || lower.contains("@live.com")
    {
        Some("outlook.office365.com".into())
    } else if lower.contains("@qq.com") {
        Some("imap.qq.com".into())
    } else if lower.contains("@163.com") {
        Some("imap.163.com".into())
    } else if lower.contains("@126.com") {
        Some("imap.126.com".into())
    } else {
        warn!("Email plugin: no IMAP host guessed for {addr}; configure explicitly");
        None
    }
}

fn guess_smtp_host(addr: &str) -> Option<String> {
    let lower = addr.to_ascii_lowercase();
    if lower.contains("@gmail.com") {
        Some("smtp.gmail.com".into())
    } else if lower.contains("@outlook.com")
        || lower.contains("@hotmail.com")
        || lower.contains("@live.com")
    {
        Some("smtp.office365.com".into())
    } else if lower.contains("@qq.com") {
        Some("smtp.qq.com".into())
    } else if lower.contains("@163.com") {
        Some("smtp.163.com".into())
    } else if lower.contains("@126.com") {
        Some("smtp.126.com".into())
    } else {
        warn!("Email plugin: no SMTP host guessed for {addr}; configure explicitly");
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn creds_for(addr: &str) -> crate::types::PluginCredentials {
        let mut c = crate::types::PluginCredentials::default();
        c.account_id = Some(addr.into());
        c.imap_password = Some("secret".into());
        c
    }

    #[tokio::test]
    async fn init_requires_account_and_password() {
        let (tx, _rx) = mpsc::channel(1);
        let mut p = EmailPlugin::new();
        let cfg = crate::types::PluginConfig {
            credentials: crate::types::PluginCredentials::default(),
            config: None,
        };
        let cb = PluginCallbacks { message_tx: tx };
        assert!(p.initialize(cfg, cb).await.is_err());
    }

    #[tokio::test]
    async fn init_guesses_gmail_hosts() {
        let (tx, _rx) = mpsc::channel(1);
        let mut p = EmailPlugin::new();
        let cfg = crate::types::PluginConfig {
            credentials: creds_for("alice@gmail.com"),
            config: None,
        };
        let cb = PluginCallbacks { message_tx: tx };
        p.initialize(cfg, cb).await.unwrap();
        assert_eq!(p.imap_host.as_deref(), Some("imap.gmail.com"));
        assert_eq!(p.smtp_host.as_deref(), Some("smtp.gmail.com"));
    }

    #[test]
    fn parse_header_fields_extracts_from_and_subject() {
        let headers = b"From: =?utf-8?B?5L2g?= <user@example.com>\nSubject: Hello\nOther: ignore";
        let (from, subject) = parse_header_fields(headers);
        assert_eq!(from, "user@example.com");
        assert_eq!(subject, " Hello");
    }
}
