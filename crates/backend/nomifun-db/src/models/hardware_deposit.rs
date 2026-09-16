use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// 端侧算力盒子「押金」订单的**履约**信息（收货地址 + 发货状态）。
///
/// 支付流水不在这张表，而在 `orders` 表（同一 `reqsn`，`plan =
/// 'hardware_deposit'`）。这样收银宝的「异步通知 / 主动查单 / 取消订单」三条既有
/// 链路可以完全复用，一行都不用改；本表只负责「钱到账之后怎么发货」。
///
/// 状态机：`created`（已下单未付款）→ `paid`（已付款，待填地址 / 待发货）
/// → `shipped`（后台已发货）。两个迁移都是幂等的，重复调用无副作用。
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct HardwareDeposit {
    pub id: i64,
    /// 买家 `user_id`（逻辑外键，与 `orders.user_id` 同口径）。
    pub user_id: String,
    /// 押金金额快照（分）。下单时刻写死，之后调价不影响历史单。
    pub deposit_fen: i64,
    /// 商户订单号，与 `orders.reqsn` 一一对应（本表 UNIQUE）。
    pub reqsn: String,
    /// 收货地区（省市区，用户手填）。
    pub region: Option<String>,
    pub receiver_name: Option<String>,
    pub receiver_phone: Option<String>,
    /// 详细地址（街道 / 门牌 / 园区楼栋）。
    pub detail_address: Option<String>,
    /// 买家备注（开票抬头、上门时间等）。
    pub remark: Option<String>,
    /// `created` | `paid` | `shipped`，见下方三个常量。
    pub status: String,
    /// 发货时间（epoch millis），未发货为 NULL。
    pub shipped_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 已下单未付款。此时不允许提交收货地址（避免未付款就排队发货）。
pub const HARDWARE_DEPOSIT_STATUS_CREATED: &str = "created";
/// 已付款，等待买家提交收货地址 / 等待后台发货。
pub const HARDWARE_DEPOSIT_STATUS_PAID: &str = "paid";
/// 后台已发货（地址已锁定，不再接受修改）。
pub const HARDWARE_DEPOSIT_STATUS_SHIPPED: &str = "shipped";

/// 后台「硬件发货」列表的一行：履约信息 + 买家名 + 关联支付订单状态。
#[derive(Debug, Clone)]
pub struct HardwareDepositAdminRow {
    pub deposit: HardwareDeposit,
    /// 买家用户名（`users.username`，可能为空）。
    pub username: Option<String>,
    /// 关联 `orders.status`：`created` | `paid` | `failed`。
    ///
    /// 押金单自身的 `status` 只表达履约阶段，**付款是否真的到账以这里为准** ——
    /// 后台列表据此显示「已付款」而不是仅凭履约状态推断。
    pub order_status: Option<String>,
    /// 关联订单金额（分），用于和 `deposit_fen` 交叉核对。
    pub amount_fen: i64,
    pub trxid: Option<String>,
    pub paid_at: Option<i64>,
}
