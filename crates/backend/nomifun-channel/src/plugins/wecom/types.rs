//! WeCom (企业微信智能机器人) long-connection protocol types and pure helpers.
//!
//! Transport is the "长连接 (WebSocket)" mode documented at
//! <https://developer.work.weixin.qq.com/document/path/101463>:
//! plain-text JSON frames of the shape
//! `{ "cmd": "...", "headers": { "req_id": "..." }, "body": { ... } }`.
//!
//! Unlike the "回调 (webhook)" mode, the channel itself is unencrypted (only
//! media downloads carry a per-resource `aeskey`), and there is no signature —
//! authentication happens by sending an `aibot_subscribe` command carrying
//! `bot_id` + `secret` right after the socket opens.
//!
//! Replies are sent with `aibot_send_msg` (active push): `chatid` is the sender
//! `userid` for single chats or the group `chatid` for groups, needs no
//! `chat_type` and no passthrough `req_id`, and is valid for 24h — so it is not
//! bound to the 5-second passive-reply window that `aibot_respond_msg` streams
//! are. Frame shapes verified against the official `@wecom/aibot-node-sdk`.
//!
//! Everything here is transport-agnostic and unit-tested; the socket loop lives
//! in [`super::plugin`].

use serde::Deserialize;
use serde_json::json;
use tracing::warn;

use crate::types::{
    MessageContentType, PluginType, UnifiedAttachment, UnifiedIncomingMessage, UnifiedMessageContent,
    UnifiedUser,
};

/// Long-connection subscribe endpoint (single connection per bot; a new
/// connection kicks the previous one, which then receives `disconnected_event`).
pub const WECOM_WS_URL: &str = "wss://openws.work.weixin.qq.com";

/// Recommended application-level heartbeat interval (server drops idle sockets).
pub const WECOM_PING_INTERVAL_SECS: u64 = 30;

// ---------------------------------------------------------------------------
// Inbound envelope
// ---------------------------------------------------------------------------

/// Generic inbound frame. `body` is kept as raw JSON and re-parsed per `cmd`,
/// so an unknown command never breaks decoding of the ones we handle.
#[derive(Debug, Clone, Deserialize)]
pub struct WecomEnvelope {
    #[serde(default)]
    pub cmd: String,
    #[serde(default)]
    pub headers: WecomHeaders,
    #[serde(default)]
    pub body: serde_json::Value,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct WecomHeaders {
    #[serde(default)]
    pub req_id: String,
}

/// `aibot_msg_callback` body (the subset we consume in v1 + v2).
#[derive(Debug, Clone, Default, Deserialize)]
pub struct WecomMsgBody {
    #[serde(default)]
    pub msgid: String,
    /// Only present for group chats.
    #[serde(default)]
    pub chatid: String,
    /// "single" | "group".
    #[serde(default)]
    pub chattype: String,
    #[serde(default)]
    pub from: WecomFrom,
    #[serde(default)]
    pub msgtype: String,
    #[serde(default)]
    pub text: WecomText,
    /// v2 image payload. `aeskey` is a 32-byte ASCII string per the aibot
    /// long-connection spec; `url` is the encrypted download URL (5 min TTL)
    /// that `aeskey` decrypts.
    #[serde(default)]
    pub image: Option<WecomImage>,
}

/// `aibot_msg_callback.image` payload. Only present for `msgtype = "image"`.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct WecomImage {
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub aeskey: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct WecomFrom {
    #[serde(default)]
    pub userid: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct WecomText {
    #[serde(default)]
    pub content: String,
}

/// `aibot_event_callback` body (`msgtype` is always `event`).
#[derive(Debug, Clone, Default, Deserialize)]
pub struct WecomEventBody {
    #[serde(default)]
    pub event: WecomEvent,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct WecomEvent {
    #[serde(default)]
    pub eventtype: String,
}

/// Commands the socket loop reacts to. Everything else is logged and ignored.
pub const CMD_MSG_CALLBACK: &str = "aibot_msg_callback";
pub const CMD_EVENT_CALLBACK: &str = "aibot_event_callback";
pub const CMD_SUBSCRIBE: &str = "aibot_subscribe";
pub const CMD_SEND_MSG: &str = "aibot_send_msg";
pub const CMD_PING: &str = "ping";

/// Event type that means another connection displaced ours — do NOT reconnect.
pub const EVENT_DISCONNECTED: &str = "disconnected_event";

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/// Parse a raw WS text frame into an envelope (lenient: returns `None` only on
/// malformed JSON).
pub fn parse_envelope(text: &str) -> Option<WecomEnvelope> {
    serde_json::from_str::<WecomEnvelope>(text).ok()
}

/// The stable per-conversation key: `chatid` for groups, else the sender
/// `userid`. This doubles as the `aibot_send_msg` `chatid` at reply time.
pub fn chat_id_for(chattype: &str, chatid: &str, userid: &str) -> String {
    if chattype == "group" && !chatid.is_empty() {
        chatid.to_owned()
    } else {
        userid.to_owned()
    }
}

/// Outcome of decoding an `aibot_msg_callback` frame.
#[derive(Debug)]
pub struct DecodedMessage {
    pub unified: UnifiedIncomingMessage,
    /// Stable callback identity: payload `msgid`, falling back to the
    /// transport envelope's replay-stable `headers.req_id`.
    pub event_id: String,
}

/// v2: image messages carry an AES-encrypted download URL whose fetch +
/// decrypt must run on a tokio task. The decoder hands the raw URL/aeskey
/// to the plugin which orchestrates the async work.
#[derive(Debug)]
pub struct NeedsMediaDownload {
    pub event_id: String,
    pub chat_id: String,
    pub user: UnifiedUser,
    pub timestamp: i64,
    pub url: String,
    pub aeskey: String,
}

/// Decode an `aibot_msg_callback` envelope into a unified message.
///
/// Returns:
/// * `None` — payload is malformed, message type not supported in this
///   build (voice/file/etc.), or any other reason to silently skip.
/// * `Some(Ok(decoded))` — text (or slash-command) message already shaped.
/// * `Some(Err(needs))` — image message whose download+decrypt must run on
///   a tokio task before yielding a unified message.
pub fn decode_msg_callback(
    env: &WecomEnvelope,
    now: i64,
) -> Option<Result<DecodedMessage, NeedsMediaDownload>> {
    let body: WecomMsgBody = serde_json::from_value(env.body.clone()).ok()?;

    // Stable event id is needed for dedup whether we go down the text or
    // the image path — drop the message if it's neither present.
    let stable_event_id = {
        let msgid = body.msgid.trim();
        if !msgid.is_empty() {
            Some(msgid)
        } else {
            let req_id = env.headers.req_id.trim();
            (!req_id.is_empty()).then_some(req_id)
        }
    };
    let Some(stable_event_id) = stable_event_id else {
        warn!("WeCom message callback missing msgid and stable headers.req_id; dropping event");
        return None;
    };

    let userid = body.from.userid.clone();
    let chat_id = chat_id_for(&body.chattype, &body.chatid, &userid);
    if chat_id.is_empty() {
        return None;
    }

    let user = UnifiedUser {
        id: userid.clone(),
        username: None,
        display_name: if userid.is_empty() {
            "unknown".to_owned()
        } else {
            userid.clone()
        },
        avatar_url: None,
    };

    match body.msgtype.as_str() {
        "text" => {
            let text = body.text.content.trim().to_owned();
            if text.is_empty() {
                return None;
            }
            let content_type = if text.starts_with('/') {
                MessageContentType::Command
            } else {
                MessageContentType::Text
            };
            let unified = UnifiedIncomingMessage {
                id: stable_event_id.to_owned(),
                platform: PluginType::Wecom,
                chat_id,
                user,
                content: UnifiedMessageContent {
                    content_type,
                    text,
                    attachments: None,
                },
                timestamp: now,
                reply_to_message_id: None,
                action: None,
                raw: None,
            };
            Some(Ok(DecodedMessage {
                unified,
                event_id: stable_event_id.to_owned(),
            }))
        }
        "image" => {
            // Only the image branch lands in Err; everything else below is a
            // silent drop (None).
            let image = body.image?;
            let url = image.url.trim();
            let aeskey = image.aeskey.trim();
            if url.is_empty() || aeskey.is_empty() {
                warn!(
                    event_id = %stable_event_id,
                    "WeCom image message missing url or aeskey; dropping"
                );
                return None;
            }
            Some(Err(NeedsMediaDownload {
                event_id: stable_event_id.to_owned(),
                chat_id,
                user,
                timestamp: now,
                url: url.to_owned(),
                aeskey: aeskey.to_owned(),
            }))
        }
        other => {
            debug_unhandled(other);
            None
        }
    }
}

fn debug_unhandled(msgtype: &str) {
    tracing::debug!(msgtype, "WeCom message type not handled in v2");
}

/// Build a unified incoming message from a downloaded+decrypted image body.
///
/// Called by the plugin's async image-fetch path once we have the bytes.
/// `decoded_unified_attachment` is the storage URL the message loop will
/// hand to the inbox UI.
pub fn image_unified_from_download(
    event_id: String,
    chat_id: String,
    user: UnifiedUser,
    timestamp: i64,
    mime: String,
    ext: String,
    bytes_len: usize,
    storage_url: String,
) -> UnifiedIncomingMessage {
    // We use the file extension as a stable filename hint; the on-disk key
    // (also embedded in `storage_url`) is the lookup. File size is useful
    // for the inbox UI to show "1.2 MB" without re-downloading.
    let att = UnifiedAttachment {
        file_id: None,
        file_name: Some(format!("wecom-{event_id}.{ext}")),
        mime_type: Some(mime),
        file_size: Some(bytes_len as u64),
        url: Some(storage_url),
    };
    UnifiedIncomingMessage {
        id: event_id,
        platform: PluginType::Wecom,
        chat_id,
        user,
        content: UnifiedMessageContent {
            content_type: MessageContentType::Photo,
            text: "[图片]".to_owned(),
            attachments: Some(vec![att]),
        },
        timestamp,
        reply_to_message_id: None,
        action: None,
        raw: None,
    }
}

/// Extract the event type from an `aibot_event_callback` envelope.
pub fn decode_event_type(env: &WecomEnvelope) -> Option<String> {
    let body: WecomEventBody = serde_json::from_value(env.body.clone()).ok()?;
    let ev = body.event.eventtype;
    if ev.is_empty() { None } else { Some(ev) }
}

// ---------------------------------------------------------------------------
// Outbound frame builders
// ---------------------------------------------------------------------------

/// `aibot_subscribe` — sent immediately after the socket opens to authenticate.
pub fn build_subscribe_frame(bot_id: &str, secret: &str, req_id: &str) -> String {
    json!({
        "cmd": CMD_SUBSCRIBE,
        "headers": { "req_id": req_id },
        "body": { "bot_id": bot_id, "secret": secret }
    })
    .to_string()
}

/// `ping` — application-level heartbeat.
pub fn build_ping_frame(req_id: &str) -> String {
    json!({
        "cmd": CMD_PING,
        "headers": { "req_id": req_id }
    })
    .to_string()
}

/// `aibot_send_msg` (active push, markdown) — the reply path.
///
/// `chatid` is the sender `userid` for single chats or the group `chatid` for
/// groups (i.e. exactly [`chat_id_for`]'s output). `req_id` is freshly
/// generated (not a passthrough). WeCom's active push has no `text` msgtype, so
/// plain text is delivered as markdown (which renders it verbatim).
pub fn build_send_msg_frame(chatid: &str, content: &str, req_id: &str) -> String {
    json!({
        "cmd": CMD_SEND_MSG,
        "headers": { "req_id": req_id },
        "body": {
            "chatid": chatid,
            "msgtype": "markdown",
            "markdown": { "content": content }
        }
    })
    .to_string()
}

/// `aibot_send_msg` image reply — used after we've uploaded the image to
/// `/cgi-bin/media/upload` and obtained a `media_id`. The platform renders
/// it inline; pass-throughs of `media_id` are bound by WeCom's 3-day temp
/// media expiry.
pub fn build_send_image_frame(chatid: &str, media_id: &str, req_id: &str) -> String {
    json!({
        "cmd": CMD_SEND_MSG,
        "headers": { "req_id": req_id },
        "body": {
            "chatid": chatid,
            "msgtype": "image",
            "image": { "media_id": media_id }
        }
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_id_group_uses_chatid() {
        assert_eq!(chat_id_for("group", "wrkgrp1", "u1"), "wrkgrp1");
    }

    #[test]
    fn chat_id_single_uses_userid() {
        assert_eq!(chat_id_for("single", "", "u1"), "u1");
    }

    #[test]
    fn chat_id_group_without_chatid_falls_back_to_userid() {
        assert_eq!(chat_id_for("group", "", "u1"), "u1");
    }

    #[test]
    fn parse_envelope_ok() {
        let env = parse_envelope(r#"{"cmd":"ping","headers":{"req_id":"r1"},"body":{}}"#).unwrap();
        assert_eq!(env.cmd, "ping");
        assert_eq!(env.headers.req_id, "r1");
    }

    #[test]
    fn parse_envelope_missing_fields_defaults() {
        // Body/headers absent must not fail decoding.
        let env = parse_envelope(r#"{"cmd":"x"}"#).unwrap();
        assert_eq!(env.cmd, "x");
        assert_eq!(env.headers.req_id, "");
    }

    #[test]
    fn parse_envelope_invalid_json_none() {
        assert!(parse_envelope("not json").is_none());
    }

    #[test]
    fn decode_text_single_chat() {
        let env = parse_envelope(
            r#"{"cmd":"aibot_msg_callback","headers":{"req_id":"req-9"},
                "body":{"msgid":"m1","aibotid":"bot","chattype":"single",
                        "from":{"userid":"zhang"},"msgtype":"text",
                        "text":{"content":"hello robot"}}}"#,
        )
        .unwrap();
        let decoded = decode_msg_callback(&env, 1000).unwrap().unwrap();
        assert_eq!(decoded.unified.id, "m1");
        assert_eq!(decoded.unified.chat_id, "zhang");
        assert_eq!(decoded.unified.user.id, "zhang");
        assert_eq!(decoded.unified.content.text, "hello robot");
        assert_eq!(decoded.unified.platform, PluginType::Wecom);
        assert_eq!(decoded.unified.content.content_type, MessageContentType::Text);
        assert_eq!(decoded.event_id, "m1");
    }

    #[test]
    fn decode_text_group_chat_uses_chatid() {
        let env = parse_envelope(
            r#"{"cmd":"aibot_msg_callback","headers":{"req_id":"r"},
                "body":{"msgid":"m2","chattype":"group","chatid":"grp42",
                        "from":{"userid":"li"},"msgtype":"text",
                        "text":{"content":"@Robot hi"}}}"#,
        )
        .unwrap();
        let decoded = decode_msg_callback(&env, 2000).unwrap().unwrap();
        assert_eq!(decoded.unified.chat_id, "grp42");
        assert_eq!(decoded.unified.user.id, "li");
    }

    #[test]
    fn decode_slash_text_is_command() {
        let env = parse_envelope(
            r#"{"cmd":"aibot_msg_callback","headers":{"req_id":"r"},
                "body":{"msgid":"m","chattype":"single","from":{"userid":"u"},
                        "msgtype":"text","text":{"content":"/start"}}}"#,
        )
        .unwrap();
        let decoded = decode_msg_callback(&env, 1).unwrap().unwrap();
        assert_eq!(decoded.unified.content.content_type, MessageContentType::Command);
        assert_eq!(decoded.unified.content.text, "/start");
    }

    #[test]
    fn decode_voice_is_dropped() {
        // Voice/file/etc. are not handled in v2 — silent drop.
        let env = parse_envelope(
            r#"{"cmd":"aibot_msg_callback","headers":{"req_id":"r"},
                "body":{"msgid":"m","chattype":"single","from":{"userid":"u"},
                        "msgtype":"voice","voice":{"url":"http://x"}}}"#,
        )
        .unwrap();
        assert!(decode_msg_callback(&env, 1).is_none());
    }

    #[test]
    fn decode_image_yields_needs_media_download() {
        let env = parse_envelope(
            r#"{"cmd":"aibot_msg_callback","headers":{"req_id":"r"},
                "body":{"msgid":"m","chattype":"single","from":{"userid":"u"},
                        "msgtype":"image",
                        "image":{"url":"https://ww-aibot-img.example/foo","aeskey":"ABCDEFGHIJKLMNOPQRSTUVWXYZ012345"}}}"#,
        )
        .unwrap();
        let needs = decode_msg_callback(&env, 42).unwrap().unwrap_err();
        assert_eq!(needs.event_id, "m");
        assert_eq!(needs.chat_id, "u");
        assert_eq!(needs.url, "https://ww-aibot-img.example/foo");
        assert_eq!(needs.aeskey, "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345");
        assert_eq!(needs.timestamp, 42);
    }

    #[test]
    fn decode_image_with_empty_url_is_dropped() {
        let env = parse_envelope(
            r#"{"cmd":"aibot_msg_callback","headers":{"req_id":"r"},
                "body":{"msgid":"m","chattype":"single","from":{"userid":"u"},
                        "msgtype":"image","image":{"url":"","aeskey":"ABCDEFGHIJKLMNOPQRSTUVWXYZ012345"}}}"#,
        )
        .unwrap();
        assert!(decode_msg_callback(&env, 1).is_none());
    }

    #[test]
    fn decode_empty_text_is_skipped() {
        let env = parse_envelope(
            r#"{"cmd":"aibot_msg_callback","headers":{"req_id":"r"},
                "body":{"msgid":"m","chattype":"single","from":{"userid":"u"},
                        "msgtype":"text","text":{"content":"   "}}}"#,
        )
        .unwrap();
        assert!(decode_msg_callback(&env, 1).is_none());
    }

    #[test]
    fn decode_missing_msgid_uses_transport_req_id() {
        let env = parse_envelope(
            r#"{"cmd":"aibot_msg_callback","headers":{"req_id":"r"},
                "body":{"chattype":"single","from":{"userid":"u"},
                        "msgtype":"text","text":{"content":"hi"}}}"#,
        )
        .unwrap();
        let decoded = decode_msg_callback(&env, 777).unwrap().unwrap();
        assert_eq!(decoded.unified.id, "r");
        assert_eq!(decoded.event_id, "r");
    }

    #[test]
    fn decode_without_msgid_or_req_id_is_dropped() {
        let env = parse_envelope(
            r#"{"cmd":"aibot_msg_callback","headers":{},
                "body":{"chattype":"single","from":{"userid":"u"},
                        "msgtype":"text","text":{"content":"hi"}}}"#,
        )
        .unwrap();

        assert!(decode_msg_callback(&env, 777).is_none());
    }

    #[test]
    fn image_unified_from_download_attaches_storage_url() {
        let unified = image_unified_from_download(
            "m1".into(),
            "u1".into(),
            UnifiedUser {
                id: "u1".into(),
                username: None,
                display_name: "u1".into(),
                avatar_url: None,
            },
            123,
            "image/jpeg".into(),
            "jpg".into(),
            4096,
            "/api/channel/media/00000000000000000000000000000000.jpg".into(),
        );
        assert_eq!(unified.platform, PluginType::Wecom);
        assert_eq!(unified.content.content_type, MessageContentType::Photo);
        assert_eq!(
            unified.content.attachments.as_ref().unwrap()[0].url.as_deref(),
            Some("/api/channel/media/00000000000000000000000000000000.jpg")
        );
        assert_eq!(
            unified.content.attachments.as_ref().unwrap()[0].file_size,
            Some(4096)
        );
    }

    #[test]
    fn decode_event_type_ok() {
        let env = parse_envelope(
            r#"{"cmd":"aibot_event_callback","headers":{"req_id":"r"},
                "body":{"msgtype":"event","event":{"eventtype":"enter_chat"}}}"#,
        )
        .unwrap();
        assert_eq!(decode_event_type(&env).as_deref(), Some("enter_chat"));
    }

    #[test]
    fn build_subscribe_frame_shape() {
        let frame = build_subscribe_frame("botA", "secretB", "req-1");
        let v: serde_json::Value = serde_json::from_str(&frame).unwrap();
        assert_eq!(v["cmd"], CMD_SUBSCRIBE);
        assert_eq!(v["headers"]["req_id"], "req-1");
        assert_eq!(v["body"]["bot_id"], "botA");
        assert_eq!(v["body"]["secret"], "secretB");
    }

    #[test]
    fn build_ping_frame_shape() {
        let v: serde_json::Value = serde_json::from_str(&build_ping_frame("p1")).unwrap();
        assert_eq!(v["cmd"], CMD_PING);
        assert_eq!(v["headers"]["req_id"], "p1");
    }

    #[test]
    fn build_send_msg_frame_shape() {
        let v: serde_json::Value = serde_json::from_str(&build_send_msg_frame("zhang", "你好", "send-1")).unwrap();
        assert_eq!(v["cmd"], CMD_SEND_MSG);
        assert_eq!(v["headers"]["req_id"], "send-1");
        assert_eq!(v["body"]["chatid"], "zhang");
        assert_eq!(v["body"]["msgtype"], "markdown");
        assert_eq!(v["body"]["markdown"]["content"], "你好");
        // WeCom active push carries no chat_type field.
        assert!(v["body"].get("chat_type").is_none());
    }

    #[test]
    fn build_send_image_frame_shape() {
        let v: serde_json::Value = serde_json::from_str(&build_send_image_frame("zhang", "MEDIA_ABC", "send-7")).unwrap();
        assert_eq!(v["cmd"], CMD_SEND_MSG);
        assert_eq!(v["headers"]["req_id"], "send-7");
        assert_eq!(v["body"]["chatid"], "zhang");
        assert_eq!(v["body"]["msgtype"], "image");
        assert_eq!(v["body"]["image"]["media_id"], "MEDIA_ABC");
    }
}
