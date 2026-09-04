/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Email channel plugin (v5.0.26).
//
// v1 scope: text-only, polled every 60s (IMAP IDLE optional where supported).
//   - Inbound: IMAP IDLE/SELECT loop → UID FETCH → text/plain bodies as
//     `UnifiedIncomingMessage`. `chat_id` is the sender email address;
//     `message_id` is the IMAP UID.
//   - Outbound: SMTP send with `From: <account_id>`, plain-text body.
//   - Credentials: imap_host/port, smtp_host/port, imap_username,
//     imap_password, account_id (the bot email).
//
// The IMAP/SMTP transports are gated behind the `email` feature flag. The
// `lettre` and `async-imap` crates (already listed as optional deps) drive
// them; see plugin.rs for the actual connection wiring.
pub mod plugin;
pub mod types;
