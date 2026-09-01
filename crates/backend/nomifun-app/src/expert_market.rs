//! 专家数字分身市场（GeekClaw 任务 F）。
//!
//! 把 `expert_catalog` 里的专家雇佣成「数字分身伙伴」Companion 实例：
//!   GET  /api/experts            — 市场列表（可按分类/关键词过滤，带 is_owned）
//!   GET  /api/experts/:id        — 专家详情（:id 支持 slug 或 expert_id）
//!   POST /api/experts/:id/hire   — 雇佣：扣积分 → 创建 Companion → 注入人格/技能/模型 → 记授权
//!   GET  /api/experts/mine       — 我雇佣的专家（含 companion_ref 可跳转到数字分身）
//!   POST /api/experts            — 创建自定义专家（落 catalog，is_builtin=0）
//!
//! 经济闭环复用 `IUserRepository::add_credits`（tx_type = "hire_expert"），
//! 数字分身复用 `nomifun_companion::CompanionService`（零新 schema）。

use std::collections::HashSet;
use std::sync::Arc;

use axum::Router;
use axum::extract::{Path, Query, State};
use axum::response::Json;
use axum::routing::{get, post};
use nomifun_api_types::ApiResponse;
use nomifun_common::{AppError, generate_id, now_ms};
use nomifun_db::IUserRepository;
use serde::Deserialize;
use serde_json::json;
use sqlx::SqlitePool;

/// 路由状态：复用 CompanionService（建数字分身）+ user_repo（扣积分）+ pool（查目录/授权）。
#[derive(Clone)]
pub struct ExpertMarketRouterState {
    pub pool: SqlitePool,
    pub user_repo: Arc<dyn IUserRepository>,
    pub companion_service: Arc<nomifun_companion::CompanionService>,
    /// 桌面单所有者场景下的权威用户 ID（与安装所有者一致）。
    pub owner_user_id: Arc<str>,
}

/// 市场卡片摘要。
#[derive(serde::Serialize)]
pub struct ExpertSummary {
    pub expert_id: String,
    pub slug: String,
    pub name: String,
    pub title: String,
    pub description: Option<String>,
    pub avatar: Option<String>,
    pub tags: Vec<String>,
    pub category: Option<String>,
    pub price_credits: i64,
    pub is_owned: bool,
}

/// 专家详情。
#[derive(serde::Serialize)]
pub struct ExpertDetail {
    pub expert_id: String,
    pub slug: String,
    pub name: String,
    pub title: String,
    pub description: Option<String>,
    pub avatar: Option<String>,
    pub tags: Vec<String>,
    pub category: Option<String>,
    pub price_credits: i64,
    pub persona_custom: String,
    pub persona_preset: String,
    pub default_character: String,
    pub default_model: Option<String>,
    pub default_model_provider: Option<String>,
    pub default_skills: Vec<String>,
    pub is_owned: bool,
}

/// 雇佣结果。
#[derive(serde::Serialize)]
pub struct HireResponse {
    pub expert_id: String,
    pub license_id: String,
    pub companion_id: String,
    pub balance: i64,
    pub already_owned: bool,
}

/// 「我的专家」条目（含可跳转的数字分身引用）。
#[derive(serde::Serialize)]
pub struct MyExpert {
    pub expert_id: String,
    pub slug: String,
    pub name: String,
    pub title: String,
    pub avatar: Option<String>,
    pub category: Option<String>,
    pub companion_ref: String,
    pub purchased_at: i64,
}

#[derive(sqlx::FromRow)]
struct ExpertCatalogRow {
    expert_id: String,
    slug: String,
    name: String,
    title: String,
    description: Option<String>,
    avatar: Option<String>,
    tags: String,
    category: Option<String>,
    price_credits: i64,
    persona_custom: String,
    persona_preset: String,
    default_character: String,
    default_model: Option<String>,
    default_model_provider: Option<String>,
    default_skills: String,
}

#[derive(Deserialize)]
struct ListQuery {
    category: Option<String>,
    q: Option<String>,
    /// 列表范围：`all`（默认）| `builtin` 内置 | `custom` 当前用户自定义。
    scope: Option<String>,
}

/// 创建自定义专家请求。
#[derive(Deserialize)]
struct CreateExpertRequest {
    name: String,
    title: String,
    description: Option<String>,
    tags: Vec<String>,
    category: Option<String>,
    #[serde(default)]
    price_credits: i64,
    #[serde(default)]
    persona_custom: String,
    #[serde(default = "default_persona_preset")]
    persona_preset: String,
    #[serde(default = "default_character")]
    default_character: String,
    default_model: Option<String>,
    default_model_provider: Option<String>,
    #[serde(default)]
    default_skills: Vec<String>,
}

fn default_persona_preset() -> String {
    "lively".to_owned()
}

fn default_character() -> String {
    "mochi".to_owned()
}

/// 构造路由。
pub fn expert_market_routes(state: ExpertMarketRouterState) -> Router {
    Router::new()
        .route("/api/experts", get(list_experts).post(create_expert))
        .route("/api/experts/mine", get(my_experts))
        .route("/api/experts/{id}", get(expert_detail))
        .route("/api/experts/{id}/hire", post(hire_expert))
        .with_state(state)
}

/// 把 TEXT(JSON 数组) 安全地解析为 Vec<String>，失败返回空。
fn parse_json_string_array(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw)
        .unwrap_or_default()
        .into_iter()
        .filter(|s| !s.trim().is_empty())
        .collect()
}

/// 把专家名称转换成 URL-safe slug（小写、空格/下划线变连字符、去非字母数字）。
fn slugify(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut last_was_dash = true; // 避免开头和连续连字符
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
    // 去掉尾部连字符
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        out.push_str("expert");
    }
    out
}

/// 确保 slug 唯一：若已存在则在尾部追加短随机后缀。
async fn unique_slug(pool: &SqlitePool, base: &str) -> Result<String, AppError> {
    let mut candidate = base.to_owned();
    for _attempt in 0..100 {
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM expert_catalog WHERE slug = ?)")
                .bind(&candidate)
                .fetch_one(pool)
                .await
                .map_err(|e| AppError::Internal(format!("check slug failed: {e}")))?;
        if !exists {
            return Ok(candidate);
        }
        let suffix = &generate_id()[..8];
        candidate = format!("{base}-{suffix}");
    }
    Err(AppError::Internal("unable to generate unique expert slug".into()))
}

async fn owned_expert_ids(pool: &SqlitePool, user_id: &str) -> HashSet<String> {
    let rows: Vec<String> = sqlx::query_scalar(
        "SELECT expert_id FROM user_expert_licenses WHERE user_id = ?",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    rows.into_iter().collect()
}

async fn list_experts(
    State(state): State<ExpertMarketRouterState>,
    Query(query): Query<ListQuery>,
) -> Result<Json<ApiResponse<Vec<ExpertSummary>>>, AppError> {
    let mut sql = String::from(
        "SELECT expert_id, slug, name, title, description, avatar, tags, category, \
         price_credits, persona_custom, persona_preset, default_character, \
         default_model, default_model_provider, default_skills \
         FROM expert_catalog WHERE enabled = 1",
    );
    let mut binds: Vec<String> = Vec::new();
    if let Some(category) = &query.category
        && !category.is_empty()
    {
        sql.push_str(" AND category = ?");
        binds.push(category.clone());
    }
    match query.scope.as_deref() {
        Some("builtin") => sql.push_str(" AND is_builtin = 1"),
        Some("custom") => {
            sql.push_str(" AND is_builtin = 0 AND creator_id = ?");
            binds.push(state.owner_user_id.to_string());
        }
        _ => {}
    }
    if let Some(q) = &query.q
        && !q.is_empty()
    {
        sql.push_str(
            " AND (name LIKE ? OR title LIKE ? OR description LIKE ? OR tags LIKE ?)",
        );
        let like = format!("%{q}%");
        binds.push(like.clone());
        binds.push(like.clone());
        binds.push(like.clone());
        binds.push(like);
    }
    sql.push_str(" ORDER BY sort_order ASC, created_at ASC");

    let mut q = sqlx::query_as::<_, ExpertCatalogRow>(&sql);
    for bind in &binds {
        q = q.bind(bind);
    }
    let rows = q
        .fetch_all(&state.pool)
        .await
        .map_err(|e| AppError::Internal(format!("load expert catalog failed: {e}")))?;

    let owned = owned_expert_ids(&state.pool, &state.owner_user_id).await;
    let items = rows
        .into_iter()
        .map(|r| ExpertSummary {
            is_owned: owned.contains(&r.expert_id),
            expert_id: r.expert_id,
            slug: r.slug,
            name: r.name,
            title: r.title,
            description: r.description,
            avatar: r.avatar,
            tags: parse_json_string_array(&r.tags),
            category: r.category,
            price_credits: r.price_credits,
        })
        .collect();

    Ok(Json(ApiResponse::ok(items)))
}

async fn expert_detail(
    State(state): State<ExpertMarketRouterState>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<ExpertDetail>>, AppError> {
    let row: Option<ExpertCatalogRow> = sqlx::query_as::<_, ExpertCatalogRow>(
        "SELECT expert_id, slug, name, title, description, avatar, tags, category, \
         price_credits, persona_custom, persona_preset, default_character, \
         default_model, default_model_provider, default_skills \
         FROM expert_catalog WHERE (slug = ? OR expert_id = ?) AND enabled = 1",
    )
    .bind(&id)
    .bind(&id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| AppError::Internal(format!("load expert failed: {e}")))?;

    let row = row.ok_or_else(|| AppError::NotFound(format!("expert '{id}' not found")))?;
    let owned = owned_expert_ids(&state.pool, &state.owner_user_id).await;
    Ok(Json(ApiResponse::ok(ExpertDetail {
        is_owned: owned.contains(&row.expert_id),
        expert_id: row.expert_id,
        slug: row.slug,
        name: row.name,
        title: row.title,
        description: row.description,
        avatar: row.avatar,
        tags: parse_json_string_array(&row.tags),
        category: row.category,
        price_credits: row.price_credits,
        persona_custom: row.persona_custom,
        persona_preset: row.persona_preset,
        default_character: row.default_character,
        default_model: row.default_model,
        default_model_provider: row.default_model_provider,
        default_skills: parse_json_string_array(&row.default_skills),
    })))
}

async fn hire_expert(
    State(state): State<ExpertMarketRouterState>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<HireResponse>>, AppError> {
    let user_id = state.owner_user_id.to_string();

    let row: ExpertCatalogRow = sqlx::query_as::<_, ExpertCatalogRow>(
        "SELECT expert_id, slug, name, title, description, avatar, tags, category, \
         price_credits, persona_custom, persona_preset, default_character, \
         default_model, default_model_provider, default_skills \
         FROM expert_catalog WHERE (slug = ? OR expert_id = ?) AND enabled = 1",
    )
    .bind(&id)
    .bind(&id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| AppError::Internal(format!("load expert failed: {e}")))?
    .ok_or_else(|| AppError::NotFound(format!("expert '{id}' not found")))?;

    // 幂等：已雇佣则直接返回既有的数字分身（不重复扣费 / 不重复建实例）。
    if let Some(existing) = sqlx::query_as::<_, (String, String)>(
        "SELECT license_id, companion_ref FROM user_expert_licenses \
         WHERE user_id = ? AND expert_id = ?",
    )
    .bind(&user_id)
    .bind(&row.expert_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| AppError::Internal(format!("check license failed: {e}")))?
    {
        let balance = current_balance(&state, &user_id).await?;
        return Ok(Json(ApiResponse::ok(HireResponse {
            expert_id: row.expert_id,
            license_id: existing.0,
            companion_id: existing.1,
            balance,
            already_owned: true,
        })));
    }

    // 余额预检（仅付费专家需要）。
    if row.price_credits > 0 {
        let balance = current_balance(&state, &user_id).await?;
        if balance < row.price_credits {
            return Err(AppError::BadRequest(format!(
                "积分不足：需要 {}，当前 {}",
                row.price_credits, balance
            )));
        }
    }

    // 1) 创建数字分身 Companion 实例（文件态，纯本地操作）。
    let profile = state
        .companion_service
        .create_companion(&row.name, &row.default_character)
        .await?;
    let companion_id = profile.companion_id.clone();

    // 2) 注入人格（system prompt）+ 技能 + 可选默认模型。
    let skills = parse_json_string_array(&row.default_skills);
    let mut patch = json!({
        "persona": { "preset": row.persona_preset, "custom": row.persona_custom },
        "skills": { "enabled": skills },
    });
    if let (Some(provider), Some(model)) = (
        row.default_model_provider.as_ref(),
        row.default_model.as_ref(),
    ) {
        if !provider.is_empty() && !model.is_empty() {
            patch["model"] = json!({ "provider_id": provider, "model": model });
        }
    }
    state
        .companion_service
        .patch_companion(&companion_id, patch)
        .await?;

    // 3) 扣积分（经济闭环）。price=0 的专家（如 LiloAvatarAI 董事长）跳过扣费。
    let mut balance = current_balance(&state, &user_id).await?;
    if row.price_credits > 0 {
        balance = state
            .user_repo
            .add_credits(
                &user_id,
                -row.price_credits,
                "hire_expert",
                Some("expert"),
                Some(&row.expert_id),
                Some("雇佣专家数字分身"),
            )
            .await
            .map_err(|e| AppError::Internal(format!("debit credits failed: {e}")))?;
    }

    // 4) 记授权（幂等键 = user_id + expert_id，配合上面的预检保证唯一）。
    let license_id = generate_id();
    let purchased_at = now_ms();
    sqlx::query(
        "INSERT INTO user_expert_licenses \
         (license_id, user_id, expert_id, companion_ref, tx_id, source, purchased_at) \
         VALUES (?, ?, ?, ?, NULL, 'purchase', ?)",
    )
    .bind(&license_id)
    .bind(&user_id)
    .bind(&row.expert_id)
    .bind(&companion_id)
    .bind(purchased_at)
    .execute(&state.pool)
    .await
    .map_err(|e| AppError::Internal(format!("insert license failed: {e}")))?;

    Ok(Json(ApiResponse::ok(HireResponse {
        expert_id: row.expert_id,
        license_id,
        companion_id,
        balance,
        already_owned: false,
    })))
}

async fn create_expert(
    State(state): State<ExpertMarketRouterState>,
    Json(req): Json<CreateExpertRequest>,
) -> Result<Json<ApiResponse<ExpertSummary>>, AppError> {
    let name = req.name.trim();
    let title = req.title.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("专家名称不能为空".into()));
    }
    if title.is_empty() {
        return Err(AppError::BadRequest("专家头衔不能为空".into()));
    }

    let expert_id = generate_id();
    let base_slug = slugify(name);
    let slug = unique_slug(&state.pool, &base_slug).await?;
    let tags_json = serde_json::to_string(&req.tags).unwrap_or_else(|_| "[]".to_owned());
    let skills_json = serde_json::to_string(&req.default_skills).unwrap_or_else(|_| "[]".to_owned());
    let created_at = now_ms();

    sqlx::query(
        "INSERT INTO expert_catalog \
         (expert_id, slug, name, title, description, avatar, tags, category, price_credits, \
          persona_custom, persona_preset, default_character, default_model, default_model_provider, \
          default_skills, is_builtin, creator_id, enabled, sort_order, created_at) \
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1, 1000, ?)",
    )
    .bind(&expert_id)
    .bind(&slug)
    .bind(name)
    .bind(title)
    .bind(req.description.as_deref().unwrap_or_default())
    .bind(&tags_json)
    .bind(req.category.as_deref())
    .bind(req.price_credits.max(0))
    .bind(&req.persona_custom)
    .bind(&req.persona_preset)
    .bind(&req.default_character)
    .bind(req.default_model.as_deref())
    .bind(req.default_model_provider.as_deref())
    .bind(&skills_json)
    .bind(&state.owner_user_id.to_string())
    .bind(created_at)
    .execute(&state.pool)
    .await
    .map_err(|e| AppError::Internal(format!("create expert failed: {e}")))?;

    Ok(Json(ApiResponse::ok(ExpertSummary {
        expert_id,
        slug,
        name: name.to_owned(),
        title: title.to_owned(),
        description: req.description.clone(),
        avatar: None,
        tags: req.tags,
        category: req.category.clone(),
        price_credits: req.price_credits.max(0),
        is_owned: false,
    })))
}

async fn my_experts(
    State(state): State<ExpertMarketRouterState>,
) -> Result<Json<ApiResponse<Vec<MyExpert>>>, AppError> {
    let user_id = state.owner_user_id.to_string();
    let rows = sqlx::query_as::<_, (String, String, i64, String, String, String, Option<String>, Option<String>)>(
        "SELECT l.expert_id, l.companion_ref, l.purchased_at, c.slug, c.name, c.title, \
         c.avatar, c.category \
         FROM user_expert_licenses l \
         JOIN expert_catalog c ON c.expert_id = l.expert_id \
         WHERE l.user_id = ? ORDER BY l.purchased_at DESC",
    )
    .bind(&user_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| AppError::Internal(format!("load my experts failed: {e}")))?;

    let items = rows
        .into_iter()
        .map(|(expert_id, companion_ref, purchased_at, slug, name, title, avatar, category)| {
            MyExpert {
                expert_id,
                slug,
                name,
                title,
                avatar,
                category,
                companion_ref,
                purchased_at,
            }
        })
        .collect();
    Ok(Json(ApiResponse::ok(items)))
}

async fn current_balance(
    state: &ExpertMarketRouterState,
    user_id: &str,
) -> Result<i64, AppError> {
    let user = state
        .user_repo
        .find_by_id(user_id)
        .await
        .map_err(|e| AppError::Internal(format!("load user failed: {e}")))?;
    user.map(|u| u.credits)
        .ok_or_else(|| AppError::NotFound("user not found".into()))
}
