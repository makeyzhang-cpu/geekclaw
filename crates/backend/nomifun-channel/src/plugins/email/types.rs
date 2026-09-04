/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Email plugin wire types (v5.0.26).
//
// Inbound: we never parse RFC-5322 ourselves — we ask the IMAP server for
// `BODY[TEXT]` (or `BODY.PEEK[TEXT]` to avoid marking as Seen) and pass the
// raw bytes through. Outbound is even simpler: a `(to, subject, text)` triple
// produces a single SMTP submission.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedInbound {
    pub from: String,
    pub subject: String,
    pub message_id_header: String,
    pub text: String,
    pub uid: u32,
}
