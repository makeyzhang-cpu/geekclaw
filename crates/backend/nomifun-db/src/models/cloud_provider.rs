use nomifun_common::TimestampMs;
use serde::{Deserialize, Serialize};

/// Row mapping for the `cloud_provider_catalog` table.
///
/// Cloud-managed model providers configured by the admin in the central web
/// backend. `api_key_encrypted` is encrypted at rest with the cloud's
/// data-encryption key; the member endpoint decrypts and returns the plaintext
/// over the authenticated TLS channel for the desktop to re-encrypt locally.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct CloudProviderRow {
    pub id: i64,
    pub provider_key: String,
    pub name: String,
    pub platform: String,
    pub base_url: String,
    pub api_key_encrypted: String,
    pub is_public: bool,
    pub is_full_url: bool,
    /// JSON array of model names materialized as `provider_models` rows on sync.
    pub models: String,
    pub sort_order: i64,
    pub created_at: TimestampMs,
    pub updated_at: TimestampMs,
}
