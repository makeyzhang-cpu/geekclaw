/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// WhatsApp Cloud API plugin (v5.0.26).
//
// v1 scope: text-message inbound via webhook, text-message outbound via REST.
//   - Webhook verification: Meta sends GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…
//     the manager routes these (see routes.rs). This plugin only consumes the
//     validated payload that arrives via `inject_webhook`.
//   - Inbound: webhook POSTs are dispatched into `message_tx` by the manager
//     after HMAC-SHA256 (`X-Hub-Signature-256`) check using `app_secret`.
//   - Outbound: POST <phone_number_id>/messages with Bearer <access_token>.
//
// Webhook transport is *not* the plugin's job — the manager has the HTTP
// listener (axum). This plugin just owns the per-bot HTTP client and the
// credentials. The webhook endpoint is registered at
// `/api/channel/plugins/whatsapp/webhook` (one path, dispatches by phone_number_id).
pub mod plugin;
pub mod types;
