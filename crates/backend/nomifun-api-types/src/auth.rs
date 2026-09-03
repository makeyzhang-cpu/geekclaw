use nomifun_common::UserId;
use serde::{Deserialize, Serialize};

/// Public user info returned in API responses.
///
/// Contains only the fields safe to expose to clients.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PublicUser {
    pub user_id: UserId,
    pub username: String,
    /// `admin` or `user`. Drives access to the user-management control plane.
    pub role: String,
    /// Whether the account is enabled.
    pub is_active: bool,
}

/// One row in the admin user list.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserListItem {
    pub user_id: UserId,
    pub username: String,
    pub role: String,
    pub is_active: bool,
    /// Last successful login, epoch milliseconds; `None` if never.
    pub last_login: Option<i64>,
    /// Billing plan tier (`free` / `pro` / `team`).
    pub plan: String,
    /// Credits wallet balance.
    pub credits: i64,
}

/// Response for `GET /api/auth/users`.
#[derive(Debug, Serialize, Deserialize)]
pub struct ListUsersResponse {
    pub success: bool,
    pub users: Vec<UserListItem>,
}

/// Request body for `POST /api/auth/users/{id}/role`.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetRoleRequest {
    pub role: String,
}

/// Invitation code as returned to admins.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvitationInfo {
    pub code: String,
    pub created_by: String,
    pub created_at: i64,
    pub expires_at: i64,
    pub used_by: Option<String>,
    pub used_at: Option<i64>,
    /// Plan tier granted to the invitee on success (NULL = default `free`).
    pub plan: Option<String>,
    /// Initial credits granted to the invitee when consumed.
    pub credits_grant: i64,
    /// Credits awarded to the inviter (`created_by`) on success — the
    /// bidirectional growth reward.
    pub reward_to_inviter: i64,
}

/// Response for `GET /api/auth/invitations`.
#[derive(Debug, Serialize, Deserialize)]
pub struct InvitationListResponse {
    pub success: bool,
    pub invitations: Vec<InvitationInfo>,
}

/// Request body for `POST /api/auth/invitations`.
#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct CreateInvitationRequest {
    /// Validity window in days. Defaults to 7.
    pub expires_in_days: i64,
    /// Plan tier granted to the invitee on success (`None` = default `free`).
    pub plan: Option<String>,
    /// Initial credits granted to the invitee when the code is consumed.
    pub credits_grant: i64,
    /// Credits awarded to the inviter on success — the bidirectional reward.
    pub reward_to_inviter: i64,
}

impl Default for CreateInvitationRequest {
    fn default() -> Self {
        Self {
            expires_in_days: 7,
            plan: None,
            credits_grant: 0,
            reward_to_inviter: 0,
        }
    }
}

/// Response for `POST /api/auth/invitations`.
#[derive(Debug, Serialize, Deserialize)]
pub struct CreateInvitationResponse {
    pub success: bool,
    pub code: String,
    pub expires_at: i64,
}

/// Login request body for `POST /login`.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

/// Register request body for `POST /api/auth/register`.
///
/// Closed registration: a valid, unexpired, unused invitation code is required.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegisterRequest {
    pub username: String,
    pub password: String,
    #[serde(rename = "inviteCode")]
    pub invite_code: String,
}

/// Login success response for `POST /login` and `POST /api/auth/qr-login`.
#[derive(Debug, Serialize, Deserialize)]
pub struct LoginResponse {
    pub success: bool,
    pub message: String,
    pub user: PublicUser,
    pub token: String,
}

impl LoginResponse {
    pub fn new(user: PublicUser, token: String) -> Self {
        Self {
            success: true,
            message: "Login successful".to_owned(),
            user,
            token,
        }
    }
}

/// Change password request body for `POST /api/auth/change-password`.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

/// Admin-set password request body for `POST /api/auth/users/{id}/change-password`.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AdminChangePasswordRequest {
    pub new_password: String,
}

/// Change username request body for `POST /api/auth/change-username`.
///
/// Unlike the local-only `/api/webui/change-username`, this authenticated
/// endpoint serves remote WebUI sessions, so it verifies the current
/// password — a hijacked browser session alone must not be able to rotate
/// the login identity.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChangeUsernameRequest {
    pub current_password: String,
    pub new_username: String,
}

/// Response for `POST /api/auth/change-username`.
#[derive(Debug, Serialize, Deserialize)]
pub struct ChangeUsernameResponse {
    pub username: String,
}

/// QR code login request body for `POST /api/auth/qr-login`.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QrLoginRequest {
    pub qr_token: String,
}

/// Auth status response for `GET /api/auth/status`.
#[derive(Debug, Serialize, Deserialize)]
pub struct AuthStatusResponse {
    pub success: bool,
    pub needs_setup: bool,
    pub user_count: u64,
    pub is_authenticated: bool,
}

/// Refresh token request body for `POST /api/auth/refresh`.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RefreshTokenRequest {
    pub token: String,
}

/// User info response for `GET /api/auth/user`.
#[derive(Debug, Serialize)]
pub struct UserInfoResponse {
    pub success: bool,
    pub user: PublicUser,
}

/// Refresh token response for `POST /api/auth/refresh`.
#[derive(Debug, Serialize)]
pub struct RefreshResponse {
    pub success: bool,
    pub token: String,
}

/// WebSocket token response for `GET /api/ws-token`.
#[derive(Debug, Serialize)]
pub struct WsTokenResponse {
    pub success: bool,
    pub ws_token: String,
    pub expires_in: u64,
}

// ---------------------------------------------------------------------------
// WebUI admin credential endpoints (local-only)
// ---------------------------------------------------------------------------

/// Change password request body for `POST /api/webui/change-password`.
///
/// No current_password field — this endpoint is local-mode only and assumes
/// the caller is the trusted Electron main process.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WebuiChangePasswordRequest {
    pub new_password: String,
}

/// Change username request body for `POST /api/webui/change-username`.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WebuiChangeUsernameRequest {
    pub new_username: String,
}

/// Response for `POST /api/webui/change-username`.
#[derive(Debug, Serialize, Deserialize)]
pub struct WebuiChangeUsernameResponse {
    pub username: String,
}

/// Response for `POST /api/webui/reset-password`.
///
/// Returns the freshly generated plaintext password. This is the only time
/// the caller sees it — subsequent reads hit the bcrypt hash only.
#[derive(Debug, Serialize, Deserialize)]
pub struct WebuiResetPasswordResponse {
    pub new_password: String,
}

/// Response for `POST /api/webui/generate-qr-token`.
///
/// Only the token and expiry are returned. URL assembly (host + port) is the
/// caller's responsibility, since only the Electron main process knows which
/// lanIP/port the WebUI is exposed on.
#[derive(Debug, Serialize, Deserialize)]
pub struct WebuiGenerateQrTokenResponse {
    pub token: String,
    pub expires_at_ms: i64,
}

// ---------------------------------------------------------------------------
// Phone-number SMS verification (registration / login / password reset)
// ---------------------------------------------------------------------------

/// Request body for `POST /api/auth/sms/send`.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SendSmsRequest {
    /// 11-digit mainland China mobile number.
    pub phone: String,
    /// `register`, `login`, or `reset`.
    pub purpose: String,
}

/// Request body for `POST /api/auth/register/phone`.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PhoneRegisterRequest {
    pub phone: String,
    /// 6-digit SMS code received by the phone.
    pub code: String,
    pub password: String,
    #[serde(rename = "inviteCode")]
    pub invite_code: String,
    /// Optional display username. When omitted the phone number is used as the
    /// login username, so the existing /login (find_by_username) path keeps
    /// working for phone-only registrations.
    #[serde(default)]
    pub username: Option<String>,
}

/// Request body for `POST /api/auth/login/phone`.
///
/// Either `password` or `code` must be supplied (at least one); supplying both
/// is allowed — password takes precedence when present.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PhoneLoginRequest {
    pub phone: String,
    pub password: Option<String>,
    pub code: Option<String>,
}

/// Request body for `POST /api/auth/reset-password/phone`.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResetPasswordPhoneRequest {
    pub phone: String,
    pub code: String,
    #[serde(rename = "newPassword")]
    pub new_password: String,
}

// ---------------------------------------------------------------------------
// Billing / economy DTOs (plan tiers + credits wallet + model pricing)
// ---------------------------------------------------------------------------

/// One credits-ledger row, as exposed to clients.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreditTransactionInfo {
    pub id: i64,
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
    pub created_at: i64,
}

/// A model's per-token pricing, keyed by `(provider, model, task)`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelPriceInfo {
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
    pub updated_at: i64,
}

/// Response for `GET /api/billing/me`: the signed-in user's wallet + ledger.
#[derive(Debug, Serialize, Deserialize)]
pub struct BillingBalance {
    pub success: bool,
    pub user_id: String,
    /// Billing plan tier (`free` / `pro` / `team`).
    pub plan: String,
    /// Current credits wallet balance.
    pub credits: i64,
    /// Most recent ledger rows, newest first.
    pub transactions: Vec<CreditTransactionInfo>,
}

/// Response for `GET /api/billing/pricing` (admin): all model prices.
#[derive(Debug, Serialize, Deserialize)]
pub struct ModelPriceListResponse {
    pub success: bool,
    pub prices: Vec<ModelPriceInfo>,
}

/// Admin request to manually adjust a user's credits.
///
/// `delta` is signed: positive grants, negative deducts. A ledger row is
/// appended so the change is auditable.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AdjustCreditsRequest {
    pub delta: i64,
    pub note: Option<String>,
}

/// Admin request to set a user's plan tier.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetPlanRequest {
    pub plan: String,
}

/// Admin request to insert/update a model's price (keyed by provider/model/task).
#[derive(Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct UpsertPricingRequest {
    pub provider: String,
    pub model: String,
    /// Defaults to `Chat` when omitted.
    pub task: String,
    pub input_credits_per_1k: f64,
    pub output_credits_per_1k: f64,
    pub cache_read_credits_per_1k: f64,
    pub currency: Option<String>,
}

impl Default for UpsertPricingRequest {
    fn default() -> Self {
        Self {
            provider: String::new(),
            model: String::new(),
            task: "Chat".to_string(),
            input_credits_per_1k: 0.0,
            output_credits_per_1k: 0.0,
            cache_read_credits_per_1k: 0.0,
            currency: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_public_user_serialization() {
        let user = PublicUser {
            user_id: UserId::new(),
            username: "admin".into(),
            role: "admin".into(),
            is_active: true,
        };
        let json = serde_json::to_value(&user).unwrap();
        assert_eq!(json["user_id"], user.user_id.as_str());
        assert_eq!(json["username"], "admin");
    }

    #[test]
    fn test_login_request_deserialization() {
        let raw = r#"{"username":"admin","password":"secret123"}"#;
        let req: LoginRequest = serde_json::from_str(raw).unwrap();
        assert_eq!(req.username, "admin");
        assert_eq!(req.password, "secret123");
    }

    #[test]
    fn test_login_request_missing_field() {
        let raw = r#"{"username":"admin"}"#;
        let result = serde_json::from_str::<LoginRequest>(raw);
        assert!(result.is_err());
    }

    #[test]
    fn test_login_response_new() {
        let user = PublicUser {
            user_id: UserId::new(),
            username: "admin".into(),
            role: "admin".into(),
            is_active: true,
        };
        let resp = LoginResponse::new(user.clone(), "jwt_token".into());
        assert!(resp.success);
        assert_eq!(resp.message, "Login successful");
        assert_eq!(resp.user, user);
        assert_eq!(resp.token, "jwt_token");
    }

    #[test]
    fn test_login_response_serialization() {
        let user_id = UserId::new();
        let resp = LoginResponse::new(
            PublicUser {
                user_id: user_id.clone(),
                username: "admin".into(),
                role: "admin".into(),
                is_active: true,
            },
            "eyJhbGciOi".into(),
        );
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["success"], true);
        assert_eq!(json["message"], "Login successful");
        assert_eq!(json["user"]["user_id"], user_id.as_str());
        assert_eq!(json["user"]["username"], "admin");
        assert_eq!(json["token"], "eyJhbGciOi");
    }

    #[test]
    fn test_change_password_request_snake_case() {
        let raw = r#"{"current_password":"old123","new_password":"new456"}"#;
        let req: ChangePasswordRequest = serde_json::from_str(raw).unwrap();
        assert_eq!(req.current_password, "old123");
        assert_eq!(req.new_password, "new456");
    }

    #[test]
    fn test_change_password_request_camel_case_rejected() {
        let raw = r#"{"currentPassword":"old","newPassword":"new"}"#;
        let result = serde_json::from_str::<ChangePasswordRequest>(raw);
        assert!(result.is_err());
    }

    #[test]
    fn test_qr_login_request_snake_case() {
        let raw = r#"{"qr_token":"abc123"}"#;
        let req: QrLoginRequest = serde_json::from_str(raw).unwrap();
        assert_eq!(req.qr_token, "abc123");
    }

    #[test]
    fn test_qr_login_request_camel_case_rejected() {
        let raw = r#"{"qrToken":"abc"}"#;
        let result = serde_json::from_str::<QrLoginRequest>(raw);
        assert!(result.is_err());
    }

    #[test]
    fn test_auth_status_response_snake_case() {
        let resp = AuthStatusResponse {
            success: true,
            needs_setup: true,
            user_count: 0,
            is_authenticated: false,
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["success"], true);
        assert_eq!(json["needs_setup"], true);
        assert_eq!(json["user_count"], 0);
        assert_eq!(json["is_authenticated"], false);
        // Verify snake_case keys exist, not camelCase
        assert!(json.get("needsSetup").is_none());
        assert!(json.get("userCount").is_none());
        assert!(json.get("isAuthenticated").is_none());
    }

    #[test]
    fn test_auth_status_response_deserialization() {
        let raw = json!({
            "success": true,
            "needs_setup": false,
            "user_count": 3,
            "is_authenticated": true
        });
        let resp: AuthStatusResponse = serde_json::from_value(raw).unwrap();
        assert!(resp.success);
        assert!(!resp.needs_setup);
        assert_eq!(resp.user_count, 3);
        assert!(resp.is_authenticated);
    }

    #[test]
    fn test_refresh_token_request_deserialization() {
        let raw = r#"{"token":"eyJhbGciOiJIUzI1NiJ9"}"#;
        let req: RefreshTokenRequest = serde_json::from_str(raw).unwrap();
        assert_eq!(req.token, "eyJhbGciOiJIUzI1NiJ9");
    }

    #[test]
    fn test_refresh_token_request_missing_token() {
        let raw = r#"{}"#;
        let result = serde_json::from_str::<RefreshTokenRequest>(raw);
        assert!(result.is_err());
    }

    #[test]
    fn public_user_rejects_noncanonical_user_id() {
        let value = json!({"user_id": "1", "username": "admin"});
        assert!(serde_json::from_value::<PublicUser>(value).is_err());
    }
}
