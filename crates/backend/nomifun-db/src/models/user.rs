use nomifun_common::{TimestampMs, UserId};
use serde::{Deserialize, Serialize};

/// Row mapping for the `users` table.
///
/// All fields match the SQLite column names and types exactly.
/// Optional fields correspond to nullable columns.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
    pub id: i64,
    #[sqlx(try_from = "String")]
    pub user_id: UserId,
    pub username: String,
    pub email: Option<String>,
    pub password_hash: String,
    pub avatar_path: Option<String>,
    pub jwt_secret: Option<String>,
    pub created_at: TimestampMs,
    pub updated_at: TimestampMs,
    pub last_login: Option<TimestampMs>,
    /// Role for admin/user management. `admin` grants access to the user
    /// management control plane; everything else is a regular user.
    pub role: String,
    /// Whether the account is enabled. Disabled accounts cannot authenticate.
    /// Stored as INTEGER 0/1 in SQLite; `1` = active.
    pub is_active: i64,
    /// Billing plan tier (`free` / `pro` / `team`). Drives feature gating and
    /// any plan-scoped behaviour; defaults to `free`.
    pub plan: String,
    /// Bound phone number (11-digit mainland China mobile), used for
    /// phone-number registration / login / password reset. `None` for
    /// accounts that registered with a username instead of a phone.
    pub phone: Option<String>,
    /// Credits wallet balance (integer credits; ~1 credit ≈ $0.001). Deducted
    /// per AI token usage and granted via signup bonus / invites / admin top-up.
    pub credits: i64,
    /// Personal, unique referral code for the "分享邀约有奖分销" affiliate
    /// program. The user's share link is
    /// `https://www.geekclaw.ai/register?invite=<code>`. NULL until first
    /// generated (lazily, on registration or first referral-page view).
    pub invite_code: Option<String>,
    /// `user_id` of the referrer whose `invite_code` this account registered
    /// with, or NULL for organic sign-ups. Logical link only (no FK contract).
    pub invited_by: Option<String>,
}

/// Invitation code issued by an admin and consumed on registration.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Invitation {
    pub id: i64,
    /// Random user-facing token (UNIQUE). Shared with the registrant.
    pub code: String,
    /// `user_id` of the admin who created the invitation (logical reference;
    /// deliberately NOT `_id`-suffixed to stay outside the reference contract).
    pub created_by: String,
    pub created_at: TimestampMs,
    pub expires_at: TimestampMs,
    /// `user_id` of the registrant who consumed the code, or NULL if unused.
    pub used_by: Option<String>,
    pub used_at: Option<TimestampMs>,
    /// Plan tier granted to the invitee on successful registration (NULL = default).
    pub plan: Option<String>,
    /// Initial credits granted to the invitee when the code is consumed.
    pub credits_grant: i64,
    /// Credits awarded to the inviter (`created_by`) on successful registration —
    /// the "invite a friend, both get credits" growth reward.
    pub reward_to_inviter: i64,
}
