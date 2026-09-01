//! 通联收银宝 (Allinpay Cashier) gateway integration.
//!
//! Scope: build a real, non-test payment loop for the GeekClaw storefront.
//!   * [`AllinpayConfig`] reads merchant credentials from `system_kv` (admin
//!     console) or the environment, so secrets never enter the binary/repo.
//!     When the config is incomplete, [`resolve_allinpay_config`] returns
//!     `None` and checkout is *blocked* (no implicit test-mode activation).
//!   * Two signature schemes are supported, auto-selected from the credentials
//!     present:
//!       - `RSA2`: SHA256WithRSA (通联 calls it `RSA2`). Outgoing requests are
//!                 signed with the merchant RSA private key; async notifies are
//!                 verified against the 通联 platform RSA public key.
//!       - `MD5` : legacy symmetric-key MD5 (kept for backwards compatibility).
//!   * [`create_unified_order`] calls the unified-order API and returns the
//!     cashier QR string for WeChat (`W01`) / Alipay (`A01`) scan payment.
//!   * [`verify_notify`] validates the async notify callback's signature and
//!     extracts the confirmed payment (`cusorderid` = our `reqsn`, `trxid`).

use std::collections::BTreeMap;
use std::env;
use std::fmt::Write as _;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use md5;
use nomifun_db::IUserRepository;
use rsa::pkcs1::DecodeRsaPrivateKey;
use rsa::pkcs1v15::Pkcs1v15Sign;
use rsa::pkcs8::DecodePrivateKey;
use rsa::pkcs8::DecodePublicKey;
use rsa::RsaPrivateKey;
use rsa::RsaPublicKey;
use rand::Rng;
use serde::Deserialize;
use sha2::{Digest, Sha256};

/// `system_kv` keys backing the 收银宝 merchant configuration. Values set here
/// (via the admin console) take precedence over environment variables.
pub const KV_ALLINPAY_CUSID: &str = "allinpay_cusid";
pub const KV_ALLINPAY_APPID: &str = "allinpay_appid";
pub const KV_ALLINPAY_KEY: &str = "allinpay_key";
pub const KV_ALLINPAY_PRIVATE_KEY: &str = "allinpay_private_key";
pub const KV_ALLINPAY_PUBLIC_KEY: &str = "allinpay_public_key";
pub const KV_ALLINPAY_NOTIFY_URL: &str = "allinpay_notify_url";
pub const KV_ALLINPAY_API_URL: &str = "allinpay_api_url";
pub const ALLINPAY_DEFAULT_API_URL: &str = "https://syb-test.allinpay.com/apiweb/unitorder/pay";

/// Which signature scheme to use, derived from the available credentials.
#[derive(Clone, Debug)]
pub enum AllinpaySignType {
    /// SHA256WithRSA (通联 calls this `RSA2`), signed with the merchant private
    /// key; notifies verified with the 通联 platform public key.
    Rsa {
        /// Merchant RSA private key (PEM, or raw base64).
        private_key: String,
        /// 通联 platform RSA public key (PEM, or raw base64) for notify verify.
        public_key: String,
    },
    /// Legacy MD5 symmetric key.
    Md5 {
        /// MD5 通讯密钥.
        key: String,
    },
}

impl AllinpaySignType {
    /// `MD5` or `RSA2` as sent in the `signtype` field.
    fn as_str(&self) -> &'static str {
        match self {
            AllinpaySignType::Rsa { .. } => "RSA2",
            AllinpaySignType::Md5 { .. } => "MD5",
        }
    }
}

/// Resolve the gateway config: prefer `system_kv` (admin console), falling back
/// to environment variables. Returns `None` when the config is incomplete —
/// callers must block checkout so we never grant a plan without a confirmed
/// payment.
pub async fn resolve_allinpay_config(repo: &dyn IUserRepository) -> Option<AllinpayConfig> {
    let cusid = first_kv_or_env(repo, KV_ALLINPAY_CUSID, "GEEKCLAW_ALLINPAY_CUSID").await?;
    let appid = first_kv_or_env(repo, KV_ALLINPAY_APPID, "GEEKCLAW_ALLINPAY_APPID").await?;
    let notify_url = first_kv_or_env(repo, KV_ALLINPAY_NOTIFY_URL, "GEEKCLAW_ALLINPAY_NOTIFY_URL").await?;
    let private_key = first_kv_or_env(repo, KV_ALLINPAY_PRIVATE_KEY, "GEEKCLAW_ALLINPAY_PRIVATE_KEY").await;
    let public_key = first_kv_or_env(repo, KV_ALLINPAY_PUBLIC_KEY, "GEEKCLAW_ALLINPAY_PUBLIC_KEY").await;
    let md5_key = first_kv_or_env(repo, KV_ALLINPAY_KEY, "GEEKCLAW_ALLINPAY_KEY").await;
    let api_url = first_kv_or_env(repo, KV_ALLINPAY_API_URL, "GEEKCLAW_ALLINPAY_API_URL")
        .await
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| ALLINPAY_DEFAULT_API_URL.to_owned());

    if cusid.is_empty() || appid.is_empty() || notify_url.is_empty() {
        return None;
    }

    let private_key = private_key.filter(|v| !v.trim().is_empty());
    let public_key = public_key.filter(|v| !v.trim().is_empty());
    let md5_key = md5_key.filter(|v| !v.trim().is_empty());

    let sign_type = if let (Some(pk), Some(pubk)) = (private_key, public_key) {
        AllinpaySignType::Rsa {
            private_key: pk,
            public_key: pubk,
        }
    } else if let Some(key) = md5_key {
        AllinpaySignType::Md5 { key }
    } else {
        // Neither RSA key pair nor MD5 key present -> not configured.
        return None;
    };

    Some(AllinpayConfig {
        cusid,
        appid,
        notify_url,
        api_url,
        sign_type,
    })
}

/// Fetch a value from `system_kv` first, falling back to the environment.
async fn first_kv_or_env(repo: &dyn IUserRepository, kv_key: &str, env_key: &str) -> Option<String> {
    if let Some(v) = repo.get_kv(kv_key).await.ok().flatten().filter(|v| !v.is_empty()) {
        return Some(v);
    }
    env::var(env_key)
        .ok()
        .map(|v| v.trim().to_owned())
        .filter(|v| !v.is_empty())
}

/// Merchant configuration for the 通联收银宝 gateway.
#[derive(Clone, Debug)]
pub struct AllinpayConfig {
    /// 商户号 (`cusid`).
    pub cusid: String,
    /// 应用 ID (`appid`).
    pub appid: String,
    /// Async notify URL (must be https, no query string). Allinpay POSTs the
    /// payment result here; we correlate it to the order via `cusorderid`.
    pub notify_url: String,
    /// Unified-order endpoint. Defaults to the 收银宝 test environment.
    pub api_url: String,
    /// Selected signature scheme + key material.
    pub sign_type: AllinpaySignType,
}

/// Build the canonical signing string: every param except `sign`, drop empties,
/// sort by key ascending, join as `k=v&k=v`.
fn canonical_string(params: &BTreeMap<String, String>) -> String {
    let mut parts: Vec<String> = Vec::new();
    for (k, v) in params {
        if k == "sign" {
            continue;
        }
        if v.is_empty() {
            continue;
        }
        parts.push(format!("{k}={v}"));
    }
    parts.sort();
    parts.join("&")
}

/// Compute the Allinpay MD5 signature.
///
/// Rule (per the 收银宝 security spec): canonical string (sorted `k=v&k=v`,
/// empties dropped, `sign` excluded) suffixed with `&key=<MERCHANT_KEY>`, then
/// MD5 hex uppercased.
pub fn sign(params: &BTreeMap<String, String>, merchant_key: &str) -> String {
    let raw = format!("{}&key={merchant_key}", canonical_string(params));
    let digest = md5::compute(raw.as_bytes());
    let mut out = String::with_capacity(32);
    for byte in digest.0 {
        let _ = write!(out, "{byte:02X}");
    }
    out
}

/// Sign the canonical string with the merchant RSA private key (SHA1WithRSA),
/// returning the base64 signature 通联 expects.
pub fn sign_rsa(params: &BTreeMap<String, String>, private_key_pem: &str) -> Result<String, String> {
    let msg = canonical_string(params);
    let key = parse_private_key(private_key_pem)?;
    let hashed = sha256_digest(msg.as_bytes());
    let sig = key
        .sign(Pkcs1v15Sign::new::<Sha256>(), &hashed)
        .map_err(|e| format!("收银宝 RSA2 签名失败: {e}"))?;
    Ok(B64.encode(sig))
}

/// Verify a 通联 notify signature against the platform RSA public key.
pub fn verify_rsa(
    params: &BTreeMap<String, String>,
    public_key_pem: &str,
    their_sign: &str,
) -> Result<bool, String> {
    let msg = canonical_string(params);
    let key = parse_public_key(public_key_pem)?;
    let sig_bytes = B64
        .decode(their_sign.trim())
        .map_err(|e| format!("收银宝签名 base64 解码失败: {e}"))?;
    let hashed = sha256_digest(msg.as_bytes());
    Ok(key.verify(Pkcs1v15Sign::new::<Sha256>(), &hashed, &sig_bytes).is_ok())
}

/// SHA256 helper (RSA2 = SHA256WithRSA).
fn sha256_digest(data: &[u8]) -> Vec<u8> {
    let mut h = Sha256::new();
    h.update(data);
    h.finalize().to_vec()
}

/// Parse a PEM-or-raw-base64 RSA private key (tries PKCS#8 then PKCS#1).
fn parse_private_key(raw: &str) -> Result<RsaPrivateKey, String> {
    let pkcs8 = wrap_pem(raw, "-----BEGIN PRIVATE KEY-----", "-----END PRIVATE KEY-----");
    if let Ok(k) = RsaPrivateKey::from_pkcs8_pem(&pkcs8) {
        return Ok(k);
    }
    let pkcs1 = wrap_pem(raw, "-----BEGIN RSA PRIVATE KEY-----", "-----END RSA PRIVATE KEY-----");
    RsaPrivateKey::from_pkcs1_pem(&pkcs1).map_err(|e| format!("解析收银宝私钥失败: {e}"))
}

/// Parse a PEM-or-raw-base64 RSA public key (SPKI / PKCS#1).
fn parse_public_key(raw: &str) -> Result<RsaPublicKey, String> {
    let spki = wrap_pem(raw, "-----BEGIN PUBLIC KEY-----", "-----END PUBLIC KEY-----");
    RsaPublicKey::from_public_key_pem(&spki).map_err(|e| format!("解析收银宝平台公钥失败: {e}"))
}

/// Normalize a possibly-raw base64 key into a parseable PEM block.
///
/// Raw base64 is wrapped with the given headers and folded at 64 characters per
/// line (RFC 7468). PEM passed through unchanged.
fn wrap_pem(raw: &str, header: &str, footer: &str) -> String {
    let body = raw.trim();
    if body.contains("-----BEGIN") {
        return body.to_owned();
    }
    let wrapped: Vec<&str> = body
        .as_bytes()
        .chunks(64)
        .map(|c| std::str::from_utf8(c).expect("base64 is ascii"))
        .collect();
    format!("{header}\n{}\n{footer}", wrapped.join("\n"))
}

/// Constant-time-ish string compare for signatures (avoids trivial timing
/// leaks; not a cryptographic guarantee but sufficient for HMAC-style equality).
fn sig_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let (ab, bb) = (a.as_bytes(), b.as_bytes());
    let mut diff = 0u8;
    for i in 0..ab.len() {
        diff |= ab[i] ^ bb[i];
    }
    diff == 0
}

/// Payment type codes for scan-to-pay.
pub const PAYTYPE_WECHAT: &str = "W01";
pub const PAYTYPE_ALIPAY: &str = "A01";

/// Result of a successful unified-order call.
#[derive(Debug, Clone)]
pub struct UnifiedOrderResult {
    /// Cashier QR content (rendered by the storefront as a QR image).
    pub payinfo: String,
    /// Allinpay transaction id. NOTE: the authoritative `trxid` arrives in the
    /// async notify callback; this field is populated only if the order API
    /// echoes it. Kept for completeness/debugging.
    #[allow(dead_code)]
    pub trxid: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UnifiedOrderResponse {
    #[serde(default)]
    retcode: Option<String>,
    #[serde(default)]
    retmsg: Option<String>,
    #[serde(default)]
    payinfo: Option<String>,
    #[serde(default)]
    trxid: Option<String>,
}

/// Calls the 收银宝 unified-order API and returns the cashier QR string.
///
/// `amount_fen` is the order total in 分 (1 CNY = 100 分). `paytype` is
/// [`PAYTYPE_WECHAT`] or [`PAYTYPE_ALIPAY`].
pub async fn create_unified_order(
    cfg: &AllinpayConfig,
    reqsn: &str,
    amount_fen: i64,
    body_desc: &str,
    paytype: &str,
) -> Result<UnifiedOrderResult, String> {
    let mut params: BTreeMap<String, String> = BTreeMap::new();
    params.insert("cusid".into(), cfg.cusid.clone());
    params.insert("appid".into(), cfg.appid.clone());
    params.insert("version".into(), "11".into());
    params.insert("signtype".into(), cfg.sign_type.as_str().into());
    params.insert("paytype".into(), paytype.to_owned());
    params.insert("trxamt".into(), amount_fen.to_string());
    params.insert("reqsn".into(), reqsn.to_owned());
    params.insert("body".into(), body_desc.to_owned());
    params.insert("remark".into(), "GeekClaw 套餐购买".into());
    params.insert("validtime".into(), "30".into()); // order valid 30 minutes
    params.insert("notify_url".into(), cfg.notify_url.clone());

    // Sign over everything except `sign`, then attach it.
    let signature = match &cfg.sign_type {
        AllinpaySignType::Rsa { private_key, .. } => sign_rsa(&params, private_key)?,
        AllinpaySignType::Md5 { key } => sign(&params, key),
    };
    params.insert("sign".into(), signature);

    // reqwest is built without the `form` feature in this workspace, so we
    // encode the form body ourselves with serde_urlencoded (handles percent
    // encoding of values such as the Chinese `body`/`remark` fields).
    let body = serde_urlencoded::to_string(&params)
        .map_err(|e| format!("收银宝表单编码失败: {e}"))?;
    let client = reqwest::Client::new();
    let resp = client
        .post(&cfg.api_url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("收银宝下单网络错误: {e}"))?;

    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取收银宝响应失败: {e}"))?;

    let parsed: UnifiedOrderResponse = serde_json::from_str(&text)
        .map_err(|e| format!("收银宝响应解析失败: {e}（原始: {text}）"))?;

    if parsed.retcode.as_deref() != Some("SUCCESS") {
        return Err(format!("收银宝下单失败: {}", parsed.retmsg.unwrap_or_default()));
    }

    let payinfo = parsed
        .payinfo
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "收银宝未返回支付二维码".to_owned())?;

    Ok(UnifiedOrderResult {
        payinfo,
        trxid: parsed.trxid.filter(|s| !s.is_empty()),
    })
}

/// Derive the 收银宝 single-order query endpoint from the unified-order URL.
///
/// The query interface sits at `.../unitorder/query` (same `unitorder` path as
/// the pay endpoint, just a different action suffix); both test and production
/// hosts share this layout.
fn query_url(api_url: &str) -> String {
    if let Some(idx) = api_url.rfind("/pay") {
        let mut u = api_url.to_owned();
        u.replace_range(idx..idx + 4, "/query");
        u
    } else {
        api_url.to_owned()
    }
}

/// Tri-state result of an 通联 single-order query.
pub enum QueryOrderResult {
    /// Payment confirmed. Carries the 通联 transaction id (may be empty).
    Paid(String),
    /// 通联 reported a definitive non-success (`3088` 超时未支付 / `3999`·`3089`
    /// 交易失败). The string is a human-readable reason for logging & the UI.
    Failed(String),
    /// Still pending — no money yet, transaction in flight or not started.
    Pending,
}

/// Query the 收银宝 single-order API to confirm the *real* payment status.
///
/// This is the closed-loop safety net: instead of trusting only the async
/// notify callback (which can be delayed or lost), the storefront polls its own
/// order endpoint and the backend actively asks 通联 whether the money landed.
///
/// Returns:
///   * `Ok(QueryOrderResult::Paid(trxid))` — `trxstatus = "0000"` only (清算成功,
///     钱已到通联)。`2000` 无论有无 `trxid` 都**不是**成功，一律 Pending。
///   * `Ok(QueryOrderResult::Failed(reason))` — definitive non-success. Mark the
///     order `failed` so the UI shows an honest failure instead of hanging.
///   * `Ok(QueryOrderResult::Pending)` — `2000` (已受理/处理中，钱未到)、`1001`
///     或未找到。Keep polling; it will resolve to `Paid` or `Failed`.
///   * `Err(msg)` — network or (de)serialization failure. Callers log and retry.
pub async fn query_order(cfg: &AllinpayConfig, reqsn: &str) -> Result<QueryOrderResult, String> {
    let mut params: BTreeMap<String, String> = BTreeMap::new();
    params.insert("cusid".into(), cfg.cusid.clone());
    params.insert("appid".into(), cfg.appid.clone());
    params.insert("version".into(), "11".into());
    params.insert("signtype".into(), cfg.sign_type.as_str().into());
    // `randomstr` is an anti-replay field; the 收银宝 gateway expects it on the
    // query call just like on the unified-order call.
    let randomstr: String = {
        let mut rng = rand::thread_rng();
        (0..16)
            .map(|_| rng.sample(rand::distributions::Alphanumeric) as char)
            .collect()
    };
    params.insert("randomstr".into(), randomstr);
    params.insert("reqsn".into(), reqsn.to_owned());

    let signature = match &cfg.sign_type {
        AllinpaySignType::Rsa { private_key, .. } => sign_rsa(&params, private_key)?,
        AllinpaySignType::Md5 { key } => sign(&params, key),
    };
    params.insert("sign".into(), signature);

    let body = serde_urlencoded::to_string(&params)
        .map_err(|e| format!("收银宝查单表单编码失败: {e}"))?;
    let client = reqwest::Client::new();
    let resp = client
        .post(&query_url(&cfg.api_url))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("收银宝查单网络错误: {e}"))?;

    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取收银宝查单响应失败: {e}"))?;

    #[derive(Deserialize)]
    struct QueryOrderResponse {
        #[serde(default)]
        retcode: Option<String>,
        #[serde(default)]
        trxstatus: Option<String>,
        #[serde(default)]
        trxid: Option<String>,
    }

    let parsed: QueryOrderResponse = serde_json::from_str(&text)
        .map_err(|e| format!("收银宝查单响应解析失败: {e}（原始: {text}）"))?;

    if parsed.retcode.as_deref() != Some("SUCCESS") {
        // 订单尚未在通联登记 / 查单暂未找到：保持 pending（前几秒可能尚未落库），
        // 后续通联会回 `3088`（超时未支付）时再由本函数标 Failed，诚实反映。
        return Ok(QueryOrderResult::Pending);
    }

    // 通联状态码语义（实测 2026-08-18：用户未付款也会返回 2000+trxid）：
    //   `0000` = 清算成功（唯一真成功，钱已到通联）。
    //   `2000` = 已受理/处理中（用户可能只是扫了码，钱**没到**；无论有无 trxid
    //            都必须保持 pending，等 0000 或 3088/3999 终态——绝不可当成功）。
    //   `3088` = 超时未支付；`3999`/`3089` = 交易失败 —— 终态必须标 Failed。
    //   其余/1001 = 交易不存在或进行中，保持 pending。
    match parsed.trxstatus.as_deref() {
        Some("0000") => Ok(QueryOrderResult::Paid(
            parsed.trxid.filter(|s| !s.is_empty()).unwrap_or_default(),
        )),
        Some("3088") => Ok(QueryOrderResult::Failed("支付超时未付款".into())),
        Some("3999") | Some("3089") => Ok(QueryOrderResult::Failed("交易失败".into())),
        _ => Ok(QueryOrderResult::Pending),
    }
}

/// Verified payment extracted from an async notify callback.
#[derive(Debug, Clone)]
pub struct VerifiedNotify {
    /// Our merchant order number (`cusorderid` in the callback).
    pub reqsn: String,
    /// Allinpay transaction id (`trxid`).
    pub trxid: String,
}

/// Validates an async notify callback.
///
/// Verifies the signature (RSA or MD5, per config), confirms
/// `trxstatus` is `"0000"` (only a settled success finalizes), and extracts
/// the order correlation.
/// Returns `Err` (with a human-readable reason) when the signature is invalid
/// or the transaction did not succeed.
///
/// NOTE: Allinpay notify callbacks include a `sign_type` field that is *not*
/// part of the signed payload, so we remove it before computing/verifying the
/// canonical string.
pub fn verify_notify(
    cfg: &AllinpayConfig,
    params: &BTreeMap<String, String>,
) -> Result<VerifiedNotify, String> {
    let their_sign = params.get("sign").cloned().unwrap_or_default();

    // 通联验签规则（见《新·订单收款聚合码支付》3.2.4 异步通知）：
    //   "获取全量变量，然后遍历获取非空变量" 组装验签原文。
    // 即：**除 `sign` 外的所有非空字段**都要参与签名校验，包括 `sign_type`
    // （通联签名时 `sign_type` 也在原文内）。绝不能按固定字段名逐个取，
    // 否则通联新增字段后验签必败。
    let valid = match &cfg.sign_type {
        AllinpaySignType::Rsa { public_key, .. } => {
            verify_rsa(params, public_key, &their_sign)?
        }
        AllinpaySignType::Md5 { key } => sig_eq(&their_sign, &sign(params, key)),
    };
    if !valid {
        return Err("收银宝通知签名校验失败".into());
    }

    let trxstatus = params.get("trxstatus").map(String::as_str).unwrap_or("");
    let _notify_trxid = params.get("trxid").map(String::as_str).unwrap_or("");
    // 只认 `0000`（清算成功=钱已到通联）为已支付。`2000` 仅代表已受理/处理中
    // （用户扫了码但钱未到，实测 trxid 也会生成），**绝不能**当成功 finalize，
    // 否则又会出现"没付钱却显示支付成功"的假成功。
    let is_paid = trxstatus == "0000";
    if !is_paid {
        return Err(format!("交易未成功: trxstatus={trxstatus}"));
    }

    let reqsn = params.get("cusorderid").cloned().unwrap_or_default();
    if reqsn.is_empty() {
        return Err("收银宝通知缺少 cusorderid".into());
    }

    let trxid = params.get("trxid").cloned().unwrap_or_default();
    Ok(VerifiedNotify { reqsn, trxid })
}
