/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// LINE Messaging API plugin (v5.0.26).
//
// v1 scope: text-message inbound via webhook, text-message outbound via REST.
//   - Inbound: webhook POST `/api/channel/plugins/line/webhook` carries X-Line-Signature
//     HMAC-SHA256 of the raw body using `channel_secret`. Verified by the manager
//     before calling `inject_webhook`.
//   - Outbound: POST https://api.line.me/v2/bot/message/push with Bearer
//     <channel_access_token>.
//
// The plugin owns the per-bot HTTP client + credentials. No long-running loop
// — the manager's axum route handles webhook transport.
pub mod plugin;
pub mod types;
