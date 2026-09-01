# GeekClaw 桌面端 ↔ 云端账号 OAuth 对接契约（v0.4.1）

> 用途：本文件是**桌面端（Tauri，本地优先）**与**云端账号体系（geekclaw.ai 后台）**之间的接口契约。
> 桌面端这边的代码已全部落地（后端 4 个路由 + 前端 `cloudAuth.ts` + 定价页入口 + `plugin-shell`/`deep-link` 基建）。
> 云端这边还需要按本文补齐 **两个小钩子** 即可打通。请云端同事（或经小G授权由我改线上后台）按本契约实现。

---

## 1. 为什么是这个方案

用户确认：桌面端**不内置第二套账号体系**，注册 / 登录 / 下单 / 积分 / 激活 全部走中央云端账号。

采用业界标准做法 —— **OAuth 2.0 授权码模式 + 系统浏览器 + 本地后端中转**（Spotify / Discord / GitHub Desktop / Notion / Linear 都是这个套路）：

- 桌面端唤起**系统浏览器**打开云端真实登录页（用户看到的是官网真页面，信任感强、可被密码管理器识别）。
- 登录成功后云端 **302 回跳到 `geekclaw://` 深链**。
- 桌面端捕获深链，由**本地后端（服务端）用 `code` 换 JWT** —— token 全程不进浏览器、不进前端 JS。
- 工作数据仍留本机 SQLite（local-first 不变），只有「身份 + 订阅/积分/激活」走云端。

```
桌面 App ──(open 系统浏览器)──> /api/oauth/geekclaw/start
                                      │ 302
                                      ▼
                              云端登录页（真实页面）
                                      │ 用户登录成功 → 302
                                      ▼
                       geekclaw://auth/callback?code=..&state=..
                                      │ OS 深链投递
                                      ▼
                              桌面 App 捕获 → POST /api/oauth/geekclaw/exchange
                                      │ 服务端用 code 换 JWT（token 不出浏览器）
                                      ▼
                              存 system_kv（KV_CLOUD_AUTH_TOKEN）
```

---

## 2. 云端必须提供的能力

### A. 登录 / 注册页支持 `redirect_uri`（含 `geekclaw://` 自定义协议）

桌面端在 `/api/oauth/geekclaw/start` 里 302 到：

```
{CLOUD_BASE}{LOGIN_PATH}?redirect_uri=geekclaw%3A%2F%2Fauth%2Fcallback&state={state}
```

- `CLOUD_BASE` = 环境变量 `GEEKCLAW_STORE_API_BASE`，默认 `https://www.geekclaw.ai`
- `LOGIN_PATH` = **待确认**（桌面端当前默认 `/login`，见第 5 节「待确认项」）
- `redirect_uri` 已做 URL-encode，解码后就是 `geekclaw://auth/callback`

**云端需要做的：**

1. 登录页（以及注册页）读取 `redirect_uri` 和 `state` 两个 query 参数。
2. 用户登录成功 **或** 注册成功（注册后自动登录）后，302 到：

   ```
   geekclaw://auth/callback?code={AUTHORIZATION_CODE}&state={state}
   ```

   - `code`：一次性、短时效的授权码（见安全约定）。
   - `state`：**原样回传**桌面端带过来的那个 `state`（CSRF 校验用，不可省略）。
3. ⚠️ **关键**：`redirect_uri` 的协议白名单必须**允许 `geekclaw://` 自定义协议**，不能只允许 `http(s)://`。这是和常规 Web OAuth 唯一不同的地方。

> 可选增强：若用户拒绝授权，302 到 `geekclaw://auth/callback?error=access_denied&state={state}`，桌面端会识别 `error` 并静默保持未登录。

### B. `POST /api/auth/token` —— 授权码换 JWT

桌面端本地后端在 `/api/oauth/geekclaw/exchange` 里**服务端**调用此端点：

**请求：**

```
POST {CLOUD_BASE}/api/auth/token
Content-Type: application/json
{
  "grant_type": "authorization_code",
  "code": "<AUTHORIZATION_CODE>",
  "redirect_uri": "geekclaw://auth/callback",
  "client_id": "geekclaw-desktop"
}
```

**响应（云端的两种写法桌面端都兼容）：**

写法一（推荐，标准 OAuth2）：

```json
{
  "access_token": "<JWT>",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

写法二（云端现有 `{success, token}` 风格也可）：

```json
{
  "success": true,
  "token": "<JWT>"
}
```

**错误响应（两种写法都兼容）：**

```json
{ "success": false, "error": "invalid_grant" }
// 或
{ "error": "invalid_grant", "error_description": "code 已过期" }
```

桌面端会把这个 `error` 透出到 UI。

---

## 3. JWT 约定（桌面端只解码、不验签）

桌面端拿到 JWT 后**只在本地 base64 解码 payload 读取用户信息**，不做签名校验（因为 token 是服务端从可信云端换来的）。所以云端 JWT 只需保证以下 claim 存在、可被解码即可：

| claim        | 说明                | 桌面端用途           |
| ------------ | ------------------- | -------------------- |
| `sub`        | 用户唯一 id         | 账号标识             |
| `name`       | 显示名（可选）      | 定价页展示           |
| `email`      | 邮箱（可选）        | 展示                 |
| `username`   | 用户名（可选）      | 展示（fallback name）|

> 后续阶段（下单/积分/激活）桌面端会把此 JWT 作为 `Authorization: Bearer <JWT>` 带去云端
> 受保护端点（如 `/api/billing/*`）。云端届时按现有 JWT 校验逻辑放行即可。

---

## 4. 安全约定

- **`state` 防 CSRF**：桌面端在 `/start` 生成 32 位十六进制 `state` 存本地；`/exchange` 时校验深链回传的 `state` 与本地一致，不一致直接拒绝。云端必须原样带回 `state`。
- **`code` 一次性 + 短时效**：建议有效期 ≤ 60s，用后作废，避免重放。
- **token 不出浏览器**：采用授权码模式而非隐式模式，JWT 只在服务端换取与存储（本地 `system_kv`）。
- **`redirect_uri` 校验**：云端应校验回传的 `redirect_uri` 等于 `geekclaw://auth/callback`（固定值），避免开放重定向。
- **`client_id=geekclaw-desktop`** 为公开客户端（无 secret），云端可按需忽略或登记。

---

## 5. 待确认项（需云端同事拍板 / 或我按小G授权改线上）

1. **登录页真实路径**：桌面端默认拼 `/login`。若云端登录页实际是 `/auth/login`、`/login.html` 或某个 SPA 路由（如 `/#/login`），请告知，我改 `CLOUD_OAUTH_LOGIN_PATH` 重新出包。
2. **注册页路径**：注册成功后的回跳是否和登录走同一 `redirect_uri` 逻辑？如果是独立 `/register` 页，请确认它也支持 `redirect_uri`+`state` 回跳。
3. **`/api/auth/token` 是否已存在**：现有后台探活显示 `/api/auth/register`、`/api/auth/status` 在工作。若 `token` 端点尚未实现，需新增（最小实现见第 2 节 B）。
4. **`geekclaw://` 协议白名单**：确认云端 `redirect_uri` 校验允许该自定义协议。

---

## 6. 桌面端已落地的接口（供云端对照）

| 桌面端路由                      | 方法 | 作用                                             |
| ------------------------------- | ---- | ------------------------------------------------ |
| `/api/oauth/geekclaw/start`     | GET  | 生成 state，302 到云端登录页                     |
| `/api/oauth/geekclaw/exchange`  | POST | 服务端用 code 换 JWT，存 kv（CSRF 校验 state）   |
| `/api/auth/cloud-status`        | GET  | 返回 `{authenticated, user}`（解码本地 JWT）     |
| `/api/auth/cloud-logout`        | POST | 清空本地 token                                    |

前端：`ui/src/common/adapter/cloudAuth.ts`（`openCloudLogin` / `handleCloudDeepLink` / `subscribeCloudAuth` / `cloudLogout`）。
定价页入口：`ui/src/renderer/pages/pricing/index.tsx` 右上角「登录云端账号」按钮。

---

## 7. 联调 checklist

- [ ] 云端登录页接受 `redirect_uri=geekclaw://auth/callback&state=xxx`
- [ ] 云端 `redirect_uri` 白名单允许 `geekclaw://`
- [ ] 登录/注册成功后 302 到 `geekclaw://auth/callback?code=..&state=..`（state 原样）
- [ ] `POST /api/auth/token` 用 code 返回 JWT（写法一或二均可）
- [ ] 桌面端点「登录云端账号」→ 系统浏览器打开登录页 → 登录 → 自动回桌面 → 定价页显示云端用户名
- [ ] 点「退出云端」→ `cloud-status` 回到 `authenticated:false`
- [ ] 用错误 code 调 `/exchange` → 桌面端提示云端返回的错误
