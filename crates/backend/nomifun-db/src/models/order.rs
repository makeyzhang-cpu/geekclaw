use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// A payment order created for the 通联收银宝 (Allinpay Cashier) gateway.
///
/// The order is created `created` the moment the storefront starts checkout.
/// It transitions to `paid` only after Allinpay's async notify callback verifies
/// `trxstatus = 0000`; the plan + credit grant are applied at that point (never
/// before payment is confirmed). `failed` is set when a notify reports a failed
/// charge.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Order {
    pub id: i64,
    /// `user_id` of the buyer (registered in NON_REFERENCE_ID_COLUMNS of the
    /// id-schema contract — a logical link, no FK contract).
    pub user_id: String,
    /// Backend plan tier this order grants: `free` | `pro` | `team`.
    pub plan: String,
    /// Billing period: `monthly` | `quarterly` | `annual`.
    pub period: String,
    /// Order total in 分 (CNY fen). 1 CNY = 100 分.
    pub amount_fen: i64,
    /// Credit grant applied to the wallet when the order is paid.
    pub credits: i64,
    /// `created` | `paid` | `failed`.
    pub status: String,
    /// Merchant order number (our side). Unique; echoed back by Allinpay as
    /// `cusorderid` in the async notify so we can correlate the payment.
    pub reqsn: String,
    /// Allinpay transaction id, set when the notify marks the order paid.
    pub trxid: Option<String>,
    /// Cashier QR string returned by the unified-order call; the storefront
    /// renders it so the user can scan with WeChat / Alipay.
    pub qr_payinfo: Option<String>,
    /// Epoch millis when the order was created.
    pub created_at: i64,
    /// Epoch millis when the order was marked paid (NULL until then).
    pub paid_at: Option<i64>,
}
