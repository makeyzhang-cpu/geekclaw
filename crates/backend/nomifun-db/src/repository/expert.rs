use crate::error::DbError;
use crate::models::ExpertRow;
use nomifun_common::{generate_id, now_ms};

/// Expert digital-twin catalog data access.
///
/// A single table (`expert_catalog`) is authoritative on the cloud (web)
/// backend — the admin manages experts there — and is re-upserted idempotently
/// by `slug` on the desktop as read-only `source = 'cloud'` rows via the sync
/// flow. `slug` is the stable cross-device dedup key.
#[async_trait::async_trait]
pub trait IExpertRepository: Send + Sync {
    /// All catalog rows (admin), ordered by sort_order then created_at.
    async fn list_all(&self) -> Result<Vec<ExpertRow>, DbError>;

    /// Only enabled rows (member read / desktop sync source).
    async fn list_enabled(&self) -> Result<Vec<ExpertRow>, DbError>;

    /// Fetch a single row by `slug` or `expert_id`.
    async fn get_by_id_or_slug(&self, id_or_slug: &str) -> Result<Option<ExpertRow>, DbError>;

    /// Insert or update a row idempotently by `slug`. On the cloud backend the
    /// row lands with `source = 'local'` (the admin-owned catalog). Returns the
    /// persisted row.
    async fn upsert(&self, params: UpsertExpertParams) -> Result<ExpertRow, DbError>;

    /// Delete a row by `slug` or `expert_id`.
    async fn delete_by_id_or_slug(&self, id_or_slug: &str) -> Result<(), DbError>;

    /// Desktop sync: upsert a cloud-sourced row (always `source = 'cloud'`).
    async fn upsert_cloud(&self, params: UpsertExpertParams) -> Result<(), DbError>;

    /// Desktop sync: prune cloud-sourced rows whose `slug` is not in `keep_slugs`.
    async fn delete_cloud_not_in(&self, keep_slugs: &[String]) -> Result<u64, DbError>;
}

/// Parameters for [`IExpertRepository::upsert`] / [`IExpertRepository::upsert_cloud`].
#[derive(Debug, Clone)]
pub struct UpsertExpertParams {
    /// Empty on create → a fresh UUIDv7 is minted. Kept on update.
    pub expert_id: String,
    /// Empty on create → generated from `name` (URL-safe, unique).
    pub slug: String,
    pub name: String,
    pub title: String,
    pub description: String,
    pub avatar: Option<String>,
    /// JSON array of tag strings.
    pub tags: String,
    pub category: Option<String>,
    pub price_credits: i64,
    pub persona_custom: String,
    pub persona_preset: String,
    pub default_character: String,
    pub default_model_provider: Option<String>,
    pub default_model: Option<String>,
    /// JSON array of skill names.
    pub default_skills: String,
    pub is_builtin: bool,
    pub creator_id: Option<String>,
    pub enabled: bool,
    pub sort_order: Option<i64>,
    pub memory_seed: String,
    pub knowledge_markdown: String,
    pub learn_enabled: bool,
    pub evolve_enabled: bool,
}

impl Default for UpsertExpertParams {
    fn default() -> Self {
        Self {
            expert_id: String::new(),
            slug: String::new(),
            name: String::new(),
            title: String::new(),
            description: String::new(),
            avatar: None,
            tags: "[]".to_owned(),
            category: None,
            price_credits: 0,
            persona_custom: String::new(),
            persona_preset: "lively".to_owned(),
            default_character: "mochi".to_owned(),
            default_model_provider: None,
            default_model: None,
            default_skills: "[]".to_owned(),
            is_builtin: false,
            creator_id: None,
            enabled: true,
            sort_order: None,
            memory_seed: String::new(),
            knowledge_markdown: String::new(),
            learn_enabled: true,
            evolve_enabled: true,
        }
    }
}

/// URL-safe slug from a display name (lowercase, separators → `-`, strips others).
fn slugify(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut last_was_dash = true;
    for ch in name.trim().to_lowercase().chars() {
        if ch.is_alphanumeric() {
            out.push(ch);
            last_was_dash = false;
        } else if ch == ' ' || ch == '_' || ch == '-' {
            if !last_was_dash {
                out.push('-');
                last_was_dash = true;
            }
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        out.push_str("expert");
    }
    out
}

#[derive(Clone, Debug)]
pub struct SqliteExpertRepository {
    pool: sqlx::SqlitePool,
}

impl SqliteExpertRepository {
    pub fn new(pool: sqlx::SqlitePool) -> Self {
        Self { pool }
    }

    async fn unique_slug(&self, base: &str) -> Result<String, DbError> {
        let mut candidate = base.to_owned();
        for _attempt in 0..100 {
            let exists: bool =
                sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM expert_catalog WHERE slug = ?)")
                    .bind(&candidate)
                    .fetch_one(&self.pool)
                    .await?;
            if !exists {
                return Ok(candidate);
            }
            let suffix = &generate_id()[..8];
            candidate = format!("{base}-{suffix}");
        }
        Err(DbError::Init("unable to generate unique expert slug".into()))
    }
}

const UPSERT_COLUMNS: &str = "expert_id, slug, name, title, description, avatar, tags, category, \
    price_credits, persona_custom, persona_preset, default_character, default_model_provider, \
    default_model, default_skills, is_builtin, creator_id, enabled, sort_order, created_at, \
    memory_seed, knowledge_markdown, learn_enabled, evolve_enabled, source";

#[async_trait::async_trait]
impl IExpertRepository for SqliteExpertRepository {
    async fn list_all(&self) -> Result<Vec<ExpertRow>, DbError> {
        let rows = sqlx::query_as::<_, ExpertRow>(
            "SELECT id, expert_id, slug, name, title, description, avatar, tags, category, \
             price_credits, persona_custom, persona_preset, default_character, \
             default_model_provider, default_model, default_skills, is_builtin, creator_id, \
             enabled, sort_order, created_at, memory_seed, knowledge_markdown, learn_enabled, \
             evolve_enabled, source \
             FROM expert_catalog ORDER BY sort_order ASC, created_at ASC, id ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn list_enabled(&self) -> Result<Vec<ExpertRow>, DbError> {
        let rows = sqlx::query_as::<_, ExpertRow>(
            "SELECT id, expert_id, slug, name, title, description, avatar, tags, category, \
             price_credits, persona_custom, persona_preset, default_character, \
             default_model_provider, default_model, default_skills, is_builtin, creator_id, \
             enabled, sort_order, created_at, memory_seed, knowledge_markdown, learn_enabled, \
             evolve_enabled, source \
             FROM expert_catalog WHERE enabled = 1 ORDER BY sort_order ASC, created_at ASC, id ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    async fn get_by_id_or_slug(&self, id_or_slug: &str) -> Result<Option<ExpertRow>, DbError> {
        let row = sqlx::query_as::<_, ExpertRow>(
            "SELECT id, expert_id, slug, name, title, description, avatar, tags, category, \
             price_credits, persona_custom, persona_preset, default_character, \
             default_model_provider, default_model, default_skills, is_builtin, creator_id, \
             enabled, sort_order, created_at, memory_seed, knowledge_markdown, learn_enabled, \
             evolve_enabled, source \
             FROM expert_catalog WHERE slug = ? OR expert_id = ? LIMIT 1",
        )
        .bind(id_or_slug)
        .bind(id_or_slug)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    async fn upsert(&self, params: UpsertExpertParams) -> Result<ExpertRow, DbError> {
        self.upsert_inner(params, "local").await
    }

    async fn upsert_cloud(&self, params: UpsertExpertParams) -> Result<(), DbError> {
        self.upsert_inner(params, "cloud").await?;
        Ok(())
    }

    async fn delete_by_id_or_slug(&self, id_or_slug: &str) -> Result<(), DbError> {
        sqlx::query("DELETE FROM expert_catalog WHERE slug = ? OR expert_id = ?")
            .bind(id_or_slug)
            .bind(id_or_slug)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete_cloud_not_in(&self, keep_slugs: &[String]) -> Result<u64, DbError> {
        if keep_slugs.is_empty() {
            let rows = sqlx::query("DELETE FROM expert_catalog WHERE source = 'cloud'")
                .execute(&self.pool)
                .await?;
            return Ok(rows.rows_affected());
        }
        // Build a dynamic NOT IN clause; keep_slugs is bounded by the catalog size.
        let placeholders = vec!["?"; keep_slugs.len()].join(",");
        let sql = format!(
            "DELETE FROM expert_catalog WHERE source = 'cloud' AND slug NOT IN ({placeholders})"
        );
        let mut q = sqlx::query(&sql);
        for slug in keep_slugs {
            q = q.bind(slug);
        }
        let rows = q.execute(&self.pool).await?;
        Ok(rows.rows_affected())
    }
}

impl SqliteExpertRepository {
    async fn upsert_inner(
        &self,
        mut params: UpsertExpertParams,
        source: &str,
    ) -> Result<ExpertRow, DbError> {
        let now = now_ms();
        if params.expert_id.is_empty() {
            params.expert_id = generate_id();
        }
        if params.slug.is_empty() {
            params.slug = self.unique_slug(&slugify(&params.name)).await?;
        }

        let existing: Option<ExpertRow> = sqlx::query_as::<_, ExpertRow>(
            "SELECT id, expert_id, slug, name, title, description, avatar, tags, category, \
             price_credits, persona_custom, persona_preset, default_character, \
             default_model_provider, default_model, default_skills, is_builtin, creator_id, \
             enabled, sort_order, created_at, memory_seed, knowledge_markdown, learn_enabled, \
             evolve_enabled, source \
             FROM expert_catalog WHERE slug = ? LIMIT 1",
        )
        .bind(&params.slug)
        .fetch_optional(&self.pool)
        .await?;

        let sort_order = params.sort_order.unwrap_or_else(|| {
            existing.as_ref().map(|e| e.sort_order).unwrap_or(0)
        });

        let row = if let Some(existing) = existing {
            // Keep the stable identity and creation timestamp.
            let expert_id = existing.expert_id;
            let created_at = existing.created_at;
            sqlx::query(&format!(
                "UPDATE expert_catalog SET \
                    name = ?, title = ?, description = ?, avatar = ?, tags = ?, category = ?, \
                    price_credits = ?, persona_custom = ?, persona_preset = ?, \
                    default_character = ?, default_model_provider = ?, default_model = ?, \
                    default_skills = ?, is_builtin = ?, creator_id = ?, enabled = ?, \
                    sort_order = ?, memory_seed = ?, knowledge_markdown = ?, learn_enabled = ?, \
                    evolve_enabled = ?, source = ? \
                 WHERE slug = ?"
            ))
            .bind(&params.name)
            .bind(&params.title)
            .bind(&params.description)
            .bind(&params.avatar)
            .bind(&params.tags)
            .bind(&params.category)
            .bind(params.price_credits)
            .bind(&params.persona_custom)
            .bind(&params.persona_preset)
            .bind(&params.default_character)
            .bind(&params.default_model_provider)
            .bind(&params.default_model)
            .bind(&params.default_skills)
            .bind(params.is_builtin)
            .bind(&params.creator_id)
            .bind(params.enabled)
            .bind(sort_order)
            .bind(&params.memory_seed)
            .bind(&params.knowledge_markdown)
            .bind(params.learn_enabled)
            .bind(params.evolve_enabled)
            .bind(source)
            .bind(&params.slug)
            .execute(&self.pool)
            .await?;
            ExpertRow {
                id: existing.id,
                expert_id,
                slug: params.slug,
                name: params.name,
                title: params.title,
                description: if params.description.is_empty() { None } else { Some(params.description) },
                avatar: params.avatar,
                tags: params.tags,
                category: params.category,
                price_credits: params.price_credits,
                persona_custom: params.persona_custom,
                persona_preset: params.persona_preset,
                default_character: params.default_character,
                default_model_provider: params.default_model_provider,
                default_model: params.default_model,
                default_skills: params.default_skills,
                is_builtin: params.is_builtin,
                creator_id: params.creator_id,
                enabled: params.enabled,
                sort_order,
                created_at,
                memory_seed: params.memory_seed,
                knowledge_markdown: params.knowledge_markdown,
                learn_enabled: params.learn_enabled,
                evolve_enabled: params.evolve_enabled,
                source: source.to_owned(),
            }
        } else {
            // sort_order default to append at the end when not supplied.
            let sort_order = if params.sort_order.is_none() {
                sqlx::query_scalar::<_, i64>(
                    "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM expert_catalog",
                )
                .fetch_one(&self.pool)
                .await?
            } else {
                sort_order
            };
            sqlx::query(&format!(
                "INSERT INTO expert_catalog ({UPSERT_COLUMNS}) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            ))
            .bind(&params.expert_id)
            .bind(&params.slug)
            .bind(&params.name)
            .bind(&params.title)
            .bind(&params.description)
            .bind(&params.avatar)
            .bind(&params.tags)
            .bind(&params.category)
            .bind(params.price_credits)
            .bind(&params.persona_custom)
            .bind(&params.persona_preset)
            .bind(&params.default_character)
            .bind(&params.default_model_provider)
            .bind(&params.default_model)
            .bind(&params.default_skills)
            .bind(params.is_builtin)
            .bind(&params.creator_id)
            .bind(params.enabled)
            .bind(sort_order)
            .bind(now)
            .bind(&params.memory_seed)
            .bind(&params.knowledge_markdown)
            .bind(params.learn_enabled)
            .bind(params.evolve_enabled)
            .bind(source)
            .execute(&self.pool)
            .await?;
            let id = sqlx::query_scalar("SELECT id FROM expert_catalog WHERE slug = ?")
                .bind(&params.slug)
                .fetch_one(&self.pool)
                .await?;
            ExpertRow {
                id,
                expert_id: params.expert_id,
                slug: params.slug,
                name: params.name,
                title: params.title,
                description: if params.description.is_empty() { None } else { Some(params.description) },
                avatar: params.avatar,
                tags: params.tags,
                category: params.category,
                price_credits: params.price_credits,
                persona_custom: params.persona_custom,
                persona_preset: params.persona_preset,
                default_character: params.default_character,
                default_model_provider: params.default_model_provider,
                default_model: params.default_model,
                default_skills: params.default_skills,
                is_builtin: params.is_builtin,
                creator_id: params.creator_id,
                enabled: params.enabled,
                sort_order,
                created_at: now,
                memory_seed: params.memory_seed,
                knowledge_markdown: params.knowledge_markdown,
                learn_enabled: params.learn_enabled,
                evolve_enabled: params.evolve_enabled,
                source: source.to_owned(),
            }
        };
        Ok(row)
    }
}
