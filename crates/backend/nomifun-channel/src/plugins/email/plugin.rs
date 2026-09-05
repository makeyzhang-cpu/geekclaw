//! Email channel plugin — IMAP inbound + SMTP outbound.
//!
//! Scope: text-only, polled every `poll_interval_secs` (default 60s).
//!
//! Implementation strategy:
//!   - `start()` spawns a background tokio task that connects to IMAP over
//!     TLS and performs a SELECT on INBOX. Each iteration (`poll_once`):
//!       1. `UID SEARCH UNSEEN` → list of unseen UIDs.
//!       2. For each UID: `UID FETCH <uid> RFC822` → raw message.
//!          Fetching RFC822 implicitly flags the message `\Seen`, which is our
//!          dedup mechanism — a dispatched mail won't resurface in UNSEEN.
//!       3. Parse sender (name + address), subject and body, convert to
//!          `UnifiedIncomingMessage` and push via `message_tx`.
//!       4. Sleep `poll_interval_secs` (configurable via `extra.poll_interval_secs`).
//!   - `send_message()` opens an SMTP connection (via `lettre`) and posts
//!     a single text/plain RFC-5322 message.
//!
//! v1 deliberately does not parse MIME attachments; multipart bodies are passed
//! through as raw text. Structured MIME parsing lands in a follow-up.

use std::time::Duration;

use tokio::sync::mpsc;
use tokio::sync::watch;
use tokio::task::JoinHandle;
use tracing::{error, info, warn};

use crate::error::ChannelError;
use crate::plugin::{ChannelPlugin, PluginCallbacks, SharedPluginStatus};
use crate::types::{
    BotInfo, MessageContentType, PluginConfig, PluginStatus, PluginType, UnifiedIncomingMessage,
    UnifiedOutgoingMessage, UnifiedMessageContent, UnifiedUser,
};

use lettre::Transport;

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
    use async_imap::Client;
    use futures_util::StreamExt;
    use tokio::net::TcpStream;
    use tokio_native_tls::TlsConnector as TokioTlsConnector;
    use tokio_util::compat::TokioAsyncReadCompatExt;

    // 1. TLS connect. `tokio-native-tls` produces a `TlsStream` that implements
    //    tokio's `AsyncRead/Write`; wrap it with `compat()` to satisfy the
    //    `futures_io` trait bounds that `async-imap::Client` requires.
    let tcp = TcpStream::connect((imap_host, imap_port))
        .await
        .map_err(|e| {
            ChannelError::ConnectionFailed(format!(
                "IMAP TCP connect {imap_host}:{imap_port}: {e}"
            ))
        })?;

    let native = native_tls::TlsConnector::new()
        .map_err(|e| ChannelError::ConnectionFailed(format!("IMAP TLS init: {e}")))?;
    let tls_connector = TokioTlsConnector::from(native);
    let tls = tls_connector.connect(imap_host, tcp).await.map_err(|e| {
        ChannelError::ConnectionFailed(format!("IMAP TLS handshake {imap_host}: {e}"))
    })?;

    let client = Client::new(tls.compat());

    // 2. Authenticate.
    let mut session = client
        .login(username, password)
        .await
        .map_err(|(e, _client)| {
            ChannelError::ConnectionFailed(format!("IMAP login {username}: {e}"))
        })?;

    // 3. Select INBOX.
    session.select("INBOX").await.map_err(|e| {
        ChannelError::ConnectionFailed(format!("IMAP SELECT INBOX: {e}"))
    })?;

    // 4. Find unseen messages.
    let uids = session
        .uid_search("UNSEEN")
        .await
        .map_err(|e| ChannelError::ConnectionFailed(format!("IMAP UID SEARCH UNSEEN: {e}")))?;

    let mut dispatched = 0usize;
    for uid in uids {
        // `RFC822` fetch implicitly marks the message \Seen, which doubles as
        // our dedup mechanism — an already-dispatched mail won't appear in the
        // next UNSEEN search.
        //
        // `uid_fetch` returns a *stream* of `Result<Fetch, _>`; drain it with
        // `StreamExt`.
        let mut fetch_stream = session
            .uid_fetch(uid.to_string(), "RFC822")
            .await
            .map_err(|e| ChannelError::ConnectionFailed(format!("IMAP UID FETCH {uid}: {e}")))?;

        while let Some(fetch_res) = fetch_stream.next().await {
            let fetch = fetch_res
                .map_err(|e| ChannelError::ConnectionFailed(format!("IMAP UID FETCH {uid}: {e}")))?;
            let Some(raw) = fetch.body() else { continue };
            let raw_text = String::from_utf8_lossy(raw).to_string();
            let (name, addr) = parse_from_header(&raw_text);
            let subject = parse_subject_header(&raw_text);
            let body = extract_body(&raw_text).trim().to_string();

            let now = chrono_now_ms();
            let msg = UnifiedIncomingMessage {
                id: format!("email-{uid}-{now}"),
                platform: PluginType::Email,
                // The conversation is keyed by the sender's address.
                chat_id: addr.clone(),
                user: UnifiedUser {
                    id: addr.clone(),
                    username: None,
                    display_name: if name.is_empty() {
                        addr.clone()
                    } else {
                        name.clone()
                    },
                    avatar_url: None,
                },
                content: UnifiedMessageContent {
                    content_type: MessageContentType::Text,
                    text: body,
                    attachments: None,
                },
                timestamp: now,
                reply_to_message_id: None,
                action: None,
                raw: Some(serde_json::json!({
                    "uid": uid,
                    "account": account,
                    "subject": subject,
                })),
            };

            // Receiver gone (plugin stopped) — bail out of the poll.
            if message_tx.send(msg).await.is_err() {
                // `fetch_stream` still borrows `session`; drop it before
                // consuming the session with `close()`.
                drop(fetch_stream);
                let _ = session.close().await;
                return Ok(dispatched);
            }
            dispatched += 1;
        }
    }

    let _ = session.close().await;
    Ok(dispatched)
}

/// Split a raw RFC822 message into its header block and body text.
fn split_mail(raw: &str) -> (String, String) {
    if let Some(pos) = raw.find("\r\n\r\n") {
        let (h, b) = raw.split_at(pos + 4);
        (h.to_string(), b.to_string())
    } else if let Some(pos) = raw.find("\n\n") {
        let (h, b) = raw.split_at(pos + 2);
        (h.to_string(), b.to_string())
    } else {
        (raw.to_string(), String::new())
    }
}

/// Extract the sender display name and address from a raw RFC822 message.
/// Returns `(display_name, address)`; falls back to `unknown@unknown` for the
/// address when none can be found.
fn parse_from_header(raw: &str) -> (String, String) {
    let (header_block, _) = split_mail(raw);
    let mut name = String::new();
    let mut addr = String::new();
    for line in header_block.lines() {
        let lower = line.to_ascii_lowercase();
        if lower.starts_with("from:") {
            let value = &line[5..];
            if let Some(start) = value.find('<') {
                if let Some(end_rel) = value[start..].find('>') {
                    addr = value[start + 1..start + end_rel].trim().to_string();
                    name = value[..start].trim().trim_matches('"').to_string();
                } else {
                    addr = value.trim().to_string();
                }
            } else {
                addr = value.trim().to_string();
            }
        } else if line.starts_with(' ') || line.starts_with('\t') {
            // Folded continuation of the From header — ignore for v1.
        } else if !addr.is_empty() {
            // A new header field follows From; we're done.
            break;
        }
    }
    if addr.is_empty() {
        addr = "unknown@unknown".to_string();
    }
    (name, addr)
}

/// Extract the Subject line from a raw RFC822 message (handles folded
/// continuations that begin with whitespace).
fn parse_subject_header(raw: &str) -> String {
    let (header_block, _) = split_mail(raw);
    let mut subject = String::new();
    for line in header_block.lines() {
        let lower = line.to_ascii_lowercase();
        if lower.starts_with("subject:") {
            subject = line[8..].trim().to_string();
        } else if line.starts_with(' ') || line.starts_with('\t') {
            if !subject.is_empty() {
                subject.push(' ');
                subject.push_str(line.trim());
            }
        } else if !subject.is_empty() {
            // New header field after Subject — stop.
            break;
        }
    }
    subject
}

/// Extract the message body text from a raw RFC822 message.
fn extract_body(raw: &str) -> String {
    let (_, body) = split_mail(raw);
    body
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
    fn parse_from_header_extracts_address() {
        let raw = "From: =?utf-8?B?5L2g?= <user@example.com>\r\nSubject: Hello\r\n\r\nBody text";
        let (name, addr) = parse_from_header(raw);
        assert_eq!(addr, "user@example.com");
        assert_eq!(name, "=?utf-8?B?5L2g?=");
    }

    #[test]
    fn parse_subject_header_extracts_subject() {
        let raw = "From: a@b.com\r\nSubject: Hello World\r\n\r\nBody";
        assert_eq!(parse_subject_header(raw), "Hello World");
    }

    #[test]
    fn extract_body_returns_text_after_blank_line() {
        let raw = "From: a@b.com\r\nSubject: x\r\n\r\nThe real body\r\nsecond line";
        assert_eq!(extract_body(raw), "The real body\r\nsecond line");
    }

    #[test]
    fn parse_from_header_falls_back_when_missing() {
        let raw = "Subject: no from here\r\n\r\nBody";
        let (name, addr) = parse_from_header(raw);
        assert_eq!(addr, "unknown@unknown");
        assert!(name.is_empty());
    }
}
