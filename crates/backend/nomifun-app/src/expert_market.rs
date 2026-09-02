//! 专家数字分身市场（GeekClaw 任务 F）。
//!
//! 把 `expert_catalog` 里的专家雇佣成「数字分身伙伴」Companion 实例：
//!   GET  /api/experts            — 市场列表（可按分类/关键词过滤，带 is_owned）
//!   GET  /api/experts/:id        — 专家详情（:id 支持 slug 或 expert_id）
//!   POST /api/experts/:id/hire   — 雇佣：扣积分 → 创建 Companion → 注入人格/技能/模型/四能力 → 记授权
//!   GET  /api/experts/mine       — 我雇佣的专家（含 companion_ref 可跳转到数字分身）
//!
//! 专家目录（含创建/自定义专家）已整体迁移到云端管理后台，桌面端只消费：
//! 内置种子走 `source='local'`，云端同步走 `source='cloud'`，本模块不再提供创建入口。
//!
//! 雇佣时注入四能力：专属记忆（add_memory seed）、专属知识库（create_base + write_file + set_binding）、
//! 自主进化（learn.enabled / evolve.enabled）、专属技能（skills.enabled）。
//! 经济闭环复用 `IUserRepository::add_credits`（tx_type = "hire_expert"）。

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

/// 路由状态：复用 CompanionService（建数字分身）+ knowledge_service（专属知识库）
/// + user_repo（扣积分）+ pool（查目录/授权）。
#[derive(Clone)]
pub struct ExpertMarketRouterState {
    pub pool: SqlitePool,
    pub user_repo: Arc<dyn IUserRepository>,
    pub companion_service: Arc<nomifun_companion::CompanionService>,
    pub knowledge_service: Arc<nomifun_knowledge::KnowledgeService>,
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
    memory_seed: String,
    knowledge_markdown: String,
    learn_enabled: bool,
    evolve_enabled: bool,
}

#[derive(Deserialize)]
struct ListQuery {
    category: Option<String>,
    q: Option<String>,
    /// 列表范围：`all`（默认）| `builtin` 内置。
    scope: Option<String>,
}

/// 构造路由。
pub fn expert_market_routes(state: ExpertMarketRouterState) -> Router {
    Router::new()
        .route("/api/experts", get(list_experts))
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
         default_model, default_model_provider, default_skills, \
         memory_seed, knowledge_markdown, learn_enabled, evolve_enabled \
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
         default_model, default_model_provider, default_skills, \
         memory_seed, knowledge_markdown, learn_enabled, evolve_enabled \
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
         default_model, default_model_provider, default_skills, \
         memory_seed, knowledge_markdown, learn_enabled, evolve_enabled \
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

    // 2) 注入人格（system prompt）+ 专属技能 + 可选默认模型 + 自主进化开关。
    let skills = parse_json_string_array(&row.default_skills);
    let mut patch = json!({
        "persona": { "preset": row.persona_preset, "custom": row.persona_custom },
        "skills": { "enabled": skills },
        "learn": { "enabled": row.learn_enabled },
        "evolve": { "enabled": row.evolve_enabled },
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

    // 2b) 专属记忆：注入初始记忆种子（best-effort，不影响雇佣主流程）。
    if !row.memory_seed.trim().is_empty() {
        if let Err(e) = state
            .companion_service
            .add_memory(
                "profile",
                row.memory_seed.trim(),
                &["expert".to_owned()],
                Some(&companion_id),
            )
            .await
        {
            tracing::warn!(companion_id = %companion_id, error = %e, "inject expert memory seed failed");
        }
    }

    // 2c) 专属知识库：创建并挂载 companion 专属知识库（best-effort）。
    if !row.knowledge_markdown.trim().is_empty() {
        if let Err(e) = inject_expert_knowledge(&state, &companion_id, &row).await {
            tracing::warn!(companion_id = %companion_id, error = %e, "inject expert knowledge base failed");
        }
    }

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

/// 专属知识库：创建 knowledge base → 写入初始文档 → 挂载到 companion。
async fn inject_expert_knowledge(
    state: &ExpertMarketRouterState,
    companion_id: &str,
    row: &ExpertCatalogRow,
) -> Result<(), AppError> {
    let info = state
        .knowledge_service
        .create_base(&format!("{} · 专属知识库", row.name), "", None, None)
        .await?;
    let kb_id = info.knowledge_base_id.clone();
    state
        .knowledge_service
        .write_file(kb_id.as_str(), "README.md", row.knowledge_markdown.trim())
        .await?;
    let binding = nomifun_knowledge::KnowledgeBinding {
        enabled: true,
        kb_ids: vec![kb_id],
        ..Default::default()
    };
    state
        .knowledge_service
        .set_binding("companion", companion_id, binding)
        .await?;
    Ok(())
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
