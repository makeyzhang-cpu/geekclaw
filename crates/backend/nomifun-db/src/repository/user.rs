use crate::error::DbError;
use crate::models::{Invitation, User};
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
}
