//! Membership subscription plan (storefront tier).
//!
//! Replaces the previously hard-coded `SUBSCRIBE_CATALOG` in `nomifun-auth`.
//! Plans are now admin-managed rows in `subscription_plans`; the storefront
//! (`GET /api/plans`), the desktop client, and `subscribe_handler` all read
//! from this table so the three surfaces stay consistent.

use serde::{Deserialize, Serialize};

/// A purchasable membership tier.
#[derive(Debug, Clone, sqlx::FromRow, Serialize, Deserialize)]
pub struct SubscriptionPlan {
    pub id: i64,
    /// Storefront plan id, e.g. `starter` / `pro` / `flagship`.
    pub plan_id: String,
    /// Display name shown on the pricing page.
    pub name: String,
    /// Backend plan tier granted on payment (`free` / `pro` / `team`).
    pub backend_plan: String,
    /// Monthly price in 分 (1 CNY = 100 分).
    pub price_fen: i64,
    /// Credits granted per billing period.
    pub credits: i64,
    /// Marketing copy shown under the plan.
    pub description: String,
    /// Sort order on the pricing page (ascending).
    pub sort_order: i64,
    /// Whether the plan is purchasable (`1`) or hidden (`0`). SQLite has no
    /// boolean type, so this mirrors the existing `users.is_active` convention.
    pub enabled: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl SubscriptionPlan {
    /// Build a new plan row from admin input, stamping timestamps.
    pub fn new(
        plan_id: String,
        name: String,
        backend_plan: String,
        price_fen: i64,
        credits: i64,
        description: String,
        sort_order: i64,
        enabled: bool,
        now_ms: i64,
    ) -> Self {
        Self {
            id: 0,
            plan_id,
            name,
            backend_plan,
            price_fen,
            credits,
            description,
            sort_order,
            enabled: if enabled { 1 } else { 0 },
            created_at: now_ms,
            updated_at: now_ms,
        }
    }
}
