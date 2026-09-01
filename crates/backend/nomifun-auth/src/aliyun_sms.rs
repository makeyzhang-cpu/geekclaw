//! Alibaba Cloud Short Message Service (Dysmsapi) client.
//!
//! Sends a single verification SMS via the RPC `SendSms` action, signing the
//! request with the POP HMAC-SHA1 scheme. Credentials are read from the env
//! (written to `/etc/geekclaw/geekclaw.env` on the server, never in code):
//!   * `GEEKCLAW_ALIYUN_ACCESS_KEY_ID`
//!   * `GEEKCLAW_ALIYUN_ACCESS_KEY_SECRET`
//!   * `GEEKCLAW_SMS_SIGN_NAME`   (defaults to `极客直播`)
//!   * `GEEKCLAW_SMS_TEMPLATE_CODE` (template must contain `${code}`)

use std::collections::BTreeMap;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use chrono::Utc;
use hmac::{Hmac, Mac};
use rand::Rng;
use sha1::Sha1;

type HmacSha1 = Hmac<Sha1>;

const SMS_ENDPOINT: &str = "https://dysmsapi.aliyuncs.com";
const SMS_VERSION: &str = "2017-05-25";
const SMS_ACTION: &str = "SendSms";

/// Percent-encode a string per Alibaba Cloud POP rules (RFC 3986, where the
/// space character is encoded as `%20`, never `+`).
fn pop_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len() * 3);
    for &b in input.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// Generate a 6-digit numeric SMS verification code (e.g. `"482913"`).
pub fn generate_sms_code() -> String {
    let n: u32 = rand::thread_rng().gen_range(100_000..1_000_000);
    format!("{:06}", n)
}

/// Compute the POP `Signature` for a GET request.
fn pop_signature(secret: &str, method: &str, params: &BTreeMap<String, String>) -> String {
    let canonical: String = params
        .iter()
        .map(|(k, v)| format!("{}={}", pop_encode(k), pop_encode(v)))
        .collect::<Vec<_>>()
        .join("&");

    let string_to_sign = format!(
        "{}&{}&{}",
        method,
        pop_encode("/"),
        pop_encode(&canonical)
    );

    let mut mac = HmacSha1::new_from_slice(format!("{}&", secret).as_bytes())
        .expect("HMAC accepts keys of any length");
    mac.update(string_to_sign.as_bytes());
    BASE64.encode(mac.finalize().into_bytes())
}

/// Send a verification SMS via Alibaba Cloud.
///
/// Returns `Err` with a human-readable Chinese message on any failure:
/// missing config, network error, or an API-level error `Code`.
pub async fn send_verification_sms(phone: &str, code: &str) -> Result<(), String> {
    let access_key_id = std::env::var("GEEKCLAW_ALIYUN_ACCESS_KEY_ID")
        .map_err(|_| "阿里云 AccessKeyId 未配置".to_string())?;
    let access_key_secret = std::env::var("GEEKCLAW_ALIYUN_ACCESS_KEY_SECRET")
        .map_err(|_| "阿里云 AccessKeySecret 未配置".to_string())?;
    let sign_name =
        std::env::var("GEEKCLAW_SMS_SIGN_NAME").unwrap_or_else(|_| "极客直播".to_string());
    let template_code = std::env::var("GEEKCLAW_SMS_TEMPLATE_CODE")
        .map_err(|_| "短信模板 Code 未配置".to_string())?;

    let timestamp = Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let nonce: u64 = rand::random();
    let template_param = format!("{{\"code\":\"{}\"}}", code);

    let mut params: BTreeMap<String, String> = BTreeMap::new();
    params.insert("AccessKeyId".into(), access_key_id);
    params.insert("Action".into(), SMS_ACTION.into());
    params.insert("Format".into(), "JSON".into());
    params.insert("PhoneNumbers".into(), phone.to_string());
    params.insert("RegionId".into(), "cn-hangzhou".into());
    params.insert("SignName".into(), sign_name);
    params.insert("SignatureMethod".into(), "HMAC-SHA1".into());
    params.insert("SignatureNonce".into(), format!("{:016X}", nonce));
    params.insert("SignatureVersion".into(), "1.0".into());
    params.insert("TemplateCode".into(), template_code);
    params.insert("TemplateParam".into(), template_param);
    params.insert("Timestamp".into(), timestamp);
    params.insert("Version".into(), SMS_VERSION.into());

    let signature = pop_signature(&access_key_secret, "GET", &params);
    params.insert("Signature".into(), signature);

    let url = format!(
        "{}/?{}",
        SMS_ENDPOINT,
        params
            .iter()
            .map(|(k, v)| format!("{}={}", pop_encode(k), pop_encode(v)))
            .collect::<Vec<_>>()
            .join("&")
    );

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("短信网关请求失败: {e}"))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("读取短信网关响应失败: {e}"))?;

    if !status.is_success() {
        return Err(format!("短信网关返回 HTTP {status}: {body}"));
    }

    let parsed: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("解析短信网关响应失败: {e} (body: {body})"))?;

    match parsed.get("Code").and_then(|c| c.as_str()) {
        Some("OK") => Ok(()),
        Some(code) => {
            let msg = parsed
                .get("Message")
                .and_then(|m| m.as_str())
                .unwrap_or("未知错误");
            Err(format!("短信发送失败 [{code}]: {msg}"))
        }
        None => Err(format!("短信网关响应缺少 Code 字段: {body}")),
    }
}
