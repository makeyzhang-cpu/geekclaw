use serde::{Deserialize, Serialize};

/// Row mapping for the `expert_catalog` table.
///
/// The expert digital-twin marketplace catalog. Rows are the authoritative
/// expert definitions: base marketplace fields plus the four "capability"
/// columns (专属记忆 / 专属知识库 / 自主进化 · 定时学习 / 自主进化 · 技能进化 /
/// 云端同步溯源). On the cloud (web) backend the admin manages these rows; the
/// desktop syncs the enabled subset down and hires them into Companion instances.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ExpertRow {
    pub id: i64,
    pub expert_id: String,
    pub slug: String,
    pub name: String,
    pub title: String,
    pub description: Option<String>,
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
    pub sort_order: i64,
    pub created_at: i64,
    /// 专属记忆：初始记忆种子（雇佣时经 `add_memory` 注入）。
    pub memory_seed: String,
    /// 专属知识库：初始知识文档（雇佣时创建并挂载 companion 知识库）。
    pub knowledge_markdown: String,
    /// 自主进化 · 定时学习开关。
    pub learn_enabled: bool,
    /// 自主进化 · 技能进化开关。
    pub evolve_enabled: bool,
    /// 溯源：`local` = 本地内置种子；`cloud` = 云端管理后台同步而来。
    pub source: String,
}
