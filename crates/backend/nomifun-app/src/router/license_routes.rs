//! Offline license activation (local, no backend server required).
//!
//! License keys are symmetric-MAC signed tokens: `SHA-256(secret ‖ message)`
//! over a canonical message string. This is intentionally *soft* DRM suited
//! to an offline, single-user desktop app — it can later be swapped for a
//! backend-issued signature / payment-verified license without changing the
//! frontend contract (`GET /api/license/status`, `POST /api/license/activate`,
//! `POST /api/license/deactivate`).
//!
//! Activation state is persisted as a plain JSON file (`license.json`) in the
//! application data directory — deliberately NOT a database table, so it
//! carries no v3 schema/contract obligations.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Canonical product secret for offline license signing. In production this is
/// replaced by a backend-issued signature (the frontend contract is unchanged).
const LICENSE_SECRET: &[u8] = b"geekclaw-offline-license-secret-v1";
const KEY_PREFIX: &str = "GEEK";
const SEP: char = '*';

#[derive(Clone)]
pub struct LicenseState {
    data_dir: PathBuf,
}

impl LicenseState {
    pub fn new(data_dir: PathBuf) -> Self {
        Self { data_dir }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LicenseInfo {
    pub active: bool,
    pub edition: String,
    pub features: Vec<String>,
    pub issued_at: i64,
    pub expires_at: i64,
    pub activated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct LicenseStatus {
    pub active: bool,
    pub edition: Option<String>,
    pub features: Vec<String>,
    pub expires_at: Option<i64>,
    pub activated_at: Option<i64>,
}

#[derive(Deserialize)]
pub struct ActivateRequest {
    pub key: String,
}

#[derive(Serialize)]
pub struct ActivateResponse {
    pub success: bool,
    pub message: String,
    pub status: LicenseStatus,
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len() / 2);
    let mut i = 0;
    while i < bytes.len() {
        let hi = (bytes[i] as char).to_digit(16)?;
        let lo = (bytes[i + 1] as char).to_digit(16)?;
        out.push(((hi << 4) | lo) as u8);
        i += 2;
    }
    Some(out)
}

/// Constant-time(ish) comparison to avoid trivial timing leaks on the MAC.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Build the canonical signed message. Field order is fixed and the features
/// list is sorted, so Python and Rust produce byte-identical strings.
/// Format: `geekclaw-license|1|<edition>|<iat>|<exp>|<features>`
/// (`features` sorted and `;` joined; each `[a-z0-9-]`).
fn build_message(edition: &str, iat: i64, exp: i64, features: &[String]) -> String {
    let mut feats: Vec<&str> = features.iter().map(|s| s.as_str()).collect();
    feats.sort_unstable();
    let feats_joined = feats.join(";");
    format!("geekclaw-license|1|{edition}|{iat}|{exp}|{feats_joined}")
}

fn sign_message(message: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(LICENSE_SECRET);
    hasher.update(message.as_bytes());
    hex_encode(&hasher.finalize())
}

#[derive(Debug)]
enum LicenseError {
    Malformed,
    InvalidSignature,
    Expired,
}

fn parse_key(key: &str) -> Result<(String, i64, i64, Vec<String>), LicenseError> {
    let trimmed = key.trim();
    let rest = trimmed
        .strip_prefix(KEY_PREFIX)
        .and_then(|s| s.strip_prefix(SEP))
        .ok_or(LicenseError::Malformed)?;
    let mut parts = rest.splitn(2, SEP);
    let body_hex = parts.next().ok_or(LicenseError::Malformed)?;
    let sig = parts.next().ok_or(LicenseError::Malformed)?;

    let body = hex_decode(body_hex).ok_or(LicenseError::Malformed)?;
    let message = String::from_utf8(body).map_err(|_| LicenseError::Malformed)?;

    let expected_sig = sign_message(&message);
    if !constant_time_eq(expected_sig.as_bytes(), sig.as_bytes()) {
        return Err(LicenseError::InvalidSignature);
    }

    let fields: Vec<&str> = message.split('|').collect();
    if fields.len() != 6 || fields[0] != "geekclaw-license" || fields[1] != "1" {
        return Err(LicenseError::Malformed);
    }
    let edition = fields[2].to_string();
    let iat: i64 = fields[3].parse().map_err(|_| LicenseError::Malformed)?;
    let exp: i64 = fields[4].parse().map_err(|_| LicenseError::Malformed)?;
    let features: Vec<String> = if fields[5].is_empty() {
        Vec::new()
    } else {
        fields[5].split(';').map(|s| s.to_string()).collect()
    };

    if exp != 0 && exp <= now_secs() {
        return Err(LicenseError::Expired);
    }

    Ok((edition, iat, exp, features))
}

fn license_path(data_dir: &Path) -> PathBuf {
    data_dir.join("license.json")
}

fn read_license(state: &LicenseState) -> Option<LicenseInfo> {
    let path = license_path(&state.data_dir);
    let content = std::fs::read_to_string(path).ok()?;
    let info: LicenseInfo = serde_json::from_str(&content).ok()?;
    if info.expires_at != 0 && info.expires_at <= now_secs() {
        // Expired activation: treat as inactive and clean up the stale file.
        let _ = std::fs::remove_file(license_path(&state.data_dir));
        return None;
    }
    Some(info)
}

fn status_from_info(info: Option<&LicenseInfo>) -> LicenseStatus {
    match info {
        Some(i) => LicenseStatus {
            active: true,
            edition: Some(i.edition.clone()),
            features: i.features.clone(),
            expires_at: if i.expires_at == 0 { None } else { Some(i.expires_at) },
            activated_at: Some(i.activated_at),
        },
        None => LicenseStatus {
            active: false,
            edition: None,
            features: Vec::new(),
            expires_at: None,
            activated_at: None,
        },
    }
}

fn inactive_response(message: &str) -> (StatusCode, Json<ActivateResponse>) {
    (
        StatusCode::BAD_REQUEST,
        Json(ActivateResponse {
            success: false,
            message: message.to_string(),
            status: LicenseStatus::default(),
        }),
    )
}

pub async fn license_status(State(state): State<LicenseState>) -> Json<LicenseStatus> {
    Json(status_from_info(read_license(&state).as_ref()))
}

pub async fn activate_license(
    State(state): State<LicenseState>,
    Json(req): Json<ActivateRequest>,
) -> (StatusCode, Json<ActivateResponse>) {
    let (edition, iat, exp, features) = match parse_key(&req.key) {
        Ok(parsed) => parsed,
        Err(LicenseError::Expired) => return inactive_response("license_expired"),
        Err(_) => return inactive_response("license_invalid"),
    };

    let info = LicenseInfo {
        active: true,
        edition,
        features,
        issued_at: iat,
        expires_at: exp,
        activated_at: now_secs(),
    };

    let path = license_path(&state.data_dir);
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            tracing::error!(error = %e, "license: failed to create data dir");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ActivateResponse {
                    success: false,
                    message: "write_failed".to_string(),
                    status: LicenseStatus::default(),
                }),
            );
        }
    }

    let json = match serde_json::to_string_pretty(&info) {
        Ok(j) => j,
        Err(e) => {
            tracing::error!(error = %e, "license: failed to serialize");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ActivateResponse {
                    success: false,
                    message: "serialize_failed".to_string(),
                    status: LicenseStatus::default(),
                }),
            );
        }
    };

    if let Err(e) = std::fs::write(&path, json) {
        tracing::error!(error = %e, "license: failed to write license file");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ActivateResponse {
                success: false,
                message: "write_failed".to_string(),
                status: LicenseStatus::default(),
            }),
        );
    }

    (
        StatusCode::OK,
        Json(ActivateResponse {
            success: true,
            message: "activated".to_string(),
            status: status_from_info(Some(&info)),
        }),
    )
}

pub async fn deactivate_license(State(state): State<LicenseState>) -> Json<LicenseStatus> {
    let _ = std::fs::remove_file(license_path(&state.data_dir));
    Json(LicenseStatus::default())
}

pub fn license_routes(state: LicenseState) -> Router {
    Router::new()
        .route("/api/license/status", get(license_status))
        .route("/api/license/activate", post(activate_license))
        .route("/api/license/deactivate", post(deactivate_license))
        .with_state(state)
}
