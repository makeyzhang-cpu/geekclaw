use nomifun_common::TimestampMs;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Append-only credits ledger row. Every wallet balance change is recorded here
/// so the running balance is always reconstructable and auditable.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct CreditTransaction {
    pub id: i64,
    /// `user_id` of the affected wallet (registered in NON_REFERENCE_ID_COLUMNS
    /// of the id-schema contract — a logical link, no FK contract).
    pub user_id: String,
    /// `consume` | `grant` | `refund` | `invite_reward` | `signup_bonus` |
    /// `monthly_grant` | `adjust`.
    pub tx_type: String,
    /// Signed delta: positive = credit, negative = debit.
    pub amount: i64,
    /// Wallet balance immediately after this transaction.
    pub balance_after: i64,
    /// What the change relates to: `conversation` | `invitation` | `admin` |
    /// `system` (nullable).
    pub ref_type: Option<String>,
    /// Related id / invitation code / admin note key (nullable).
    pub ref_value: Option<String>,
    /// Human-readable note (nullable).
    pub note: Option<String>,
    pub created_at: TimestampMs,
}

/// Per-model billing price. Cost in credits per 1k tokens, keyed by
/// `(provider, model, task)`. `provider` / `model` deliberately avoid the `_id`
/// suffix so the table stays outside the logical-reference contract.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ModelPricing {
    pub id: i64,
    pub provider: String,
    pub model: String,
    /// `Chat` | `ImageGeneration` | ... — matches `ModelTask` values.
    pub task: String,
    pub input_credits_per_1k: f64,
    pub output_credits_per_1k: f64,
    pub cache_read_credits_per_1k: f64,
    /// Billing currency unit; the wallet is denominated in `credits`.
    pub currency: String,
    pub updated_at: TimestampMs,
}
