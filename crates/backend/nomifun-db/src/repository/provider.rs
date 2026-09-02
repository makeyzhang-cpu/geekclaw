use crate::error::DbError;
use crate::models::Provider;

/// Model provider data access abstraction.
///
/// Provides CRUD operations on the `providers` table.
/// API keys are stored encrypted; callers handle encryption/decryption.
#[async_trait::async_trait]
pub trait IProviderRepository: Send + Sync {
    /// Returns all providers, ordered by creation time ascending.
    async fn list(&self) -> Result<Vec<Provider>, DbError>;

    /// Finds a provider by ID, or `None` if not found.
    async fn find_by_id(&self, id: &str) -> Result<Option<Provider>, DbError>;

    /// Creates a new provider and returns the inserted row.
    async fn create(&self, params: CreateProviderParams<'_>) -> Result<Provider, DbError>;

    /// Updates an existing provider. Returns `DbError::NotFound` if the ID doesn't exist.
    async fn update(&self, id: &str, params: UpdateProviderParams<'_>) -> Result<Provider, DbError>;

    /// Deletes a provider by ID. Returns `DbError::NotFound` if the ID doesn't exist.
    async fn delete(&self, id: &str) -> Result<(), DbError>;

    /// Idempotently upsert a cloud-synced provider row keyed by `cloud_key`.
    ///
    /// An existing `source = 'cloud'` row with the same `cloud_key` is updated
    /// in place (its `provider_id` is preserved); otherwise a new row with a
    /// fresh UUIDv7 `provider_id` is created. The per-model surface is
    /// re-materialized from `models` on every sync.
    async fn upsert_cloud_provider(
        &self,
        params: UpsertCloudProviderLocalParams<'_>,
    ) -> Result<Provider, DbError>;

    /// Remove local `source = 'cloud'` providers whose `cloud_key` is NOT in
    /// `keep_keys`. Returns the number of providers deleted (their
    /// `provider_models` rows are cascade-cleared). Pass an empty slice to
    /// clear every cloud provider (admin removed them all server-side).
    async fn delete_cloud_providers_not_in(&self, keep_keys: &[String]) -> Result<u64, DbError>;
}

/// Parameters for creating a new provider.
///
/// `models` and the four per-model map params (`model_context_limits`,
/// `model_protocols`, `model_descriptions`, `model_enabled`) are wire-compat
/// INPUTS only: migration 016 dropped the matching providers columns, so
/// these params feed exclusively the `provider_models` row sync
/// (`sync_provider_models_tx`) — one row per `models` entry, mirrored columns
/// seeded from the maps. They are never persisted on the providers row.
///
/// There is deliberately no `model_health` param: since P3 the server-side
/// health probe (`IProviderModelRepository::set_health`) is the only health
/// writer, and no `capabilities` param: migration 017 dropped the column.
#[derive(Debug)]
pub struct CreateProviderParams<'a> {
    /// Optional caller-supplied stable business ID.
    pub provider_id: Option<&'a str>,
    pub platform: &'a str,
    pub name: &'a str,
    pub base_url: &'a str,
    pub api_key_encrypted: &'a str,
    pub models: &'a str,
    pub enabled: bool,
    pub model_context_limits: Option<&'a str>,
    pub model_protocols: Option<&'a str>,
    pub model_descriptions: Option<&'a str>,
    pub model_enabled: Option<&'a str>,
    pub bedrock_config: Option<&'a str>,
    pub is_full_url: bool,
    /// Optional explicit provider priority. Omitted means append after current max.
    pub sort_order: Option<i64>,
}

/// Parameters for updating an existing provider.
///
/// All fields are optional; `None` means "keep the current value".
///
/// Like [`CreateProviderParams`], `models` and the four per-model map params
/// are wire-compat INPUTS that only drive the `provider_models` row sync:
/// `models: Some` replaces membership (insert new rows, delete removed,
/// re-index survivors); a map param `Some(...)` is a whole-map replacement of
/// that mirrored column across ALL rows (`Some(None)` = empty map → column
/// defaults); a map param `None` leaves existing rows untouched. Health is
/// intentionally not updatable here — `set_health` is the only write path.
#[derive(Debug, Default)]
pub struct UpdateProviderParams<'a> {
    pub platform: Option<&'a str>,
    pub name: Option<&'a str>,
    pub base_url: Option<&'a str>,
    pub api_key_encrypted: Option<&'a str>,
    pub models: Option<&'a str>,
    pub enabled: Option<bool>,
    pub model_context_limits: Option<Option<&'a str>>,
    pub model_protocols: Option<Option<&'a str>>,
    pub model_descriptions: Option<Option<&'a str>>,
    pub model_enabled: Option<Option<&'a str>>,
    pub bedrock_config: Option<Option<&'a str>>,
    pub is_full_url: Option<bool>,
    pub sort_order: Option<i64>,
}

/// Parameters for upserting a cloud-synced provider row on the desktop.
///
/// `api_key_encrypted` is expected to already be encrypted with the *local*
/// data-encryption key (the sync handler decrypts the cloud plaintext and
/// re-encrypts locally before calling this). `cloud_key` is the stable dedup
/// key; an existing row with the same `cloud_key` is updated in place,
/// otherwise a fresh UUIDv7 `provider_id` is minted.
pub struct UpsertCloudProviderLocalParams<'a> {
    pub cloud_key: &'a str,
    pub platform: &'a str,
    pub name: &'a str,
    pub base_url: &'a str,
    /// Already encrypted with the local data-encryption key.
    pub api_key_encrypted: &'a str,
    pub is_full_url: bool,
    /// JSON array of model names.
    pub models: &'a str,
    pub sort_order: Option<i64>,
}
