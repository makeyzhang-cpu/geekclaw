use crate::error::DbError;
use crate::models::CloudProviderRow;

/// Cloud-managed model provider catalog data access.
///
/// The catalog lives in the central web backend; admin CRUD encrypts the API
/// key at rest with the cloud's data-encryption key. The member endpoint
/// decrypts before returning, so this repository only ever stores/returns the
/// already-encrypted form.
#[async_trait::async_trait]
pub trait ICloudProviderRepository: Send + Sync {
    /// All catalog rows, regardless of `is_public`.
    async fn list_all(&self) -> Result<Vec<CloudProviderRow>, DbError>;

    /// Only rows flagged `is_public = 1` (eligible for member sync).
    async fn list_public(&self) -> Result<Vec<CloudProviderRow>, DbError>;

    /// Fetch a single row by its stable `provider_key`.
    async fn get_by_key(&self, key: &str) -> Result<Option<CloudProviderRow>, DbError>;

    /// Insert or update a row by `provider_key` (idempotent by key).
    ///
    /// `api_key_encrypted` is expected to already be encrypted by the caller
    /// with the cloud's data-encryption key.
    async fn upsert_by_key(&self, params: UpsertCloudProviderParams<'_>) -> Result<CloudProviderRow, DbError>;

    /// Delete a row by `provider_key`.
    async fn delete_by_key(&self, key: &str) -> Result<(), DbError>;
}

/// Parameters for [`ICloudProviderRepository::upsert_by_key`].
#[derive(Debug)]
pub struct UpsertCloudProviderParams<'a> {
    pub provider_key: &'a str,
    pub name: &'a str,
    pub platform: &'a str,
    pub base_url: &'a str,
    /// Already encrypted with the cloud's data-encryption key.
    pub api_key_encrypted: &'a str,
    pub is_public: bool,
    pub is_full_url: bool,
    /// JSON array of model names.
    pub models: &'a str,
    pub sort_order: Option<i64>,
}

#[derive(Clone, Debug)]
pub struct SqliteCloudProviderRepository {
    pool: sqlx::SqlitePool,
}

impl SqliteCloudProviderRepository {
    pub fn new(pool: sqlx::SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait::async_trait]
impl ICloudProviderRepository for SqliteCloudProviderRepository {
    async fn list_all(&self) -> Result<Vec<CloudProviderRow>, DbError> {
        let rows = sqlx::query_as::<_, CloudProviderRow>(
            "SELECT * FROM cloud_provider_catalog \
             ORDER BY sort_order ASC, created_at ASC, id ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn list_public(&self) -> Result<Vec<CloudProviderRow>, DbError> {
        let rows = sqlx::query_as::<_, CloudProviderRow>(
            "SELECT * FROM cloud_provider_catalog WHERE is_public = 1 \
             ORDER BY sort_order ASC, created_at ASC, id ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn get_by_key(&self, key: &str) -> Result<Option<CloudProviderRow>, DbError> {
        let row = sqlx::query_as::<_, CloudProviderRow>(
            "SELECT * FROM cloud_provider_catalog WHERE provider_key = ?",
        )
        .bind(key)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    async fn upsert_by_key(&self, params: UpsertCloudProviderParams<'_>) -> Result<CloudProviderRow, DbError> {
        let now = nomifun_common::now_ms();
        let sort_order = match params.sort_order {
            Some(value) => value,
            None => sqlx::query_scalar::<_, i64>(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM cloud_provider_catalog",
            )
            .fetch_one(&self.pool)
            .await?,
        };

        let existing: Option<CloudProviderRow> = sqlx::query_as::<_, CloudProviderRow>(
            "SELECT * FROM cloud_provider_catalog WHERE provider_key = ?",
        )
        .bind(params.provider_key)
        .fetch_optional(&self.pool)
        .await?;

        let row = if let Some(existing) = existing {
            sqlx::query(
                "UPDATE cloud_provider_catalog SET \
                    name = ?, platform = ?, base_url = ?, api_key_encrypted = ?, \
                    is_public = ?, is_full_url = ?, models = ?, sort_order = ?, updated_at = ? \
                 WHERE provider_key = ?",
            )
            .bind(params.name)
            .bind(params.platform)
            .bind(params.base_url)
            .bind(params.api_key_encrypted)
            .bind(params.is_public)
            .bind(params.is_full_url)
            .bind(params.models)
            .bind(sort_order)
            .bind(now)
            .bind(params.provider_key)
            .execute(&self.pool)
            .await?;
            CloudProviderRow {
                id: existing.id,
                provider_key: params.provider_key.to_string(),
                name: params.name.to_string(),
                platform: params.platform.to_string(),
                base_url: params.base_url.to_string(),
                api_key_encrypted: params.api_key_encrypted.to_string(),
                is_public: params.is_public,
                is_full_url: params.is_full_url,
                models: params.models.to_string(),
                sort_order,
                created_at: existing.created_at,
                updated_at: now,
            }
        } else {
            sqlx::query(
                "INSERT INTO cloud_provider_catalog \
                    (provider_key, name, platform, base_url, api_key_encrypted, \
                     is_public, is_full_url, models, sort_order, created_at, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(params.provider_key)
            .bind(params.name)
            .bind(params.platform)
            .bind(params.base_url)
            .bind(params.api_key_encrypted)
            .bind(params.is_public)
            .bind(params.is_full_url)
            .bind(params.models)
            .bind(sort_order)
            .bind(now)
            .bind(now)
            .execute(&self.pool)
            .await?;
            let id = sqlx::query_scalar("SELECT id FROM cloud_provider_catalog WHERE provider_key = ?")
                .bind(params.provider_key)
                .fetch_one(&self.pool)
                .await?;
            CloudProviderRow {
                id,
                provider_key: params.provider_key.to_string(),
                name: params.name.to_string(),
                platform: params.platform.to_string(),
                base_url: params.base_url.to_string(),
                api_key_encrypted: params.api_key_encrypted.to_string(),
                is_public: params.is_public,
                is_full_url: params.is_full_url,
                models: params.models.to_string(),
                sort_order,
                created_at: now,
                updated_at: now,
            }
        };
        Ok(row)
    }

    async fn delete_by_key(&self, key: &str) -> Result<(), DbError> {
        sqlx::query("DELETE FROM cloud_provider_catalog WHERE provider_key = ?")
            .bind(key)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_database_memory;

    async fn setup() -> SqliteCloudProviderRepository {
        let db = init_database_memory().await.unwrap();
        SqliteCloudProviderRepository::new(db.pool().clone())
    }

    fn sample() -> UpsertCloudProviderParams<'static> {
        UpsertCloudProviderParams {
            provider_key: "geekclawai",
            name: "GeekClawAI",
            platform: "dashscope",
            base_url: "https://api.llm-token.cn/v1",
            api_key_encrypted: "enc:sample",
            is_public: true,
            is_full_url: false,
            models: r#"["gpt-4o","gpt-4o-mini"]"#,
            sort_order: None,
        }
    }

    #[tokio::test]
    async fn upsert_then_get_and_list_public() {
        let repo = setup().await;
        repo.upsert_by_key(sample()).await.unwrap();
        let got = repo.get_by_key("geekclawai").await.unwrap().unwrap();
        assert_eq!(got.platform, "dashscope");
        assert_eq!(got.is_public, true);
        let public = repo.list_public().await.unwrap();
        assert_eq!(public.len(), 1);
        let all = repo.list_all().await.unwrap();
        assert_eq!(all.len(), 1);
    }

    #[tokio::test]
    async fn upsert_is_idempotent_by_key() {
        let repo = setup().await;
        repo.upsert_by_key(sample()).await.unwrap();
        repo.upsert_by_key(UpsertCloudProviderParams {
            name: "GeekClawAI v2",
            ..sample()
        })
        .await
        .unwrap();
        let all = repo.list_all().await.unwrap();
        assert_eq!(all.len(), 1, "key collision must update, not insert");
        assert_eq!(all[0].name, "GeekClawAI v2");
    }

    #[tokio::test]
    async fn delete_by_key_removes_row() {
        let repo = setup().await;
        repo.upsert_by_key(sample()).await.unwrap();
        repo.delete_by_key("geekclawai").await.unwrap();
        assert!(repo.get_by_key("geekclawai").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn non_public_is_excluded_from_list_public() {
        let repo = setup().await;
        repo.upsert_by_key(UpsertCloudProviderParams {
            is_public: false,
            ..sample()
        })
        .await
        .unwrap();
        assert!(repo.list_public().await.unwrap().is_empty());
        assert_eq!(repo.list_all().await.unwrap().len(), 1);
    }
}
