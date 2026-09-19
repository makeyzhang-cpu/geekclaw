use sqlx::{FromRow, Row, SqlitePool};

use nomifun_common::{TimestampMs, now_ms};
use rand::Rng;
use rand::rngs::StdRng;
use rand::SeedableRng;

use crate::error::DbError;
use crate::models::{
    CreditTransaction, HARDWARE_DEPOSIT_STATUS_CREATED, HARDWARE_DEPOSIT_STATUS_PAID,
    HARDWARE_DEPOSIT_STATUS_SHIPPED, HardwareDeposit, HardwareDepositAdminRow, Invitation,
    ModelPricing, Order, SocialEntitlement, SubscriptionPlan, User,
};
use crate::repository::IUserRepository;

/// True if the sqlx error is a SQLite UNIQUE-constraint violation
/// (`SQLITE_CONSTRAINT_UNIQUE` = 2067). Used to retry `ensure_invite_code` on the
/// rare collision rather than bubbling the error up as a 500.
fn is_sqlite_unique_violation(e: &sqlx::Error) -> bool {
    match e {
        sqlx::Error::Database(db) => {
            db.is_unique_violation() || db.code() == Some(std::borrow::Cow::Borrowed("2067"))
        }
        _ => false,
    }
}

/// SQLite-backed implementation of [`IUserRepository`].
#[derive(Clone, Debug)]
pub struct SqliteUserRepository {
    pool: SqlitePool,
}

impl SqliteUserRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait::async_trait]
impl IUserRepository for SqliteUserRepository {
    async fn has_users(&self) -> Result<bool, DbError> {
        let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users WHERE password_hash != ''")
            .fetch_one(&self.pool)
            .await?;

        Ok(row.0 > 0)
    }

    async fn get_system_user(&self) -> Result<Option<User>, DbError> {
        let user = sqlx::query_as::<_, User>(
            "SELECT users.* \
             FROM installation_identity identity \
             JOIN users ON users.user_id = identity.owner_user_id \
             WHERE identity.singleton_key = 'installation'",
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(user)
    }

    async fn get_primary_webui_user(&self) -> Result<Option<User>, DbError> {
        self.get_system_user().await
    }

    async fn set_system_user_credentials(&self, username: &str, password_hash: &str) -> Result<(), DbError> {
        let now = nomifun_common::now_ms();
        let result = sqlx::query(
            "UPDATE users SET username = ?, password_hash = ?, updated_at = ? \
             WHERE user_id = (SELECT owner_user_id FROM installation_identity \
                              WHERE singleton_key = 'installation')",
        )
        .bind(username)
        .bind(password_hash)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(|e| match &e {
            sqlx::Error::Database(db_err) if is_unique_violation(db_err.as_ref()) => {
                DbError::Conflict(format!("Username '{username}' already exists"))
            }
            _ => DbError::Query(e),
        })?;

        if result.rows_affected() == 0 {
            return Err(DbError::NotFound(
                "installation owner user not found".to_string(),
            ));
        }

        Ok(())
    }

    async fn set_system_user_credentials_if_uninitialized(
        &self,
        username: &str,
        password_hash: &str,
    ) -> Result<bool, DbError> {
        let now = nomifun_common::now_ms();
        // The WHERE clause is the gate: it matches only the freshly-seeded
        // installation owner (empty/NULL password). SQLite serialises writers, so two
        // concurrent first-run callers cannot both match — the second sees the
        // already-populated hash and updates 0 rows.
        let result = sqlx::query(
            "UPDATE users SET username = ?, password_hash = ?, \"role\" = 'admin', updated_at = ? \
             WHERE user_id = (SELECT owner_user_id FROM installation_identity \
                              WHERE singleton_key = 'installation') \
               AND (password_hash = '' OR password_hash IS NULL)",
        )
        .bind(username)
        .bind(password_hash)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(|e| match &e {
            sqlx::Error::Database(db_err) if is_unique_violation(db_err.as_ref()) => {
                DbError::Conflict(format!("Username '{username}' already exists"))
            }
            _ => DbError::Query(e),
        })?;

        Ok(result.rows_affected() > 0)
    }

    async fn set_system_user_password_if_uninitialized(&self, password_hash: &str) -> Result<bool, DbError> {
        let now = nomifun_common::now_ms();
        // Only the password column is touched, and only while it is still empty
        // — the username the user may have set is preserved. The WHERE clause is
        // the gate, so a second concurrent enable writes 0 rows.
        let result = sqlx::query(
            "UPDATE users SET password_hash = ?, updated_at = ? \
             WHERE user_id = (SELECT owner_user_id FROM installation_identity \
                              WHERE singleton_key = 'installation') \
               AND (password_hash = '' OR password_hash IS NULL)",
        )
        .bind(password_hash)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    async fn create_user(&self, username: &str, password_hash: &str) -> Result<User, DbError> {
        let id = nomifun_common::UserId::new();
        let now = nomifun_common::now_ms();

        let row_id: i64 = sqlx::query_scalar(
            "INSERT INTO users (user_id, username, password_hash, created_at, updated_at, \"role\", is_active, plan, credits) \
             VALUES (?, ?, ?, ?, ?, 'user', 1, 'free', 0) RETURNING id",
        )
        .bind(id.as_str())
        .bind(username)
        .bind(password_hash)
        .bind(now)
        .bind(now)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| match &e {
            sqlx::Error::Database(db_err) if is_unique_violation(db_err.as_ref()) => {
                DbError::Conflict(format!("Username '{username}' already exists"))
            }
            _ => DbError::Query(e),
        })?;

        Ok(User {
            id: row_id,
            user_id: id,
            username: username.to_string(),
            email: None,
            password_hash: password_hash.to_string(),
            avatar_path: None,
            jwt_secret: None,
            created_at: now,
            updated_at: now,
            last_login: None,
            phone: None,
            role: "user".to_string(),
            is_active: 1,
            plan: "free".to_string(),
            credits: 0,
            invite_code: None,
            invited_by: None,
        })
    }

    async fn create_user_with_phone(&self, username: &str, password_hash: &str, phone: &str) -> Result<User, DbError> {
        let id = nomifun_common::UserId::new();
        let now = nomifun_common::now_ms();
        let row_id: i64 = sqlx::query_scalar(
            "INSERT INTO users (user_id, username, password_hash, phone, created_at, updated_at, \"role\", is_active, plan, credits) \
             VALUES (?, ?, ?, ?, ?, ?, 'user', 1, 'free', 0) RETURNING id",
        )
        .bind(id.as_str())
        .bind(username)
        .bind(password_hash)
        .bind(phone)
        .bind(now)
        .bind(now)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| match &e {
            sqlx::Error::Database(db_err) if is_unique_violation(db_err.as_ref()) => {
                DbError::Conflict(format!("Username '{username}' already exists"))
            }
            _ => DbError::Query(e),
        })?;
        Ok(User {
            id: row_id,
            user_id: id,
            username: username.to_string(),
            email: None,
            password_hash: password_hash.to_string(),
            avatar_path: None,
            jwt_secret: None,
            created_at: now,
            updated_at: now,
            last_login: None,
            phone: Some(phone.to_string()),
            role: "user".to_string(),
            is_active: 1,
            plan: "free".to_string(),
            credits: 0,
            invite_code: None,
            invited_by: None,
        })
    }

    async fn find_by_phone(&self, phone: &str) -> Result<Option<User>, DbError> {
        let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE phone = ?")
            .bind(phone)
            .fetch_optional(&self.pool)
            .await?;
        Ok(user)
    }

    async fn create_sms_code(&self, phone: &str, code: &str, purpose: &str, expires_at: TimestampMs) -> Result<(), DbError> {
        let now = nomifun_common::now_ms();
        sqlx::query(
            "INSERT INTO sms_verification_codes (phone, code, purpose, expires_at, created_at, used) VALUES (?, ?, ?, ?, ?, 0)",
        )
        .bind(phone)
        .bind(code)
        .bind(purpose)
        .bind(expires_at)
        .bind(now)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn get_latest_valid_sms_code(&self, phone: &str, purpose: &str, now: TimestampMs) -> Result<Option<(i64, String)>, DbError> {
        let row: Option<(i64, String)> = sqlx::query_as(
            "SELECT id, code FROM sms_verification_codes WHERE phone = ? AND purpose = ? AND used = 0 AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
        )
        .bind(phone)
        .bind(purpose)
        .bind(now)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    async fn mark_sms_code_used(&self, id: i64) -> Result<(), DbError> {
        sqlx::query("UPDATE sms_verification_codes SET used = 1 WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // ── Referral / affiliate ("分享邀约有奖分销") ───────────────────────────

    async fn ensure_invite_code(&self, user_id: &str) -> Result<String, DbError> {
        // Return the existing code if already assigned.
        if let Some(code) = sqlx::query_scalar::<_, Option<String>>(
            "SELECT invite_code FROM users WHERE user_id = ?",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?
        .flatten()
        {
            if !code.is_empty() {
                return Ok(code);
            }
        }
        // Generate + persist a unique personal referral code. The code is drawn
        // from a CSPRNG (not from a timestamp-derived value) so that codes minted
        // seconds apart never collide, and we retry on the rare UNIQUE collision
        // instead of propagating it.
        let mut rng = StdRng::from_entropy();
        loop {
            let code: String = (0..8)
                .map(|_| rng.sample(rand::distributions::Alphanumeric) as char)
                .collect::<String>()
                .to_ascii_uppercase();
            match sqlx::query(
                "UPDATE users SET invite_code = ? WHERE user_id = ? AND (invite_code IS NULL OR invite_code = '')",
            )
            .bind(&code)
            .bind(user_id)
            .execute(&self.pool)
            .await
            {
                Ok(res) if res.rows_affected() > 0 => return Ok(code),
                Ok(_) => {
                    // 0 rows affected means a concurrent call already stamped the
                    // code; re-read and reuse it.
                    if let Some(existing) = sqlx::query_scalar::<_, Option<String>>(
                        "SELECT invite_code FROM users WHERE user_id = ?",
                    )
                    .bind(user_id)
                    .fetch_optional(&self.pool)
                    .await?
                    .flatten()
                    {
                        if !existing.is_empty() {
                            return Ok(existing);
                        }
                    }
                }
                Err(e) if is_sqlite_unique_violation(&e) => {
                    // Collision with another user's code; generate a new one.
                    continue;
                }
                Err(e) => return Err(e.into()),
            }
        }
    }

    async fn get_user_by_invite_code(&self, code: &str) -> Result<Option<User>, DbError> {
        let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE invite_code = ?")
            .bind(code)
            .fetch_optional(&self.pool)
            .await?;
        Ok(user)
    }

    async fn set_invited_by(&self, user_id: &str, invited_by: &str) -> Result<(), DbError> {
        sqlx::query("UPDATE users SET invited_by = ?, updated_at = ? WHERE user_id = ?")
            .bind(invited_by)
            .bind(nomifun_common::now_ms())
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn count_invited_by(&self, user_id: &str) -> Result<i64, DbError> {
        let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users WHERE invited_by = ?")
            .bind(user_id)
            .fetch_one(&self.pool)
            .await?;
        Ok(row.0)
    }

    async fn sum_credit_tx_by_type(&self, user_id: &str, tx_type: &str) -> Result<i64, DbError> {
        let row: (Option<i64>,) = sqlx::query_as(
            "SELECT SUM(amount) FROM credit_transactions WHERE user_id = ? AND tx_type = ?",
        )
        .bind(user_id)
        .bind(tx_type)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.0.unwrap_or(0))
    }

    async fn find_by_username(&self, username: &str) -> Result<Option<User>, DbError> {
        let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE username = ?")
            .bind(username)
            .fetch_optional(&self.pool)
            .await?;

        Ok(user)
    }

    async fn find_by_id(&self, id: &str) -> Result<Option<User>, DbError> {
        let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE user_id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;

        Ok(user)
    }

    async fn list_users(&self) -> Result<Vec<User>, DbError> {
        let users = sqlx::query_as::<_, User>("SELECT * FROM users")
            .fetch_all(&self.pool)
            .await?;

        Ok(users)
    }

    async fn count_users(&self) -> Result<i64, DbError> {
        let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
            .fetch_one(&self.pool)
            .await?;

        Ok(row.0)
    }

    async fn update_password(&self, user_id: &str, password_hash: &str) -> Result<(), DbError> {
        let now = nomifun_common::now_ms();
        let result = sqlx::query("UPDATE users SET password_hash = ?, updated_at = ? WHERE user_id = ?")
            .bind(password_hash)
            .bind(now)
            .bind(user_id)
            .execute(&self.pool)
            .await?;

        if result.rows_affected() == 0 {
            return Err(DbError::NotFound(format!("User '{user_id}' not found")));
        }

        Ok(())
    }

    async fn update_username(&self, user_id: &str, username: &str) -> Result<(), DbError> {
        let now = nomifun_common::now_ms();
        let result = sqlx::query("UPDATE users SET username = ?, updated_at = ? WHERE user_id = ?")
            .bind(username)
            .bind(now)
            .bind(user_id)
            .execute(&self.pool)
            .await
            .map_err(|e| match &e {
                sqlx::Error::Database(db_err) if is_unique_violation(db_err.as_ref()) => {
                    DbError::Conflict(format!("Username '{username}' already exists"))
                }
                _ => DbError::Query(e),
            })?;

        if result.rows_affected() == 0 {
            return Err(DbError::NotFound(format!("User '{user_id}' not found")));
        }

        Ok(())
    }

    async fn update_last_login(&self, user_id: &str) -> Result<(), DbError> {
        let now = nomifun_common::now_ms();
        let result = sqlx::query("UPDATE users SET last_login = ?, updated_at = ? WHERE user_id = ?")
            .bind(now)
            .bind(now)
            .bind(user_id)
            .execute(&self.pool)
            .await?;

        if result.rows_affected() == 0 {
            return Err(DbError::NotFound(format!("User '{user_id}' not found")));
        }

        Ok(())
    }

    async fn update_jwt_secret(&self, user_id: &str, jwt_secret: &str) -> Result<(), DbError> {
        let now = nomifun_common::now_ms();
        let result = sqlx::query("UPDATE users SET jwt_secret = ?, updated_at = ? WHERE user_id = ?")
            .bind(jwt_secret)
            .bind(now)
            .bind(user_id)
            .execute(&self.pool)
            .await?;

        if result.rows_affected() == 0 {
            return Err(DbError::NotFound(format!("User '{user_id}' not found")));
        }

        Ok(())
    }

    async fn set_user_role(&self, user_id: &str, role: &str) -> Result<(), DbError> {
        let now = nomifun_common::now_ms();
        let result = sqlx::query("UPDATE users SET \"role\" = ?, updated_at = ? WHERE user_id = ?")
            .bind(role)
            .bind(now)
            .bind(user_id)
            .execute(&self.pool)
            .await?;

        if result.rows_affected() == 0 {
            return Err(DbError::NotFound(format!("User '{user_id}' not found")));
        }
        Ok(())
    }

    async fn set_user_active(&self, user_id: &str, active: bool) -> Result<(), DbError> {
        let now = nomifun_common::now_ms();
        let result = sqlx::query("UPDATE users SET is_active = ?, updated_at = ? WHERE user_id = ?")
            .bind(if active { 1i64 } else { 0i64 })
            .bind(now)
            .bind(user_id)
            .execute(&self.pool)
            .await?;

        if result.rows_affected() == 0 {
            return Err(DbError::NotFound(format!("User '{user_id}' not found")));
        }
        Ok(())
    }

    async fn count_active_admins(&self) -> Result<i64, DbError> {
        let row: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM users WHERE \"role\" = 'admin' AND is_active = 1",
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(row.0)
    }

    async fn create_invitation(
        &self,
        created_by: &str,
        expires_at: TimestampMs,
        plan: Option<&str>,
        credits_grant: i64,
        reward_to_inviter: i64,
    ) -> Result<Invitation, DbError> {
        let code = uuid::Uuid::now_v7().simple().to_string();
        let now = nomifun_common::now_ms();
        let row_id: i64 = sqlx::query_scalar(
            "INSERT INTO invitations (code, created_by, created_at, expires_at, plan, credits_grant, reward_to_inviter) \
             VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
        )
        .bind(&code)
        .bind(created_by)
        .bind(now)
        .bind(expires_at)
        .bind(plan)
        .bind(credits_grant)
        .bind(reward_to_inviter)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| match &e {
            sqlx::Error::Database(db_err) if is_unique_violation(db_err.as_ref()) => {
                DbError::Conflict("Invitation code collision; retry".to_string())
            }
            _ => DbError::Query(e),
        })?;

        Ok(Invitation {
            id: row_id,
            code,
            created_by: created_by.to_string(),
            created_at: now,
            expires_at,
            used_by: None,
            used_at: None,
            plan: plan.map(|p| p.to_string()),
            credits_grant,
            reward_to_inviter,
        })
    }

    async fn list_invitations(&self) -> Result<Vec<Invitation>, DbError> {
        let invitations = sqlx::query_as::<_, Invitation>(
            "SELECT * FROM invitations ORDER BY created_at DESC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(invitations)
    }

    async fn get_invitation(&self, code: &str) -> Result<Option<Invitation>, DbError> {
        let invitation = sqlx::query_as::<_, Invitation>("SELECT * FROM invitations WHERE code = ?")
            .bind(code)
            .fetch_optional(&self.pool)
            .await?;
        Ok(invitation)
    }

    async fn consume_invitation(&self, code: &str, used_by: &str) -> Result<bool, DbError> {
        let now = nomifun_common::now_ms();
        // Only consume if the code exists, is unused, and is not expired. The
        // WHERE clause is the single atomic gate; 0 rows affected means the
        // code was missing/expired/already used.
        let result = sqlx::query(
            "UPDATE invitations SET used_by = ?, used_at = ? \
             WHERE code = ? AND used_by IS NULL AND expires_at > ?",
        )
        .bind(used_by)
        .bind(now)
        .bind(code)
        .bind(now)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn delete_user(&self, user_id: &str) -> Result<(), DbError> {
        let result = sqlx::query("DELETE FROM users WHERE user_id = ?")
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(DbError::NotFound(format!("User '{user_id}' not found")));
        }
        Ok(())
    }

    async fn revoke_invitation(&self, code: &str) -> Result<bool, DbError> {
        // Only unused codes can be revoked; a consumed code must remain for the
        // audit trail, so the gate returns false instead of deleting it.
        let result = sqlx::query("DELETE FROM invitations WHERE code = ? AND used_by IS NULL")
            .bind(code)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn add_credits(
        &self,
        user_id: &str,
        delta: i64,
        tx_type: &str,
        ref_type: Option<&str>,
        ref_value: Option<&str>,
        note: Option<&str>,
    ) -> Result<i64, DbError> {
        let now = now_ms();
        let mut tx = self.pool.begin().await.map_err(DbError::Query)?;

        let result = sqlx::query(
            "UPDATE users SET credits = credits + ?, updated_at = ? WHERE user_id = ?",
        )
        .bind(delta)
        .bind(now)
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(DbError::Query)?;

        if result.rows_affected() == 0 {
            let _ = tx.rollback().await;
            return Err(DbError::NotFound(format!("User '{user_id}' not found")));
        }

        let balance_after: i64 =
            sqlx::query_scalar("SELECT credits FROM users WHERE user_id = ?")
                .bind(user_id)
                .fetch_one(&mut *tx)
                .await
                .map_err(DbError::Query)?;

        sqlx::query(
            "INSERT INTO credit_transactions \
             (user_id, tx_type, amount, balance_after, ref_type, ref_value, note, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(user_id)
        .bind(tx_type)
        .bind(delta)
        .bind(balance_after)
        .bind(ref_type)
        .bind(ref_value)
        .bind(note)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(DbError::Query)?;

        tx.commit().await.map_err(DbError::Query)?;
        Ok(balance_after)
    }

    async fn set_plan(&self, user_id: &str, plan: &str) -> Result<(), DbError> {
        let now = now_ms();
        let result = sqlx::query("UPDATE users SET plan = ?, updated_at = ? WHERE user_id = ?")
            .bind(plan)
            .bind(now)
            .bind(user_id)
            .execute(&self.pool)
            .await
            .map_err(DbError::Query)?;
        if result.rows_affected() == 0 {
            return Err(DbError::NotFound(format!("User '{user_id}' not found")));
        }
        Ok(())
    }

    // ── 社媒矩阵加装包额度（迁移 047）─────────────────────────────────────

    async fn get_social_entitlement(
        &self,
        user_id: &str,
    ) -> Result<Option<SocialEntitlement>, DbError> {
        let row = sqlx::query_as::<_, SocialEntitlement>(
            "SELECT social_groups, social_expires_at FROM users WHERE user_id = ?",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(DbError::Query)?;
        Ok(row)
    }

    async fn grant_social_addon(
        &self,
        user_id: &str,
        groups: i64,
        extend_ms: i64,
    ) -> Result<SocialEntitlement, DbError> {
        let now = now_ms();

        // 读旧值 + 写新值必须在**同一个事务**里：两次购买并发时若各自「读-算-写」，
        // 后写的那一次会盖掉前一次的组数，等于客户白买一份。
        let mut tx = self.pool.begin().await.map_err(DbError::Query)?;

        let prev = sqlx::query_as::<_, SocialEntitlement>(
            "SELECT social_groups, social_expires_at FROM users WHERE user_id = ?",
        )
        .bind(user_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(DbError::Query)?
        .ok_or_else(|| DbError::NotFound(format!("User '{user_id}' not found")))?;

        // 组数累加（再买一份 = 扩容，不是覆盖）。
        let next_groups = prev.social_groups.saturating_add(groups.max(0));
        // 到期顺延：未到期就从原到期日往后接（不吃掉剩余天数），已过期或首次购买
        // 则从当前时间起算。`extend_ms <= 0` 时保持原值 —— 否则原本「无到期」的
        // 账号会被写成一个立刻到期的时刻。
        let next_expires = if extend_ms > 0 {
            let base = prev.social_expires_at.unwrap_or(now).max(now);
            Some(base.saturating_add(extend_ms))
        } else {
            prev.social_expires_at
        };

        sqlx::query(
            "UPDATE users SET social_groups = ?, social_expires_at = ?, updated_at = ? \
             WHERE user_id = ?",
        )
        .bind(next_groups)
        .bind(next_expires)
        .bind(now)
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(DbError::Query)?;

        tx.commit().await.map_err(DbError::Query)?;

        Ok(SocialEntitlement {
            social_groups: next_groups,
            social_expires_at: next_expires,
        })
    }

    async fn set_social_entitlement(
        &self,
        user_id: &str,
        groups: i64,
        expires_at: Option<i64>,
    ) -> Result<(), DbError> {
        let now = now_ms();
        let result = sqlx::query(
            "UPDATE users SET social_groups = ?, social_expires_at = ?, updated_at = ? \
             WHERE user_id = ?",
        )
        .bind(groups.max(0))
        .bind(expires_at)
        .bind(now)
        .bind(user_id)
        .execute(&self.pool)
        .await
        .map_err(DbError::Query)?;
        if result.rows_affected() == 0 {
            return Err(DbError::NotFound(format!("User '{user_id}' not found")));
        }
        Ok(())
    }

    async fn finalize_social_addon_order(
        &self,
        reqsn: &str,
        trxid: &str,
        user_id: &str,
        groups: i64,
        extend_ms: i64,
    ) -> Result<Option<SocialEntitlement>, DbError> {
        let now = now_ms();
        let mut tx = self.pool.begin().await.map_err(DbError::Query)?;

        // 幂等闸门：只有真正完成「非 paid → paid」的那一次才发放。放在事务内，
        // 与下面的发放在一起提交，中途任何失败都会整体回滚。
        let transitioned = sqlx::query(
            "UPDATE orders SET status = 'paid', trxid = ?, paid_at = ? \
             WHERE reqsn = ? AND status != 'paid'",
        )
        .bind(trxid)
        .bind(now)
        .bind(reqsn)
        .execute(&mut *tx)
        .await
        .map_err(DbError::Query)?;

        if transitioned.rows_affected() == 0 {
            // 回调重放：订单早已 paid，额度在首次那轮已经发过，直接返回。
            tx.commit().await.map_err(DbError::Query)?;
            return Ok(None);
        }

        let prev = sqlx::query_as::<_, SocialEntitlement>(
            "SELECT social_groups, social_expires_at FROM users WHERE user_id = ?",
        )
        .bind(user_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(DbError::Query)?
        .ok_or_else(|| DbError::NotFound(format!("User '{user_id}' not found")))?;

        let next_groups = prev.social_groups.saturating_add(groups.max(0));
        let next_expires = if extend_ms > 0 {
            let base = prev.social_expires_at.unwrap_or(now).max(now);
            Some(base.saturating_add(extend_ms))
        } else {
            prev.social_expires_at
        };

        sqlx::query(
            "UPDATE users SET social_groups = ?, social_expires_at = ?, updated_at = ? \
             WHERE user_id = ?",
        )
        .bind(next_groups)
        .bind(next_expires)
        .bind(now)
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(DbError::Query)?;

        tx.commit().await.map_err(DbError::Query)?;

        Ok(Some(SocialEntitlement {
            social_groups: next_groups,
            social_expires_at: next_expires,
        }))
    }

    /// 加油包履约：单一事务 mark_order_paid + `users.credits += credits`，
    /// 与 social_addon 同款幂等闸门（仅 `status != 'paid'` 行进 rows_affected），
    /// 回调重放时直接返回 `None`，不重复发放。
    async fn finalize_credit_addon_order(
        &self,
        reqsn: &str,
        trxid: &str,
        user_id: &str,
        credits: i64,
    ) -> Result<Option<i64>, DbError> {
        let now = now_ms();
        let mut tx = self.pool.begin().await.map_err(DbError::Query)?;

        // 1) 幂等闸门：仅首次「非 paid → paid」返回 rows_affected=1。
        let transitioned = sqlx::query(
            "UPDATE orders SET status = 'paid', trxid = ?, paid_at = ? \
             WHERE reqsn = ? AND status != 'paid'",
        )
        .bind(trxid)
        .bind(now)
        .bind(reqsn)
        .execute(&mut *tx)
        .await
        .map_err(DbError::Query)?;

        if transitioned.rows_affected() == 0 {
            // 回调重放：首次已发放过，返回 None 让调用方打 info 日志。
            tx.commit().await.map_err(DbError::Query)?;
            return Ok(None);
        }

        // 2) 一次性事务里直接累加 credits，避免走 add_credits 单独事务
        //    （避免两段提交时其中一段失败的潜在脏状态）。
        let updated = sqlx::query(
            "UPDATE users SET credits = credits + ?, updated_at = ? WHERE user_id = ?",
        )
        .bind(credits.max(0))
        .bind(now)
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(DbError::Query)?;

        if updated.rows_affected() == 0 {
            return Err(DbError::NotFound(format!("User '{user_id}' not found")));
        }

        let new_balance: i64 = sqlx::query_scalar("SELECT credits FROM users WHERE user_id = ?")
            .bind(user_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(DbError::Query)?;

        tx.commit().await.map_err(DbError::Query)?;
        Ok(Some(new_balance))
    }

    /// 读 provider 的 platform 字段（v5.0.69 Bug4 计费分流依据）。
    /// `Ok(None)` = provider 不存在；调用方按"保守视为计费"处理。
    async fn get_provider_platform(
        &self,
        provider_id: &str,
    ) -> Result<Option<String>, DbError> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT platform FROM providers WHERE id = ?")
                .bind(provider_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(DbError::Query)?;
        Ok(row.map(|r| r.0))
    }

    async fn create_order(&self, order: &Order) -> Result<Order, DbError> {
        let now = now_ms();
        let result = sqlx::query(
            "INSERT INTO orders \
             (user_id, plan, period, amount_fen, credits, status, reqsn, qr_payinfo, created_at) \
             VALUES (?, ?, ?, ?, ?, 'created', ?, ?, ?)",
        )
        .bind(&order.user_id)
        .bind(&order.plan)
        .bind(&order.period)
        .bind(order.amount_fen)
        .bind(order.credits)
        .bind(&order.reqsn)
        .bind(&order.qr_payinfo)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(DbError::Query)?;

        if result.rows_affected() == 0 {
            return Err(DbError::Internal("Failed to insert order".into()));
        }

        self.get_order_by_reqsn(&order.reqsn)
            .await?
            .ok_or_else(|| DbError::Internal(format!("Order '{}' not found after insert", order.reqsn)))
    }

    async fn get_order_by_reqsn(&self, reqsn: &str) -> Result<Option<Order>, DbError> {
        let row = sqlx::query_as::<_, Order>("SELECT * FROM orders WHERE reqsn = ?")
            .bind(reqsn)
            .fetch_optional(&self.pool)
            .await
            .map_err(DbError::Query)?;
        Ok(row)
    }

    async fn list_orders(&self) -> Result<Vec<(Order, Option<String>)>, DbError> {
        let rows = sqlx::query(
            "SELECT o.*, u.username FROM orders o LEFT JOIN users u ON u.user_id = o.user_id ORDER BY o.created_at DESC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(DbError::Query)?;
        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let order = Order::from_row(&row).map_err(DbError::Query)?;
            let username: Option<String> = row.try_get("username").ok().flatten();
            out.push((order, username));
        }
        Ok(out)
    }

    async fn mark_order_paid(&self, reqsn: &str, trxid: &str) -> Result<bool, DbError> {
        let now = now_ms();
        let result = sqlx::query(
            "UPDATE orders SET status = 'paid', trxid = ?, paid_at = ? WHERE reqsn = ? AND status != 'paid'",
        )
        .bind(trxid)
        .bind(now)
        .bind(reqsn)
        .execute(&self.pool)
        .await
        .map_err(DbError::Query)?;

        Ok(result.rows_affected() > 0)
    }

    async fn mark_order_failed(&self, reqsn: &str, reason: &str) -> Result<bool, DbError> {
        // Only an unpaid (`created`) order can transition to `failed`; a `paid`
        // order (grant already applied) and an already `failed` order stay put.
        let result = sqlx::query(
            "UPDATE orders SET status = 'failed' WHERE reqsn = ? AND status = 'created'",
        )
        .bind(reqsn)
        .execute(&self.pool)
        .await
        .map_err(DbError::Query)?;
        // `reason` is consumed by the caller's log line; keep the schema stable
        // (no new column) so deployed migrations don't need to change.
        let _ = reason;
        Ok(result.rows_affected() > 0)
    }

    async fn list_subscription_plans(
        &self,
        include_disabled: bool,
    ) -> Result<Vec<SubscriptionPlan>, DbError> {
        let sql = if include_disabled {
            "SELECT * FROM subscription_plans ORDER BY sort_order ASC, id ASC"
        } else {
            "SELECT * FROM subscription_plans WHERE enabled = 1 ORDER BY sort_order ASC, id ASC"
        };
        let rows = sqlx::query_as::<_, SubscriptionPlan>(sql)
            .fetch_all(&self.pool)
            .await
            .map_err(DbError::Query)?;
        Ok(rows)
    }

    async fn get_subscription_plan_by_plan_id(
        &self,
        plan_id: &str,
    ) -> Result<Option<SubscriptionPlan>, DbError> {
        let row = sqlx::query_as::<_, SubscriptionPlan>(
            "SELECT * FROM subscription_plans WHERE plan_id = ?",
        )
        .bind(plan_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(DbError::Query)?;
        Ok(row)
    }

    async fn create_subscription_plan(
        &self,
        plan: &SubscriptionPlan,
    ) -> Result<SubscriptionPlan, DbError> {
        let now = now_ms();
        sqlx::query(
            "INSERT INTO subscription_plans \
             (plan_id, name, backend_plan, price_fen, price_year_fen, credits, description, sort_order, enabled, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&plan.plan_id)
        .bind(&plan.name)
        .bind(&plan.backend_plan)
        .bind(plan.price_fen)
        .bind(plan.price_year_fen)
        .bind(plan.credits)
        .bind(&plan.description)
        .bind(plan.sort_order)
        .bind(plan.enabled)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(DbError::Query)?;

        self.get_subscription_plan_by_plan_id(&plan.plan_id)
            .await?
            .ok_or_else(|| DbError::Internal(format!("Plan '{}' not found after insert", plan.plan_id)))
    }

    async fn update_subscription_plan(
        &self,
        plan: &SubscriptionPlan,
    ) -> Result<bool, DbError> {
        let now = now_ms();
        let result = sqlx::query(
            "UPDATE subscription_plans SET \
             name = ?, backend_plan = ?, price_fen = ?, price_year_fen = ?, credits = ?, description = ?, \
             sort_order = ?, enabled = ?, updated_at = ? \
             WHERE plan_id = ?",
        )
        .bind(&plan.name)
        .bind(&plan.backend_plan)
        .bind(plan.price_fen)
        .bind(plan.price_year_fen)
        .bind(plan.credits)
        .bind(&plan.description)
        .bind(plan.sort_order)
        .bind(plan.enabled)
        .bind(now)
        .bind(&plan.plan_id)
        .execute(&self.pool)
        .await
        .map_err(DbError::Query)?;
        Ok(result.rows_affected() > 0)
    }

    async fn delete_subscription_plan(&self, plan_id: &str) -> Result<bool, DbError> {
        let result = sqlx::query("DELETE FROM subscription_plans WHERE plan_id = ?")
            .bind(plan_id)
            .execute(&self.pool)
            .await
            .map_err(DbError::Query)?;
        Ok(result.rows_affected() > 0)
    }

    async fn get_kv(&self, key: &str) -> Result<Option<String>, DbError> {
        let row: Option<(String,)> = sqlx::query_as("SELECT value FROM system_kv WHERE key = ?")
            .bind(key)
            .fetch_optional(&self.pool)
            .await
            .map_err(DbError::Query)?;
        Ok(row.map(|r| r.0))
    }

    async fn set_kv(&self, key: &str, value: &str) -> Result<(), DbError> {
        let now = now_ms();
        sqlx::query(
            "INSERT INTO system_kv (key, value, updated_at) VALUES (?, ?, ?) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        )
        .bind(key)
        .bind(value)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(DbError::Query)?;
        Ok(())
    }

    async fn list_model_pricing(&self) -> Result<Vec<ModelPricing>, DbError> {
        let rows = sqlx::query_as::<_, ModelPricing>(
            "SELECT * FROM model_pricing ORDER BY provider, model, task",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(DbError::Query)?;
        Ok(rows)
    }

    async fn upsert_model_pricing(&self, pricing: &ModelPricing) -> Result<(), DbError> {
        let now = now_ms();
        sqlx::query(
            "INSERT INTO model_pricing \
             (provider, model, task, input_credits_per_1k, output_credits_per_1k, cache_read_credits_per_1k, currency, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?) \
             ON CONFLICT(provider, model, task) DO UPDATE SET \
             input_credits_per_1k = excluded.input_credits_per_1k, \
             output_credits_per_1k = excluded.output_credits_per_1k, \
             cache_read_credits_per_1k = excluded.cache_read_credits_per_1k, \
             currency = excluded.currency, \
             updated_at = excluded.updated_at",
        )
        .bind(&pricing.provider)
        .bind(&pricing.model)
        .bind(&pricing.task)
        .bind(pricing.input_credits_per_1k)
        .bind(pricing.output_credits_per_1k)
        .bind(pricing.cache_read_credits_per_1k)
        .bind(&pricing.currency)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(DbError::Query)?;
        Ok(())
    }

    async fn get_model_pricing(
        &self,
        provider: &str,
        model: &str,
        task: &str,
    ) -> Result<Option<ModelPricing>, DbError> {
        let row = sqlx::query_as::<_, ModelPricing>(
            "SELECT * FROM model_pricing WHERE provider = ? AND model = ? AND task = ?",
        )
        .bind(provider)
        .bind(model)
        .bind(task)
        .fetch_optional(&self.pool)
        .await
        .map_err(DbError::Query)?;
        Ok(row)
    }

    async fn list_credit_transactions(
        &self,
        user_id: &str,
        limit: i64,
    ) -> Result<Vec<CreditTransaction>, DbError> {
        let limit = if limit <= 0 { 50 } else { limit };
        let rows = sqlx::query_as::<_, CreditTransaction>(
            "SELECT * FROM credit_transactions WHERE user_id = ? \
             ORDER BY created_at DESC, id DESC LIMIT ?",
        )
        .bind(user_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(DbError::Query)?;
        Ok(rows)
    }

    // ── 硬件押金（端侧算力盒子）履约信息 ──────────────────────────────────

    async fn create_hardware_deposit(
        &self,
        deposit: &HardwareDeposit,
    ) -> Result<HardwareDeposit, DbError> {
        let now = now_ms();
        let result = sqlx::query(
            "INSERT INTO hardware_deposits \
             (user_id, deposit_fen, reqsn, region, receiver_name, receiver_phone, \
              detail_address, remark, status, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&deposit.user_id)
        .bind(deposit.deposit_fen)
        .bind(&deposit.reqsn)
        .bind(&deposit.region)
        .bind(&deposit.receiver_name)
        .bind(&deposit.receiver_phone)
        .bind(&deposit.detail_address)
        .bind(&deposit.remark)
        .bind(HARDWARE_DEPOSIT_STATUS_CREATED)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(DbError::Query)?;

        if result.rows_affected() == 0 {
            return Err(DbError::Internal("Failed to insert hardware deposit".into()));
        }

        self.get_hardware_deposit_by_reqsn(&deposit.reqsn)
            .await?
            .ok_or_else(|| {
                DbError::Internal(format!(
                    "Hardware deposit '{}' not found after insert",
                    deposit.reqsn
                ))
            })
    }

    async fn get_hardware_deposit_by_reqsn(
        &self,
        reqsn: &str,
    ) -> Result<Option<HardwareDeposit>, DbError> {
        let row = sqlx::query_as::<_, HardwareDeposit>("SELECT * FROM hardware_deposits WHERE reqsn = ?")
            .bind(reqsn)
            .fetch_optional(&self.pool)
            .await
            .map_err(DbError::Query)?;
        Ok(row)
    }

    async fn set_hardware_deposit_address(
        &self,
        reqsn: &str,
        region: &str,
        receiver_name: &str,
        receiver_phone: &str,
        detail_address: &str,
        remark: &str,
    ) -> Result<bool, DbError> {
        // `status != 'shipped'` 保证已发货的单不会被收货地址覆盖 —— 货已经按旧地址
        // 发出去了，改地址只会让后台数据与实际物流不一致，所以直接拒绝（返回 false）。
        let result = sqlx::query(
            "UPDATE hardware_deposits SET region = ?, receiver_name = ?, receiver_phone = ?, \
             detail_address = ?, remark = ?, updated_at = ? \
             WHERE reqsn = ? AND status != 'shipped'",
        )
        .bind(region)
        .bind(receiver_name)
        .bind(receiver_phone)
        .bind(detail_address)
        .bind(remark)
        .bind(now_ms())
        .bind(reqsn)
        .execute(&self.pool)
        .await
        .map_err(DbError::Query)?;
        Ok(result.rows_affected() > 0)
    }

    async fn mark_hardware_deposit_paid(&self, reqsn: &str) -> Result<bool, DbError> {
        // 幂等：只有 `created` 会迁移到 `paid`，重复通知不会再改一次。
        let result = sqlx::query(
            "UPDATE hardware_deposits SET status = ?, updated_at = ? \
             WHERE reqsn = ? AND status = ?",
        )
        .bind(HARDWARE_DEPOSIT_STATUS_PAID)
        .bind(now_ms())
        .bind(reqsn)
        .bind(HARDWARE_DEPOSIT_STATUS_CREATED)
        .execute(&self.pool)
        .await
        .map_err(DbError::Query)?;
        Ok(result.rows_affected() > 0)
    }

    async fn mark_hardware_deposit_shipped(&self, reqsn: &str) -> Result<bool, DbError> {
        // 只有已付款（`paid`）的单才允许发货；`created` 未付款、`shipped` 已发货
        // 都返回 false，由调用方给出明确提示。
        let now = now_ms();
        let result = sqlx::query(
            "UPDATE hardware_deposits SET status = ?, shipped_at = ?, updated_at = ? \
             WHERE reqsn = ? AND status = ?",
        )
        .bind(HARDWARE_DEPOSIT_STATUS_SHIPPED)
        .bind(now)
        .bind(now)
        .bind(reqsn)
        .bind(HARDWARE_DEPOSIT_STATUS_PAID)
        .execute(&self.pool)
        .await
        .map_err(DbError::Query)?;
        Ok(result.rows_affected() > 0)
    }

    async fn list_hardware_deposits(&self) -> Result<Vec<HardwareDepositAdminRow>, DbError> {
        let rows = sqlx::query(
            "SELECT d.*, u.username, o.status AS order_status, o.amount_fen AS order_amount_fen, \
             o.trxid AS order_trxid, o.paid_at AS order_paid_at \
             FROM hardware_deposits d \
             LEFT JOIN users u ON u.user_id = d.user_id \
             LEFT JOIN orders o ON o.reqsn = d.reqsn \
             ORDER BY d.created_at DESC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(DbError::Query)?;
        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let deposit = HardwareDeposit::from_row(&row).map_err(DbError::Query)?;
            out.push(HardwareDepositAdminRow {
                deposit,
                username: row.try_get("username").ok().flatten(),
                order_status: row.try_get("order_status").ok().flatten(),
                amount_fen: row.try_get("order_amount_fen").ok().flatten().unwrap_or(0),
                trxid: row.try_get("order_trxid").ok().flatten(),
                paid_at: row.try_get("order_paid_at").ok().flatten(),
            });
        }
        Ok(out)
    }

    async fn list_hardware_deposits_by_user(
        &self,
        user_id: &str,
    ) -> Result<Vec<HardwareDeposit>, DbError> {
        let rows = sqlx::query_as::<_, HardwareDeposit>(
            "SELECT * FROM hardware_deposits WHERE user_id = ? ORDER BY created_at DESC, id DESC",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await
        .map_err(DbError::Query)?;
        Ok(rows)
    }
}

/// Checks if a SQLite database error is a UNIQUE constraint violation.
fn is_unique_violation(err: &dyn sqlx::error::DatabaseError) -> bool {
    // SQLite error code 2067 = SQLITE_CONSTRAINT_UNIQUE
    err.code().is_some_and(|c| c == "2067")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_database_memory;

    async fn setup() -> (SqliteUserRepository, crate::Database) {
        let db = init_database_memory().await.unwrap();
        let repo = SqliteUserRepository::new(db.pool().clone());
        (repo, db)
    }

    // -- Unit tests for is_unique_violation helper --

    #[test]
    fn unique_violation_code_detected() {
        // SQLite UNIQUE violation has code "2067"
        assert!(is_unique_violation(&FakeDbError("2067")));
    }

    #[test]
    fn non_unique_violation_code_rejected() {
        assert!(!is_unique_violation(&FakeDbError("1555")));
    }

    /// Minimal fake for testing is_unique_violation.
    struct FakeDbError(&'static str);

    impl std::fmt::Display for FakeDbError {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(f, "fake error")
        }
    }

    impl std::fmt::Debug for FakeDbError {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(f, "FakeDbError({})", self.0)
        }
    }

    impl std::error::Error for FakeDbError {}

    impl sqlx::error::DatabaseError for FakeDbError {
        fn message(&self) -> &str {
            "fake"
        }
        fn kind(&self) -> sqlx::error::ErrorKind {
            sqlx::error::ErrorKind::UniqueViolation
        }
        fn code(&self) -> Option<std::borrow::Cow<'_, str>> {
            Some(std::borrow::Cow::Borrowed(self.0))
        }
        fn as_error(&self) -> &(dyn std::error::Error + Send + Sync + 'static) {
            self
        }
        fn as_error_mut(&mut self) -> &mut (dyn std::error::Error + Send + Sync + 'static) {
            self
        }
        fn into_error(self: Box<Self>) -> Box<dyn std::error::Error + Send + Sync + 'static> {
            self
        }
    }

    // -- Integration tests that exercise the repository against in-memory SQLite --

    #[tokio::test]
    async fn create_user_returns_populated_fields() {
        let (repo, _db) = setup().await;
        let user = repo.create_user("alice", "hash123").await.unwrap();

        assert!(nomifun_common::UserId::parse(user.user_id.as_str()).is_ok());
        assert_eq!(user.username, "alice");
        assert_eq!(user.password_hash, "hash123");
        assert!(user.email.is_none());
        assert!(user.avatar_path.is_none());
        assert!(user.jwt_secret.is_none());
        assert!(user.last_login.is_none());
        assert!(user.created_at > 0);
        assert_eq!(user.created_at, user.updated_at);
    }

    #[tokio::test]
    async fn create_user_duplicate_username_returns_conflict() {
        let (repo, _db) = setup().await;
        repo.create_user("bob", "h1").await.unwrap();

        let err = repo.create_user("bob", "h2").await.unwrap_err();
        assert!(matches!(err, DbError::Conflict(_)));
    }

    #[tokio::test]
    async fn has_users_false_when_only_system_user() {
        let (repo, _db) = setup().await;
        assert!(!repo.has_users().await.unwrap());
    }

    #[tokio::test]
    async fn has_users_true_after_creating_real_user() {
        let (repo, _db) = setup().await;
        repo.create_user("real", "pass").await.unwrap();
        assert!(repo.has_users().await.unwrap());
    }

    #[tokio::test]
    async fn get_system_user_returns_default() {
        let (repo, db) = setup().await;
        let owner = crate::installation_owner_id(db.pool()).await.unwrap();
        let user = repo.get_system_user().await.unwrap().unwrap();
        assert_eq!(user.user_id.as_str(), owner);
        assert_eq!(user.username, "admin");
    }

    #[tokio::test]
    async fn get_primary_webui_user_returns_system_user_first() {
        let (repo, db) = setup().await;
        let owner = crate::installation_owner_id(db.pool()).await.unwrap();
        repo.create_user("other", "hash").await.unwrap();

        let user = repo.get_primary_webui_user().await.unwrap().unwrap();
        assert_eq!(user.user_id.as_str(), owner);
    }

    #[tokio::test]
    async fn find_by_username_existing() {
        let (repo, _db) = setup().await;
        repo.create_user("charlie", "h").await.unwrap();

        let found = repo.find_by_username("charlie").await.unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().username, "charlie");
    }

    #[tokio::test]
    async fn find_by_username_missing() {
        let (repo, _db) = setup().await;
        assert!(repo.find_by_username("ghost").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn find_by_id_existing() {
        let (repo, _db) = setup().await;
        let created = repo.create_user("dave", "h").await.unwrap();

        let found = repo.find_by_id(created.user_id.as_str()).await.unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().user_id, created.user_id);
    }

    #[tokio::test]
    async fn find_by_id_missing() {
        let (repo, _db) = setup().await;
        assert!(repo.find_by_id("nonexistent").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn list_users_includes_system_and_created() {
        let (repo, _db) = setup().await;
        repo.create_user("eve", "h").await.unwrap();
        repo.create_user("frank", "h").await.unwrap();

        let users = repo.list_users().await.unwrap();
        // installation owner + eve + frank
        assert_eq!(users.len(), 3);
    }

    #[tokio::test]
    async fn count_users_includes_all() {
        let (repo, _db) = setup().await;
        repo.create_user("grace", "h").await.unwrap();

        // installation owner + grace
        assert_eq!(repo.count_users().await.unwrap(), 2);
    }

    #[tokio::test]
    async fn update_password_succeeds() {
        let (repo, _db) = setup().await;
        let user = repo.create_user("hal", "old_hash").await.unwrap();

        repo.update_password(user.user_id.as_str(), "new_hash").await.unwrap();

        let updated = repo.find_by_id(user.user_id.as_str()).await.unwrap().unwrap();
        assert_eq!(updated.password_hash, "new_hash");
        assert!(updated.updated_at >= user.updated_at);
    }

    #[tokio::test]
    async fn update_password_nonexistent_user() {
        let (repo, _db) = setup().await;
        let err = repo.update_password("no_such_id", "h").await.unwrap_err();
        assert!(matches!(err, DbError::NotFound(_)));
    }

    #[tokio::test]
    async fn update_username_succeeds() {
        let (repo, _db) = setup().await;
        let user = repo.create_user("ivan", "h").await.unwrap();

        repo.update_username(user.user_id.as_str(), "ivan_new").await.unwrap();

        let updated = repo.find_by_id(user.user_id.as_str()).await.unwrap().unwrap();
        assert_eq!(updated.username, "ivan_new");
    }

    #[tokio::test]
    async fn update_username_conflict() {
        let (repo, _db) = setup().await;
        repo.create_user("jane", "h").await.unwrap();
        let other = repo.create_user("kate", "h").await.unwrap();

        let err = repo
            .update_username(other.user_id.as_str(), "jane")
            .await
            .unwrap_err();
        assert!(matches!(err, DbError::Conflict(_)));
    }

    #[tokio::test]
    async fn update_last_login_sets_timestamp() {
        let (repo, _db) = setup().await;
        let user = repo.create_user("leo", "h").await.unwrap();
        assert!(user.last_login.is_none());

        repo.update_last_login(user.user_id.as_str()).await.unwrap();

        let updated = repo.find_by_id(user.user_id.as_str()).await.unwrap().unwrap();
        assert!(updated.last_login.is_some());
        assert!(updated.last_login.unwrap() > 0);
    }

    #[tokio::test]
    async fn update_jwt_secret_succeeds() {
        let (repo, _db) = setup().await;
        let user = repo.create_user("mike", "h").await.unwrap();
        assert!(user.jwt_secret.is_none());

        repo.update_jwt_secret(user.user_id.as_str(), "secret123").await.unwrap();

        let updated = repo.find_by_id(user.user_id.as_str()).await.unwrap().unwrap();
        assert_eq!(updated.jwt_secret.as_deref(), Some("secret123"));
    }

    #[tokio::test]
    async fn set_system_user_credentials_conflict_with_existing_username() {
        let (repo, _db) = setup().await;
        repo.create_user("taken", "h").await.unwrap();

        let err = repo.set_system_user_credentials("taken", "hash").await.unwrap_err();
        assert!(matches!(err, DbError::Conflict(_)));
    }

    #[tokio::test]
    async fn set_system_user_credentials_updates_fields() {
        let (repo, _db) = setup().await;

        repo.set_system_user_credentials("admin", "secure_hash").await.unwrap();

        let user = repo.get_system_user().await.unwrap().unwrap();
        assert_eq!(user.username, "admin");
        assert_eq!(user.password_hash, "secure_hash");
    }

    #[tokio::test]
    async fn set_system_user_password_if_uninitialized_preserves_username() {
        let (repo, db) = setup().await;
        let owner = crate::installation_owner_id(db.pool()).await.unwrap();

        // User renamed the system account while its password was still empty.
        repo.update_username(&owner, "bob").await.unwrap();

        // Provisioning a password must fill the password WITHOUT touching the username.
        let wrote = repo
            .set_system_user_password_if_uninitialized("provisioned_hash")
            .await
            .unwrap();
        assert!(wrote, "should write when password was empty");

        let user = repo.get_system_user().await.unwrap().unwrap();
        assert_eq!(user.username, "bob", "username must be preserved, not reset to admin");
        assert_eq!(user.password_hash, "provisioned_hash");

        // A second enable is a no-op: password already set, nothing changes.
        let wrote_again = repo
            .set_system_user_password_if_uninitialized("another_hash")
            .await
            .unwrap();
        assert!(!wrote_again, "should not overwrite an existing password");
        let user = repo.get_system_user().await.unwrap().unwrap();
        assert_eq!(user.password_hash, "provisioned_hash", "existing password must be kept");
        assert_eq!(user.username, "bob");
    }

    // -- Invitation + role/active closed-loop tests (user management) --

    #[tokio::test]
    async fn create_and_list_invitation() {
        let (repo, _db) = setup().await;
        let inv = repo.create_invitation("owner", nomifun_common::now_ms() + 86_400_000, None, 0, 0).await.unwrap();
        assert!(!inv.code.is_empty());
        let list = repo.list_invitations().await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].code, inv.code);
    }

    #[tokio::test]
    async fn consume_invitation_marks_used_and_is_idempotent() {
        let (repo, _db) = setup().await;
        let inv = repo.create_invitation("owner", nomifun_common::now_ms() + 86_400_000, None, 0, 0).await.unwrap();
        let consumed = repo.consume_invitation(&inv.code, "user-1").await.unwrap();
        assert!(consumed);
        let fetched = repo.get_invitation(&inv.code).await.unwrap().unwrap();
        assert_eq!(fetched.used_by.as_deref(), Some("user-1"));
        // A second consume must fail (already used).
        let again = repo.consume_invitation(&inv.code, "user-2").await.unwrap();
        assert!(!again);
    }

    #[tokio::test]
    async fn consume_invitation_expired_returns_false() {
        let (repo, _db) = setup().await;
        let inv = repo.create_invitation("owner", nomifun_common::now_ms() - 1000, None, 0, 0).await.unwrap();
        let consumed = repo.consume_invitation(&inv.code, "user-1").await.unwrap();
        assert!(!consumed);
    }

    #[tokio::test]
    async fn revoke_invitation_unused_succeeds_used_fails() {
        let (repo, _db) = setup().await;
        let inv = repo.create_invitation("owner", nomifun_common::now_ms() + 86_400_000, None, 0, 0).await.unwrap();
        let revoked = repo.revoke_invitation(&inv.code).await.unwrap();
        assert!(revoked);
        assert_eq!(repo.list_invitations().await.unwrap().len(), 0);

        // A used code must not be revocable (kept for the audit trail).
        let inv2 = repo.create_invitation("owner", nomifun_common::now_ms() + 86_400_000, None, 0, 0).await.unwrap();
        repo.consume_invitation(&inv2.code, "user-1").await.unwrap();
        let revoked2 = repo.revoke_invitation(&inv2.code).await.unwrap();
        assert!(!revoked2);
        assert_eq!(repo.list_invitations().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn set_user_role_and_count_active_admins() {
        let (repo, _db) = setup().await;
        // 没有任何迁移会种子管理员账号：首个管理员是运行时「第一个注册用户」
        // 提升出来的。所以全新库必须是 0，而不是 >= 1。
        let before = repo.count_active_admins().await.unwrap();
        assert_eq!(before, 0, "a fresh database must not seed an admin");
        let user = repo.create_user("promote", "h").await.unwrap();
        repo.set_user_role(user.user_id.as_str(), "admin").await.unwrap();
        assert_eq!(repo.count_active_admins().await.unwrap(), before + 1);
        repo.set_user_role(user.user_id.as_str(), "user").await.unwrap();
        assert_eq!(repo.count_active_admins().await.unwrap(), before);
    }

    #[tokio::test]
    async fn set_user_active_toggles_flag() {
        let (repo, _db) = setup().await;
        let user = repo.create_user("toggle", "h").await.unwrap();
        repo.set_user_active(user.user_id.as_str(), false).await.unwrap();
        let fetched = repo.find_by_id(user.user_id.as_str()).await.unwrap().unwrap();
        assert_eq!(fetched.is_active, 0);
        repo.set_user_active(user.user_id.as_str(), true).await.unwrap();
        let fetched2 = repo.find_by_id(user.user_id.as_str()).await.unwrap().unwrap();
        assert_eq!(fetched2.is_active, 1);
    }

    /// 硬件押金（端侧算力盒子）履约状态机：created → paid → shipped，
    /// 每一步都必须是幂等的，且已发货后不能再改收货地址。
    #[tokio::test]
    async fn hardware_deposit_lifecycle_is_idempotent_and_ordered() {
        let (repo, _db) = setup().await;
        let reqsn = "GC1758000000000_hw0001";

        let created = repo
            .create_hardware_deposit(&HardwareDeposit {
                id: 0,
                user_id: "u-deposit".into(),
                deposit_fen: 1_000_000,
                reqsn: reqsn.into(),
                region: None,
                receiver_name: None,
                receiver_phone: None,
                detail_address: None,
                remark: None,
                status: HARDWARE_DEPOSIT_STATUS_CREATED.into(),
                shipped_at: None,
                created_at: 0,
                updated_at: 0,
            })
            .await
            .unwrap();
        assert_eq!(created.status, HARDWARE_DEPOSIT_STATUS_CREATED);
        assert_eq!(created.deposit_fen, 1_000_000, "押金金额必须原样落库");

        // 未付款阶段也允许先存地址（后台发货门槛由 routes 层把关），但状态机本身
        // 不会因此提前变成 paid。
        assert!(repo
            .set_hardware_deposit_address(
                reqsn,
                "广东省深圳市南山区",
                "张三",
                "13800000000",
                "科技园路 1 号 A 栋 801",
                "工作日送货",
            )
            .await
            .unwrap());

        // 支付确认：只有第一次是真实迁移，重复通知返回 false（防止重复处理）。
        assert!(repo.mark_hardware_deposit_paid(reqsn).await.unwrap());
        assert!(
            !repo.mark_hardware_deposit_paid(reqsn).await.unwrap(),
            "重复的支付通知不得再次迁移状态"
        );

        let paid = repo.get_hardware_deposit_by_reqsn(reqsn).await.unwrap().unwrap();
        assert_eq!(paid.status, HARDWARE_DEPOSIT_STATUS_PAID);
        assert_eq!(paid.receiver_name.as_deref(), Some("张三"));

        // 发货：paid → shipped 成功，重复发货失败。
        assert!(repo.mark_hardware_deposit_shipped(reqsn).await.unwrap());
        assert!(
            !repo.mark_hardware_deposit_shipped(reqsn).await.unwrap(),
            "已发货的单不得重复发货"
        );

        let shipped = repo.get_hardware_deposit_by_reqsn(reqsn).await.unwrap().unwrap();
        assert_eq!(shipped.status, HARDWARE_DEPOSIT_STATUS_SHIPPED);
        assert!(shipped.shipped_at.is_some(), "发货时间必须落库");
        assert!(
            !repo
                .set_hardware_deposit_address(reqsn, "", "李四", "13900000000", "别处", "")
                .await
                .unwrap(),
            "已发货后收货地址必须锁定"
        );

        // 后台列表：没有对应 users 行时 username 为 NULL，但行本身必须能查出来
        // （发货台不能因为用户被删就丢掉订单）。
        let rows = repo.list_hardware_deposits().await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].deposit.reqsn, reqsn);
        assert!(rows[0].username.is_none());
        // 没有对应 orders 行时付款真源为空，后台据此显示「待支付」而不是假「已支付」。
        assert!(rows[0].order_status.is_none());

        let mine = repo.list_hardware_deposits_by_user("u-deposit").await.unwrap();
        assert_eq!(mine.len(), 1);
        assert!(repo
            .list_hardware_deposits_by_user("someone-else")
            .await
            .unwrap()
            .is_empty());
    }

    /// 未付款（`created`）的押金单不允许直接发货 —— 否则会产生「货发了钱没到」的死单。
    #[tokio::test]
    async fn hardware_deposit_cannot_ship_before_payment() {
        let (repo, _db) = setup().await;
        let reqsn = "GC1758000000000_hw0002";
        repo.create_hardware_deposit(&HardwareDeposit {
            id: 0,
            user_id: "u-deposit-2".into(),
            deposit_fen: 1_000_000,
            reqsn: reqsn.into(),
            region: None,
            receiver_name: None,
            receiver_phone: None,
            detail_address: None,
            remark: None,
            status: HARDWARE_DEPOSIT_STATUS_CREATED.into(),
            shipped_at: None,
            created_at: 0,
            updated_at: 0,
        })
        .await
        .unwrap();

        assert!(!repo.mark_hardware_deposit_shipped(reqsn).await.unwrap());
        let row = repo.get_hardware_deposit_by_reqsn(reqsn).await.unwrap().unwrap();
        assert_eq!(row.status, HARDWARE_DEPOSIT_STATUS_CREATED);
    }

    // ── 社媒矩阵加装包额度（迁移 047 / 048）────────────────────────────────
    //
    // 这一段覆盖的是**收钱路径**：组数怎么算、到期怎么顺延、回调重放会不会重复
    // 发放、发放失败时订单状态会不会被留在 `paid`。最后一条是重点 —— 一旦订单
    // 先落 `paid`、发放再失败，收银宝重放会因为「已 paid」被幂等闸门跳过，
    // 客户付了钱拿不到额度，而且没有任何人工环节会发现。

    const DAY_MS: i64 = 24 * 60 * 60 * 1000;

    async fn seed_addon_order(repo: &SqliteUserRepository, user_id: &str, plan: &str, reqsn: &str) {
        sqlx::query(
            "INSERT INTO orders \
             (user_id, plan, period, amount_fen, credits, status, reqsn, created_at) \
             VALUES (?, ?, 'annual', 299900, 0, 'created', ?, ?)",
        )
        .bind(user_id)
        .bind(plan)
        .bind(reqsn)
        .bind(now_ms())
        .execute(&repo.pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn social_entitlement_starts_unpurchased() {
        let (repo, _db) = setup().await;
        let u = repo.create_user("social_a", "h").await.unwrap();

        let ent = repo
            .get_social_entitlement(&u.user_id)
            .await
            .unwrap()
            .expect("用户行应存在");
        assert_eq!(ent.social_groups, 0);
        assert_eq!(ent.social_expires_at, None);
        assert!(!ent.is_purchased());
        assert!(!ent.is_active_at(now_ms()));
    }

    /// 再买一份 = 扩容（累加），且到期从**原到期日**往后接，不吃掉剩余天数。
    #[tokio::test]
    async fn social_addon_repeat_purchase_accumulates_and_stacks_expiry() {
        let (repo, _db) = setup().await;
        let u = repo.create_user("social_b", "h").await.unwrap();

        let first = repo
            .grant_social_addon(&u.user_id, 3, 30 * DAY_MS)
            .await
            .unwrap();
        assert_eq!(first.social_groups, 3);
        let first_expiry = first.social_expires_at.expect("首次购买应写入到期时间");

        let second = repo
            .grant_social_addon(&u.user_id, 1, 30 * DAY_MS)
            .await
            .unwrap();
        assert_eq!(second.social_groups, 4, "重复购买必须累加，覆盖等于让客户白买");
        assert_eq!(
            second.social_expires_at,
            Some(first_expiry + 30 * DAY_MS),
            "续费应从原到期日顺延，而不是从现在重新起算"
        );
    }

    /// 已过期的账号续费：新的有效期必须落在未来（否则续了费仍然是过期态）。
    #[tokio::test]
    async fn social_addon_expired_baseline_restarts_from_now() {
        let (repo, _db) = setup().await;
        let u = repo.create_user("social_c", "h").await.unwrap();
        repo.set_social_entitlement(&u.user_id, 2, Some(now_ms() - 10 * DAY_MS))
            .await
            .unwrap();

        let ent = repo
            .grant_social_addon(&u.user_id, 1, 30 * DAY_MS)
            .await
            .unwrap();
        assert_eq!(ent.social_groups, 3);
        assert!(ent.social_expires_at.unwrap() > now_ms());
    }

    /// `extend_ms = 0` 表示「不设到期」。不能被写成「立刻过期」的时刻，否则
    /// 刚发的额度下一毫秒就失效。
    #[tokio::test]
    async fn social_addon_zero_extension_keeps_no_expiry() {
        let (repo, _db) = setup().await;
        let u = repo.create_user("social_d", "h").await.unwrap();

        let ent = repo.grant_social_addon(&u.user_id, 2, 0).await.unwrap();
        assert_eq!(ent.social_groups, 2);
        assert_eq!(ent.social_expires_at, None);
        assert!(ent.is_active_at(now_ms()), "无到期时间视为长期有效");
    }

    /// 首次履约发放 + 回调重放必须只发一次。
    #[tokio::test]
    async fn finalize_social_addon_grants_once_then_ignores_replay() {
        let (repo, _db) = setup().await;
        let u = repo.create_user("social_e", "h").await.unwrap();
        seed_addon_order(&repo, &u.user_id, "social_addon_3", "REQ-1").await;

        let granted = repo
            .finalize_social_addon_order("REQ-1", "TRX-1", &u.user_id, 3, 30 * DAY_MS)
            .await
            .unwrap();
        assert_eq!(granted.expect("首次履约应发放额度").social_groups, 3);

        let order = repo.get_order_by_reqsn("REQ-1").await.unwrap().unwrap();
        assert_eq!(order.status, "paid");
        assert_eq!(order.trxid.as_deref(), Some("TRX-1"));

        // 收银宝回调会重放同一个 reqsn：不得第二次发放。
        let replay = repo
            .finalize_social_addon_order("REQ-1", "TRX-1", &u.user_id, 3, 30 * DAY_MS)
            .await
            .unwrap();
        assert!(replay.is_none(), "重放必须被幂等闸门拦下");
        assert_eq!(
            repo.get_social_entitlement(&u.user_id)
                .await
                .unwrap()
                .unwrap()
                .social_groups,
            3,
            "重放不得把组数再加一遍"
        );
    }

    /// 🔴 发放失败时，订单状态必须**一起回滚** —— 这是「订单转 paid」与「发放额度」
    /// 必须同事务的根因。留在 `paid` 就等于静默丢单。
    #[tokio::test]
    async fn finalize_social_addon_rolls_back_order_when_grant_fails() {
        let (repo, _db) = setup().await;
        seed_addon_order(&repo, "no-such-user", "social_addon_1", "REQ-2").await;

        let err = repo
            .finalize_social_addon_order("REQ-2", "TRX-2", "no-such-user", 1, 30 * DAY_MS)
            .await
            .unwrap_err();
        assert!(matches!(err, DbError::NotFound(_)), "拿不到用户行应报 NotFound");

        let order = repo.get_order_by_reqsn("REQ-2").await.unwrap().unwrap();
        assert_eq!(
            order.status, "created",
            "发放失败必须整体回滚，订单不得停在 paid（否则重试会被幂等闸门跳过）"
        );
    }
}
