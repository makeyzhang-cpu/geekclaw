use std::sync::{Arc, OnceLock};
use std::time::Duration;

use axum::extract::rejection::JsonRejection;
use axum::body::Body;
use axum::extract::{Form, Json, Path, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::middleware::{from_fn, from_fn_with_state};
use axum::response::{Html, IntoResponse, Redirect, Response};
use axum::routing::{delete, get, post, put};
use axum::{Extension, Router};
use base64::Engine as _;
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use dashmap::DashMap;

use nomifun_api_types::{
    AdjustCreditsRequest, ApiResponse, AuthStatusResponse, BillingBalance, ChangePasswordRequest,
    ChangeUsernameRequest, ChangeUsernameResponse, CreateInvitationRequest, CreateInvitationResponse,
    CreditTransactionInfo, ErrorResponse, InvitationInfo, InvitationListResponse, ListUsersResponse,
    LoginRequest, LoginResponse, ModelPriceInfo, ModelPriceListResponse, PublicUser, QrLoginRequest,
    RegisterRequest, SetPlanRequest, SetRoleRequest, UpsertPricingRequest, UserListItem, RefreshResponse,
    RefreshTokenRequest, UserInfoResponse, WebuiChangePasswordRequest, WebuiChangeUsernameRequest,
    WebuiChangeUsernameResponse, WebuiGenerateQrTokenResponse, WebuiResetPasswordResponse, WsTokenResponse,
    SendSmsRequest, PhoneRegisterRequest, PhoneLoginRequest, ResetPasswordPhoneRequest,
};
use nomifun_common::{AppError, now_ms};
use nomifun_common::constants::SESSION_MAX_AGE_SECONDS;
use nomifun_db::{DbError, IUserRepository, models::{ModelPricing, Order, SubscriptionPlan, User}};

use crate::allinpay::{
    PAYTYPE_ALIPAY, PAYTYPE_WECHAT, ALLINPAY_DEFAULT_API_URL,
    KV_ALLINPAY_APPID, KV_ALLINPAY_API_URL, KV_ALLINPAY_CUSID, KV_ALLINPAY_KEY,
    KV_ALLINPAY_NOTIFY_URL, create_unified_order, query_order, resolve_allinpay_config,
    verify_notify, QueryOrderResult,
};

use crate::extract::extract_token_from_headers;
use crate::middleware::{AuthState, CurrentUser, auth_middleware};
use crate::trust::require_local_trust_middleware;
use crate::password::{dummy_password_hash, generate_password, hash_password, verify_password_timed};
use crate::qr_token::QrTokenStore;
use crate::rate_limit::{
    RateLimiter, api_rate_limit_middleware, auth_rate_limit_middleware, authenticated_action_rate_limit_middleware,
};
use crate::validation::{validate_password, validate_username};
use crate::error::AuthError;
use crate::aliyun_sms::{generate_sms_code, send_verification_sms};
use crate::{CookieConfig, JwtService};

/// Shared state for all auth route handlers.
#[derive(Clone)]
pub struct AuthRouterState {
    pub jwt_service: Arc<JwtService>,
    pub user_repo: Arc<dyn IUserRepository>,
    pub cookie_config: Arc<CookieConfig>,
    pub qr_token_store: Arc<QrTokenStore>,
}

fn into_public_user(user: User) -> Result<PublicUser, AppError> {
    Ok(PublicUser {
        user_id: user.user_id,
        username: user.username,
        role: user.role,
        is_active: user.is_active != 0,
    })
}

/// Build the auth router with all endpoints and middleware layers.
///
/// Returns a `Router` with these endpoints:
/// - `POST /login`
/// - `GET /login` (OAuth authorize page for the desktop `geekclaw://` deep-link flow)
/// - `POST /api/auth/setup` (one-time first-run admin creation)
/// - `POST /api/auth/register` (invite-code-gated registration)
/// - `POST /logout`
/// - `GET /api/auth/status`
/// - `GET /api/auth/user`
/// - `POST /api/auth/change-password`
/// - `POST /api/auth/refresh`
/// - `GET /api/ws-token`
/// - `POST /api/auth/qr-login`
/// - `GET /qr-login`
/// - `GET /api/auth/users` (admin)
/// - `POST /api/auth/users/{id}/role` (admin)
/// - `POST /api/auth/users/{id}/disable` (admin)
/// - `POST /api/auth/users/{id}/enable` (admin)
/// - `POST /api/auth/invitations` (admin)
/// - `GET /api/auth/invitations` (admin)
/// - `DELETE /api/auth/invitations/{code}` (admin)
/// - `POST /api/webui/change-password` (local-only)
/// - `POST /api/webui/change-username` (local-only)
/// - `POST /api/webui/reset-password` (local-only)
/// - `POST /api/webui/generate-qr-token` (local-only)
pub fn auth_routes(state: AuthRouterState) -> Router {
    let auth_limiter = Arc::new(RateLimiter::auth());
    let api_limiter = Arc::new(RateLimiter::api());
    let action_limiter = Arc::new(RateLimiter::authenticated_action());

    // Start periodic cleanup for rate limiters
    let cleanup_interval = Duration::from_secs(60);
    auth_limiter.start_cleanup_task(cleanup_interval);
    api_limiter.start_cleanup_task(cleanup_interval);
    action_limiter.start_cleanup_task(cleanup_interval);

    let auth_state = AuthState {
        jwt_service: state.jwt_service.clone(),
        user_repo: state.user_repo.clone(),
        cookie_config: state.cookie_config.clone(),
    };

    // Auth rate limited routes (login POST, setup, qr-login).
    //
    // NOTE: GET /login (the login/authorize page) deliberately lives in
    // `api_public`, NOT here. It carries no credentials, so it must not share
    // the auth limiter — otherwise a locked-out IP cannot even *open* the page
    // (429 on GET) and can never recover without waiting out the window.
    // Only credential-bearing POST actions consume the auth budget.
    let auth_rate_limited = Router::new()
        .route("/login", post(login_handler))
        .route("/api/auth/setup", post(setup_handler))
        .route("/api/auth/register", post(register_handler))
        .route("/api/auth/qr-login", post(qr_login_handler))
        .route_layer(from_fn_with_state(auth_limiter, auth_rate_limit_middleware))
        .with_state(state.clone());

    // Truly public, no-auth route: first-run/login status probe + the login
    // page itself (GET /login renders the authorize page without consuming the
    // auth rate-limit budget).
    let api_public = Router::new()
        .route("/api/auth/status", get(status_handler))
        .route("/login", get(authorize_page_handler))
        .route("/api/plans", get(public_plans_handler))
        // Proxy to the central cloud store backend (https://www.geekclaw.ai/admin)
        // so the desktop pricing page can read admin-managed plans without CORS.
        .route("/api/store/plans", get(store_plans_proxy_handler))
        // A2A 跨境电商平台：商品目录以云端管理后台为唯一真源。
        // 桌面端经此公开代理读取云端商品（云端未就绪时返回错误，前端降级本地 mock）。
        .route("/api/store/a2a/products", get(store_a2a_products_proxy_handler))
        // Cloud account OAuth (system browser + geekclaw:// deep link; token stays server-side).
        .route("/api/oauth/geekclaw/start", get(oauth_geekclaw_start_handler))
        .route("/api/oauth/geekclaw/exchange", post(oauth_geekclaw_exchange_handler))
        .route("/api/auth/cloud-status", get(cloud_status_handler))
        .route("/api/auth/cloud-logout", post(cloud_logout_handler))
        // Send an SMS verification code (rate-limited per phone inside handler).
        .route("/api/auth/sms/send", post(sms_send_handler))
        .route_layer(from_fn_with_state(api_limiter.clone(), api_rate_limit_middleware))
        .with_state(state.clone());

    // Phone-number account flows: SMS-code registration, phone+password/code
    // login, and phone-code password reset. Separate auth limiter (5/15min per
    // IP) because these are credential-bearing endpoints like /login.
    let sms_auth_limiter = Arc::new(RateLimiter::auth());
    let sms_account = Router::new()
        .route("/api/auth/register/phone", post(phone_register_handler))
        .route("/api/auth/login/phone", post(phone_login_handler))
        .route("/api/auth/reset-password/phone", post(reset_password_phone_handler))
        .route_layer(from_fn_with_state(sms_auth_limiter, auth_rate_limit_middleware))
        .with_state(state.clone());

    // Local-only credential routes. These have NO auth middleware, so
    // they are gated by `require_local_trust_middleware`: only the local desktop
    // client (which presents the per-boot trust secret, resolved upstream by
    // `trust_resolve_middleware` into a `LocalTrusted` marker) may reach them.
    let api_local_only = Router::new()
        // WebUI admin credential endpoints — local desktop client only.
        .route("/api/webui/change-password", post(webui_change_password_handler))
        .route("/api/webui/change-username", post(webui_change_username_handler))
        .route("/api/webui/reset-password", post(webui_reset_password_handler))
        .route("/api/webui/generate-qr-token", post(webui_generate_qr_token_handler))
        // Cloud billing proxy — desktop shell only, uses stored cloud JWT.
        .route("/api/store/me", get(store_billing_me_proxy_handler))
        // Referral / affiliate: desktop shell only, forwards to the cloud
        // backend (which owns the referral data) using the stored cloud JWT.
        .route("/api/store/referral/info", get(referral_info_proxy_handler))
        .route("/api/store/subscribe", post(store_subscribe_proxy_handler))
        .route("/api/store/order/{reqsn}", get(store_order_status_proxy_handler))
        .route("/api/store/order/{reqsn}/cancel", post(store_order_cancel_proxy_handler))
        // A2A 跨境电商独立站：开通授权状态以云端管理后台为准（本地 trust 代理，
        // 带云端 JWT 转发）。云端未授权时前端显示开通引导，不开通不可用。
        .route("/api/store/a2a/storefront/status", get(store_a2a_storefront_status_proxy_handler))
        .route_layer(from_fn(require_local_trust_middleware))
        .route_layer(from_fn_with_state(api_limiter.clone(), api_rate_limit_middleware))
        .with_state(state.clone());

    // Authenticated routes: api limiter -> auth -> action limiter
    // route_layer order: last added = outermost (first to process)
    let authenticated = Router::new()
        .route("/logout", post(logout_handler))
        .route("/api/auth/user", get(user_handler))
        .route("/api/auth/change-password", post(change_password_handler))
        .route("/api/auth/change-username", post(change_username_handler))
        .route("/api/ws-token", get(ws_token_handler))
        // Billing: the signed-in user's own wallet + ledger.
        .route("/api/billing/me", get(billing_me_handler))
        // Referral / affiliate: the signed-in user's own invite stats. Served by
        // the cloud backend directly (Bearer JWT from the desktop proxy also works).
        .route("/api/referral/info", get(referral_info_handler))
        // Admin control plane (invite-code-gated user management).
        .route("/api/auth/users", get(list_users_handler))
        .route("/api/auth/users/{id}/role", post(set_role_handler))
        .route("/api/auth/users/{id}/disable", post(disable_handler))
        .route("/api/auth/users/{id}/enable", post(enable_handler))
        .route("/api/auth/users/{id}/plan", post(set_plan_handler))
        .route("/api/auth/invitations", post(create_invitation_handler).get(list_invitations_handler))
        .route("/api/auth/invitations/{code}", delete(delete_invitation_handler))
    // Admin billing control plane.
    .route("/api/billing/users/{id}/adjust", post(adjust_credits_handler))
    .route("/api/billing/users/{id}", get(admin_billing_handler))
    .route("/api/billing/pricing", get(list_pricing_handler).put(upsert_pricing_handler))
    // Consumer billing: poll an order's payment status (authenticated buyer).
    .route("/api/billing/order/{reqsn}", get(order_status_handler))
        // Consumer billing: explicitly cancel an unpaid order (honest failure).
        .route("/api/billing/order/{reqsn}/cancel", post(cancel_order_handler))
        // Consumer self-service purchase (open registration; 通联支付 planned).
        .route("/api/billing/subscribe", post(subscribe_handler))
        // Admin console: payment config + subscription plans (admin-gated inside).
        .route("/api/admin/payment-config", get(get_payment_config_handler).put(put_payment_config_handler))
        .route("/api/admin/voice-config", get(get_voice_config_handler).put(put_voice_config_handler))
        .route("/api/admin/plans", get(list_admin_plans_handler).post(create_plan_handler))
        .route("/api/admin/plans/{plan_id}", put(update_plan_handler).delete(delete_plan_handler))
        .route("/api/admin/orders", get(list_admin_orders_handler))
        // Consumer: digital-twin TTS via admin-configured 火山引擎 (auth only).
        .route("/api/voice/speak", post(voice_speak_handler))
        .route_layer(from_fn_with_state(
            action_limiter.clone(),
            authenticated_action_rate_limit_middleware,
        ))
        .route_layer(from_fn_with_state(auth_state, auth_middleware))
        .route_layer(from_fn_with_state(api_limiter.clone(), api_rate_limit_middleware))
        .with_state(state.clone());

    // API + action limited routes (token in body, no auth middleware)
    let api_action_limited = Router::new()
        .route("/api/auth/refresh", post(refresh_handler))
        .route_layer(from_fn_with_state(
            action_limiter,
            authenticated_action_rate_limit_middleware,
        ))
        .route_layer(from_fn_with_state(api_limiter, api_rate_limit_middleware))
        .with_state(state.clone());

    // Static page (no middleware)
    let static_routes = Router::new().route("/qr-login", get(qr_login_page));

    // Allinpay async notify callback: NO auth (it comes from Allinpay's
    // servers), NO rate limiting (they retry on failure), and the path is
    // exempt from CSRF in `csrf.rs`. It only verifies the MD5 signature.
    let allinpay_webhook = Router::new()
        .route("/api/billing/notify/allinpay", post(allinpay_notify_handler))
        .with_state(state.clone());

    Router::new()
        .merge(auth_rate_limited)
        .merge(api_public)
        .merge(sms_account)
        .merge(api_local_only)
        .merge(authenticated)
        .merge(api_action_limited)
        .merge(allinpay_webhook)
        .merge(static_routes)
}

// ---------------------------------------------------------------------------
// POST /login
// ---------------------------------------------------------------------------

/// Returns true for 11-digit strings starting with 1 (Chinese mobile numbers).
fn is_chinese_mobile(s: &str) -> bool {
    s.len() == 11 && s.starts_with('1') && s.chars().all(|c| c.is_ascii_digit())
}

async fn login_handler(
    State(state): State<AuthRouterState>,
    headers: HeaderMap,
    body: Result<Json<LoginRequest>, JsonRejection>,
) -> Result<Response, AppError> {
    // Fail loudly BEFORE credential checks when this deployment issues Secure
    // cookies but the page came over plain HTTP — the browser would silently
    // drop the session cookie and the user would loop on the login screen.
    state.cookie_config.reject_plaintext_login_when_secure(&headers)?;

    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;

    // Input length validation (per API spec)
    if req.username.len() > 32 {
        return Err(AppError::BadRequest("Username must not exceed 32 characters".into()));
    }
    if req.password.len() > 128 {
        return Err(AppError::BadRequest("Password must not exceed 128 characters".into()));
    }

    // Look up user by username; if missing and the input is a Chinese mobile
    // number, also try by phone so the same account works with either the
    // custom username or the registered phone number (web ↔ desktop parity).
    let username_or_phone = req.username.trim();
    let user = match state
        .user_repo
        .find_by_username(username_or_phone)
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?
    {
        Some(u) => Some(u),
        None if is_chinese_mobile(username_or_phone) => state
            .user_repo
            .find_by_phone(username_or_phone)
            .await
            .map_err(|e| AppError::Internal(format!("Database error: {e}")))?,
        None => None,
    };

    let (found_user, password_valid) = match user {
        Some(u) if u.password_hash.trim().is_empty() => {
            // Seeded user with no password yet (first-run local mode).
            // Treat as invalid credentials; run dummy verify for timing symmetry
            // and to avoid bcrypt error on empty hash leaking as a 500.
            let _ = verify_password_timed(&req.password, dummy_password_hash()).await;
            (None, false)
        }
        Some(u) => {
            let valid = verify_password_timed(&req.password, &u.password_hash).await?;
            (Some(u), valid)
        }
        None => {
            // Prevent user enumeration via timing
            let _ = verify_password_timed(&req.password, dummy_password_hash()).await;
            (None, false)
        }
    };

    if !password_valid {
        return Err(AppError::Unauthorized("Invalid username or password".into()));
    }

    let user = found_user.ok_or_else(|| AppError::Unauthorized("Invalid username or password".into()))?;

    let token = state
        .jwt_service
        .sign(user.user_id.as_str(), &user.username)
        .map_err(|e| AppError::Internal(format!("Token signing error: {e}")))?;

    // Update last login (best-effort)
    if let Err(e) = state.user_repo.update_last_login(user.user_id.as_str()).await {
        tracing::warn!("Failed to update last login for {}: {e}", user.user_id);
    }

    let cookie = state.cookie_config.build_session_cookie(&token);
    let resp = LoginResponse::new(into_public_user(user)?, token);

    Ok(([(header::SET_COOKIE, cookie)], Json(resp)).into_response())
}

// ---------------------------------------------------------------------------
// POST /logout
// ---------------------------------------------------------------------------

async fn logout_handler(State(state): State<AuthRouterState>, headers: HeaderMap) -> Result<Response, AppError> {
    if let Some(token) = extract_token_from_headers(&headers) {
        state.jwt_service.blacklist_token(&token);
    }

    let cookie = state.cookie_config.clear_session_cookie();
    let resp = ApiResponse::message("Logged out successfully");

    Ok(([(header::SET_COOKIE, cookie)], Json(resp)).into_response())
}

// ---------------------------------------------------------------------------
// GET /login — Cloud OAuth authorize page (self-contained HTML)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct AuthorizeQuery {
    #[serde(default)]
    redirect_uri: Option<String>,
    #[serde(default)]
    state: Option<String>,
}

/// `GET /login` — render a self-contained login/register page for the desktop
/// OAuth flow. The desktop's `/api/oauth/geekclaw/start` 302s the system browser
/// here with `redirect_uri=geekclaw://auth/callback&state=...`. After the user
/// authenticates against the existing `/api/auth/login` (or `/api/auth/register`)
/// endpoint, the page bounces the browser to `redirect_uri?token=<jwt>&state=<state>`
/// — the desktop's `geekclaw://` deep link — so the JWT is delivered straight to
/// the local backend without ever sitting in browser storage.
async fn authorize_page_handler(Query(q): Query<AuthorizeQuery>) -> Html<String> {
    // Only the desktop deep link is a valid post-login target. An attacker-supplied
    // `redirect_uri` (e.g. `https://evil.com`) is rejected by falling back to the
    // canonical deep link, preventing open-redirect / token exfiltration.
    let redirect_uri = q
        .redirect_uri
        .filter(|r| r.starts_with("geekclaw://"))
        .unwrap_or_else(|| "geekclaw://auth/callback".to_string());
    let state = q.state.unwrap_or_default();

    // Embed as JSON so serde escapes any HTML/JS metacharacters (XSS-safe).
    let config_json = serde_json::json!({ "redirect_uri": redirect_uri, "state": state }).to_string();

    Html(build_authorize_html(&config_json))
}

/// Build the self-contained OAuth authorize HTML page (login + register tabs).
/// Inline the same brand logo (`geekclaw-claw.png`) the desktop shell uses, as a
/// base64 data-URI, so the web `/login` page stays visually identical to the
/// desktop CloudLoginWall without needing a separate static-asset route.
fn geekclaw_logo_data_uri() -> &'static str {
    static URI: OnceLock<String> = OnceLock::new();
    URI.get_or_init(|| {
        // Path is relative to this source file (crates/backend/nomifun-auth/src).
        let bytes = include_bytes!("../../../../ui/public/geekclaw-claw.png");
        format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )
    })
}

fn build_authorize_html(config_json: &str) -> String {
    let tmpl = r##"<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>GeekClaw 账号登录</title>
<style>
  :root{--bg:#fff8f5;--card:#ffffff;--fg:#1a1a1a;--muted:#666666;--line:#f0e6e0;--primary:#ff6a00;--primary2:#ff8f00;--err:#e23b3b;--ok:#16a34a;}
  *{box-sizing:border-box}
  body{position:relative;overflow:hidden;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(1200px 700px at 50% -15%,#ffe6d1,#fff8f5 55%);color:var(--fg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;}
  .glow{position:absolute;top:-12%;left:50%;transform:translateX(-50%);width:540px;height:540px;border-radius:50%;background:radial-gradient(circle,rgba(255,106,0,.16),transparent 62%);filter:blur(10px);pointer-events:none;}
  .card{position:relative;width:384px;max-width:92vw;background:rgba(255,255,255,.92);border:1px solid var(--line);border-radius:22px;padding:34px 30px;box-shadow:0 20px 60px rgba(255,106,0,.18);backdrop-filter:blur(10px);}
  .brand{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:4px;}
  .brand img{width:34px;height:34px;border-radius:50%;object-fit:cover;box-shadow:0 8px 20px rgba(255,106,0,.35);}
  .brand h1{font-size:20px;margin:0;font-weight:800;letter-spacing:.3px;color:var(--fg);line-height:34px;}
  .code-row{display:flex;gap:8px;}
  .code-row input{flex:1;min-width:0;}
  .code-btn{flex:0 0 auto;white-space:nowrap;padding:0 14px;border:1px solid var(--primary);background:#fff5f0;color:var(--primary);border-radius:11px;font-size:13px;cursor:pointer;transition:all .2s;}
  .code-btn:hover{background:linear-gradient(135deg,var(--primary),var(--primary2));color:#fff;}
  .code-btn:disabled{opacity:.55;cursor:default;background:#fff5f0;color:var(--muted);}
  .sub{color:var(--muted);font-size:13px;margin:8px 0 20px;line-height:1.6;}
  .tabs{display:flex;gap:8px;margin-bottom:18px;}
  .tab{flex:1;text-align:center;padding:9px 0;border-radius:11px;cursor:pointer;background:#fff5f0;color:var(--muted);font-size:14px;border:1px solid var(--line);transition:all .2s;}
  .tab.active{color:#fff;background:linear-gradient(135deg,var(--primary),var(--primary2));border-color:transparent;font-weight:600;}
  label{display:block;font-size:12px;color:var(--muted);margin:12px 0 6px;}
  input{width:100%;padding:12px 13px;border-radius:11px;border:1px solid var(--line);background:#fffaf7;color:var(--fg);font-size:14px;outline:none;transition:border-color .2s,box-shadow .2s;}
  input:focus{border-color:var(--primary);box-shadow:0 0 0 3px rgba(255,106,0,.12);}
  button.primary{width:100%;margin-top:20px;padding:13px 0;border:0;border-radius:11px;background:linear-gradient(135deg,var(--primary),var(--primary2));color:#fff;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 10px 24px rgba(255,106,0,.32);transition:transform .1s,box-shadow .2s;}
  button.primary:hover{box-shadow:0 14px 32px rgba(255,106,0,.42);}
  button.primary:active{transform:translateY(1px);}
  .msg{margin-top:14px;font-size:13px;min-height:18px;}
  .msg.err{color:var(--err);}
  .msg.ok{color:var(--ok);}
  .pane{display:none;}
  .pane.active{display:block;}
</style>
</head>
<body>
  <div class="glow"></div>
  <div class="card">
    <div class="brand"><img src="__LOGO__" alt="GeekClaw"/><h1>GeekClaw</h1></div>
    <div class="sub">登录以在桌面端同步你的账号、订阅与积分</div>
    <div class="tabs">
      <div class="tab active" id="tab-login" onclick="switchTab('login')">登录</div>
      <div class="tab" id="tab-register" onclick="switchTab('register')">注册</div>
    </div>

    <form class="pane active" id="pane-login" onsubmit="return doLogin(event)">
      <label>用户名</label>
      <input id="login-user" type="text" autocomplete="username" placeholder="用户名" required/>
      <label>密码</label>
      <input id="login-pass" type="password" autocomplete="current-password" placeholder="密码" required/>
      <button class="primary" type="submit">登录并授权桌面端</button>
    </form>

    <form class="pane" id="pane-register" onsubmit="return doRegister(event)">
      <label>手机号</label>
      <input id="reg-phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="11 位手机号" required/>
      <label>短信验证码</label>
      <div class="code-row">
        <input id="reg-code-sms" type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="6 位验证码" required/>
        <button type="button" class="code-btn" id="btn-send-code" onclick="sendCode()">获取验证码</button>
      </div>
      <label>用户名（选填）</label>
      <input id="reg-user" type="text" autocomplete="username" placeholder="留空则使用手机号"/>
      <label>密码</label>
      <input id="reg-pass" type="password" autocomplete="new-password" placeholder="密码（至少 8 位）" required/>
      <label>邀请码（如需要）</label>
      <input id="reg-code" type="text" placeholder="选填"/>
      <button class="primary" type="submit">注册并授权桌面端</button>
    </form>

    <div class="msg" id="msg"></div>
  </div>

<script>
const OAUTH = __CONFIG__;
function switchTab(name){
  document.getElementById('tab-login').classList.toggle('active', name==='login');
  document.getElementById('tab-register').classList.toggle('active', name==='register');
  document.getElementById('pane-login').classList.toggle('active', name==='login');
  document.getElementById('pane-register').classList.toggle('active', name==='register');
}
function setMsg(text, isErr){
  const el=document.getElementById('msg');
  el.textContent=text||'';
  el.className='msg'+(isErr?' err':' ok');
}
function bounce(token){
  const base=OAUTH.redirect_uri||'geekclaw://auth/callback';
  const sep=base.indexOf('?')>=0?'&':'?';
  const url=base+sep+'token='+encodeURIComponent(token)+'&state='+encodeURIComponent(OAUTH.state||'');
  window.location.href=url;
}
async function doLogin(e){
  e.preventDefault();
  setMsg('');
  const u=document.getElementById('login-user').value.trim();
  const p=document.getElementById('login-pass').value;
  if(!u||!p){setMsg('请输入用户名和密码',true);return;}
  try{
    const res=await fetch('/api/auth/login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
    const data=await res.json().catch(function(){return {};});
    if(data&&data.token){setMsg('登录成功，正在返回桌面端…');bounce(data.token);return;}
    setMsg((data&&(data.message||data.error||data.reason))||'用户名或密码错误',true);
  }catch(err){setMsg('网络错误，请稍后重试',true);}
}
async function sendCode(){
  setMsg('');
  const phone=document.getElementById('reg-phone').value.trim();
  if(!/^1\d{10}$/.test(phone)){setMsg('请输入有效的 11 位手机号',true);return;}
  const btn=document.getElementById('btn-send-code');
  btn.disabled=true;
  try{
    const res=await fetch('/api/auth/sms/send',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:phone,purpose:'register'})});
    const data=await res.json().catch(function(){return {};});
    if(res.ok && data && data.data){
      const dev=data.data.dev_code;
      if(dev){setMsg('验证码已发送（开发模式，验证码：'+dev+'）',false);}
      else{setMsg('验证码已发送，请查收短信',false);}
      let s=60;
      btn.textContent=s+' 秒后重发';
      const timer=setInterval(function(){s--;if(s<=0){clearInterval(timer);btn.disabled=false;btn.textContent='获取验证码';}else{btn.textContent=s+' 秒后重发';}},1000);
      return;
    }
    setMsg((data&&(data.message||data.error||data.reason))||'验证码发送失败',true);
  }catch(err){setMsg('网络错误，请稍后重试',true);}
  btn.disabled=false;
}
async function doRegister(e){
  e.preventDefault();
  setMsg('');
  const phone=document.getElementById('reg-phone').value.trim();
  const code=document.getElementById('reg-code-sms').value.trim();
  const p=document.getElementById('reg-pass').value;
  const u=document.getElementById('reg-user').value.trim();
  const c=document.getElementById('reg-code').value.trim();
  if(!/^1\d{10}$/.test(phone)){setMsg('请输入有效的 11 位手机号',true);return;}
  if(!/^\d{6}$/.test(code)){setMsg('请输入 6 位短信验证码',true);return;}
  if(!p){setMsg('请设置密码',true);return;}
  try{
    const body={phone:phone,code:code,password:p,inviteCode:c};
    if(u){body.username=u;}
    const res=await fetch('/api/auth/register/phone',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await res.json().catch(function(){return {};});
    if(data&&data.token){setMsg('注册成功，正在返回桌面端…');bounce(data.token);return;}
    setMsg((data&&(data.message||data.error||data.reason))||'注册失败（可能需要邀请码）',true);
  }catch(err){setMsg('网络错误，请稍后重试',true);}
}
</script>
</body>
</html>"##;
    tmpl
        .replacen("__CONFIG__", config_json, 1)
        .replacen("__LOGO__", geekclaw_logo_data_uri(), 1)
}

// ---------------------------------------------------------------------------
// GET /api/auth/status
// ---------------------------------------------------------------------------

async fn status_handler(
    State(state): State<AuthRouterState>,
    headers: HeaderMap,
) -> Result<Json<AuthStatusResponse>, AppError> {
    let has_users = state
        .user_repo
        .has_users()
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?;

    let user_count = state
        .user_repo
        .count_users()
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?;

    // Check authentication without requiring it
    let is_authenticated = extract_token_from_headers(&headers)
        .and_then(|token| state.jwt_service.verify(&token).ok())
        .is_some();

    Ok(Json(AuthStatusResponse {
        success: true,
        needs_setup: !has_users,
        user_count: user_count as u64,
        is_authenticated,
    }))
}

// ---------------------------------------------------------------------------
// POST /api/auth/setup — one-time first-run admin creation
// ---------------------------------------------------------------------------

/// Create the initial admin account on a fresh install, then log them in.
///
/// Available ONLY while the install is uninitialised: the very first visitor's
/// chosen username + password become the admin credentials, and the response
/// sets the session cookie so they are immediately logged in. The write is an
/// atomic conditional UPDATE (only matches the empty-password installation owner), so
/// even two concurrent first-run requests cannot both win — the loser gets
/// `409 Conflict` and never overwrites the winner's account.
///
/// Reuses [`LoginRequest`]/[`LoginResponse`] (same `{username, password}` shape
/// and `{success, user, token}` reply as `/login`). CSRF-exempt like `/login`
/// (see `csrf::csrf_middleware`) and behind the auth rate limiter.
///
/// SECURITY: there is a brief first-run window before setup completes where any
/// client reaching the port could claim the admin. Operators who need to close
/// it can pre-seed with `GEEKCLAW_ADMIN_PASSWORD` (see
/// `nomifun_app::bootstrap::ensure_admin_credentials`), which makes this return
/// 409 from the first boot.
async fn setup_handler(
    State(state): State<AuthRouterState>,
    headers: HeaderMap,
    body: Result<Json<LoginRequest>, JsonRejection>,
) -> Result<Response, AppError> {
    // Same Secure-cookie trap as login: refuse a plain-HTTP browser setup
    // before it creates an admin whose session cookie can never stick.
    state.cookie_config.reject_plaintext_login_when_secure(&headers)?;

    // One-time only: refuse once any real (non-empty-password) user exists.
    let has_users = state
        .user_repo
        .has_users()
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?;
    if has_users {
        return Err(AppError::Conflict("Admin account already initialized".into()));
    }

    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;

    let username = req.username.trim().to_owned();
    validate_username(&username).map_err(|e| AppError::BadRequest(e.to_string()))?;
    validate_password(&req.password).map_err(|e| AppError::BadRequest(e.to_string()))?;

    // Hash on a blocking thread (bcrypt is CPU-bound), mirroring change-password.
    let password = req.password.clone();
    let password_hash = tokio::task::spawn_blocking(move || hash_password(&password))
        .await
        .map_err(|e| AppError::Internal(format!("Task join error: {e}")))??;

    // Atomically claim the uninitialised admin slot. The conditional UPDATE is
    // the authoritative one-time gate: if a concurrent request already set the
    // credentials, this writes 0 rows and we return 409 instead of clobbering
    // the winner. (The has_users() check above is just a cheap pre-reject.)
    let provisioned = state
        .user_repo
        .set_system_user_credentials_if_uninitialized(&username, &password_hash)
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?;
    if !provisioned {
        return Err(AppError::Conflict("Admin account already initialized".into()));
    }

    let user = state
        .user_repo
        .get_primary_webui_user()
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?
        .ok_or_else(|| AppError::Internal("Admin user missing after setup".into()))?;

    let token = state
        .jwt_service
        .sign(user.user_id.as_str(), &user.username)
        .map_err(|e| AppError::Internal(format!("Token signing error: {e}")))?;

    if let Err(e) = state.user_repo.update_last_login(user.user_id.as_str()).await {
        tracing::warn!("Failed to update last login for {}: {e}", user.user_id);
    }

    let cookie = state.cookie_config.build_session_cookie(&token);
    let resp = LoginResponse::new(into_public_user(user)?, token);

    tracing::info!("first-run setup: initial admin account created");
    Ok(([(header::SET_COOKIE, cookie)], Json(resp)).into_response())
}

// ---------------------------------------------------------------------------
// GET /api/auth/user
// ---------------------------------------------------------------------------

async fn user_handler(Extension(user): Extension<CurrentUser>) -> Json<UserInfoResponse> {
    Json(UserInfoResponse {
        success: true,
        user: PublicUser {
            user_id: user.id,
            username: user.username,
            role: user.role,
            is_active: user.is_active != 0,
        },
    })
}

// ---------------------------------------------------------------------------
// POST /api/auth/change-password
// ---------------------------------------------------------------------------

async fn change_password_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
    body: Result<Json<ChangePasswordRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;

    // Validate new password strength
    validate_password(&req.new_password)?;

    // Fetch user record
    let user = state
        .user_repo
        .find_by_id(current_user.id.as_str())
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?
        .ok_or_else(|| AppError::NotFound("User not found".into()))?;

    // Verify current password
    let valid = verify_password_timed(&req.current_password, &user.password_hash).await?;
    if !valid {
        return Err(AppError::Unauthorized("Current password is incorrect".into()));
    }

    // Hash new password on blocking thread
    let password = req.new_password.clone();
    let new_hash = tokio::task::spawn_blocking(move || hash_password(&password))
        .await
        .map_err(|e| AppError::Internal(format!("Task join error: {e}")))??;

    // Persist new password hash
    state
        .user_repo
        .update_password(current_user.id.as_str(), &new_hash)
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?;

    // Rotate JWT secret to invalidate all sessions
    let new_secret = state
        .jwt_service
        .rotate_secret()
        .map_err(|e| AppError::Internal(format!("Secret rotation error: {e}")))?;

    // Persist new secret to database
    state
        .user_repo
        .update_jwt_secret(current_user.id.as_str(), &new_secret)
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?;

    Ok(Json(ApiResponse::message("Password changed successfully")))
}

// ---------------------------------------------------------------------------
// POST /api/auth/change-username
// ---------------------------------------------------------------------------

/// Authenticated username change for remote (WebUI) sessions.
///
/// The local-only `/api/webui/change-username` trusts physical possession of
/// the desktop and skips password verification; this variant serves docker/
/// WebUI deployments where changing the login must not require editing
/// container parameters, so it demands the current password instead
/// (audit 2026-07-30, finding I). Sessions stay valid: the JWT carries the
/// user id and lookups resolve the fresh username from the database.
async fn change_username_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
    body: Result<Json<ChangeUsernameRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<ChangeUsernameResponse>>, AppError> {
    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;

    let trimmed = req.new_username.trim().to_owned();
    validate_username(&trimmed)?;

    let user = state
        .user_repo
        .find_by_id(current_user.id.as_str())
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?
        .ok_or_else(|| AppError::NotFound("User not found".into()))?;

    let valid = verify_password_timed(&req.current_password, &user.password_hash).await?;
    if !valid {
        return Err(AppError::Unauthorized("Current password is incorrect".into()));
    }

    if user.username != trimmed {
        state
            .user_repo
            .update_username(current_user.id.as_str(), &trimmed)
            .await
            .map_err(|e| AppError::Internal(format!("Database error: {e}")))?;
    }

    Ok(Json(ApiResponse::ok(ChangeUsernameResponse { username: trimmed })))
}

// ---------------------------------------------------------------------------
// POST /api/auth/refresh
// ---------------------------------------------------------------------------

async fn refresh_handler(
    State(state): State<AuthRouterState>,
    body: Result<Json<RefreshTokenRequest>, JsonRejection>,
) -> Result<Json<RefreshResponse>, AppError> {
    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;

    let payload = state
        .jwt_service
        .verify(&req.token)
        .map_err(|_| AppError::Unauthorized("Invalid or expired token".into()))?;

    let new_token = state
        .jwt_service
        .sign(payload.user_id.as_str(), &payload.username)
        .map_err(|e| AppError::Internal(format!("Token signing error: {e}")))?;

    Ok(Json(RefreshResponse {
        success: true,
        token: new_token,
    }))
}

// ---------------------------------------------------------------------------
// GET /api/ws-token
// ---------------------------------------------------------------------------

async fn ws_token_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
    headers: HeaderMap,
) -> Result<Json<WsTokenResponse>, AppError> {
    // Reuse the existing session token for WebSocket connections
    let token = extract_token_from_headers(&headers).ok_or_else(|| AppError::Unauthorized("No token found".into()))?;

    // Ensure user still exists
    state
        .user_repo
        .find_by_id(current_user.id.as_str())
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?
        .ok_or_else(|| AppError::Unauthorized("User not found".into()))?;

    // Cookie max age in milliseconds
    let expires_in = SESSION_MAX_AGE_SECONDS * 1000;

    Ok(Json(WsTokenResponse {
        success: true,
        ws_token: token,
        expires_in,
    }))
}

// ---------------------------------------------------------------------------
// POST /api/auth/qr-login
// ---------------------------------------------------------------------------

async fn qr_login_handler(
    State(state): State<AuthRouterState>,
    headers: HeaderMap,
    body: Result<Json<QrLoginRequest>, JsonRejection>,
) -> Result<Response, AppError> {
    // Same Secure-cookie trap as login (finding D).
    state.cookie_config.reject_plaintext_login_when_secure(&headers)?;

    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;

    // Validate and consume QR token (one-time use)
    state.qr_token_store.validate_and_consume(&req.qr_token)?;

    // Get primary WebUI user for QR login
    let user = state
        .user_repo
        .get_primary_webui_user()
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?
        .ok_or_else(|| AppError::Internal("No primary user configured".into()))?;

    let token = state
        .jwt_service
        .sign(user.user_id.as_str(), &user.username)
        .map_err(|e| AppError::Internal(format!("Token signing error: {e}")))?;

    // Update last login (best-effort)
    if let Err(e) = state.user_repo.update_last_login(user.user_id.as_str()).await {
        tracing::warn!("Failed to update last login for {}: {e}", user.user_id);
    }

    let cookie = state.cookie_config.build_session_cookie(&token);
    let resp = LoginResponse::new(into_public_user(user)?, token);

    Ok(([(header::SET_COOKIE, cookie)], Json(resp)).into_response())
}

// ---------------------------------------------------------------------------
// GET /qr-login (static HTML page)
// ---------------------------------------------------------------------------

async fn qr_login_page() -> Html<&'static str> {
    Html(QR_LOGIN_HTML)
}

const QR_LOGIN_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>QR Login - GeekClaw</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; justify-content: center;
         align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
  .card { background: white; padding: 2rem; border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
  .status { margin-top: 1rem; color: #666; }
  .error { color: #d32f2f; }
  .success { color: #388e3c; }
</style>
</head>
<body>
<div class="card">
  <h1>GeekClaw</h1>
  <p id="status" class="status">Processing login...</p>
</div>
<script>
(function() {
  var el = document.getElementById('status');
  var params = new URLSearchParams(window.location.search);
  var token = params.get('token');
  if (!token) {
    el.textContent = 'Error: No token provided';
    el.className = 'status error';
    return;
  }
  function verifyAppShellThenRedirect() {
    fetch('/?nomifun_spa_shell_check=1', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin'
    })
    .then(function(r) {
      if (!r.ok) {
        throw new Error('HTTP ' + r.status);
      }
      window.location.replace('/#/guid');
    })
    .catch(function(err) {
      el.textContent = 'Login succeeded, but WebUI app shell is not reachable: ' + err.message;
      el.className = 'status error';
    });
  }
  fetch('/api/auth/qr-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ qr_token: token })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.success) {
      el.textContent = 'Login successful! Redirecting...';
      el.className = 'status success';
      try {
        sessionStorage.setItem('geekclaw:qr-login-resume', JSON.stringify({
          at: Date.now(),
          user: data.user
        }));
      } catch (e) {}
      setTimeout(verifyAppShellThenRedirect, 600);
    } else {
      el.textContent = 'Login failed: ' + (data.error || 'Unknown error');
      el.className = 'status error';
    }
  })
  .catch(function(err) {
    el.textContent = 'Error: ' + err.message;
    el.className = 'status error';
  });
})();
</script>
</body>
</html>"#;

// ---------------------------------------------------------------------------
// Helpers for register + admin control plane
// ---------------------------------------------------------------------------

/// Build a JSON error `Response` carrying an explicit machine-readable `code`
/// (separate from the HTTP status) so the frontend can branch on it. Used where
/// a friendly code (e.g. `invalidInviteCode`) is more useful than the generic
/// `BAD_REQUEST` that `AppError` would produce.
fn error_response(status: StatusCode, code: &'static str, message: impl Into<String>) -> Response {
    let body = ErrorResponse::new(message, code);
    (status, Json(body)).into_response()
}

/// Reject any caller who is not an admin. Layer this after `auth_middleware`
/// so `CurrentUser` is always present.
fn ensure_admin(current_user: &CurrentUser) -> Result<(), AppError> {
    if current_user.role != "admin" {
        return Err(AppError::Forbidden("Admin access required".into()));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Affiliate referral rewards ("分享邀约有奖分销"), in credits. Both the invitee
// (signup bonus) and the referrer (invite reward) are credited on a successful
// referral registration. Tunable here until an admin console control exists.
const REFEREE_SIGNUP_BONUS: i64 = 50;
const REFERRER_REWARD: i64 = 100;

// POST /api/auth/register — invite-code-gated account creation
// ---------------------------------------------------------------------------

async fn register_handler(
    State(state): State<AuthRouterState>,
    headers: HeaderMap,
    body: Result<Json<RegisterRequest>, JsonRejection>,
) -> Result<Response, AppError> {
    // Same Secure-cookie trap as /login and /setup: refuse a plain-HTTP browser
    // registration before it creates an account whose session cookie can never stick.
    state.cookie_config.reject_plaintext_login_when_secure(&headers)?;

    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;

    let username = req.username.trim().to_owned();
    if let Err(e) = validate_username(&username) {
        return Ok(error_response(StatusCode::BAD_REQUEST, "invalidCredentials", e.to_string()));
    }
    if let Err(e) = validate_password(&req.password) {
        return Ok(error_response(StatusCode::BAD_REQUEST, "invalidCredentials", e.to_string()));
    }

    let invite_code = req.invite_code.trim();

    // Hash on a blocking thread (bcrypt is CPU-bound), mirroring other handlers.
    let password = req.password.clone();
    let password_hash = tokio::task::spawn_blocking(move || hash_password(&password))
        .await
        .map_err(|e| AppError::Internal(format!("Task join error: {e}")))??;

    // Create the account first so we have a stable `user_id` to stamp the
    // invitation's `used_by`. A duplicate username is surfaced as a conflict.
    let created_user = state
        .user_repo
        .create_user(&username, &password_hash)
        .await
        .map_err(|e| match e {
            DbError::Conflict(_) => {
                AppError::Conflict(format!("Username '{username}' already exists"))
            }
            other => AppError::Internal(format!("Database error: {other}")),
        })?;

    // Open registration: an invitation code is OPTIONAL. When supplied we
    // resolve it as either a personal referral code (multi-use affiliate link)
    // or a single-use admin-issued invitation, then apply growth-loop rewards.
    if !invite_code.is_empty() {
        // 1) Personal referral: the entered code is another user's `invite_code`.
        //    Every registrant who uses it counts, and both sides get credits.
        match state.user_repo.get_user_by_invite_code(invite_code).await {
            Ok(Some(referrer)) if referrer.user_id != created_user.user_id => {
                // Stamp the referrer (idempotent) then grant bidirectional credits.
                // Failures are non-fatal: the account already exists, so log + continue.
                if let Err(e) = state
                    .user_repo
                    .set_invited_by(created_user.user_id.as_str(), referrer.user_id.as_str())
                    .await
                {
                    tracing::warn!("failed to stamp invited_by for {}: {e}", created_user.user_id);
                }
                if let Err(e) = state
                    .user_repo
                    .add_credits(
                        created_user.user_id.as_str(),
                        REFEREE_SIGNUP_BONUS,
                        "signup_bonus",
                        Some("referral"),
                        Some(invite_code),
                        Some("Referral signup bonus"),
                    )
                    .await
                {
                    tracing::warn!("failed to grant referral signup bonus for {}: {e}", created_user.user_id);
                }
                if let Err(e) = state
                    .user_repo
                    .add_credits(
                        referrer.user_id.as_str(),
                        REFERRER_REWARD,
                        "invite_reward",
                        Some("referral"),
                        Some(invite_code),
                        Some("Invited a new user via referral code"),
                    )
                    .await
                {
                    tracing::warn!("failed to reward referrer {}: {e}", referrer.user_id);
                }
            }
            Ok(Some(_)) => {
                // Matched the new user's own (not-yet-assigned) code — ignore and
                // let the admin-invitation branch below reject it as invalid.
            }
            Ok(None) => {
                // 2) Fall back to the admin-issued single-use invitation.
                let consumed = state
                    .user_repo
                    .consume_invitation(invite_code, created_user.user_id.as_str())
                    .await
                    .map_err(|e| AppError::Internal(format!("Database error: {e}")))?;

                if !consumed {
                    let _ = state.user_repo.delete_user(created_user.user_id.as_str()).await;
                    return Ok(error_response(
                        StatusCode::BAD_REQUEST,
                        "invalidInviteCode",
                        "Invalid or expired invitation code",
                    ));
                }

                // --- Growth-loop rewards (bidirectional invitation incentive) ---
                match state.user_repo.get_invitation(invite_code).await {
                    Ok(Some(inv)) => {
                        if let Some(plan) = inv.plan.as_deref() {
                            if !plan.is_empty() {
                                if let Err(e) = state
                                    .user_repo
                                    .set_plan(created_user.user_id.as_str(), plan)
                                    .await
                                {
                                    tracing::warn!("failed to set plan '{}' for {}: {e}", plan, created_user.user_id);
                                }
                            }
                        }
                        if inv.credits_grant > 0 {
                            if let Err(e) = state
                                .user_repo
                                .add_credits(
                                    created_user.user_id.as_str(),
                                    inv.credits_grant,
                                    "signup_bonus",
                                    Some("invitation"),
                                    Some(invite_code),
                                    Some("Invitation signup bonus"),
                                )
                                .await
                            {
                                tracing::warn!("failed to grant signup bonus for {}: {e}", created_user.user_id);
                            }
                        }
                        if inv.reward_to_inviter > 0 {
                            if let Err(e) = state
                                .user_repo
                                .add_credits(
                                    &inv.created_by,
                                    inv.reward_to_inviter,
                                    "invite_reward",
                                    Some("invitation"),
                                    Some(invite_code),
                                    Some("Invited a new user"),
                                )
                                .await
                            {
                                tracing::warn!("failed to reward inviter {}: {e}", inv.created_by);
                            }
                        }
                    }
                    Ok(None) => {
                        tracing::warn!("invitation '{}' vanished after consume", invite_code);
                    }
                    Err(e) => {
                        tracing::warn!("failed to load invitation '{}' for rewards: {e}", invite_code);
                    }
                }
            }
            Err(e) => {
                tracing::warn!("failed to look up referral code '{}': {e}", invite_code);
            }
        }
    }

    // Always assign the new account its own personal invite code (lazy, unique).
    if let Err(e) = state.user_repo.ensure_invite_code(created_user.user_id.as_str()).await {
        tracing::warn!("failed to ensure invite_code for {}: {e}", created_user.user_id);
    }

    let token = state
        .jwt_service
        .sign(created_user.user_id.as_str(), &created_user.username)
        .map_err(|e| AppError::Internal(format!("Token signing error: {e}")))?;

    if let Err(e) = state.user_repo.update_last_login(created_user.user_id.as_str()).await {
        tracing::warn!("Failed to update last login for {}: {e}", created_user.user_id);
    }

    let cookie = state.cookie_config.build_session_cookie(&token);
    let resp = LoginResponse::new(into_public_user(created_user)?, token);

    Ok(([(header::SET_COOKIE, cookie)], Json(resp)).into_response())
}

// ---------------------------------------------------------------------------
// GET /api/auth/users — admin: list all users
// ---------------------------------------------------------------------------

async fn list_users_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
) -> Result<Json<ListUsersResponse>, AppError> {
    ensure_admin(&current_user)?;
    let users = state
        .user_repo
        .list_users()
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?;
    let items: Vec<UserListItem> = users
        .into_iter()
        .map(|u| UserListItem {
            user_id: u.user_id,
            username: u.username,
            role: u.role,
            is_active: u.is_active != 0,
            last_login: u.last_login,
            plan: u.plan,
            credits: u.credits,
        })
        .collect();
    Ok(Json(ListUsersResponse {
        success: true,
        users: items,
    }))
}

// ---------------------------------------------------------------------------
// POST /api/auth/users/{id}/role — admin: change a user's role
// ---------------------------------------------------------------------------

async fn set_role_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(user_id): Path<String>,
    body: Result<Json<SetRoleRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    ensure_admin(&current_user)?;
    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;
    let new_role = req.role.trim();
    if new_role != "admin" && new_role != "user" {
        return Err(AppError::BadRequest("Role must be 'admin' or 'user'".into()));
    }

    // Guard: never strip the last active admin of their privileges.
    let target = state
        .user_repo
        .find_by_id(&user_id)
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?
        .ok_or_else(|| AppError::NotFound("User not found".into()))?;
    if target.role == "admin" && new_role != "admin" {
        let active_admins = state
            .user_repo
            .count_active_admins()
            .await
            .map_err(|e| AppError::Internal(format!("Database error: {e}")))?;
        if active_admins <= 1 {
            return Err(AppError::Conflict("Cannot remove the last active admin".into()));
        }
    }

    state
        .user_repo
        .set_user_role(&user_id, new_role)
        .await
        .map_err(|e| match e {
            DbError::NotFound(_) => AppError::NotFound("User not found".into()),
            other => AppError::Internal(format!("Database error: {other}")),
        })?;
    Ok(Json(ApiResponse::message("Role updated")))
}

// ---------------------------------------------------------------------------
// POST /api/auth/users/{id}/disable | /enable — admin: toggle account status
// ---------------------------------------------------------------------------

async fn set_active_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(user_id): Path<String>,
    active: bool,
) -> Result<Json<ApiResponse<()>>, AppError> {
    ensure_admin(&current_user)?;
    // Guard: an admin must not disable (lock out) or enable their own account.
    if user_id == current_user.id.as_str() {
        return Err(AppError::BadRequest("Cannot change your own account status".into()));
    }
    state
        .user_repo
        .set_user_active(&user_id, active)
        .await
        .map_err(|e| match e {
            DbError::NotFound(_) => AppError::NotFound("User not found".into()),
            other => AppError::Internal(format!("Database error: {other}")),
        })?;
    Ok(Json(ApiResponse::message(if active {
        "User enabled"
    } else {
        "User disabled"
    })))
}

async fn disable_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(user_id): Path<String>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    set_active_handler(State(state), Extension(current_user), Path(user_id), false).await
}

async fn enable_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(user_id): Path<String>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    set_active_handler(State(state), Extension(current_user), Path(user_id), true).await
}

// ---------------------------------------------------------------------------
// POST /api/auth/invitations — admin: create an invitation code
// ---------------------------------------------------------------------------

async fn create_invitation_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
    body: Result<Json<CreateInvitationRequest>, JsonRejection>,
) -> Result<Json<CreateInvitationResponse>, AppError> {
    ensure_admin(&current_user)?;
    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;
    let days = if req.expires_in_days <= 0 { 7 } else { req.expires_in_days };
    let expires_at = now_ms() + days * 86_400_000;
    let inv = state
        .user_repo
        .create_invitation(
            current_user.id.as_str(),
            expires_at,
            req.plan.as_deref(),
            req.credits_grant,
            req.reward_to_inviter,
        )
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?;
    Ok(Json(CreateInvitationResponse {
        success: true,
        code: inv.code,
        expires_at: inv.expires_at,
    }))
}

// ---------------------------------------------------------------------------
// GET /api/auth/invitations — admin: list invitation codes
// ---------------------------------------------------------------------------

async fn list_invitations_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
) -> Result<Json<InvitationListResponse>, AppError> {
    ensure_admin(&current_user)?;
    let invs = state
        .user_repo
        .list_invitations()
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?;
    let items: Vec<InvitationInfo> = invs
        .into_iter()
        .map(|inv| InvitationInfo {
            code: inv.code,
            created_by: inv.created_by,
            created_at: inv.created_at,
            expires_at: inv.expires_at,
            used_by: inv.used_by,
            used_at: inv.used_at,
            plan: inv.plan,
            credits_grant: inv.credits_grant,
            reward_to_inviter: inv.reward_to_inviter,
        })
        .collect();
    Ok(Json(InvitationListResponse {
        success: true,
        invitations: items,
    }))
}

// ---------------------------------------------------------------------------
// DELETE /api/auth/invitations/{code} — admin: revoke an unused invitation
// ---------------------------------------------------------------------------

async fn delete_invitation_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(code): Path<String>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    ensure_admin(&current_user)?;
    let revoked = state
        .user_repo
        .revoke_invitation(&code)
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?;
    if !revoked {
        return Err(AppError::Conflict("Cannot revoke a used or nonexistent invitation".into()));
    }
    Ok(Json(ApiResponse::message("Invitation revoked")))
}

// ---------------------------------------------------------------------------
// Billing / economy endpoints
// ---------------------------------------------------------------------------

/// Build a [`BillingBalance`] for a user: wallet fields + recent ledger rows.
async fn build_billing_balance(
    repo: &dyn IUserRepository,
    user_id: &str,
    limit: i64,
) -> Result<BillingBalance, AppError> {
    let user = repo
        .find_by_id(user_id)
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?
        .ok_or_else(|| AppError::NotFound("User not found".into()))?;
    let txs = repo
        .list_credit_transactions(user_id, limit)
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?;
    let transactions: Vec<CreditTransactionInfo> = txs
        .into_iter()
        .map(|t| CreditTransactionInfo {
            id: t.id,
            user_id: t.user_id,
            tx_type: t.tx_type,
            amount: t.amount,
            balance_after: t.balance_after,
            ref_type: t.ref_type,
            ref_value: t.ref_value,
            note: t.note,
            created_at: t.created_at,
        })
        .collect();
    Ok(BillingBalance {
        success: true,
        user_id: user.user_id.as_str().to_string(),
        plan: user.plan,
        credits: user.credits,
        transactions,
    })
}

// ---------------------------------------------------------------------------
// GET /api/billing/me — signed-in user's wallet + ledger
// ---------------------------------------------------------------------------

async fn billing_me_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
) -> Result<Json<BillingBalance>, AppError> {
    Ok(Json(
        build_billing_balance(&*state.user_repo, current_user.id.as_str(), 50).await?,
    ))
}

// ---------------------------------------------------------------------------
// Referral / affiliate ("分享邀约有奖分销")
// ---------------------------------------------------------------------------

/// Response shape for `GET /api/referral/info`. Matches the desktop referral
/// page contract: `{ success, data: { inviteCode, inviteLink, invitedCount,
/// earnedCredits } }`.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ReferralInfoData {
    invite_code: String,
    invite_link: String,
    invited_count: i64,
    earned_credits: i64,
}

#[derive(serde::Serialize)]
struct ReferralInfoResponse {
    success: bool,
    data: ReferralInfoData,
}

/// GET /api/referral/info — the signed-in user's own referral stats.
///
/// Generates the user's personal invite code lazily (if absent), counts how
/// many accounts registered with it, and sums the affiliate credits earned.
/// Works for both the cloud WebUI (session cookie) and the desktop shell, which
/// forwards a Bearer cloud JWT via the `/api/store/referral/info` proxy.
async fn referral_info_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
) -> Result<Json<ReferralInfoResponse>, AppError> {
    let invite_code = state
        .user_repo
        .ensure_invite_code(current_user.id.as_str())
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?;
    let invited_count = state
        .user_repo
        .count_invited_by(current_user.id.as_str())
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?;
    let earned_credits = state
        .user_repo
        .sum_credit_tx_by_type(current_user.id.as_str(), "invite_reward")
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?;
    let invite_link = format!("https://www.geekclaw.ai/register?invite={invite_code}");
    Ok(Json(ReferralInfoResponse {
        success: true,
        data: ReferralInfoData {
            invite_code,
            invite_link,
            invited_count,
            earned_credits,
        },
    }))
}

/// GET /api/store/referral/info — desktop-shell proxy to the cloud backend.
///
/// The desktop webview reaches this (gated by local-trust middleware); we read
/// the stored cloud JWT and forward to `{cloud_store_base}/api/referral/info`,
/// streaming the cloud's JSON response back verbatim.
async fn referral_info_proxy_handler(
    State(state): State<AuthRouterState>,
) -> Result<Response, AppError> {
    let token = cloud_billing_token(&state).await?;
    let url = format!("{}/api/referral/info", cloud_store_base());
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {token}"))
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("云端推荐接口请求失败: {e}")))?;
    let status = resp.status();
    let headers = resp.headers().clone();
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Internal(format!("读取云端响应失败: {e}")))?;
    let mut builder = Response::builder().status(status);
    if let Some(ct) = headers.get("content-type").and_then(|v| v.to_str().ok()) {
        builder = builder.header("content-type", ct);
    }
    Ok(builder.body(Body::from(bytes)).unwrap())
}

// ---------------------------------------------------------------------------
// POST /api/billing/users/{id}/adjust — admin: manually adjust a user's credits
// ---------------------------------------------------------------------------

async fn adjust_credits_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(user_id): Path<String>,
    body: Result<Json<AdjustCreditsRequest>, JsonRejection>,
) -> Result<Json<BillingBalance>, AppError> {
    ensure_admin(&current_user)?;
    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;
    state
        .user_repo
        .add_credits(
            &user_id,
            req.delta,
            "adjust",
            Some("admin"),
            Some(current_user.id.as_str()),
            req.note.as_deref(),
        )
        .await
        .map_err(|e| match e {
            DbError::NotFound(_) => AppError::NotFound("User not found".into()),
            other => AppError::Internal(format!("Database error: {other}")),
        })?;
    Ok(Json(
        build_billing_balance(&*state.user_repo, &user_id, 50).await?,
    ))
}

// ---------------------------------------------------------------------------
// GET /api/billing/users/{id} — admin: read any user's wallet + ledger
// ---------------------------------------------------------------------------

async fn admin_billing_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(user_id): Path<String>,
) -> Result<Json<BillingBalance>, AppError> {
    ensure_admin(&current_user)?;
    Ok(Json(
        build_billing_balance(&*state.user_repo, &user_id, 50).await?,
    ))
}

// ---------------------------------------------------------------------------
// GET /api/billing/pricing — admin: list all model prices
// ---------------------------------------------------------------------------

async fn list_pricing_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
) -> Result<Json<ModelPriceListResponse>, AppError> {
    ensure_admin(&current_user)?;
    let rows = state
        .user_repo
        .list_model_pricing()
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?;
    let prices: Vec<ModelPriceInfo> = rows
        .into_iter()
        .map(|p| ModelPriceInfo {
            id: p.id,
            provider: p.provider,
            model: p.model,
            task: p.task,
            input_credits_per_1k: p.input_credits_per_1k,
            output_credits_per_1k: p.output_credits_per_1k,
            cache_read_credits_per_1k: p.cache_read_credits_per_1k,
            currency: p.currency,
            updated_at: p.updated_at,
        })
        .collect();
    Ok(Json(ModelPriceListResponse {
        success: true,
        prices,
    }))
}

// ---------------------------------------------------------------------------
// PUT /api/billing/pricing — admin: insert/update a model price
// ---------------------------------------------------------------------------

async fn upsert_pricing_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
    body: Result<Json<UpsertPricingRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<ModelPriceInfo>>, AppError> {
    ensure_admin(&current_user)?;
    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;
    if req.provider.trim().is_empty() || req.model.trim().is_empty() {
        return Err(AppError::BadRequest("provider and model are required".into()));
    }
    let task = if req.task.trim().is_empty() {
        "Chat"
    } else {
        req.task.trim()
    };
    let pricing = ModelPricing {
        id: 0,
        provider: req.provider.trim().to_string(),
        model: req.model.trim().to_string(),
        task: task.to_string(),
        input_credits_per_1k: req.input_credits_per_1k,
        output_credits_per_1k: req.output_credits_per_1k,
        cache_read_credits_per_1k: req.cache_read_credits_per_1k,
        currency: req.currency.unwrap_or_else(|| "credits".to_string()),
        updated_at: now_ms(),
    };
    state
        .user_repo
        .upsert_model_pricing(&pricing)
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?;
    let stored = state
        .user_repo
        .get_model_pricing(&pricing.provider, &pricing.model, &pricing.task)
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?
        .ok_or_else(|| AppError::Internal("Price vanished after upsert".into()))?;
    Ok(Json(ApiResponse::ok(ModelPriceInfo {
        id: stored.id,
        provider: stored.provider,
        model: stored.model,
        task: stored.task,
        input_credits_per_1k: stored.input_credits_per_1k,
        output_credits_per_1k: stored.output_credits_per_1k,
        cache_read_credits_per_1k: stored.cache_read_credits_per_1k,
        currency: stored.currency,
        updated_at: stored.updated_at,
    })))
}

// ---------------------------------------------------------------------------
// POST /api/auth/users/{id}/plan — admin: set a user's plan tier
// ---------------------------------------------------------------------------

async fn set_plan_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(user_id): Path<String>,
    body: Result<Json<SetPlanRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    ensure_admin(&current_user)?;
    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;
    let plan = req.plan.trim();
    match plan {
        "free" | "pro" | "team" => {}
        _ => return Err(AppError::BadRequest("Plan must be 'free', 'pro', or 'team'".into())),
    }
    state
        .user_repo
        .set_plan(&user_id, plan)
        .await
        .map_err(|e| match e {
            DbError::NotFound(_) => AppError::NotFound("User not found".into()),
            other => AppError::Internal(format!("Database error: {other}")),
        })?;
    Ok(Json(ApiResponse::message("Plan updated")))
}

// ---------------------------------------------------------------------------
// POST /api/billing/subscribe — consumer self-service plan purchase
// ---------------------------------------------------------------------------

/// Total-price multiplier for a billing period.
///
/// Mirrors the storefront's `PERIOD_FACTOR` × months so the QR amount equals
/// what the user sees on the pricing page (computed in 分 to avoid rounding drift).
/// Plan prices/credits themselves live in `subscription_plans` (admin-managed),
/// so only the structural multiplier stays here.
fn period_multiplier(period: &str) -> f64 {
    match period {
        "quarterly" => 0.85 * 3.0, // PERIOD_FACTOR 0.85 × 3 months
        "annual" => 0.75 * 12.0,   // PERIOD_FACTOR 0.75 × 12 months
        _ => 1.0,                  // monthly (and any unrecognized value)
    }
}

/// Response for `POST /api/billing/subscribe`: the cashier QR strings for both
/// WeChat and Alipay, plus the order identity for polling.
#[derive(Debug, Serialize)]
pub struct SubscribeResponse {
    pub reqsn: String,
    pub amount_fen: i64,
    pub plan: String,
    pub period: String,
    /// Cashier QR content keyed by channel: `wechat` (W01) / `alipay` (A01).
    pub payinfo: HashMap<String, String>,
}

/// Generate a unique merchant order number (`reqsn`).
fn gen_reqsn() -> String {
    let mut buf = [0u8; 8];
    let _ = getrandom::getrandom(&mut buf);
    let rand = u64::from_be_bytes(buf);
    format!("GC{}_{:016x}", now_ms(), rand)
}

/// Request body for `POST /api/billing/subscribe`.
#[derive(Debug, Deserialize)]
pub struct SubscribeRequest {
    /// Storefront plan id, one of the rows in `subscription_plans`
    /// (e.g. `starter` / `pro` / `flagship`), validated against the DB.
    pub plan_id: String,
    /// Billing period hint (`monthly` / `quarterly` / `annual`). Currently
    /// informational; real proration lands with the payment gateway.
    #[serde(default = "default_period")]
    pub period: String,
}

fn default_period() -> String {
    "monthly".to_owned()
}

async fn subscribe_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
    body: Result<Json<SubscribeRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<SubscribeResponse>>, AppError> {
    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;
    let plan_id = req.plan_id.trim();

    // Resolve the storefront plan from the admin-managed catalog (DB source of
    // truth, shared by the storefront, the admin console and the desktop app).
    let entry = state
        .user_repo
        .get_subscription_plan_by_plan_id(plan_id)
        .await
        .map_err(|e| AppError::Internal(format!("查询套餐失败: {e}")))?
        .filter(|p| p.enabled != 0)
        .ok_or_else(|| AppError::BadRequest(format!("未知的套餐或已下架: '{plan_id}'")))?;

    // Payment gateway is REQUIRED for real purchases. Without merchant keys the
    // buy is blocked — we never grant a plan without a confirmed payment.
    let cfg = resolve_allinpay_config(&*state.user_repo)
        .await
        .ok_or_else(|| {
            AppError::BadRequest("支付网关尚未配置，暂时无法购买。请联系管理员。".to_string())
        })?;

    let period = match req.period.trim() {
        "quarterly" | "annual" => req.period.trim().to_owned(),
        _ => "monthly".to_owned(),
    };
    let amount_fen = (entry.price_fen as f64 * period_multiplier(&period)).round() as i64;
    if amount_fen <= 0 {
        return Err(AppError::BadRequest("订单金额无效".to_string()));
    }

    let uid = current_user.id.as_str().to_owned();
    let reqsn = gen_reqsn();

    // Request both WeChat (W01) and Alipay (A01) cashier QR strings in one
    // order so the user can pick either. If one channel fails we still return
    // the other; only refuse when both fail.
    let mut payinfo: HashMap<String, String> = HashMap::new();
    for (channel, paytype) in [("wechat", PAYTYPE_WECHAT), ("alipay", PAYTYPE_ALIPAY)] {
        match create_unified_order(
            &cfg,
            &reqsn,
            amount_fen,
            &format!("GeekClaw {}", entry.backend_plan),
            paytype,
        )
        .await
        {
            Ok(result) => {
                payinfo.insert(channel.to_owned(), result.payinfo);
            }
            Err(e) => tracing::warn!("收银宝下单({channel})失败: {e}"),
        }
    }
    if payinfo.is_empty() {
        return Err(AppError::BadRequest(
            "收银宝下单失败，请稍后重试或联系管理员。".to_string(),
        ));
    }

    // Persist the order (status `created`). The QR map is stored as JSON so a
    // refreshed storefront can re-render it while polling for payment.
    let qr_json = serde_json::to_string(&payinfo).unwrap_or_default();
    let order = Order {
        id: 0,
        user_id: uid.clone(),
        plan: entry.backend_plan.to_owned(),
        period: period.clone(),
        amount_fen,
        credits: entry.credits,
        status: "created".into(),
        reqsn: reqsn.clone(),
        trxid: None,
        qr_payinfo: Some(qr_json),
        created_at: 0,
        paid_at: None,
    };
    state
        .user_repo
        .create_order(&order)
        .await
        .map_err(|e| AppError::Internal(format!("创建订单失败: {e}")))?;

    Ok(Json(ApiResponse::with_message(
        SubscribeResponse {
            reqsn,
            amount_fen,
            plan: entry.backend_plan.to_owned(),
            period,
            payinfo,
        },
        "请使用微信或支付宝扫码完成支付".to_string(),
    )))
}

// ---------------------------------------------------------------------------
// GET /api/billing/order/{reqsn} — consumer polls payment status
// ---------------------------------------------------------------------------

/// Response for `GET /api/billing/order/{reqsn}`.
#[derive(Debug, Serialize)]
pub struct OrderStatusResponse {
    pub reqsn: String,
    pub status: String,
    pub plan: String,
    pub period: String,
    pub amount_fen: i64,
    /// Cashier QR map (JSON) captured at checkout, for re-rendering after refresh.
    pub qr_payinfo: Option<String>,
}

async fn order_status_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(reqsn): Path<String>,
) -> Result<Json<ApiResponse<OrderStatusResponse>>, AppError> {
    let mut order = state
        .user_repo
        .get_order_by_reqsn(&reqsn)
        .await
        .map_err(|e| AppError::Internal(format!("查询订单失败: {e}")))?
        .ok_or_else(|| AppError::NotFound("订单不存在".into()))?;

    // Only the buyer or an admin may view this order.
    let viewer = current_user.id.as_str();
    if order.user_id != viewer && current_user.role != "admin" {
        return Err(AppError::Forbidden("无权查看该订单".into()));
    }

    // Closed-loop fallback: if the order is not yet marked paid, actively query
    // 通联 to confirm the real payment status. This makes checkout reflect
    // immediately even when the async notify callback is delayed or lost — the
    // grant (plan + credits) is applied exactly once via `mark_order_paid`.
    if order.status != "paid" {
        if let Some(cfg) = resolve_allinpay_config(&*state.user_repo).await {
            match query_order(&cfg, &order.reqsn).await {
                Ok(QueryOrderResult::Paid(trxid)) => {
                    if finalize_paid_order(&state, &order, &trxid).await? {
                        tracing::info!(
                            "订单 {} 经主动查单确认支付成功：已开通 {} 并赠送 {} 算力",
                            order.reqsn,
                            order.plan,
                            order.credits
                        );
                    }
                    // Reload so the response reflects the paid status.
                    if let Ok(Some(o)) = state.user_repo.get_order_by_reqsn(&reqsn).await {
                        order = o;
                    }
                }
                Ok(QueryOrderResult::Failed(reason)) => {
                    // 真实失败：诚实标记订单为 failed，前端明确显示失败，杜绝无限 pending / 假成功。
                    if let Err(e) = state.user_repo.mark_order_failed(&order.reqsn, &reason).await {
                        tracing::warn!("标记订单 {} 失败异常: {e}", order.reqsn);
                    } else {
                        tracing::info!("订单 {} 查单确认未支付/失败：{}", order.reqsn, reason);
                    }
                    // Reload so the response reflects the failed status.
                    if let Ok(Some(o)) = state.user_repo.get_order_by_reqsn(&reqsn).await {
                        order = o;
                    }
                }
                Ok(QueryOrderResult::Pending) => { /* still pending — return as-is */ }
                Err(e) => {
                    tracing::warn!("主动查单失败（不阻断轮询）: {e}");
                }
            }
        }
    }

    Ok(Json(ApiResponse::ok(OrderStatusResponse {
        reqsn: order.reqsn,
        status: order.status,
        plan: order.plan,
        period: order.period,
        amount_fen: order.amount_fen,
        qr_payinfo: order.qr_payinfo,
    })))
}

// ---------------------------------------------------------------------------
// POST /api/billing/order/{reqsn}/cancel — buyer explicitly cancels an unpaid
// order. Only a `created` order transitions to `failed`; `paid` (grant already
// applied) and `failed` are left untouched. This makes a cancellation show up
// honestly as a failed order instead of lingering as `created`.
// ---------------------------------------------------------------------------

async fn cancel_order_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(reqsn): Path<String>,
) -> Result<Json<ApiResponse<OrderStatusResponse>>, AppError> {
    let order = state
        .user_repo
        .get_order_by_reqsn(&reqsn)
        .await
        .map_err(|e| AppError::Internal(format!("查询订单失败: {e}")))?
        .ok_or_else(|| AppError::NotFound("订单不存在".into()))?;

    if order.user_id != current_user.id.as_str() && current_user.role != "admin" {
        return Err(AppError::Forbidden("无权操作该订单".into()));
    }

    // Only an unpaid order can be cancelled to failed.
    if order.status == "created" {
        state
            .user_repo
            .mark_order_failed(&reqsn, "用户取消支付")
            .await
            .map_err(|e| AppError::Internal(format!("取消订单失败: {e}")))?;
    }

    let updated = state
        .user_repo
        .get_order_by_reqsn(&reqsn)
        .await
        .map_err(|e| AppError::Internal(format!("查询订单失败: {e}")))?
        .ok_or_else(|| AppError::NotFound("订单不存在".into()))?;

    Ok(Json(ApiResponse::ok(OrderStatusResponse {
        reqsn: updated.reqsn,
        status: updated.status,
        plan: updated.plan,
        period: updated.period,
        amount_fen: updated.amount_fen,
        qr_payinfo: updated.qr_payinfo,
    })))
}

// ---------------------------------------------------------------------------
// Shared finalization: mark paid + grant plan + credits (exactly once)
// ---------------------------------------------------------------------------

/// Mark an order paid (idempotent on the `created → paid` transition) and, when
/// that transition happens, grant the plan + credit bundle exactly once.
///
/// Shared by both the async notify callback and the polling closed-loop
/// fallback so the two paths can never diverge on the grant logic.
async fn finalize_paid_order(
    state: &AuthRouterState,
    order: &Order,
    trxid: &str,
) -> Result<bool, AppError> {
    let newly_paid = state
        .user_repo
        .mark_order_paid(&order.reqsn, trxid)
        .await
        .map_err(|e| AppError::Internal(format!("标记订单失败: {e}")))?;
    if newly_paid {
        state
            .user_repo
            .set_plan(&order.user_id, &order.plan)
            .await
            .map_err(|e| AppError::Internal(format!("激活套餐失败: {e}")))?;
        state
            .user_repo
            .add_credits(
                &order.user_id,
                order.credits,
                "purchase",
                Some("billing"),
                Some(&order.reqsn),
                Some("GeekClaw 套餐购买"),
            )
            .await
            .map_err(|e| AppError::Internal(format!("发放算力失败: {e}")))?;
    }
    Ok(newly_paid)
}

// ---------------------------------------------------------------------------
// POST /api/billing/notify/allinpay — Allinpay async payment callback
// ---------------------------------------------------------------------------

/// Handles Allinpay's async notify: verifies the MD5 signature, confirms the
/// transaction succeeded, marks the order paid, and (once) activates the plan +
/// credit grant. Returns the literal `success` so Allinpay stops retrying.
async fn allinpay_notify_handler(
    State(state): State<AuthRouterState>,
    Form(params): Form<HashMap<String, String>>,
) -> Result<Response, AppError> {
    // No gateway configured → we cannot validate; tell Allinpay to stop.
    let cfg = match resolve_allinpay_config(&*state.user_repo).await {
        Some(c) => c,
        None => {
            tracing::error!("收到收银宝通知，但支付网关未配置");
            return Ok("fail".to_string().into_response());
        }
    };

    let map: BTreeMap<String, String> = params.into_iter().collect();
    let cusorderid = map.get("cusorderid").cloned().unwrap_or_default();

    // 1) Preferred path: verify the async-notify signature and extract the
    //    confirmed payment. This requires the 通联 platform public key to match
    //    exactly; if it does not (key mismatch), fall through to the query
    //    fallback below instead of failing the whole callback.
    let verified = match verify_notify(&cfg, &map) {
        Ok(v) => Some(v),
        Err(e) => {
            tracing::warn!("收银宝通知验签失败，将尝试主动查单兜底: {e}");
            None
        }
    };

    // 2) Closed-loop fallback: if signature verification could not confirm the
    //    payment, actively ask 通联 whether the money actually landed. This does
    //    not depend on the platform public key — we signed the query with our
    //    own merchant private key and read the authoritative `trxstatus` over
    //    TLS from 通联's official endpoint.
    let confirm = if let Some(v) = verified {
        Some((v.reqsn, v.trxid))
    } else if !cusorderid.is_empty() {
        match query_order(&cfg, &cusorderid).await {
            Ok(QueryOrderResult::Paid(trxid)) => {
                tracing::warn!(
                    "收银宝通知验签失败，但主动查单确认支付成功: {}",
                    cusorderid
                );
                Some((cusorderid.clone(), trxid))
            }
            // Not paid / failed / not found → let Allinpay retry (or the poll closes it).
            Ok(QueryOrderResult::Failed(_)) | Ok(QueryOrderResult::Pending) => None,
            Err(e) => {
                tracing::warn!("收银宝通知验签失败且主动查单异常: {e}");
                None
            }
        }
    } else {
        None
    };

    let (reqsn, trxid) = match confirm {
        Some(x) => x,
        None => {
            // Cannot confirm. If the order is already paid, stop Allinpay's
            // retries; otherwise tell it to retry.
            if let Some(o) = state
                .user_repo
                .get_order_by_reqsn(&cusorderid)
                .await
                .ok()
                .flatten()
            {
                if o.status == "paid" {
                    return Ok("success".to_string().into_response());
                }
            }
            return Ok("fail".to_string().into_response());
        }
    };

    let order = match state
        .user_repo
        .get_order_by_reqsn(&reqsn)
        .await
        .map_err(|e| AppError::Internal(format!("查询订单失败: {e}")))?
    {
        Some(o) => o,
        None => {
            tracing::error!("收银宝通知指向未知订单: {}", reqsn);
            // Order not ours; stop retries (manual reconciliation if needed).
            return Ok("success".to_string().into_response());
        }
    };

    // `finalize_paid_order` returns true only on the created→paid transition,
    // so the plan + credits are granted exactly once even under notify retries.
    let newly_paid = finalize_paid_order(&state, &order, &trxid).await?;
    if newly_paid {
        tracing::info!(
            "订单 {} 支付成功：已开通 {} 并赠送 {} 算力",
            reqsn,
            order.plan,
            order.credits
        );
    }

    Ok("success".to_string().into_response())
}

// ---------------------------------------------------------------------------
// 会员套餐（后台可管理）+ 支付配置（后台可配置）+ 公开套餐列表
//
// 套餐是真源：营销站 /api/plans、桌面端、subscribe 下单全部读 subscription_plans
// 表，实现三端一致。支付配置存 system_kv（后台可改），环境变量兜底。
// ---------------------------------------------------------------------------

/// Public storefront plan — no admin-only or secret fields.
#[derive(Debug, Serialize)]
pub struct PublicPlan {
    pub plan_id: String,
    pub name: String,
    pub backend_plan: String,
    pub price_fen: i64,
    pub credits: i64,
    pub description: String,
    pub sort_order: i64,
}

/// Response for `GET /api/plans` (public, unauthenticated).
#[derive(Debug, Serialize)]
pub struct PublicPlansResponse {
    pub success: bool,
    pub plans: Vec<PublicPlan>,
}

/// GET /api/plans — public list of purchasable plans (storefront + desktop).
async fn public_plans_handler(
    State(state): State<AuthRouterState>,
) -> Result<Json<PublicPlansResponse>, AppError> {
    let rows = state
        .user_repo
        .list_subscription_plans(false)
        .await
        .map_err(|e| AppError::Internal(format!("查询套餐失败: {e}")))?;
    let plans: Vec<PublicPlan> = rows
        .into_iter()
        .map(|p| PublicPlan {
            plan_id: p.plan_id,
            name: p.name,
            backend_plan: p.backend_plan,
            price_fen: p.price_fen,
            credits: p.credits,
            description: p.description,
            sort_order: p.sort_order,
        })
        .collect();
    Ok(Json(PublicPlansResponse {
        success: true,
        plans,
    }))
}

// ---------------------------------------------------------------------------
// Cloud store proxy: the desktop "套餐与定价" page reads admin-managed plans
// from the central backend (https://www.geekclaw.ai/admin). The webview cannot
// call the cloud directly (no CORS headers), so we proxy server-side.
// ---------------------------------------------------------------------------

/// Cloud plan as returned by the central backend's `GET /api/plans`.
#[derive(Debug, Deserialize)]
struct CloudPlan {
    plan_id: String,
    name: String,
    backend_plan: String,
    price_fen: i64,
    #[serde(default)]
    credits: i64,
    #[serde(default)]
    description: String,
    #[serde(default)]
    sort_order: i64,
}

/// Response envelope from the central backend's `GET /api/plans`.
#[derive(Debug, Deserialize)]
struct CloudPlansResponse {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    plans: Vec<CloudPlan>,
}

/// GET /api/store/plans — server-side proxy to the central store backend.
///
/// Fetches `GET {GEEKCLAW_STORE_API_BASE}/api/plans` (default
/// `https://www.geekclaw.ai`) and relays the plans back to the desktop client,
/// bypassing browser CORS. Keeps the desktop pricing page in sync with the
/// admin console.
async fn store_plans_proxy_handler() -> Result<Json<PublicPlansResponse>, AppError> {
    let base = std::env::var("GEEKCLAW_STORE_API_BASE")
        .unwrap_or_else(|_| "https://www.geekclaw.ai".to_string());
    let url = format!("{}/api/plans", base.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("拉取云端套餐失败: {e}")))?;
    let body = resp
        .text()
        .await
        .map_err(|e| AppError::Internal(format!("读取云端套餐响应失败: {e}")))?;
    let cloud: CloudPlansResponse = serde_json::from_str(&body)
        .map_err(|e| AppError::Internal(format!("解析云端套餐失败: {e}")))?;
    let plans: Vec<PublicPlan> = cloud
        .plans
        .into_iter()
        .map(|p| PublicPlan {
            plan_id: p.plan_id,
            name: p.name,
            backend_plan: p.backend_plan,
            price_fen: p.price_fen,
            credits: p.credits,
            description: p.description,
            sort_order: p.sort_order,
        })
        .collect();
    Ok(Json(PublicPlansResponse {
        success: cloud.success,
        plans,
    }))
}

// ---------------------------------------------------------------------------
// A2A 跨境电商 cloud proxy (desktop shell)
//
// 架构约定（2026-08-21 用户明确）：
//   - A2A 跨境电商平台的管理总后台 = 网页端管理后台（geekclaw.ai/admin），
//     商品/订单/商家数据真源在云端；
//   - A2A 跨境电商独立站的开通授权 = 网页端管理后台授权，授权后用户才能使用。
// 桌面端经本地后端代理云端 API（webview 直连云端无 CORS）；云端接口未就绪时
// 返回 502/错误，前端据此降级本地 mock 或显示开通引导。
// ---------------------------------------------------------------------------

/// GET /api/store/a2a/products — 代理云端 A2A 商品目录。
///
/// 转发 `GET {GEEKCLAW_STORE_API_BASE}/api/a2a/products`（公开，无需云端登录，
/// 与 store/plans 同模式）。返回体原样透传，由前端决定字段结构；云端未实现时
/// 返回 502 Bad Gateway，前端降级本地商品库。
async fn store_a2a_products_proxy_handler() -> Result<Response, AppError> {
    let base = cloud_store_base();
    let url = format!("{}/api/a2a/products", base.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| AppError::BadGateway(format!("A2A 云端商品服务不可用: {e}")))?;
    let status = resp.status();
    let headers = resp.headers().clone();
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::BadGateway(format!("读取 A2A 云端商品响应失败: {e}")))?;
    let mut builder = Response::builder().status(status);
    if let Some(ct) = headers.get("content-type").and_then(|v| v.to_str().ok()) {
        builder = builder.header("content-type", ct);
    }
    Ok(builder.body(Body::from(bytes)).unwrap())
}

/// GET /api/store/a2a/storefront/status — 代理云端 A2A 独立站开通授权状态。
///
/// 带本地存储的云端 JWT 转发 `GET {GEEKCLAW_STORE_API_BASE}/api/a2a/storefront/status`
/// （与 store/me 同模式）。云端返回 `{ enabled: bool }`（或自定义结构，前端按
/// 约定解析）；未登录云端 → 401，云端接口未实现 → 502。前端据此渲染开通引导。
async fn store_a2a_storefront_status_proxy_handler(
    State(state): State<AuthRouterState>,
) -> Result<Response, AppError> {
    let token = cloud_billing_token(&state).await?;
    let url = format!("{}/api/a2a/storefront/status", cloud_store_base().trim_end_matches('/'));
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {token}"))
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| AppError::BadGateway(format!("A2A 云端独立站服务不可用: {e}")))?;
    let status = resp.status();
    let headers = resp.headers().clone();
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::BadGateway(format!("读取 A2A 云端独立站状态失败: {e}")))?;
    let mut builder = Response::builder().status(status);
    if let Some(ct) = headers.get("content-type").and_then(|v| v.to_str().ok()) {
        builder = builder.header("content-type", ct);
    }
    Ok(builder.body(Body::from(bytes)).unwrap())
}

// ---------------------------------------------------------------------------
// Cloud billing proxy (desktop shell only)
//
// When the user is signed into a GeekClaw cloud account, purchases must be
// created in the cloud backend (where the plans catalog and payment gateway
// config live) rather than in the local desktop backend. These routes are
// gated by local-trust middleware so only the desktop webview can reach them,
// and they forward the stored cloud JWT to the cloud API.
// ---------------------------------------------------------------------------

async fn cloud_billing_token(state: &AuthRouterState) -> Result<String, AppError> {
    state
        .user_repo
        .get_kv(KV_CLOUD_AUTH_TOKEN)
        .await
        .ok()
        .flatten()
        .filter(|t| !t.is_empty())
        .ok_or_else(|| AppError::Unauthorized("未登录云端账号".into()))
}

async fn forward_cloud_billing(
    state: &AuthRouterState,
    method: reqwest::Method,
    path: &str,
    body: Option<serde_json::Value>,
) -> Result<Response, AppError> {
    let token = cloud_billing_token(state).await?;
    let url = format!("{}/api/billing/{}", cloud_store_base(), path);
    let client = reqwest::Client::new();
    let mut req = client
        .request(method, &url)
        .header("Authorization", format!("Bearer {token}"))
        .timeout(Duration::from_secs(30));
    if let Some(b) = body {
        req = req.json(&b);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("云端账单请求失败: {e}")))?;
    let status = resp.status();
    let headers = resp.headers().clone();
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Internal(format!("读取云端账单响应失败: {e}")))?;
    let mut builder = Response::builder().status(status);
    if let Some(ct) = headers.get("content-type").and_then(|v| v.to_str().ok()) {
        builder = builder.header("content-type", ct);
    }
    Ok(builder.body(Body::from(bytes)).unwrap())
}

async fn store_subscribe_proxy_handler(
    State(state): State<AuthRouterState>,
    Json(payload): Json<serde_json::Value>,
) -> Result<Response, AppError> {
    forward_cloud_billing(&state, reqwest::Method::POST, "subscribe", Some(payload)).await
}

async fn store_order_status_proxy_handler(
    State(state): State<AuthRouterState>,
    Path(reqsn): Path<String>,
) -> Result<Response, AppError> {
    forward_cloud_billing(&state, reqwest::Method::GET, &format!("order/{reqsn}"), None).await
}

async fn store_order_cancel_proxy_handler(
    State(state): State<AuthRouterState>,
    Path(reqsn): Path<String>,
) -> Result<Response, AppError> {
    forward_cloud_billing(&state, reqwest::Method::POST, &format!("order/{reqsn}/cancel"), None).await
}

async fn store_billing_me_proxy_handler(State(state): State<AuthRouterState>) -> Result<Response, AppError> {
    forward_cloud_billing(&state, reqwest::Method::GET, "me", None).await
}

// ---------------------------------------------------------------------------
// Cloud account OAuth (authorization-code, via local backend + geekclaw:// deep link)
//
// Desktop opens the SYSTEM browser to /api/oauth/geekclaw/start, which 302s to the
// cloud login page with redirect_uri=geekclaw://auth/callback. After login the cloud
// redirects back to the deep link; the renderer catches it and calls /exchange (or
// /set-token). The JWT is stored locally in system_kv — it never enters the browser.
// ---------------------------------------------------------------------------

const KV_CLOUD_OAUTH_STATE: &str = "cloud_oauth_state";
const KV_CLOUD_AUTH_TOKEN: &str = "cloud_auth_token";

/// Cloud login page path. MUST be confirmed with the web team — the cloud must serve a
/// real login/register page at this path that honours `redirect_uri` (incl. the
/// `geekclaw://` custom scheme) and 302-redirects back to it with `?code=..&state=..`.
const CLOUD_OAUTH_LOGIN_PATH: &str = "/login";

/// Percent-encoded `geekclaw://auth/callback` (the deep link the cloud bounces back to).
const CLOUD_OAUTH_REDIRECT_URI: &str = "geekclaw%3A%2F%2Fauth%2Fcallback";

/// First-party public OAuth client id for the desktop app (no secret — public client).
const CLOUD_OAUTH_CLIENT_ID: &str = "geekclaw-desktop";

fn cloud_store_base() -> String {
    std::env::var("GEEKCLAW_STORE_API_BASE")
        .unwrap_or_else(|_| "https://www.geekclaw.ai".to_string())
        .trim_end_matches('/')
        .to_string()
}

fn random_oauth_state() -> String {
    let v: u128 = rand::random();
    format!("{:032x}", v)
}

/// GET /api/oauth/geekclaw/start — generate + persist a state, then 302 the system
/// browser to the cloud login page (with redirect_uri pointing at our deep link).
async fn oauth_geekclaw_start_handler(
    State(state): State<AuthRouterState>,
) -> Result<Redirect, AppError> {
    let state_val = random_oauth_state();
    state
        .user_repo
        .set_kv(KV_CLOUD_OAUTH_STATE, &state_val)
        .await
        .map_err(|e| AppError::Internal(format!("保存 OAuth state 失败: {e}")))?;
    let login_url = format!(
        "{}{}?redirect_uri={}&state={}",
        cloud_store_base(),
        CLOUD_OAUTH_LOGIN_PATH,
        CLOUD_OAUTH_REDIRECT_URI,
        state_val
    );
    Ok(Redirect::to(&login_url))
}

#[derive(Debug, Deserialize)]
struct OAuthExchangeRequest {
    #[serde(default)]
    code: String,
    #[serde(default)]
    token: String,
    /// Echoed by the cloud deep link; verified against the persisted `/start` state (CSRF).
    #[serde(default)]
    state: String,
}

#[derive(Debug, Serialize)]
struct OAuthExchangeResponse {
    pub success: bool,
    #[serde(default)]
    pub error: Option<String>,
}

/// POST /api/oauth/geekclaw/exchange — redeem a cloud `code` for a JWT (server-to-server,
/// so the token never touches the browser), or accept a token directly (implicit flow).
async fn oauth_geekclaw_exchange_handler(
    State(state): State<AuthRouterState>,
    Json(req): Json<OAuthExchangeRequest>,
) -> Result<Json<OAuthExchangeResponse>, AppError> {
    // Reject empty payloads first.
    if req.token.is_empty() && req.code.is_empty() {
        return Ok(Json(OAuthExchangeResponse {
            success: false,
            error: Some("缺少 code 或 token".to_string()),
        }));
    }
    // CSRF protection: the `state` echoed by the cloud deep link must match the one we
    // persisted during /start. Required for BOTH the code flow and the implicit token
    // flow — without it, an attacker who intercepts a token (or races a login window)
    // could complete an auth binding the victim never initiated.
    let expected = state
        .user_repo
        .get_kv(KV_CLOUD_OAUTH_STATE)
        .await
        .ok()
        .flatten();
    match expected {
        Some(exp) if req.state == exp => { /* ok */ }
        _ => {
            return Ok(Json(OAuthExchangeResponse {
                success: false,
                error: Some("OAuth state 校验失败，可能被 CSRF 拦截".to_string()),
            }));
        }
    }

    let token = if !req.token.is_empty() {
        req.token
    } else {
        let url = format!("{}/api/auth/token", cloud_store_base());
        let client = reqwest::Client::new();
        let resp = client
            .post(&url)
            .timeout(std::time::Duration::from_secs(10))
            .json(&serde_json::json!({
                "grant_type": "authorization_code",
                "code": req.code,
                "redirect_uri": "geekclaw://auth/callback",
                "client_id": CLOUD_OAUTH_CLIENT_ID
            }))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("向云端换取 token 失败: {e}")))?;
        let body = resp
            .text()
            .await
            .map_err(|e| AppError::Internal(format!("读取云端 token 响应失败: {e}")))?;
        // Tolerant parse: accept either the cloud's custom `{success, token}` shape OR a
        // standard OAuth2 `{access_token, token_type, expires_in}` response.
        #[derive(Deserialize)]
        struct CloudTokenResp {
            #[serde(default)]
            success: bool,
            #[serde(default)]
            token: String,
            #[serde(default)]
            access_token: String,
            #[serde(default)]
            error: String,
            #[serde(default)]
            error_description: String,
        }
        let tr: CloudTokenResp = serde_json::from_str(&body)
            .map_err(|e| AppError::Internal(format!("解析云端 token 失败: {e}")))?;
        if !tr.token.is_empty() {
            tr.token
        } else if !tr.access_token.is_empty() {
            tr.access_token
        } else {
            let msg = if !tr.error.is_empty() {
                format!("{}: {}", tr.error, tr.error_description)
            } else {
                "云端未返回 token".to_string()
            };
            return Ok(Json(OAuthExchangeResponse {
                success: false,
                error: Some(msg),
            }));
        }
    };
    state
        .user_repo
        .set_kv(KV_CLOUD_AUTH_TOKEN, &token)
        .await
        .map_err(|e| AppError::Internal(format!("保存云端 token 失败: {e}")))?;
    Ok(Json(OAuthExchangeResponse {
        success: true,
        error: None,
    }))
}

#[derive(Debug, Serialize)]
struct CloudUserInfo {
    #[serde(default)]
    pub sub: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
}

#[derive(Debug, Serialize)]
struct CloudStatusResponse {
    pub authenticated: bool,
    #[serde(default)]
    pub user: Option<CloudUserInfo>,
}

/// GET /api/auth/cloud-status — report whether a cloud token is stored locally and
/// decode its (unverified) claims for display. Verification is unnecessary here because
/// the token was obtained server-to-server from the cloud during /exchange.
async fn cloud_status_handler(
    State(state): State<AuthRouterState>,
) -> Result<Json<CloudStatusResponse>, AppError> {
    let token = state.user_repo.get_kv(KV_CLOUD_AUTH_TOKEN).await.ok().flatten();
    match token {
        Some(t) if !t.is_empty() => {
            let user = decode_jwt_claims(&t);
            Ok(Json(CloudStatusResponse {
                authenticated: true,
                user,
            }))
        }
        _ => Ok(Json(CloudStatusResponse {
            authenticated: false,
            user: None,
        })),
    }
}

fn decode_jwt_claims(token: &str) -> Option<CloudUserInfo> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() < 2 {
        return None;
    }
    let mut padded = parts[1].to_string();
    while padded.len() % 4 != 0 {
        padded.push('=');
    }
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(&padded)
        .or_else(|_| base64::engine::general_purpose::STANDARD.decode(&padded))
        .ok()?;
    let v: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    Some(CloudUserInfo {
        sub: v.get("sub").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        name: v.get("name").and_then(|x| x.as_str()).map(|s| s.to_string()),
        email: v.get("email").and_then(|x| x.as_str()).map(|s| s.to_string()),
        username: v
            .get("username")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string()),
    })
}

/// POST /api/auth/cloud-logout — drop the locally stored cloud token.
async fn cloud_logout_handler(
    State(state): State<AuthRouterState>,
) -> Result<Json<OAuthExchangeResponse>, AppError> {
    let _ = state.user_repo.set_kv(KV_CLOUD_AUTH_TOKEN, "").await;
    Ok(Json(OAuthExchangeResponse {
        success: true,
        error: None,
    }))
}

/// Admin-facing plan (includes the `enabled` flag).
#[derive(Debug, Serialize)]
pub struct AdminPlanView {
    pub id: i64,
    pub plan_id: String,
    pub name: String,
    pub backend_plan: String,
    pub price_fen: i64,
    pub credits: i64,
    pub description: String,
    pub sort_order: i64,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

impl AdminPlanView {
    fn from_plan(p: SubscriptionPlan) -> Self {
        Self {
            id: p.id,
            plan_id: p.plan_id,
            name: p.name,
            backend_plan: p.backend_plan,
            price_fen: p.price_fen,
            credits: p.credits,
            description: p.description,
            sort_order: p.sort_order,
            enabled: p.enabled != 0,
            created_at: p.created_at,
            updated_at: p.updated_at,
        }
    }
}

/// Response for `GET /api/admin/plans` (admin).
#[derive(Debug, Serialize)]
pub struct AdminPlansResponse {
    pub success: bool,
    pub plans: Vec<AdminPlanView>,
}

/// Response for `GET /api/admin/orders` (admin).
#[derive(Debug, Serialize)]
pub struct AdminOrdersResponse {
    pub success: bool,
    pub orders: Vec<AdminOrderView>,
}

/// Admin view of a single payment order, enriched with the buyer's username.
#[derive(Debug, Serialize)]
pub struct AdminOrderView {
    pub id: i64,
    pub user_id: String,
    pub username: Option<String>,
    pub plan: String,
    pub period: String,
    pub amount_fen: i64,
    pub credits: i64,
    pub status: String,
    pub reqsn: String,
    pub trxid: Option<String>,
    pub created_at: i64,
    pub paid_at: Option<i64>,
}

/// GET /api/admin/orders — admin: list all payment orders (most-recent first),
/// enriched with each buyer's username for the operations console.
async fn list_admin_orders_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
) -> Result<Json<AdminOrdersResponse>, AppError> {
    ensure_admin(&current_user)?;
    let orders = state
        .user_repo
        .list_orders()
        .await
        .map_err(|e| AppError::Internal(format!("查询订单失败: {e}")))?;
    let orders = orders
        .into_iter()
        .map(|(o, username)| AdminOrderView {
            id: o.id,
            user_id: o.user_id,
            username,
            plan: o.plan,
            period: o.period,
            amount_fen: o.amount_fen,
            credits: o.credits,
            status: o.status,
            reqsn: o.reqsn,
            trxid: o.trxid,
            created_at: o.created_at,
            paid_at: o.paid_at,
        })
        .collect();
    Ok(Json(AdminOrdersResponse {
        success: true,
        orders,
    }))
}

/// Request body for create/update of a plan.
#[derive(Debug, Deserialize)]
pub struct UpsertPlanRequest {
    pub plan_id: String,
    pub name: String,
    #[serde(default = "default_backend_plan")]
    pub backend_plan: String,
    pub price_fen: i64,
    #[serde(default)]
    pub credits: i64,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub sort_order: i64,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_backend_plan() -> String {
    "pro".to_owned()
}
fn default_true() -> bool {
    true
}

/// GET /api/admin/plans — admin: list all plans (incl. disabled).
async fn list_admin_plans_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
) -> Result<Json<AdminPlansResponse>, AppError> {
    ensure_admin(&current_user)?;
    let rows = state
        .user_repo
        .list_subscription_plans(true)
        .await
        .map_err(|e| AppError::Internal(format!("查询套餐失败: {e}")))?;
    let plans = rows.into_iter().map(AdminPlanView::from_plan).collect();
    Ok(Json(AdminPlansResponse {
        success: true,
        plans,
    }))
}

/// POST /api/admin/plans — admin: create a plan.
async fn create_plan_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
    body: Result<Json<UpsertPlanRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<AdminPlanView>>, AppError> {
    ensure_admin(&current_user)?;
    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;
    let plan_id = req.plan_id.trim().to_owned();
    let name = req.name.trim().to_owned();
    if plan_id.is_empty() || name.is_empty() {
        return Err(AppError::BadRequest("plan_id 和 name 不能为空".into()));
    }
    if req.price_fen <= 0 {
        return Err(AppError::BadRequest("price_fen 必须大于 0".into()));
    }
    if state
        .user_repo
        .get_subscription_plan_by_plan_id(&plan_id)
        .await
        .map_err(|e| AppError::Internal(format!("查询套餐失败: {e}")))?
        .is_some()
    {
        return Err(AppError::Conflict(format!("套餐 '{plan_id}' 已存在")));
    }
    let now = now_ms();
    let plan = SubscriptionPlan::new(
        plan_id,
        name,
        req.backend_plan.trim().to_owned(),
        req.price_fen,
        req.credits,
        req.description.trim().to_owned(),
        req.sort_order,
        req.enabled,
        now,
    );
    let stored = state
        .user_repo
        .create_subscription_plan(&plan)
        .await
        .map_err(|e| AppError::Internal(format!("创建套餐失败: {e}")))?;
    Ok(Json(ApiResponse::ok(AdminPlanView::from_plan(stored))))
}

/// PUT /api/admin/plans/{plan_id} — admin: update a plan.
async fn update_plan_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(plan_id): Path<String>,
    body: Result<Json<UpsertPlanRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<AdminPlanView>>, AppError> {
    ensure_admin(&current_user)?;
    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;
    let plan_id = plan_id.trim().to_owned();
    let existing = state
        .user_repo
        .get_subscription_plan_by_plan_id(&plan_id)
        .await
        .map_err(|e| AppError::Internal(format!("查询套餐失败: {e}")))?
        .ok_or_else(|| AppError::NotFound("套餐不存在".into()))?;
    let now = now_ms();
    let updated = SubscriptionPlan {
        id: existing.id,
        plan_id: plan_id.clone(),
        name: req.name.trim().to_owned(),
        backend_plan: req.backend_plan.trim().to_owned(),
        price_fen: if req.price_fen > 0 { req.price_fen } else { existing.price_fen },
        credits: req.credits,
        description: req.description.trim().to_owned(),
        sort_order: req.sort_order,
        enabled: if req.enabled { 1 } else { 0 },
        created_at: existing.created_at,
        updated_at: now,
    };
    state
        .user_repo
        .update_subscription_plan(&updated)
        .await
        .map_err(|e| AppError::Internal(format!("更新套餐失败: {e}")))?;
    let stored = state
        .user_repo
        .get_subscription_plan_by_plan_id(&plan_id)
        .await
        .map_err(|e| AppError::Internal(format!("查询套餐失败: {e}")))?
        .ok_or_else(|| AppError::NotFound("套餐不存在".into()))?;
    Ok(Json(ApiResponse::ok(AdminPlanView::from_plan(stored))))
}

/// DELETE /api/admin/plans/{plan_id} — admin: delete a plan.
async fn delete_plan_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(plan_id): Path<String>,
) -> Result<Json<ApiResponse<()>>, AppError> {
    ensure_admin(&current_user)?;
    state
        .user_repo
        .delete_subscription_plan(plan_id.trim())
        .await
        .map_err(|e| AppError::Internal(format!("删除套餐失败: {e}")))?;
    Ok(Json(ApiResponse::message("套餐已删除")))
}

/// Mask a secret for display: reveal only the last 4 characters.
fn mask_secret(v: &Option<String>) -> String {
    match v {
        Some(s) if !s.is_empty() => {
            if s.len() <= 4 {
                "****".to_owned()
            } else {
                format!("****{}", &s[s.len() - 4..])
            }
        }
        _ => String::new(),
    }
}

/// Response for `GET /api/admin/payment-config` (admin). The secret key is
/// never returned in full — only a mask — so the admin console can show status
/// without leaking the merchant key.
#[derive(Debug, Serialize)]
pub struct PaymentConfigResponse {
    pub success: bool,
    pub cusid: String,
    pub appid: String,
    pub key_masked: String,
    pub notify_url: String,
    pub api_url: String,
    pub configured: bool,
}

/// Request body for `PUT /api/admin/payment-config`.
///
/// Send the full merchant key on first set. To keep the existing key unchanged,
/// send `"***"` (or empty) for `key` — the handler preserves the stored value.
#[derive(Debug, Deserialize)]
pub struct UpsertPaymentConfigRequest {
    pub cusid: String,
    pub appid: String,
    pub key: String,
    pub notify_url: String,
    #[serde(default)]
    pub api_url: String,
}

/// GET /api/admin/payment-config — admin: view current 收银宝 config (masked).
async fn get_payment_config_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
) -> Result<Json<PaymentConfigResponse>, AppError> {
    ensure_admin(&current_user)?;
    let cusid = state.user_repo.get_kv(KV_ALLINPAY_CUSID).await.ok().flatten();
    let appid = state.user_repo.get_kv(KV_ALLINPAY_APPID).await.ok().flatten();
    let key = state.user_repo.get_kv(KV_ALLINPAY_KEY).await.ok().flatten();
    let notify_url = state
        .user_repo
        .get_kv(KV_ALLINPAY_NOTIFY_URL)
        .await
        .ok()
        .flatten();
    let api_url = state
        .user_repo
        .get_kv(KV_ALLINPAY_API_URL)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| ALLINPAY_DEFAULT_API_URL.to_owned());
    let configured =
        cusid.is_some() && appid.is_some() && key.is_some() && notify_url.is_some();
    Ok(Json(PaymentConfigResponse {
        success: true,
        cusid: cusid.unwrap_or_default(),
        appid: appid.unwrap_or_default(),
        key_masked: mask_secret(&key),
        notify_url: notify_url.unwrap_or_default(),
        api_url,
        configured,
    }))
}

/// PUT /api/admin/payment-config — admin: update 收银宝 config (stored in kv).
async fn put_payment_config_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
    body: Result<Json<UpsertPaymentConfigRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<PaymentConfigResponse>>, AppError> {
    ensure_admin(&current_user)?;
    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;
    let cusid = req.cusid.trim().to_owned();
    let appid = req.appid.trim().to_owned();
    let notify_url = req.notify_url.trim().to_owned();
    if cusid.is_empty() || appid.is_empty() || notify_url.is_empty() {
        return Err(AppError::BadRequest(
            "cusid / appid / notify_url 不能为空".into(),
        ));
    }
    // Resolve the key: explicit value, or preserve the stored one when the
    // sentinel "***" / empty is sent.
    let key = if req.key.trim() == "***" || req.key.trim().is_empty() {
        state
            .user_repo
            .get_kv(KV_ALLINPAY_KEY)
            .await
            .map_err(|e| AppError::Internal(format!("读取密钥失败: {e}")))?
            .unwrap_or_default()
    } else {
        req.key.trim().to_owned()
    };
    if key.is_empty() {
        return Err(AppError::BadRequest(
            "支付密钥不能为空（首次配置请填写完整密钥）".into(),
        ));
    }
    let api_url = if req.api_url.trim().is_empty() {
        ALLINPAY_DEFAULT_API_URL.to_owned()
    } else {
        req.api_url.trim().to_owned()
    };

    state
        .user_repo
        .set_kv(KV_ALLINPAY_CUSID, &cusid)
        .await
        .map_err(|e| AppError::Internal(format!("保存失败: {e}")))?;
    state
        .user_repo
        .set_kv(KV_ALLINPAY_APPID, &appid)
        .await
        .map_err(|e| AppError::Internal(format!("保存失败: {e}")))?;
    state
        .user_repo
        .set_kv(KV_ALLINPAY_KEY, &key)
        .await
        .map_err(|e| AppError::Internal(format!("保存失败: {e}")))?;
    state
        .user_repo
        .set_kv(KV_ALLINPAY_NOTIFY_URL, &notify_url)
        .await
        .map_err(|e| AppError::Internal(format!("保存失败: {e}")))?;
    state
        .user_repo
        .set_kv(KV_ALLINPAY_API_URL, &api_url)
        .await
        .map_err(|e| AppError::Internal(format!("保存失败: {e}")))?;

    // Re-fetch to return the masked view.
    let cfg = get_payment_config_handler(State(state), Extension(current_user))
        .await?;
    Ok(Json(ApiResponse::ok(cfg.0)))
}

// ---------------------------------------------------------------------------
// Admin: 火山引擎语音 + 数字分身配置（管理后台配接口）
// ---------------------------------------------------------------------------

const KV_VOLC_APP_KEY: &str = "volc_app_key";
const KV_VOLC_ACCESS_KEY: &str = "volc_access_key";
const KV_VOLC_RESOURCE_ID: &str = "volc_resource_id";
const KV_VOLC_VOICE: &str = "volc_voice";
const KV_AVATAR_IMAGE: &str = "avatar_image";
const KV_AVATAR_LIPSYNC_STYLE: &str = "avatar_lipsync_style";

/// Default 火山引擎 TTS resource id (unidirectional stream). Override in admin
/// if 火山引擎控制台 assigns a different one.
const VOLC_TTS_DEFAULT_RESOURCE_ID: &str = "volc.service_type.10029";
const VOLC_TTS_DEFAULT_MODEL: &str = "seed-tts-2.0-standard";
const VOLC_TTS_BASE_URL: &str = "https://openspeech.bytedance.com";

#[derive(Debug, Serialize)]
pub struct VoiceConfigResponse {
    pub success: bool,
    pub app_key_masked: String,
    pub access_key_masked: String,
    pub resource_id_masked: String,
    pub voice: String,
    pub avatar_image: String,
    pub avatar_lipsync_style: String,
    pub configured: bool,
}

#[derive(Debug, Deserialize)]
pub struct UpsertVoiceConfigRequest {
    pub app_key: String,
    pub access_key: String,
    pub resource_id: String,
    #[serde(default)]
    pub voice: String,
    #[serde(default)]
    pub avatar_image: String,
    #[serde(default)]
    pub avatar_lipsync_style: String,
}

/// GET /api/admin/voice-config — admin: view 火山引擎 + 数字分身 config (masked).
async fn get_voice_config_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
) -> Result<Json<VoiceConfigResponse>, AppError> {
    ensure_admin(&current_user)?;
    let app_key = state.user_repo.get_kv(KV_VOLC_APP_KEY).await.ok().flatten();
    let access_key = state.user_repo.get_kv(KV_VOLC_ACCESS_KEY).await.ok().flatten();
    let resource_id = state.user_repo.get_kv(KV_VOLC_RESOURCE_ID).await.ok().flatten();
    let voice = state
        .user_repo
        .get_kv(KV_VOLC_VOICE)
        .await
        .ok()
        .flatten()
        .unwrap_or_default();
    let avatar_image = state
        .user_repo
        .get_kv(KV_AVATAR_IMAGE)
        .await
        .ok()
        .flatten()
        .unwrap_or_default();
    let avatar_lipsync_style = state
        .user_repo
        .get_kv(KV_AVATAR_LIPSYNC_STYLE)
        .await
        .ok()
        .flatten()
        .unwrap_or_default();
    let configured = app_key.is_some() && access_key.is_some() && resource_id.is_some();
    Ok(Json(VoiceConfigResponse {
        success: true,
        app_key_masked: mask_secret(&app_key),
        access_key_masked: mask_secret(&access_key),
        resource_id_masked: mask_secret(&resource_id),
        voice,
        avatar_image,
        avatar_lipsync_style,
        configured,
    }))
}

/// PUT /api/admin/voice-config — admin: update 火山引擎 + 数字分身 config.
async fn put_voice_config_handler(
    State(state): State<AuthRouterState>,
    Extension(current_user): Extension<CurrentUser>,
    body: Result<Json<UpsertVoiceConfigRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<VoiceConfigResponse>>, AppError> {
    ensure_admin(&current_user)?;
    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;

    // Resolve each secret: explicit value, or preserve stored when sentinel/empty.
    // NOTE: declared as an async fn (not a closure) because it performs `.await`.
    async fn resolve_voice_cfg(
        state: &AuthRouterState,
        stored_key: &str,
        new_val: &str,
        required: bool,
    ) -> Result<String, AppError> {
        if new_val.trim() == "***" || new_val.trim().is_empty() {
            let stored = state
                .user_repo
                .get_kv(stored_key)
                .await
                .map_err(|e| AppError::Internal(format!("读取配置失败: {e}")))?
                .unwrap_or_default();
            if required && stored.is_empty() {
                return Err(AppError::BadRequest("该字段为必填，首次配置请填写完整值".into()));
            }
            Ok(stored)
        } else {
            Ok(new_val.trim().to_owned())
        }
    }

    let app_key = resolve_voice_cfg(&state, KV_VOLC_APP_KEY, &req.app_key, true).await?;
    let access_key = resolve_voice_cfg(&state, KV_VOLC_ACCESS_KEY, &req.access_key, true).await?;
    let resource_id = resolve_voice_cfg(&state, KV_VOLC_RESOURCE_ID, &req.resource_id, true).await?;

    state
        .user_repo
        .set_kv(KV_VOLC_APP_KEY, &app_key)
        .await
        .map_err(|e| AppError::Internal(format!("保存失败: {e}")))?;
    state
        .user_repo
        .set_kv(KV_VOLC_ACCESS_KEY, &access_key)
        .await
        .map_err(|e| AppError::Internal(format!("保存失败: {e}")))?;
    state
        .user_repo
        .set_kv(KV_VOLC_RESOURCE_ID, &resource_id)
        .await
        .map_err(|e| AppError::Internal(format!("保存失败: {e}")))?;
    state
        .user_repo
        .set_kv(KV_VOLC_VOICE, &req.voice.trim().to_owned())
        .await
        .map_err(|e| AppError::Internal(format!("保存失败: {e}")))?;
    state
        .user_repo
        .set_kv(KV_AVATAR_IMAGE, &req.avatar_image.trim().to_owned())
        .await
        .map_err(|e| AppError::Internal(format!("保存失败: {e}")))?;
    state
        .user_repo
        .set_kv(KV_AVATAR_LIPSYNC_STYLE, &req.avatar_lipsync_style.trim().to_owned())
        .await
        .map_err(|e| AppError::Internal(format!("保存失败: {e}")))?;

    let cfg = get_voice_config_handler(State(state), Extension(current_user)).await?;
    Ok(Json(ApiResponse::ok(cfg.0)))
}

/// Request for `POST /api/voice/speak` — synthesize `text` with the
/// admin-configured 火山引擎 TTS, returning the audio bytes (mp3).
#[derive(Debug, Deserialize)]
pub struct VoiceSpeakRequest {
    pub text: String,
    #[serde(default)]
    pub voice: Option<String>,
}

/// POST /api/voice/speak — authenticated consumer: speak via 火山引擎 using the
/// admin-configured credentials (secrets stay server-side).
async fn voice_speak_handler(
    State(state): State<AuthRouterState>,
    Extension(_current_user): Extension<CurrentUser>,
    body: Result<Json<VoiceSpeakRequest>, JsonRejection>,
) -> Result<Response, AppError> {
    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;
    let text = req.text.trim().to_owned();
    if text.is_empty() {
        return Err(AppError::BadRequest("text 不能为空".into()));
    }
    if text.chars().count() > 4096 {
        return Err(AppError::BadRequest("text 超过 4096 字上限".into()));
    }

    let app_key = state.user_repo.get_kv(KV_VOLC_APP_KEY).await.ok().flatten();
    let access_key = state.user_repo.get_kv(KV_VOLC_ACCESS_KEY).await.ok().flatten();
    let resource_id = state.user_repo.get_kv(KV_VOLC_RESOURCE_ID).await.ok().flatten();
    let default_voice = state.user_repo.get_kv(KV_VOLC_VOICE).await.ok().flatten();

    let (app_key, access_key, resource_id) = match (app_key, access_key, resource_id) {
        (Some(a), Some(b), Some(c)) => (a, b, c),
        _ => return Err(AppError::BadRequest("火山引擎语音未配置，请先在管理后台配置".into())),
    };

    let speaker = req
        .voice
        .filter(|v| !v.trim().is_empty())
        .or(default_voice)
        .unwrap_or_default();
    let request_id = nomifun_common::generate_id();

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{VOLC_TTS_BASE_URL}/api/v3/tts/unidirectional"))
        .timeout(std::time::Duration::from_secs(120))
        .header("X-Api-App-Key", &app_key)
        .header("X-Api-Access-Key", &access_key)
        .header("X-Api-Resource-Id", &resource_id)
        .header("X-Api-Request-Id", &request_id)
        .json(&serde_json::json!({ "req_params": { "text": text, "model": VOLC_TTS_DEFAULT_MODEL, "speaker": speaker } }))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("火山引擎请求失败: {e}")))?;

    // Voice-domain house rule: verdict lives in X-Api-Status-Code header.
    if let Some(code) = resp
        .headers()
        .get("X-Api-Status-Code")
        .and_then(|v| v.to_str().ok())
    {
        if !matches!(code, "20000000" | "20000001" | "20000002") {
            let detail = resp
                .headers()
                .get("X-Api-Message")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("未知错误")
                .to_owned();
            return Err(AppError::BadRequest(format!("火山引擎拒绝请求 ({code}): {detail}")));
        }
    }

    let raw = resp
        .bytes()
        .await
        .map_err(|e| AppError::Internal(format!("读取响应失败: {e}")))?;
    let audio = aggregate_volc_tts_json_lines(&String::from_utf8_lossy(&raw))
        .map_err(AppError::BadRequest)?;

    Ok((
        [
            (header::CONTENT_TYPE, "audio/mpeg"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        audio,
    )
        .into_response())
}

/// Aggregate a 火山引擎 v3 TTS JSON-lines body into audio bytes. Mirrors the
/// `volc_voice` adapter's `aggregate_tts_json_lines` (kept local to avoid a
/// cross-crate export). Each non-blank line is one `{code, data}` JSON object;
/// `data` is a base64 audio chunk appended in order; data-less lines are the
/// sentinel/heartbeat when `code` ∈ {0, 20000000} and a terminal failure
/// otherwise.
fn aggregate_volc_tts_json_lines(body: &str) -> Result<Vec<u8>, String> {
    use base64::Engine as _;
    let mut out: Vec<u8> = Vec::new();
    for line in body.lines().map(str::trim).filter(|l| !l.is_empty()) {
        let value: serde_json::Value =
            serde_json::from_str(line).map_err(|e| format!("火山引擎流行非 JSON: {e}"))?;
        if let Some(data) = value.get("data").and_then(|d| d.as_str()).filter(|s| !s.trim().is_empty()) {
            let chunk = base64::engine::general_purpose::STANDARD
                .decode(data)
                .map_err(|_| "音频块 base64 非法".to_string())?;
            out.extend_from_slice(&chunk);
            continue;
        }
        let code = value.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
        if code != 0 && code != 20_000_000 {
            let msg = value
                .get("message")
                .and_then(|m| m.as_str())
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| code.to_string());
            return Err(format!("火山引擎合成失败 (code {code}): {msg}"));
        }
    }
    if out.is_empty() {
        return Err("火山引擎未返回音频".to_string());
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// WebUI admin credential endpoints (local-only)
// ---------------------------------------------------------------------------

/// Random password length for `/api/webui/reset-password`.
const RESET_PASSWORD_LEN: usize = 16;

/// Resolve the WebUI admin user, falling back to NotFound when absent.
async fn resolve_webui_admin(user_repo: &dyn IUserRepository) -> Result<User, AppError> {
    user_repo
        .get_primary_webui_user()
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?
        .ok_or_else(|| AppError::NotFound("No WebUI admin user configured".into()))
}

// ---------------------------------------------------------------------------
// POST /api/webui/change-password
// ---------------------------------------------------------------------------

async fn webui_change_password_handler(
    State(state): State<AuthRouterState>,
    body: Result<Json<WebuiChangePasswordRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<()>>, AppError> {

    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;

    validate_password(&req.new_password)?;

    let user = resolve_webui_admin(&*state.user_repo).await?;

    let password = req.new_password;
    let new_hash = tokio::task::spawn_blocking(move || hash_password(&password))
        .await
        .map_err(|e| AppError::Internal(format!("Task join error: {e}")))??;

    state
        .user_repo
        .update_password(user.user_id.as_str(), &new_hash)
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?;

    Ok(Json(ApiResponse::message("Password changed successfully")))
}

// ---------------------------------------------------------------------------
// POST /api/webui/change-username
// ---------------------------------------------------------------------------

async fn webui_change_username_handler(
    State(state): State<AuthRouterState>,
    body: Result<Json<WebuiChangeUsernameRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<WebuiChangeUsernameResponse>>, AppError> {

    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;

    let trimmed = req.new_username.trim().to_owned();
    validate_username(&trimmed)?;

    let user = resolve_webui_admin(&*state.user_repo).await?;

    if user.username != trimmed {
        state
            .user_repo
            .update_username(user.user_id.as_str(), &trimmed)
            .await
            .map_err(|e| AppError::Internal(format!("Database error: {e}")))?;
    }

    Ok(Json(ApiResponse::ok(WebuiChangeUsernameResponse { username: trimmed })))
}

// ---------------------------------------------------------------------------
// POST /api/webui/reset-password
// ---------------------------------------------------------------------------

async fn webui_reset_password_handler(
    State(state): State<AuthRouterState>,
) -> Result<Json<ApiResponse<WebuiResetPasswordResponse>>, AppError> {


    let user = resolve_webui_admin(&*state.user_repo).await?;

    let new_password = generate_password(RESET_PASSWORD_LEN);
    let password_for_hash = new_password.clone();
    let new_hash = tokio::task::spawn_blocking(move || hash_password(&password_for_hash))
        .await
        .map_err(|e| AppError::Internal(format!("Task join error: {e}")))??;

    state
        .user_repo
        .update_password(user.user_id.as_str(), &new_hash)
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?;

    Ok(Json(ApiResponse::ok(WebuiResetPasswordResponse { new_password })))
}

// ---------------------------------------------------------------------------
// POST /api/webui/generate-qr-token
// ---------------------------------------------------------------------------

async fn webui_generate_qr_token_handler(
    State(state): State<AuthRouterState>,
) -> Result<Json<ApiResponse<WebuiGenerateQrTokenResponse>>, AppError> {


    let (token, expires_at_ms) = state.qr_token_store.generate_with_expiry();

    Ok(Json(ApiResponse::ok(WebuiGenerateQrTokenResponse {
        token,
        expires_at_ms,
    })))
}

// ---------------------------------------------------------------------------
// SMS verification-code account flows (phone + SMS)
//
// 手机号即用户名：注册时 username 直接等于手机号（validate_username 允许
// 3–32 位纯数字），因此现有的 /login（find_by_username）对手机+密码登录天然生效。
// 这里只新增「发码 / 手机注册 / 手机登录 / 手机重置密码」四类端点，复用
// 既有的 IUserRepository + 短信网关（aliyun_sms）。
// ---------------------------------------------------------------------------

/// SMS verification-code purposes.
const SMS_PURPOSE_REGISTER: &str = "register";
const SMS_PURPOSE_LOGIN: &str = "login";
const SMS_PURPOSE_RESET: &str = "reset";

/// Verification code lifetime: 5 minutes.
const SMS_CODE_TTL_MS: i64 = 5 * 60 * 1000;

/// Per-phone send throttle: at most one code per 60s, and at most 20 codes per
/// calendar day (UTC-day bucket). Stored in a process-global `DashMap` keyed by
/// phone. A `OnceLock` avoids touching `AuthRouterState`'s constructors.
struct SmsPhoneThrottle {
    /// phone -> (last_send_ms, sends_today, day_bucket)
    map: DashMap<String, (i64, u32, i64)>,
}

impl SmsPhoneThrottle {
    fn check_and_record(
        &self,
        phone: &str,
        now: i64,
        cooldown_ms: i64,
        daily_cap: u32,
    ) -> Result<(), String> {
        let day = now / 86_400_000;
        let mut entry = self.map.entry(phone.to_owned()).or_insert((0i64, 0u32, day));
        if entry.2 != day {
            entry.1 = 0;
            entry.2 = day;
        }
        if now - entry.0 < cooldown_ms {
            let wait = ((cooldown_ms - (now - entry.0)) + 999) / 1000;
            return Err(format!("发送过于频繁，请 {wait} 秒后再试"));
        }
        if entry.1 >= daily_cap {
            return Err("今日短信验证码发送次数已达上限，请明天再试".into());
        }
        entry.0 = now;
        entry.1 += 1;
        Ok(())
    }
}

static SMS_PHONE_THROTTLE: OnceLock<SmsPhoneThrottle> = OnceLock::new();

fn sms_phone_throttle() -> &'static SmsPhoneThrottle {
    SMS_PHONE_THROTTLE.get_or_init(|| SmsPhoneThrottle {
        map: DashMap::new(),
    })
}

/// Validate a mainland-China mobile number: 11 digits, `1[3-9]` prefix.
fn validate_phone(phone: &str) -> Result<(), AppError> {
    let bytes = phone.as_bytes();
    let ok = bytes.len() == 11
        && bytes[0] == b'1'
        && matches!(bytes[1], b'3'..=b'9')
        && bytes.iter().all(|b| b.is_ascii_digit());
    if !ok {
        return Err(AppError::BadRequest("请输入有效的 11 位中国大陆手机号".into()));
    }
    Ok(())
}

/// Response data for `POST /api/auth/sms/send`.
#[derive(Debug, Serialize)]
pub struct SendSmsData {
    /// Echoed only in dev mode (`GEEKCLAW_SMS_DEV_MODE` set). Lets the client
    /// complete the flow without a real handset. Absent in production.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dev_code: Option<String>,
}

// ---------------------------------------------------------------------------
// POST /api/auth/sms/send — issue a verification code (no session required)
// ---------------------------------------------------------------------------

async fn sms_send_handler(
    State(state): State<AuthRouterState>,
    body: Result<Json<SendSmsRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<SendSmsData>>, AppError> {
    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;
    let phone = req.phone.trim().to_owned();
    validate_phone(&phone)?;

    let purpose = match req.purpose.trim() {
        SMS_PURPOSE_REGISTER | SMS_PURPOSE_LOGIN | SMS_PURPOSE_RESET => req.purpose.trim().to_owned(),
        other => return Err(AppError::BadRequest(format!("未知的验证码用途: {other}"))),
    };

    // Per-phone throttle (60s cooldown + 20/day). Surfaced as a friendly 400.
    let now = now_ms();
    if let Err(msg) = sms_phone_throttle().check_and_record(&phone, now, 60_000, 20) {
        return Err(AppError::BadRequest(msg));
    }

    let code = generate_sms_code();
    let expires_at = now + SMS_CODE_TTL_MS;
    state
        .user_repo
        .create_sms_code(&phone, &code, &purpose, expires_at)
        .await
        .map_err(|e| AppError::Internal(format!("保存验证码失败: {e}")))?;

    // Send via Aliyun unless dev mode is on: then skip the gateway and echo the
    // code so the flow is exercisable without a real handset.
    let dev_code = if std::env::var("GEEKCLAW_SMS_DEV_MODE").is_ok() {
        Some(code.clone())
    } else {
        match send_verification_sms(&phone, &code).await {
            Ok(()) => None,
            Err(e) => {
                // The persisted code is simply orphaned (won't validate later);
                // report the SMS failure so the client can retry.
                return Err(AppError::BadRequest(format!("短信发送失败: {e}")));
            }
        }
    };

    Ok(Json(ApiResponse::ok(SendSmsData { dev_code })))
}

// ---------------------------------------------------------------------------
// POST /api/auth/register/phone — SMS-code account creation
// ---------------------------------------------------------------------------

async fn phone_register_handler(
    State(state): State<AuthRouterState>,
    headers: HeaderMap,
    body: Result<Json<PhoneRegisterRequest>, JsonRejection>,
) -> Result<Response, AppError> {
    // Same Secure-cookie trap as /login: refuse a plain-HTTP browser register
    // before the session cookie can stick.
    state.cookie_config.reject_plaintext_login_when_secure(&headers)?;

    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;
    let phone = req.phone.trim().to_owned();
    validate_phone(&phone)?;

    // Resolve the login username. When the client supplies one we validate it
    // and reject duplicates; otherwise the phone number itself becomes the
    // username (legacy phone==username path, keeps /login working).
    let username = match req.username.as_ref() {
        Some(u) if !u.trim().is_empty() => {
            let u = u.trim().to_owned();
            if let Err(e) = validate_username(&u) {
                // 用户名校验错误也走中文 + 专用 code（与弱密码一致的 i18n 策略）
                let (code, msg) = match &e {
                    AuthError::InvalidUsername(_) => (
                        "invalidUsername",
                        "用户名格式不正确(3-32 位字母/数字/下划线/连字符)".to_string(),
                    ),
                    _ => ("invalidCredentials", e.to_string()),
                };
                return Ok(error_response(StatusCode::BAD_REQUEST, code, msg));
            }
            if state
                .user_repo
                .find_by_username(&u)
                .await
                .map_err(|e| AppError::Internal(format!("Database error: {e}")))?
                .is_some()
            {
                return Ok(error_response(
                    StatusCode::CONFLICT,
                    "usernameTaken",
                    "该用户名已被占用，请换一个",
                ));
            }
            u
        }
        _ => phone.clone(),
    };

    if state
        .user_repo
        .find_by_phone(&phone)
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?
        .is_some()
    {
        return Ok(error_response(
            StatusCode::CONFLICT,
            "phoneRegistered",
            "该手机号已注册，请直接登录",
        ));
    }

    if let Err(e) = validate_password(&req.password) {
        // 显式返回中文 message + 专用 code, 让前端(无论缓存什么版本)都能直接展示,
        // 不要再依赖英文文案的字符串匹配。i18n 暂时让步: 站点主用户群是中文。
        let (code, msg) = match &e {
            AuthError::WeakPassword(_) => (
                "weakPassword",
                "密码过于简单,请使用至少 8 位的复杂密码".to_string(),
            ),
            AuthError::InvalidUsername(_) => (
                "invalidUsername",
                "用户名格式不正确(3-32 位字母/数字/下划线/连字符)".to_string(),
            ),
            _ => ("invalidCredentials", e.to_string()),
        };
        return Ok(error_response(StatusCode::BAD_REQUEST, code, msg));
    }

    // Verify + consume the SMS code.
    let now = now_ms();
    let (code_id, expected) = match state
        .user_repo
        .get_latest_valid_sms_code(&phone, SMS_PURPOSE_REGISTER, now)
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?
    {
        Some(v) => v,
        None => {
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                "invalidCode",
                "验证码无效或已过期，请重新获取",
            ))
        }
    };
    if req.code.trim() != expected {
        return Ok(error_response(
            StatusCode::BAD_REQUEST,
            "invalidCode",
            "验证码错误",
        ));
    }
    state
        .user_repo
        .mark_sms_code_used(code_id)
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?;

    let password = req.password.clone();
    let password_hash = tokio::task::spawn_blocking(move || hash_password(&password))
        .await
        .map_err(|e| AppError::Internal(format!("Task join error: {e}")))??;

    // Use the resolved username (supplied by client, or the phone number as
    // fallback) so /login keeps working for both cases.
    let created_user = match state
        .user_repo
        .create_user_with_phone(&username, &password_hash, &phone)
        .await
    {
        Ok(u) => u,
        Err(DbError::Conflict(_)) => {
            return Ok(error_response(
                StatusCode::CONFLICT,
                "phoneRegistered",
                "该手机号已注册，请直接登录",
            ))
        }
        Err(other) => return Err(AppError::Internal(format!("Database error: {other}"))),
    };

    // Optional invite code (mirrors register_handler's growth-loop rewards).
    let invite_code = req.invite_code.trim();
    if !invite_code.is_empty() {
        let consumed = state
            .user_repo
            .consume_invitation(invite_code, created_user.user_id.as_str())
            .await
            .map_err(|e| AppError::Internal(format!("Database error: {e}")))?;
        if !consumed {
            let _ = state.user_repo.delete_user(created_user.user_id.as_str()).await;
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                "invalidInviteCode",
                "邀请码无效或已过期",
            ));
        }
        if let Ok(Some(inv)) = state.user_repo.get_invitation(invite_code).await {
            if let Some(plan) = inv.plan.as_deref().filter(|p| !p.is_empty()) {
                let _ = state
                    .user_repo
                    .set_plan(created_user.user_id.as_str(), plan)
                    .await;
            }
            if inv.credits_grant > 0 {
                let _ = state
                    .user_repo
                    .add_credits(
                        created_user.user_id.as_str(),
                        inv.credits_grant,
                        "signup_bonus",
                        Some("invitation"),
                        Some(invite_code),
                        Some("邀请注册奖励"),
                    )
                    .await;
            }
            if inv.reward_to_inviter > 0 {
                let _ = state
                    .user_repo
                    .add_credits(
                        &inv.created_by,
                        inv.reward_to_inviter,
                        "invite_reward",
                        Some("invitation"),
                        Some(invite_code),
                        Some("邀请新用户奖励"),
                    )
                    .await;
            }
        }
    }

    let token = state
        .jwt_service
        .sign(created_user.user_id.as_str(), &created_user.username)
        .map_err(|e| AppError::Internal(format!("Token signing error: {e}")))?;

    if let Err(e) = state.user_repo.update_last_login(created_user.user_id.as_str()).await {
        tracing::warn!("Failed to update last login for {}: {e}", created_user.user_id);
    }

    let cookie = state.cookie_config.build_session_cookie(&token);
    let resp = LoginResponse::new(into_public_user(created_user)?, token);
    Ok(([(header::SET_COOKIE, cookie)], Json(resp)).into_response())
}

// ---------------------------------------------------------------------------
// POST /api/auth/login/phone — phone + password OR phone + SMS code
// ---------------------------------------------------------------------------

async fn phone_login_handler(
    State(state): State<AuthRouterState>,
    headers: HeaderMap,
    body: Result<Json<PhoneLoginRequest>, JsonRejection>,
) -> Result<Response, AppError> {
    state.cookie_config.reject_plaintext_login_when_secure(&headers)?;

    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;
    let phone = req.phone.trim().to_owned();
    validate_phone(&phone)?;

    // Resolve the account: by phone first, then by username == phone (legacy).
    let user = if let Some(u) = state
        .user_repo
        .find_by_phone(&phone)
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?
    {
        u
    } else if let Some(u) = state
        .user_repo
        .find_by_username(&phone)
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?
    {
        u
    } else {
        return Err(AppError::Unauthorized("该手机号尚未注册".into()));
    };

    match (req.code.as_deref(), req.password.as_deref()) {
        (Some(code), _) if !code.trim().is_empty() => {
            let now = now_ms();
            let (code_id, expected) = match state
                .user_repo
                .get_latest_valid_sms_code(&phone, SMS_PURPOSE_LOGIN, now)
                .await
                .map_err(|e| AppError::Internal(format!("Database error: {e}")))?
            {
                Some(v) => v,
                None => {
                    return Ok(error_response(
                        StatusCode::BAD_REQUEST,
                        "invalidCode",
                        "验证码无效或已过期，请重新获取",
                    ))
                }
            };
            if code.trim() != expected {
                return Ok(error_response(
                    StatusCode::BAD_REQUEST,
                    "invalidCode",
                    "验证码错误",
                ));
            }
            state
                .user_repo
                .mark_sms_code_used(code_id)
                .await
                .map_err(|e| AppError::Internal(format!("Database error: {e}")))?;
        }
        (_, Some(password)) if !password.is_empty() => {
            let valid = verify_password_timed(password, &user.password_hash).await?;
            if !valid {
                return Err(AppError::Unauthorized("手机号或密码错误".into()));
            }
        }
        _ => {
            return Err(AppError::BadRequest("请提供短信验证码或密码".into()));
        }
    }

    let token = state
        .jwt_service
        .sign(user.user_id.as_str(), &user.username)
        .map_err(|e| AppError::Internal(format!("Token signing error: {e}")))?;

    if let Err(e) = state.user_repo.update_last_login(user.user_id.as_str()).await {
        tracing::warn!("Failed to update last login for {}: {e}", user.user_id);
    }

    let cookie = state.cookie_config.build_session_cookie(&token);
    let resp = LoginResponse::new(into_public_user(user)?, token);
    Ok(([(header::SET_COOKIE, cookie)], Json(resp)).into_response())
}

// ---------------------------------------------------------------------------
// POST /api/auth/reset-password/phone — verify code then set new password
// ---------------------------------------------------------------------------

async fn reset_password_phone_handler(
    State(state): State<AuthRouterState>,
    body: Result<Json<ResetPasswordPhoneRequest>, JsonRejection>,
) -> Result<Response, AppError> {
    let Json(req) = body.map_err(|e| AppError::BadRequest(e.to_string()))?;
    let phone = req.phone.trim().to_owned();
    validate_phone(&phone)?;
    if let Err(e) = validate_password(&req.new_password) {
        return Ok(error_response(
            StatusCode::BAD_REQUEST,
            "invalidCredentials",
            e.to_string(),
        ));
    }

    let user = match state
        .user_repo
        .find_by_phone(&phone)
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?
    {
        Some(u) => u,
        None => {
            return Ok(error_response(
                StatusCode::NOT_FOUND,
                "phoneNotRegistered",
                "该手机号尚未注册",
            ))
        }
    };

    let now = now_ms();
    let (code_id, expected) = match state
        .user_repo
        .get_latest_valid_sms_code(&phone, SMS_PURPOSE_RESET, now)
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?
    {
        Some(v) => v,
        None => {
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                "invalidCode",
                "验证码无效或已过期，请重新获取",
            ))
        }
    };
    if req.code.trim() != expected {
        return Ok(error_response(
            StatusCode::BAD_REQUEST,
            "invalidCode",
            "验证码错误",
        ));
    }
    state
        .user_repo
        .mark_sms_code_used(code_id)
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?;

    let password = req.new_password.clone();
    let new_hash = tokio::task::spawn_blocking(move || hash_password(&password))
        .await
        .map_err(|e| AppError::Internal(format!("Task join error: {e}")))??;

    state
        .user_repo
        .update_password(user.user_id.as_str(), &new_hash)
        .await
        .map_err(|e| AppError::Internal(format!("Database error: {e}")))?;

    Ok(Json(ApiResponse::message("密码重置成功，请使用新密码登录")).into_response())
}
