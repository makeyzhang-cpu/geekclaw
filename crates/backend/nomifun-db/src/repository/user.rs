use crate::error::DbError;
use crate::models::{HardwareDeposit, HardwareDepositAdminRow, Invitation, SocialEntitlement, User};
use nomifun_common::TimestampMs;

/// User data access abstraction.
///
/// All methods return `Result<_, DbError>` so callers can handle
/// database failures uniformly via the `DbError → AppError` conversion.
///
/// Object-safe via `async_trait` to support `Arc<dyn IUserRepository>`.
#[async_trait::async_trait]
pub trait IUserRepository: Send + Sync {
    /// Returns `true` if at least one user with a non-empty password exists.
    ///
    /// The uninitialized installation owner (empty password_hash) does not count.
    async fn has_users(&self) -> Result<bool, DbError>;

    /// Returns the canonical installation owner selected by
    /// `installation_identity`.
    async fn get_system_user(&self) -> Result<Option<User>, DbError>;

    /// Returns the primary WebUI user.
    ///
    /// This is the installation owner; usernames are mutable presentation data
    /// and are never used as an identity fallback.
    async fn get_primary_webui_user(&self) -> Result<Option<User>, DbError>;

    /// Updates the installation owner's username and password hash.
    ///
    /// Unconditional overwrite — used by local-mode credential management
    /// (desktop). For first-run provisioning prefer
    /// [`set_system_user_credentials_if_uninitialized`](Self::set_system_user_credentials_if_uninitialized).
    async fn set_system_user_credentials(&self, username: &str, password_hash: &str) -> Result<(), DbError>;

    /// Atomically sets the installation owner's credentials ONLY if it has not
    /// been initialised yet (empty / NULL `password_hash`).
    ///
    /// Returns `Ok(true)` when the credentials were written, `Ok(false)` when an
    /// admin already exists (the caller should treat this as a conflict). The
    /// `WHERE` clause is the gate, so two concurrent first-run callers can never
    /// both win — this is the race-safe primitive for first-run setup.
    async fn set_system_user_credentials_if_uninitialized(
        &self,
        username: &str,
        password_hash: &str,
    ) -> Result<bool, DbError>;

    /// Sets the installation owner's password hash ONLY if it is currently
    /// empty/NULL, and NEVER touches the username.
    ///
    /// This is the desktop LAN-provisioning primitive: it must fill in a
    /// password before exposing the WebUI to the network, but must not clobber
    /// a username the user already chose (unlike
    /// [`set_system_user_credentials`](Self::set_system_user_credentials), whose
    /// SQL rewrites both columns). The `WHERE` clause is the race-safe gate, so
    /// a second concurrent enable updates 0 rows and reuses the stored password.
    ///
    /// Returns `Ok(true)` when the password was written (it was uninitialised),
    /// `Ok(false)` when a password already existed (nothing changed).
    async fn set_system_user_password_if_uninitialized(&self, password_hash: &str) -> Result<bool, DbError>;

    /// Creates a new user and returns the inserted row.
    ///
    /// Returns `DbError::Conflict` if the username already exists.
    async fn create_user(&self, username: &str, password_hash: &str) -> Result<User, DbError>;

    /// Finds a user by username.
    async fn find_by_username(&self, username: &str) -> Result<Option<User>, DbError>;

    /// Finds a user by ID.
    async fn find_by_id(&self, id: &str) -> Result<Option<User>, DbError>;

    /// Lists all users.
    async fn list_users(&self) -> Result<Vec<User>, DbError>;

    /// Returns the total number of users.
    async fn count_users(&self) -> Result<i64, DbError>;

    /// Updates a user's password hash.
    async fn update_password(&self, user_id: &str, password_hash: &str) -> Result<(), DbError>;

    /// Updates a user's username.
    ///
    /// Returns `DbError::Conflict` if the new username already exists.
    async fn update_username(&self, user_id: &str, username: &str) -> Result<(), DbError>;

    /// Updates a user's last login timestamp to the current time.
    async fn update_last_login(&self, user_id: &str) -> Result<(), DbError>;

    /// Updates a user's JWT secret.
    async fn update_jwt_secret(&self, user_id: &str, jwt_secret: &str) -> Result<(), DbError>;

    /// Sets a user's role (e.g. `admin` / `user`).
    async fn set_user_role(&self, user_id: &str, role: &str) -> Result<(), DbError>;

    /// Enables or disables a user account (`is_active`).
    async fn set_user_active(&self, user_id: &str, active: bool) -> Result<(), DbError>;

    /// Counts users with `role = 'admin'` and `is_active = 1`.
    async fn count_active_admins(&self) -> Result<i64, DbError>;

    /// Creates a new invitation code (code generated internally) and returns the row.
    ///
    /// `plan` is the plan tier granted to the invitee (NULL = default),
    /// `credits_grant` is the initial credits given to the invitee on success,
    /// and `reward_to_inviter` is the credits awarded to `created_by` when the
    /// code is consumed — the bidirectional growth reward.
    async fn create_invitation(
        &self,
        created_by: &str,
        expires_at: TimestampMs,
        plan: Option<&str>,
        credits_grant: i64,
        reward_to_inviter: i64,
    ) -> Result<Invitation, DbError>;

    /// Lists all invitations, newest first.
    async fn list_invitations(&self) -> Result<Vec<Invitation>, DbError>;

    /// Fetches a single invitation by its code.
    async fn get_invitation(&self, code: &str) -> Result<Option<Invitation>, DbError>;

    /// Marks an invitation as used by the given user.
    ///
    /// Returns `Ok(false)` when the code is missing, expired, or already used —
    /// the caller should treat that as an invalid-invitation error.
    async fn consume_invitation(&self, code: &str, used_by: &str) -> Result<bool, DbError>;

    /// Deletes a user by id. Used to roll back an orphaned account when an
    /// invitation fails to consume (race loss). Returns `DbError::NotFound`
    /// when no such user existed.
    async fn delete_user(&self, user_id: &str) -> Result<(), DbError>;

    /// Deletes an unused invitation by code. Returns `Ok(false)` when the code
    /// is missing or already used — the caller should reject the revoke.
    async fn revoke_invitation(&self, code: &str) -> Result<bool, DbError>;

    /// Atomically adds `delta` credits to a user's wallet and appends a ledger
    /// row. `tx_type` classifies the change (e.g. `consume`, `grant`,
    /// `invite_reward`, `signup_bonus`, `adjust`). `ref_type`/`ref_value`/`note`
    /// provide audit context. Returns the new balance, or `DbError::NotFound`
    /// when the user does not exist.
    ///
    /// `delta` may be negative (a debit); the caller is responsible for ensuring
    /// the pre-check left enough balance before debiting.
    async fn add_credits(
        &self,
        user_id: &str,
        delta: i64,
        tx_type: &str,
        ref_type: Option<&str>,
        ref_value: Option<&str>,
        note: Option<&str>,
    ) -> Result<i64, DbError>;

    /// Sets a user's plan tier (`free` / `pro` / `team`).
    async fn set_plan(&self, user_id: &str, plan: &str) -> Result<(), DbError>;

    // ── 社媒矩阵加装包额度（迁移 047，列在 `users` 表上）──────────────────
    //
    // 社媒**不进套餐**，所有用户都必须单独买加装包，所以额度是独立于 `plan`
    // 的一条账。刻意不把这两列加进 `User` 结构体：多处 `SELECT * FROM users`
    // 会因此牵动列对齐，改动面远超收益。

    /// 读用户当前的社媒额度。用户不存在时返回 `None`（与仓储层其它方法同口径）。
    async fn get_social_entitlement(
        &self,
        user_id: &str,
    ) -> Result<Option<SocialEntitlement>, DbError>;

    /// 履约：购买成功后**累加**组数，并把到期时间从「原到期日与当前时间的较晚者」
    /// 顺延 `extend_ms` 毫秒。
    ///
    /// 语义刻意如此（而不是「覆盖」）：
    /// * 组数累加 —— 客户再买一份就是扩容，覆盖会让他白买；
    /// * 到期取较晚者再顺延 —— 续费不该缩短前一批的剩余时长；未到期就续费时
    ///   从原到期日往后接，不会凭空吃掉剩余天数。
    ///
    /// 返回写入后的新额度。用户不存在时返回 `DbError::NotFound`。
    async fn grant_social_addon(
        &self,
        user_id: &str,
        groups: i64,
        extend_ms: i64,
    ) -> Result<SocialEntitlement, DbError>;

    /// 后台手工核定额度与到期（覆盖式）。用于客服补偿、线下签约开通等
    /// 不经过支付网关的场景。`expires_at` 为 `None` 表示不设到期。
    async fn set_social_entitlement(
        &self,
        user_id: &str,
        groups: i64,
        expires_at: Option<i64>,
    ) -> Result<(), DbError>;

    // ── 积分加油包（迁移 049）────────────────────────────────────────────────
    //
    // 加油包**不污染** `users.plan`，履约只增 `users.credits`（1 积分 = 1 Token）。
    // 同 `finalize_social_addon_order` 的幂等闸门：在单一事务里 mark_order_paid
    // + add_credits，回调重放时不会重复发放。

    /// 履约：加油包订单付款成功后**直接累加 credits**到 user 余额（单一事务）。
    /// `Some(新余额)` 当次首次发；`None` 当回调重放；用户不存在 → `DbError::NotFound`。
    async fn finalize_credit_addon_order(
        &self,
        reqsn: &str,
        trxid: &str,
        user_id: &str,
        credits: i64,
    ) -> Result<Option<i64>, DbError>;

    /// 读 provider 的 platform 字段（"local" / "ollama" / "lmstudio" 等）。
    /// 用于会话扣减前分流（v5.0.69 Bug4）：本地/自配 provider 不扣积分。
    /// `Ok(None)` 表示 provider 不存在；调用方按「保守视为计费」处理。
    async fn get_provider_platform(
        &self,
        provider_id: &str,
    ) -> Result<Option<String>, DbError>;

    /// 社媒加装包**支付回调专用**履约：把订单转成 `paid`，并**在同一个事务里**
    /// 发放额度（语义同 [`Self::grant_social_addon`]）。
    ///
    /// 为什么不在这里复用 `mark_order_paid` + `grant_social_addon` 两步走：
    /// 第二步失败时订单已经是 `paid`，收银宝重试也会因为「已不再是 `created → paid`」
    /// 而直接跳过发放 —— 客户付了钱却拿不到额度，且**没有任何人工环节能发现**
    /// （押金单不同：它失败还有后台发货台兜底）。放进一个事务后，要么两者都成功，
    /// 要么一起回滚，回调重试可以安全重放。
    ///
    /// 返回 `None` 表示订单本就已是 `paid`（幂等重放），此时**不再发放**。
    async fn finalize_social_addon_order(
        &self,
        reqsn: &str,
        trxid: &str,
        user_id: &str,
        groups: i64,
        extend_ms: i64,
    ) -> Result<Option<SocialEntitlement>, DbError>;

    /// Lists all model pricing rows, ordered by provider then model.
    async fn list_model_pricing(&self) -> Result<Vec<crate::models::ModelPricing>, DbError>;

    /// Inserts or updates a model pricing row (keyed by provider/model/task).
    async fn upsert_model_pricing(
        &self,
        pricing: &crate::models::ModelPricing,
    ) -> Result<(), DbError>;

    /// Fetches the pricing row for a specific (provider, model, task), if any.
    async fn get_model_pricing(
        &self,
        provider: &str,
        model: &str,
        task: &str,
    ) -> Result<Option<crate::models::ModelPricing>, DbError>;

    /// Returns the most recent `limit` ledger rows for a user, newest first.
    /// Used to render a wallet's transaction history in the billing UI.
    async fn list_credit_transactions(
        &self,
        user_id: &str,
        limit: i64,
    ) -> Result<Vec<crate::models::CreditTransaction>, DbError>;

    /// Persists a newly created payment order (status `created`) and returns the
    /// inserted row. `order.reqsn` must be unique (the merchant order number).
    async fn create_order(&self, order: &crate::models::Order) -> Result<crate::models::Order, DbError>;

    /// Fetches a single order by its merchant order number (`reqsn`).
    async fn get_order_by_reqsn(&self, reqsn: &str) -> Result<Option<crate::models::Order>, DbError>;

    /// Lists all payment orders (admin view), most-recent first, each enriched
    /// with the buyer's username via a LEFT JOIN on `users`.
    async fn list_orders(&self) -> Result<Vec<(crate::models::Order, Option<String>)>, DbError>;

    /// Marks an order `paid`, records the Allinpay transaction id, and stamps
    /// `paid_at`. Idempotent: re-paying the same `reqsn` leaves `status` as
    /// `paid` and refreshes `trxid`/`paid_at`. Returns `true` when this call
    /// performed the `created → paid` transition (the caller should apply the
    /// plan + credit grant only then), or `false` when the order was already
    /// paid (or does not exist), so activation never double-applies.
    async fn mark_order_paid(&self, reqsn: &str, trxid: &str) -> Result<bool, DbError>;

    /// Marks an unpaid (`created`) order `failed`. Idempotent on the
    /// `created → failed` transition: a `paid` order (grant already applied) and
    /// an already `failed` order are left untouched and return `false`. This is
    /// how a cancelled or never-paid order is honestly reflected to the user
    /// instead of lingering as `created`.
    async fn mark_order_failed(&self, reqsn: &str, reason: &str) -> Result<bool, DbError>;

    // ── Subscription plans (admin-managed, replaces hard-coded catalog) ──────

    /// Lists subscription plans. When `include_disabled` is false, only
    /// `enabled = 1` rows are returned (storefront view).
    async fn list_subscription_plans(
        &self,
        include_disabled: bool,
    ) -> Result<Vec<crate::models::SubscriptionPlan>, DbError>;

    /// Fetches a plan by its storefront `plan_id`.
    async fn get_subscription_plan_by_plan_id(
        &self,
        plan_id: &str,
    ) -> Result<Option<crate::models::SubscriptionPlan>, DbError>;

    /// Inserts a new plan and returns the stored row (with id/timestamps).
    async fn create_subscription_plan(
        &self,
        plan: &crate::models::SubscriptionPlan,
    ) -> Result<crate::models::SubscriptionPlan, DbError>;

    /// Updates an existing plan matched by `plan_id`. Returns `true` when a row
    /// was updated.
    async fn update_subscription_plan(
        &self,
        plan: &crate::models::SubscriptionPlan,
    ) -> Result<bool, DbError>;

    /// Deletes a plan by `plan_id`. Returns `true` when a row was removed.
    async fn delete_subscription_plan(&self, plan_id: &str) -> Result<bool, DbError>;

    // ── System key/value store (payment config, etc.) ───────────────────────

    /// Reads a value from `system_kv`. Returns `None` when the key is absent.
    async fn get_kv(&self, key: &str) -> Result<Option<String>, DbError>;

    /// Writes (or overwrites) a value in `system_kv`, stamping `updated_at`.
    async fn set_kv(&self, key: &str, value: &str) -> Result<(), DbError>;

    // ── Phone-number SMS verification (registration / login / reset) ───────

    /// Creates a user with a bound phone number. Phone-number accounts reuse
    /// the phone (11-digit pure digits) as their `username`, so the existing
    /// UNIQUE username constraint guarantees phone uniqueness.
    /// Returns `DbError::Conflict` if the username already exists.
    async fn create_user_with_phone(
        &self,
        username: &str,
        password_hash: &str,
        phone: &str,
    ) -> Result<User, DbError>;

    /// Finds a user by their bound phone number.
    async fn find_by_phone(&self, phone: &str) -> Result<Option<User>, DbError>;

    /// Persists a freshly generated SMS verification code.
    async fn create_sms_code(
        &self,
        phone: &str,
        code: &str,
        purpose: &str,
        expires_at: TimestampMs,
    ) -> Result<(), DbError>;

    /// Returns the most recent unused, non-expired code for `(phone, purpose)`,
    /// or `None`. Tuple is `(id, code)`; callers must still compare `code`.
    async fn get_latest_valid_sms_code(
        &self,
        phone: &str,
        purpose: &str,
        now: TimestampMs,
    ) -> Result<Option<(i64, String)>, DbError>;

    /// Marks a verification code as used (affects up to 1 row).
    async fn mark_sms_code_used(&self, id: i64) -> Result<(), DbError>;

    // ── Referral / affiliate ("分享邀约有奖分销") ───────────────────────────

    /// Returns the user's existing `invite_code`, generating and persisting a
    /// unique one if absent. Always returns a non-empty code (or an error if
    /// the user does not exist). Used to power the referral share link.
    async fn ensure_invite_code(&self, user_id: &str) -> Result<String, DbError>;

    /// Looks up the user who owns a given `invite_code`, or `None`.
    async fn get_user_by_invite_code(&self, code: &str) -> Result<Option<User>, DbError>;

    /// Stamps `invited_by` on an account to record which referrer's code was
    /// used at registration. Idempotent: re-stamping the same value is a no-op.
    async fn set_invited_by(&self, user_id: &str, invited_by: &str) -> Result<(), DbError>;

    /// Counts how many accounts registered with this user's `invite_code`
    /// (i.e. `invited_by = user_id`). Drives the referral "已邀请人数" stat.
    async fn count_invited_by(&self, user_id: &str) -> Result<i64, DbError>;

    /// Sums `credit_transactions.amount` for a user filtered by `tx_type`
    /// (e.g. `invite_reward`). Drives the referral "累计获得积分" stat.
    async fn sum_credit_tx_by_type(&self, user_id: &str, tx_type: &str) -> Result<i64, DbError>;

    // ── 硬件押金（端侧算力盒子）履约信息 ──────────────────────────────────
    //
    // 支付流水在 `orders` 表（同一 `reqsn`，`plan = 'hardware_deposit'`），
    // 这里只负责「收货地址 + 发货状态」。详见迁移 045 的说明。

    /// 落一行押金履约记录（`status = 'created'`）。`reqsn` 必须与对应的
    /// `orders` 行一致且唯一。
    async fn create_hardware_deposit(
        &self,
        deposit: &HardwareDeposit,
    ) -> Result<HardwareDeposit, DbError>;

    /// 按商户订单号取押金履约记录，不存在返回 `None`。
    async fn get_hardware_deposit_by_reqsn(
        &self,
        reqsn: &str,
    ) -> Result<Option<HardwareDeposit>, DbError>;

    /// 写入 / 更新收货地址。已发货（`shipped`）的单会被拒绝并返回 `false`，
    /// 避免后台已按旧地址发出的货与页面数据不一致。
    async fn set_hardware_deposit_address(
        &self,
        reqsn: &str,
        region: &str,
        receiver_name: &str,
        receiver_phone: &str,
        detail_address: &str,
        remark: &str,
    ) -> Result<bool, DbError>;

    /// 支付成功后把履约状态从 `created` 迁移到 `paid`。幂等：
    /// 只有真正发生 `created → paid` 的那一次返回 `true`。
    async fn mark_hardware_deposit_paid(&self, reqsn: &str) -> Result<bool, DbError>;

    /// 后台标记已发货（`paid → shipped`）。只有已付款的单可发货，
    /// 其余状态返回 `false`，由调用方给出明确提示。
    async fn mark_hardware_deposit_shipped(&self, reqsn: &str) -> Result<bool, DbError>;

    /// 后台发货台列表，按下单时间倒序，附带买家名与关联支付订单状态。
    async fn list_hardware_deposits(&self) -> Result<Vec<HardwareDepositAdminRow>, DbError>;

    /// 某个买家自己的押金单（用于定价页回显「是否已提交收货地址」）。
    async fn list_hardware_deposits_by_user(
        &self,
        user_id: &str,
    ) -> Result<Vec<HardwareDeposit>, DbError>;
}
