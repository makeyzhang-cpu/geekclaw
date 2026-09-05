//! WeCom (企业微信智能机器人) long-connection plugin.
//!
//! Connects out to [`WECOM_WS_URL`], authenticates with an `aibot_subscribe`
//! frame carrying `bot_id` + `secret`, then relays `aibot_msg_callback` frames
//! as [`UnifiedIncomingMessage`]s.
//!
//! Replies go back over the *same* socket via `aibot_send_msg` (active push):
//! its `chatid` is the sender `userid` (single) or group `chatid` (group) —
//! exactly the `chat_id` the manager hands to [`ChannelPlugin::send_message`] —
//! so no request correlation is needed, and (unlike an `aibot_respond_msg`
//! stream) it is not bound to the 5-second passive-reply window. The facade
//! therefore only needs an mpsc sender into the background loop.
//!
//! Mirrors the Lark long-connection plugin's reconnect/heartbeat/TLS skeleton;
//! the wire format is plain-text JSON (not Lark's protobuf frames).
//!
//! v1 scope: text in, markdown reply out (single + group), subscribe, 30s ping,
//! backoff reconnect, msgid dedup.
//! v2 scope (this patch): image message in (HTTP GET + AES-256-CBC decrypt into
//! the channel media store) and image reply out (cgi-bin/media/upload + active
//! push `aibot_send_msg` image frame). Group @-mention stripping and other media
//! types (voice/file) remain deferred.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use dashmap::DashMap;
use reqwest::Client as HttpClient;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;
use tracing::{debug, error, info, warn};

use crate::constants::{RECONNECT_MAX_ATTEMPTS, RECONNECT_MAX_DELAY};
use crate::error::ChannelError;
use crate::media_store::ChannelMediaStore;
use crate::plugin::{ChannelPlugin, PluginCallbacks, SharedPluginStatus, mark_error_on_unexpected_exit};
use crate::plugins::util::backoff_delay;
use crate::types::{
    BotInfo, MediaKind, OutgoingMedia, PluginConfig, PluginStatus, PluginType, UnifiedIncomingMessage,
    UnifiedOutgoingMessage,
};

use super::image_crypto::decrypt_media_bytes;
use super::types::{
    CMD_EVENT_CALLBACK, CMD_MSG_CALLBACK, CMD_SUBSCRIBE, EVENT_DISCONNECTED, WECOM_PING_INTERVAL_SECS, WECOM_WS_URL,
    build_ping_frame, build_send_image_frame, build_send_msg_frame, build_subscribe_frame,
    decode_event_type, decode_msg_callback, image_unified_from_download, parse_envelope,
};
use super::uploader::WecomUploader;

/// How long a seen `msgid` is remembered for dedup.
const DEDUP_TTL: Duration = Duration::from_secs(600);

/// Bounded buffer for replies queued toward the socket loop.
const OUTGOING_BUFFER: usize = 64;

/// WeCom intelligent-bot long-connection plugin.
pub struct WecomPlugin {
    /// Shared with the socket loop so a dead loop can flip it to `Error`.
    status: SharedPluginStatus,
    bot_info: Option<BotInfo>,
    last_error: Option<String>,
    bot_id: Option<String>,
    secret: Option<String>,
    callbacks: Option<PluginCallbacks>,
    /// Reply channel into the socket loop (set in `start`).
    outgoing_tx: Option<mpsc::Sender<String>>,
    /// msgid → first-seen instant; shared dedup cache.
    dedup: Arc<DashMap<String, Instant>>,
    /// Monotonic counter for generated reply `req_id`s.
    req_seq: AtomicU64,
    ws_handle: Option<JoinHandle<()>>,
    shutdown_tx: Option<watch::Sender<bool>>,
    /// v2: HTTP client used by both the inbound image-fetch path and the
    /// `WecomUploader`'s token refresh / media upload.
    http: Option<HttpClient>,
    /// v2: token cache + multipart upload facade. Held in the plugin so the
    /// `send_media` calls (which the relay invokes through `&self`) share a
    /// single token cache with the upload HTTP call.
    uploader: Option<WecomUploader>,
    /// v2: decrypted-image disk store. Holds the same root the channel
    /// router serves `/api/channel/media/*` from so the storage URL the inbox
    /// receives resolves locally.
    media_store: Option<ChannelMediaStore>,
}

impl Default for WecomPlugin {
    fn default() -> Self {
        Self {
            status: SharedPluginStatus::default(),
            bot_info: None,
            last_error: None,
            bot_id: None,
            secret: None,
            callbacks: None,
            outgoing_tx: None,
            dedup: Arc::new(DashMap::new()),
            req_seq: AtomicU64::new(0),
            ws_handle: None,
            shutdown_tx: None,
            http: None,
            uploader: None,
            media_store: None,
        }
    }
}

impl WecomPlugin {
    pub fn new() -> Self {
        Self::default()
    }

    /// Locate the on-disk directory the channel media store + the route
    /// `/api/channel/media/{key}.{ext}` share.
    ///
    /// Resolution order:
    /// 1. `$GEEKCLAW_CHANNEL_MEDIA_DIR` — tests / explicit override.
    /// 2. `$HOME/GeekClaw/channel-media` (macOS/Linux) /
    ///    `%LOCALAPPDATA%\GeekClaw\channel-media` (Windows).
    /// 3. `/tmp/GeekClaw/channel-media` — last-resort fallback.
    fn resolve_media_store_path() -> PathBuf {
        if let Ok(p) = std::env::var("GEEKCLAW_CHANNEL_MEDIA_DIR") {
            return PathBuf::from(p);
        }
        if let Some(home) = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("LOCALAPPDATA"))
            .map(PathBuf::from)
        {
            return home.join("GeekClaw").join("channel-media");
        }
        PathBuf::from("/tmp/GeekClaw/channel-media")
    }

    /// Build the channel media store on disk. The plugin keeps a clone of
    /// the same root as the HTTP router, so storage URLs handed back to
    /// the inbox resolve. Returns `Ok(())` even on failure — the caller
    /// downgrades to text-only mode and logs the reason.
    fn build_v2_stack(&mut self) -> Result<(), String> {
        let path = Self::resolve_media_store_path();
        let store = ChannelMediaStore::new(&path)
            .map_err(|e| format!("channel media store at {}: {e}", path.display()))?;
        self.media_store = Some(store);
        Ok(())
    }
}

#[async_trait::async_trait]
impl ChannelPlugin for WecomPlugin {
    async fn initialize(&mut self, config: PluginConfig, callbacks: PluginCallbacks) -> Result<(), ChannelError> {
        self.status.set(PluginStatus::Initializing);

        let bot_id = config
            .credentials
            .bot_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                self.status.set(PluginStatus::Error);
                self.last_error = Some("Missing WeCom bot_id".into());
                ChannelError::InvalidConfig("Missing WeCom bot_id".into())
            })?
            .to_owned();

        let secret = config
            .credentials
            .secret
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                self.status.set(PluginStatus::Error);
                self.last_error = Some("Missing WeCom secret".into());
                ChannelError::InvalidConfig("Missing WeCom secret".into())
            })?
            .to_owned();

        // No pre-flight validation call exists in long-connection mode — the
        // credentials are only verified by the subscribe handshake once the
        // socket is up, so initialize just records them.
        self.bot_info = Some(BotInfo {
            id: bot_id.clone(),
            username: None,
            display_name: "WeCom Bot".into(),
        });
        self.bot_id = Some(bot_id.clone());
        self.secret = Some(secret.clone());
        self.callbacks = Some(callbacks);

        // v2: build the http stack and the on-disk media store. Failures here
        // are recoverable (text still works without them) — we log and
        // continue, but mark on the plugin so the operator sees the gap.
        match self.build_v2_stack() {
            Ok(()) => {
                self.http = Some(
                    HttpClient::builder()
                        .timeout(Duration::from_secs(20))
                        .build()
                        .expect("reqwest client builder is infallible for this config"),
                );
                self.uploader = Some(WecomUploader::new(bot_id.clone(), secret.clone()));
            }
            Err(e) => {
                warn!(error = %e, "WeCom image v2 stack init failed; text-only mode");
            }
        }

        self.status.set(PluginStatus::Ready);
        info!("WeCom bot initialized");
        Ok(())
    }

    async fn start(&mut self) -> Result<(), ChannelError> {
        self.status.set(PluginStatus::Starting);

        let callbacks = self.callbacks.take().ok_or_else(|| {
            self.status.set(PluginStatus::Error);
            ChannelError::ConnectionFailed("Plugin not initialized".into())
        })?;
        let bot_id = self
            .bot_id
            .clone()
            .ok_or_else(|| ChannelError::ConnectionFailed("Plugin not initialized".into()))?;
        let secret = self
            .secret
            .clone()
            .ok_or_else(|| ChannelError::ConnectionFailed("Plugin not initialized".into()))?;

        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        self.shutdown_tx = Some(shutdown_tx);

        let (outgoing_tx, outgoing_rx) = mpsc::channel::<String>(OUTGOING_BUFFER);
        self.outgoing_tx = Some(outgoing_tx);

        // v2 media stack is best-effort: each piece is independently Option'd
        // and the image paths fall back to a warning log when absent.
        let http = self.http.clone();
        let media_store = self.media_store.clone();

        self.ws_handle = Some(tokio::spawn(ws_loop(
            bot_id,
            secret,
            callbacks.message_tx,
            self.dedup.clone(),
            self.status.clone(),
            outgoing_rx,
            shutdown_rx,
            http,
            media_store,
        )));

        self.status.set(PluginStatus::Running);
        info!("WeCom plugin started");
        Ok(())
    }

    async fn stop(&mut self) -> Result<(), ChannelError> {
        self.status.set(PluginStatus::Stopping);

        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(true);
        }
        if let Some(handle) = self.ws_handle.take() {
            let _ = tokio::time::timeout(Duration::from_secs(5), handle).await;
        }
        self.outgoing_tx = None;
        self.status.set(PluginStatus::Stopped);
        info!("WeCom plugin stopped");
        Ok(())
    }

    async fn send_message(&self, chat_id: &str, message: UnifiedOutgoingMessage) -> Result<String, ChannelError> {
        let outgoing = self
            .outgoing_tx
            .as_ref()
            .ok_or_else(|| ChannelError::PlatformApi("WeCom socket not running".into()))?;

        let text = message.text.unwrap_or_default();
        let seq = self.req_seq.fetch_add(1, Ordering::Relaxed);
        let req_id = format!("send-{seq}");
        let frame = build_send_msg_frame(chat_id, &text, &req_id);

        info!(chat_id, text_len = text.len(), req_id = %req_id, "WeCom queueing reply (aibot_send_msg)");

        outgoing
            .send(frame)
            .await
            .map_err(|_| ChannelError::MessageSendFailed("WeCom socket loop is gone".into()))?;

        // The push ack arrives asynchronously over the socket; use the generated
        // request id as the logical message id (WeCom returns no id inline).
        Ok(req_id)
    }

    async fn edit_message(
        &self,
        chat_id: &str,
        _message_id: &str,
        message: UnifiedOutgoingMessage,
    ) -> Result<(), ChannelError> {
        // WeCom has no edit API in this mode — degrade to sending a new reply.
        self.send_message(chat_id, message).await.map(|_| ())
    }

    async fn send_media(
        &self,
        chat_id: &str,
        media: OutgoingMedia,
        caption: Option<&str>,
    ) -> Result<String, ChannelError> {
        let outgoing = self.outgoing_tx.as_ref().ok_or_else(|| {
            ChannelError::PlatformApi("WeCom socket not running".into())
        })?;
        let uploader = self.uploader.as_ref().ok_or_else(|| {
            ChannelError::PlatformApi("WeCom uploader not initialized (v2 stack failed)".into())
        })?;

        // 1) Upload the bytes to /cgi-bin/media/upload and obtain a `media_id`.
        let kind = match media.kind {
            MediaKind::Image => "image",
            MediaKind::File => "file",
        };
        let media_id = uploader
            .upload(kind, &media.filename, &media.mime, &media.bytes)
            .await
            .map_err(|e| ChannelError::PlatformApi(format!("WeCom media upload: {e}")))?;

        // 2) Push `aibot_send_msg` with `msgtype = "image"`. If a caption is
        //    given, we fall back to a separate markdown message right after —
        //    WeCom's image msgtype has no caption field, so two frames in a
        //    row keep both visible to the user.
        let seq = self.req_seq.fetch_add(1, Ordering::Relaxed);
        let req_id = format!("send-image-{seq}");
        let frame = build_send_image_frame(chat_id, &media_id, &req_id);
        outgoing
            .send(frame)
            .await
            .map_err(|_| ChannelError::MessageSendFailed("WeCom socket loop is gone".into()))?;

        if let Some(text) = caption.filter(|t| !t.is_empty()) {
            let caption_seq = self.req_seq.fetch_add(1, Ordering::Relaxed);
            let caption_req_id = format!("send-caption-{caption_seq}");
            let caption_frame = build_send_msg_frame(chat_id, text, &caption_req_id);
            outgoing
                .send(caption_frame)
                .await
                .map_err(|_| ChannelError::MessageSendFailed("WeCom socket loop is gone".into()))?;
        }

        Ok(media_id)
    }

    fn active_user_count(&self) -> usize {
        0
    }

    fn bot_info(&self) -> Option<&BotInfo> {
        self.bot_info.as_ref()
    }

    fn plugin_type(&self) -> PluginType {
        PluginType::Wecom
    }

    fn status(&self) -> PluginStatus {
        self.status.get()
    }

    fn last_error(&self) -> Option<&str> {
        self.last_error.as_deref()
    }
}

// ---------------------------------------------------------------------------
// WebSocket connection loop
// ---------------------------------------------------------------------------

async fn ws_loop(
    bot_id: String,
    secret: String,
    message_tx: mpsc::Sender<UnifiedIncomingMessage>,
    dedup: Arc<DashMap<String, Instant>>,
    status: SharedPluginStatus,
    mut outgoing_rx: mpsc::Receiver<String>,
    mut shutdown_rx: watch::Receiver<bool>,
    http: Option<HttpClient>,
    media_store: Option<ChannelMediaStore>,
) {
    let mut consecutive_errors: u32 = 0;
    let mut req_counter: u64 = 0;

    loop {
        if *shutdown_rx.borrow() {
            debug!("WeCom WS loop received shutdown signal");
            break;
        }

        match connect_and_listen(
            &bot_id,
            &secret,
            &message_tx,
            &dedup,
            &mut req_counter,
            &mut outgoing_rx,
            &mut shutdown_rx,
            http.as_ref(),
            media_store.as_ref(),
        )
        .await
        {
            Ok(()) => {
                debug!("WeCom WS connection closed");
                break;
            }
            Err(e) => {
                consecutive_errors += 1;
                warn!(error = %e, consecutive_errors, "WeCom WS connection error");
                if consecutive_errors >= RECONNECT_MAX_ATTEMPTS {
                    error!("WeCom max reconnect attempts reached");
                    break;
                }
                let delay = backoff_delay(consecutive_errors, RECONNECT_MAX_DELAY);
                tokio::select! {
                    _ = tokio::time::sleep(delay) => {}
                    _ = shutdown_rx.changed() => break,
                }
            }
        }
    }

    mark_error_on_unexpected_exit(&status, &shutdown_rx, "wecom");
    debug!("WeCom WS loop exited");
}

/// Connect, subscribe, and pump frames until the socket closes or shutdown.
#[allow(clippy::too_many_arguments)]
async fn connect_and_listen(
    bot_id: &str,
    secret: &str,
    message_tx: &mpsc::Sender<UnifiedIncomingMessage>,
    dedup: &Arc<DashMap<String, Instant>>,
    req_counter: &mut u64,
    outgoing_rx: &mut mpsc::Receiver<String>,
    shutdown_rx: &mut watch::Receiver<bool>,
    http: Option<&HttpClient>,
    media_store: Option<&ChannelMediaStore>,
) -> Result<(), ChannelError> {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::connect_async_tls_with_config;
    use tokio_tungstenite::tungstenite::Message as WsMessage;

    let connector = build_ws_tls_connector()?;
    let (ws_stream, _) = connect_async_tls_with_config(WECOM_WS_URL, None, false, Some(connector))
        .await
        .map_err(|e| ChannelError::ConnectionFailed(format!("WeCom WS connect failed: {e}")))?;
    info!("WeCom WebSocket connected");

    let (mut write, mut read) = ws_stream.split();

    // Authenticate immediately.
    *req_counter += 1;
    let subscribe = build_subscribe_frame(bot_id, secret, &format!("sub-{req_counter}"));
    write
        .send(WsMessage::Text(subscribe.into()))
        .await
        .map_err(|e| ChannelError::ConnectionFailed(format!("WeCom subscribe send failed: {e}")))?;

    let ping_duration = Duration::from_secs(WECOM_PING_INTERVAL_SECS);
    let mut ping_deadline = tokio::time::Instant::now() + ping_duration;

    loop {
        tokio::select! {
            msg = read.next() => {
                match msg {
                    Some(Ok(WsMessage::Text(text))) => {
                        match handle_inbound_text(
                            &text,
                            message_tx,
                            dedup,
                            http,
                            media_store,
                        )
                        .await
                        {
                            InboundOutcome::Continue => {}
                            InboundOutcome::Displaced => {
                                warn!("WeCom connection displaced by another subscriber; not reconnecting");
                                return Ok(());
                            }
                            // Bad bot_id/secret — break without reconnect so the
                            // watchdog surfaces Error instead of looping forever.
                            InboundOutcome::SubscribeFailed => return Ok(()),
                        }
                    }
                    Some(Ok(WsMessage::Binary(bytes))) => {
                        // WeCom frames are JSON text; tolerate a binary wrapper.
                        if let Ok(text) = String::from_utf8(bytes.to_vec()) {
                            match handle_inbound_text(
                                &text,
                                message_tx,
                                dedup,
                                http,
                                media_store,
                            )
                            .await
                            {
                                InboundOutcome::Continue => {}
                                InboundOutcome::Displaced => return Ok(()),
                                InboundOutcome::SubscribeFailed => return Ok(()),
                            }
                        }
                    }
                    Some(Ok(WsMessage::Ping(payload))) => {
                        let _ = write.send(WsMessage::Pong(payload)).await;
                    }
                    Some(Ok(WsMessage::Close(_))) => {
                        debug!("WeCom WS received close frame");
                        return Ok(());
                    }
                    Some(Ok(_)) => {}
                    Some(Err(e)) => {
                        return Err(ChannelError::ConnectionFailed(format!("WeCom WS read error: {e}")));
                    }
                    None => {
                        return Err(ChannelError::ConnectionFailed("WeCom WS stream ended".into()));
                    }
                }
            }
            outgoing = outgoing_rx.recv() => {
                match outgoing {
                    Some(frame) => {
                        debug!(frame = %frame, "WeCom writing reply frame");
                        if let Err(e) = write.send(WsMessage::Text(frame.into())).await {
                            return Err(ChannelError::ConnectionFailed(format!("WeCom reply send failed: {e}")));
                        }
                        info!("WeCom reply frame written to socket");
                    }
                    None => {
                        // Sender dropped (plugin stopping).
                        return Ok(());
                    }
                }
            }
            _ = tokio::time::sleep_until(ping_deadline) => {
                *req_counter += 1;
                let ping = build_ping_frame(&format!("ping-{req_counter}"));
                if let Err(e) = write.send(WsMessage::Text(ping.into())).await {
                    return Err(ChannelError::ConnectionFailed(format!("WeCom ping failed: {e}")));
                }
                ping_deadline = tokio::time::Instant::now() + ping_duration;
                cleanup_dedup(dedup);
            }
            _ = shutdown_rx.changed() => {
                debug!("WeCom WS shutdown during listen");
                return Ok(());
            }
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
enum InboundOutcome {
    /// Normal — keep the connection.
    Continue,
    /// Server told us another connection took over; stop reconnecting.
    Displaced,
    /// The `aibot_subscribe` handshake was rejected (bad `bot_id`/`secret`).
    SubscribeFailed,
}

/// Decode one inbound JSON frame and dispatch it. Pure enough to unit-test:
/// only touches the passed channel/cache and `http`/`media_store` (used by
/// the image branch).
async fn handle_inbound_text(
    text: &str,
    message_tx: &mpsc::Sender<UnifiedIncomingMessage>,
    dedup: &Arc<DashMap<String, Instant>>,
    http: Option<&HttpClient>,
    media_store: Option<&ChannelMediaStore>,
) -> InboundOutcome {
    let Some(env) = parse_envelope(text) else {
        warn!("WeCom frame is not valid JSON");
        return InboundOutcome::Continue;
    };

    match env.cmd.as_str() {
        CMD_MSG_CALLBACK => {
            let Some(decoded) = decode_msg_callback(&env, now_secs()) else {
                return InboundOutcome::Continue;
            };
            match decoded {
                Ok(text_msg) => {
                    // The decoder only returns replay-stable, non-empty ids.
                    if is_duplicate(dedup, &text_msg.event_id) {
                        debug!(event_id = %text_msg.event_id, "WeCom duplicate message, skipping");
                        return InboundOutcome::Continue;
                    }
                    info!(chat_id = %text_msg.unified.chat_id, "WeCom inbound message received");
                    let _ = message_tx.send(text_msg.unified).await;
                }
                Err(needs) => {
                    if is_duplicate(dedup, &needs.event_id) {
                        debug!(event_id = %needs.event_id, "WeCom duplicate image, skipping fetch");
                        return InboundOutcome::Continue;
                    }
                    let Some((http, store)) = http.zip(media_store) else {
                        warn!(
                            event_id = %needs.event_id,
                            "WeCom image received but v2 stack not initialised; dropping"
                        );
                        return InboundOutcome::Continue;
                    };
                    info!(
                        event_id = %needs.event_id,
                        chat_id = %needs.chat_id,
                        url_fingerprint = %ChannelMediaStore::fingerprint(&[&needs.url]),
                        "WeCom inbound image; spawning fetch+decrypt task"
                    );
                    let tx = message_tx.clone();
                    let store = store.clone();
                    let http = http.clone();
                    let event_id = needs.event_id.clone();
                    tokio::spawn(async move {
                        match fetch_decrypt_store(&http, &store, needs).await {
                            Ok(unified) => {
                                if let Err(e) = tx.send(unified).await {
                                    warn!(event_id = %event_id, error = %e, "WeCom image: message channel closed before dispatch");
                                }
                            }
                            Err(e) => {
                                warn!(event_id = %event_id, error = %e, "WeCom image fetch+decrypt failed");
                            }
                        }
                    });
                }
            }
            InboundOutcome::Continue
        }
        CMD_EVENT_CALLBACK => {
            match decode_event_type(&env).as_deref() {
                Some(EVENT_DISCONNECTED) => InboundOutcome::Displaced,
                Some(other) => {
                    debug!(eventtype = other, "WeCom event (unhandled in v1)");
                    InboundOutcome::Continue
                }
                None => InboundOutcome::Continue,
            }
        }
        CMD_SUBSCRIBE => {
            // Subscribe ack: errcode 0 = success.
            let errcode = env.body.get("errcode").and_then(|v| v.as_i64()).unwrap_or(0);
            if errcode == 0 {
                info!("WeCom subscribe succeeded");
                InboundOutcome::Continue
            } else {
                let errmsg = env.body.get("errmsg").and_then(|v| v.as_str()).unwrap_or("");
                warn!(errcode, errmsg, "WeCom subscribe failed");
                InboundOutcome::SubscribeFailed
            }
        }
        other => {
            debug!(cmd = other, "WeCom unhandled frame");
            InboundOutcome::Continue
        }
    }
}

/// v2 image path: HTTP GET the encrypted URL, AES-decrypt with the per-message
/// `aeskey`, guess MIME from magic bytes, persist to the channel media store,
/// and return a unified message with the storage URL attached.
async fn fetch_decrypt_store(
    http: &HttpClient,
    store: &ChannelMediaStore,
    needs: super::types::NeedsMediaDownload,
) -> Result<UnifiedIncomingMessage, String> {
    let bytes = http
        .get(&needs.url)
        .send()
        .await
        .map_err(|e| format!("download: {e}"))?
        .error_for_status()
        .map_err(|e| format!("download status: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("download body: {e}"))?;

    let plain = decrypt_media_bytes(&needs.aeskey, &bytes)
        .map_err(|e| format!("decrypt: {e}"))?;

    let (mime, ext) = sniff_image_mime(&plain);
    let (key, ext) = store
        .store(&plain, &ext)
        .map_err(|e| format!("store: {e}"))?;
    let url = ChannelMediaStore::url_for(&key, &ext);
    debug!(
        event_id = %needs.event_id,
        stored_bytes = plain.len(),
        mime,
        storage_url = %url,
        "WeCom image decrypted and stored"
    );
    Ok(image_unified_from_download(
        needs.event_id,
        needs.chat_id,
        needs.user,
        needs.timestamp,
        mime.to_owned(),
        ext,
        plain.len(),
        url,
    ))
}

/// Tiny magic-byte sniffer for the limited set WeCom's image messages
/// legitimately carry (PNG/JPEG/GIF/WebP). Anything else falls back to
/// `application/octet-stream` + `bin` so a corrupt sniff never blocks
/// storing the file.
fn sniff_image_mime(bytes: &[u8]) -> (&'static str, &'static str) {
    if bytes.len() >= 8 && &bytes[..8] == b"\x89PNG\r\n\x1a\n" {
        ("image/png", "png")
    } else if bytes.len() >= 3 && bytes[..3] == *b"\xff\xd8\xff" {
        ("image/jpeg", "jpg")
    } else if bytes.len() >= 6 && (&bytes[..6] == b"GIF87a" || &bytes[..6] == b"GIF89a") {
        ("image/gif", "gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        ("image/webp", "webp")
    } else {
        ("application/octet-stream", "bin")
    }
}

// ---------------------------------------------------------------------------
// Dedup
// ---------------------------------------------------------------------------

/// Returns true if `key` was already seen; records it otherwise.
fn is_duplicate(cache: &Arc<DashMap<String, Instant>>, key: &str) -> bool {
    if cache.contains_key(key) {
        return true;
    }
    cache.insert(key.to_owned(), Instant::now());
    false
}

fn cleanup_dedup(cache: &Arc<DashMap<String, Instant>>) {
    cache.retain(|_, seen| seen.elapsed() < DEDUP_TTL);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// TLS connector pinned to HTTP/1.1 ALPN (WebSocket upgrade is incompatible
/// with h2). Copied from the Lark plugin's connector.
fn build_ws_tls_connector() -> Result<tokio_tungstenite::Connector, ChannelError> {
    use tokio_tungstenite::Connector;

    let certs = rustls_native_certs::load_native_certs();
    let mut root_store = rustls::RootCertStore::empty();
    root_store.add_parsable_certificates(certs.certs);

    let provider = rustls::crypto::CryptoProvider::get_default()
        .cloned()
        .unwrap_or_else(|| Arc::new(rustls::crypto::ring::default_provider()));

    let mut config = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| ChannelError::ConnectionFailed(format!("TLS config error: {e}")))?
        .with_root_certificates(root_store)
        .with_no_client_auth();
    config.alpn_protocols = vec![b"http/1.1".to_vec()];

    Ok(Connector::Rustls(Arc::new(config)))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn dedup_cache() -> Arc<DashMap<String, Instant>> {
        Arc::new(DashMap::new())
    }

    #[test]
    fn new_plugin_initial_state() {
        let plugin = WecomPlugin::new();
        assert_eq!(plugin.status(), PluginStatus::Created);
        assert!(plugin.bot_info().is_none());
        assert!(plugin.last_error().is_none());
        assert_eq!(plugin.plugin_type(), PluginType::Wecom);
        assert_eq!(plugin.active_user_count(), 0);
    }

    #[test]
    fn dedup_tracks_first_seen() {
        let cache = dedup_cache();
        assert!(!is_duplicate(&cache, "m1"));
        assert!(is_duplicate(&cache, "m1"));
        assert!(!is_duplicate(&cache, "m2"));
    }

    #[tokio::test]
    async fn inbound_message_dispatched() {
        let (message_tx, mut message_rx) = mpsc::channel(16);
        let dedup = dedup_cache();
        let frame = r#"{"cmd":"aibot_msg_callback","headers":{"req_id":"req-7"},
            "body":{"msgid":"m1","chattype":"single","from":{"userid":"zhang"},
                    "msgtype":"text","text":{"content":"hi bot"}}}"#;

        let outcome = handle_inbound_text(frame, &message_tx, &dedup, None, None).await;
        assert_eq!(outcome, InboundOutcome::Continue);

        let msg = message_rx.try_recv().unwrap();
        assert_eq!(msg.chat_id, "zhang");
        assert_eq!(msg.content.text, "hi bot");
        assert_eq!(msg.platform, PluginType::Wecom);
    }

    #[tokio::test]
    async fn inbound_message_deduplicated_by_msgid() {
        let (message_tx, mut message_rx) = mpsc::channel(16);
        let dedup = dedup_cache();
        let frame = r#"{"cmd":"aibot_msg_callback","headers":{"req_id":"r"},
            "body":{"msgid":"dup","chattype":"single","from":{"userid":"u"},
                    "msgtype":"text","text":{"content":"x"}}}"#;

        handle_inbound_text(frame, &message_tx, &dedup, None, None).await;
        handle_inbound_text(frame, &message_tx, &dedup, None, None).await;

        assert!(message_rx.try_recv().is_ok());
        assert!(message_rx.try_recv().is_err(), "duplicate msgid dropped");
    }

    #[tokio::test]
    async fn inbound_message_uses_req_id_when_msgid_is_missing() {
        let (message_tx, mut message_rx) = mpsc::channel(16);
        let dedup = dedup_cache();
        let frame = r#"{"cmd":"aibot_msg_callback","headers":{"req_id":"req-fallback-1"},
            "body":{"chattype":"single","from":{"userid":"u"},
                    "msgtype":"text","text":{"content":"x"}}}"#;

        handle_inbound_text(frame, &message_tx, &dedup, None, None).await;
        handle_inbound_text(frame, &message_tx, &dedup, None, None).await;

        assert_eq!(message_rx.try_recv().unwrap().id, "req-fallback-1");
        assert!(message_rx.try_recv().is_err(), "duplicate req_id dropped");
    }

    #[tokio::test]
    async fn inbound_message_without_msgid_or_req_id_is_dropped() {
        let (message_tx, mut message_rx) = mpsc::channel(16);
        let dedup = dedup_cache();
        let frame = r#"{"cmd":"aibot_msg_callback","headers":{},
            "body":{"chattype":"single","from":{"userid":"u"},
                    "msgtype":"text","text":{"content":"x"}}}"#;

        handle_inbound_text(frame, &message_tx, &dedup, None, None).await;

        assert!(message_rx.try_recv().is_err());
    }

#[tokio::test]
async fn inbound_image_drops_when_v2_stack_uninitialised() {
    // v2 stack (http / media_store) absent → image is silently dropped (logs
    // a warning). The plugin stays healthy and continues processing later
    // frames.
    let (message_tx, mut message_rx) = mpsc::channel(16);
    let dedup = dedup_cache();
    let frame = r#"{"cmd":"aibot_msg_callback","headers":{"req_id":"r"},
            "body":{"msgid":"img1","chattype":"single","from":{"userid":"u"},
                    "msgtype":"image",
                    "image":{"url":"https://ww-aibot-img.example/foo","aeskey":"ABCDEFGHIJKLMNOPQRSTUVWXYZ012345"}}}"#;

    let outcome = handle_inbound_text(frame, &message_tx, &dedup, None, None).await;
    assert_eq!(outcome, InboundOutcome::Continue);
    // No synchronous message is emitted; the spawn would silently fail.
    assert!(message_rx.try_recv().is_err());
}

#[test]
fn sniff_image_mime_recognises_known_magics() {
    let png = b"\x89PNG\r\n\x1a\n...rest...".to_vec();
    let jpeg = b"\xff\xd8\xff\xe0\x00\x10JFIF".to_vec();
    let gif87 = b"GIF87a...".to_vec();
    let gif89 = b"GIF89a...".to_vec();
    let webp = {
        let mut b = b"RIFF".to_vec();
        b.extend_from_slice(&[0, 0, 0, 0]); // size
        b.extend_from_slice(b"WEBP");
        b.extend_from_slice(b"VP8 ");
        b
    };
    let unknown = b"random bytes here".to_vec();

    assert_eq!(sniff_image_mime(&png), ("image/png", "png"));
    assert_eq!(sniff_image_mime(&jpeg), ("image/jpeg", "jpg"));
    assert_eq!(sniff_image_mime(&gif87), ("image/gif", "gif"));
    assert_eq!(sniff_image_mime(&gif89), ("image/gif", "gif"));
    assert_eq!(sniff_image_mime(&webp), ("image/webp", "webp"));
    assert_eq!(
        sniff_image_mime(&unknown),
        ("application/octet-stream", "bin")
    );
    assert_eq!(sniff_image_mime(&[]).0, "application/octet-stream");
}

    #[tokio::test]
    async fn disconnected_event_signals_displaced() {
        let (message_tx, _rx) = mpsc::channel(16);
        let dedup = dedup_cache();
        let frame = r#"{"cmd":"aibot_event_callback","headers":{"req_id":"r"},
            "body":{"msgtype":"event","event":{"eventtype":"disconnected_event"}}}"#;

        let outcome = handle_inbound_text(frame, &message_tx, &dedup, None, None).await;
        assert_eq!(outcome, InboundOutcome::Displaced);
    }

    #[tokio::test]
    async fn subscribe_ack_is_tolerated() {
        let (message_tx, mut message_rx) = mpsc::channel(16);
        let dedup = dedup_cache();
        let frame = r#"{"cmd":"aibot_subscribe","headers":{"req_id":"sub-1"},"body":{"errcode":0}}"#;

        let outcome = handle_inbound_text(frame, &message_tx, &dedup, None, None).await;
        assert_eq!(outcome, InboundOutcome::Continue);
        assert!(message_rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn subscribe_failure_signals_subscribe_failed() {
        let (message_tx, _rx) = mpsc::channel(16);
        let dedup = dedup_cache();
        let frame = r#"{"cmd":"aibot_subscribe","headers":{"req_id":"sub-1"},
            "body":{"errcode":40001,"errmsg":"invalid secret"}}"#;

        let outcome = handle_inbound_text(frame, &message_tx, &dedup, None, None).await;
        assert_eq!(outcome, InboundOutcome::SubscribeFailed);
    }

    #[tokio::test]
    async fn malformed_frame_is_ignored() {
        let (message_tx, mut message_rx) = mpsc::channel(16);
        let dedup = dedup_cache();
        let outcome = handle_inbound_text("not json", &message_tx, &dedup, None, None).await;
        assert_eq!(outcome, InboundOutcome::Continue);
        assert!(message_rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn send_message_queues_aibot_send_msg_frame() {
        // With outgoing wired, send_message must enqueue an aibot_send_msg frame
        // addressed by chat_id (no prior context/req_id needed).
        let mut plugin = WecomPlugin::new();
        let (tx, mut rx) = mpsc::channel::<String>(4);
        plugin.outgoing_tx = Some(tx);

        let msg = UnifiedOutgoingMessage {
            message_type: crate::types::OutgoingMessageType::Text,
            text: Some("你好世界".into()),
            parse_mode: None,
            buttons: None,
            keyboard: None,
            image_url: None,
            file_url: None,
            file_name: None,
            media_actions: None,
            reply_to_message_id: None,
            silent: None,
        };
        let id = plugin.send_message("zhang", msg).await.unwrap();
        assert!(id.starts_with("send-"));

        let frame = rx.try_recv().unwrap();
        let v: serde_json::Value = serde_json::from_str(&frame).unwrap();
        assert_eq!(v["cmd"], "aibot_send_msg");
        assert_eq!(v["body"]["chatid"], "zhang");
        assert_eq!(v["body"]["msgtype"], "markdown");
        assert_eq!(v["body"]["markdown"]["content"], "你好世界");
    }

    #[tokio::test]
    async fn send_message_without_socket_errors() {
        let plugin = WecomPlugin::new();
        let msg = UnifiedOutgoingMessage {
            message_type: crate::types::OutgoingMessageType::Text,
            text: Some("hi".into()),
            parse_mode: None,
            buttons: None,
            keyboard: None,
            image_url: None,
            file_url: None,
            file_name: None,
            media_actions: None,
            reply_to_message_id: None,
            silent: None,
        };
        assert!(plugin.send_message("zhang", msg).await.is_err());
    }
}
