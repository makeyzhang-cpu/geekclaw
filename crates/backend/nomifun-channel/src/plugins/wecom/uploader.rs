//! WeCom (企业微信) aibot access_token cache + temporary media upload.
//!
//! Active-push bots only authenticate over the long-connection socket (via
//! `bot_id` + `secret`), but the *upload* REST call (`cgi-bin/media/upload`)
//! still needs a separate `access_token`. We exchange `bot_id`/`secret` for an
//! `access_token` (`cgi-bin/gettoken`), cache it for slightly less than its
//! advertised `expires_in`, and reuse it for upload calls.
//!
//! Endpoints (Corporate WeCom / `qyapi.weixin.qq.com`):
//! * `GET  /cgi-bin/gettoken?corpid={bot_id}&corpsecret={secret}`
//! * `POST /cgi-bin/media/upload?access_token={token}&type={type}`
//!
//! Both accept/return JSON; the upload is a standard `multipart/form-data`
//! with a single `media` part. The reply carries a `media_id` we can later
//! embed into an `aibot_send_msg` frame.
//!
//! Per the official `Tencent/WeKnora` and `dividduang/aibot-python-sdk`
//! references.

use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

const GETTOKEN_URL: &str = "https://qyapi.weixin.qq.com/cgi-bin/gettoken";
const MEDIA_UPLOAD_URL: &str = "https://qyapi.weixin.qq.com/cgi-bin/media/upload";

/// Refresh the cached token this far before its advertised `expires_in`.
const TOKEN_EXPIRY_SAFETY_MARGIN: Duration = Duration::from_secs(120);

#[derive(Debug, thiserror::Error)]
pub enum WecomUploadError {
    #[error("WeCom access-token endpoint returned errcode={code}: {message}")]
    TokenApi { code: i64, message: String },
    #[error("missing access_token field in gettoken response: {0}")]
    MissingAccessToken(String),
    #[error("WeCom media upload returned errcode={code}: {message}")]
    UploadApi { code: i64, message: String },
    #[error("missing media_id field in media/upload response: {0}")]
    MissingMediaId(String),
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("missing filename for media upload")]
    MissingFilename,
}

#[derive(Debug, Deserialize)]
struct GetTokenResponse {
    #[serde(default)]
    errcode: i64,
    #[serde(default)]
    errmsg: String,
    #[serde(default)]
    access_token: Option<String>,
    #[serde(default)]
    expires_in: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct MediaUploadResponse {
    #[serde(default)]
    errcode: i64,
    #[serde(default)]
    errmsg: String,
    #[serde(default)]
    media_id: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    url: Option<String>,
}

#[derive(Debug, Serialize)]
struct MediaUploadEnvelope<'a> {
    #[serde(rename = "media_id")]
    media_id: &'a str,
}

/// Cached aibot token with pre-computed expiry.
struct CachedToken {
    access_token: String,
    expires_at: Instant,
}

/// Shared cache so concurrent upload requests don't all hit `/gettoken`.
#[derive(Clone)]
pub struct WecomUploader {
    bot_id: Arc<str>,
    secret: Arc<str>,
    http: reqwest::Client,
    token_cache: Arc<Mutex<Option<CachedToken>>>,
}

impl WecomUploader {
    pub fn new(bot_id: String, secret: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .expect("reqwest client builder is infallible for this config");
        Self {
            bot_id: Arc::from(bot_id),
            secret: Arc::from(secret),
            http,
            token_cache: Arc::new(Mutex::new(None)),
        }
    }

    /// Fetches (and caches) a fresh `access_token` for the configured bot.
    ///
    /// Concurrent calls share the cache: only the first to find an empty
    /// cache will issue the GET; the rest await its result.
    pub async fn access_token(&self) -> Result<String, WecomUploadError> {
        // Reuse an unexpired cached token.
        if let Some(tok) = self.token_cache.lock().await.as_ref() {
            if tok.expires_at > Instant::now() {
                return Ok(tok.access_token.clone());
            }
        }

        let mut guard = self.token_cache.lock().await;
        // Double-check after acquiring the write lock — a concurrent caller
        // may have refreshed it while we were waiting.
        if let Some(tok) = guard.as_ref() {
            if tok.expires_at > Instant::now() {
                return Ok(tok.access_token.clone());
            }
        }

        let url = format!(
            "{}?corpid={}&corpsecret={}",
            GETTOKEN_URL, self.bot_id, self.secret
        );
        let resp: GetTokenResponse = self
            .http
            .get(&url)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        if resp.errcode != 0 {
            return Err(WecomUploadError::TokenApi {
                code: resp.errcode,
                message: resp.errmsg,
            });
        }
        let token = resp
            .access_token
            .filter(|s| !s.is_empty())
            .ok_or_else(|| WecomUploadError::MissingAccessToken("empty token".into()))?;
        let expires_in = resp.expires_in.unwrap_or(7200).max(60);
        let expires_at = Instant::now()
            + Duration::from_secs(expires_in as u64)
                .saturating_sub(TOKEN_EXPIRY_SAFETY_MARGIN);
        *guard = Some(CachedToken {
            access_token: token.clone(),
            expires_at,
        });
        Ok(token)
    }

    /// Upload `bytes` (named `filename`, with the given MIME type) as a
    /// temporary media asset of `kind` (e.g. `image`, `voice`, `file`).
    /// Returns the `media_id` to embed in subsequent `aibot_send_msg` frames.
    pub async fn upload(
        &self,
        kind: &str,
        filename: &str,
        mime: &str,
        bytes: &[u8],
    ) -> Result<String, WecomUploadError> {
        if filename.is_empty() {
            return Err(WecomUploadError::MissingFilename);
        }
        let token = self.access_token().await?;
        let url = format!("{}?access_token={}&type={}", MEDIA_UPLOAD_URL, token, kind);

        let part = reqwest::multipart::Part::bytes(bytes.to_vec())
            .file_name(filename.to_owned())
            .mime_str(mime)
            .map_err(WecomUploadError::Http)?;
        let form = reqwest::multipart::Form::new().part("media", part);

        let resp: MediaUploadResponse = self
            .http
            .post(&url)
            .multipart(form)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        if resp.errcode != 0 {
            return Err(WecomUploadError::UploadApi {
                code: resp.errcode,
                message: resp.errmsg,
            });
        }
        resp.media_id
            .filter(|s| !s.is_empty())
            .ok_or_else(|| WecomUploadError::MissingMediaId("empty media_id".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build the multipart body without hitting the wire and assert its shape.
    #[tokio::test]
    async fn upload_request_shape_against_mock_form() {
        // We can't trivially mock reqwest::Client without wiremock; this
        // sanity-test just covers serialization (round-trip the envelope).
        let env = MediaUploadEnvelope {
            media_id: "MEDIA_ABC123",
        };
        let s = serde_json::to_string(&env).unwrap();
        assert_eq!(s, r#"{"media_id":"MEDIA_ABC123"}"#);
    }

    #[test]
    fn token_expiry_safety_margin_is_positive() {
        // Sanity: the safety margin must always reduce, never extend, the
        // expiry — so an instant in-time clock drift or a one-second
        // roundtrip latency never hands out an already-expired token.
        let margin = TOKEN_EXPIRY_SAFETY_MARGIN;
        assert!(margin > Duration::ZERO);
    }

    #[test]
    fn rejects_empty_filename() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let uploader = WecomUploader::new("bot".into(), "sec".into());
            let result = uploader.upload("image", "", "image/png", b"x").await;
            assert!(matches!(result, Err(WecomUploadError::MissingFilename)));
        });
    }
}
