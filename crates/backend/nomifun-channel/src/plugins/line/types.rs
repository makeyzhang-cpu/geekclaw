/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// LINE Messaging API wire types (subset used by v1).
// Reference: https://developers.line.biz/en/reference/messaging-api/

use serde::{Deserialize, Serialize};

/// Inbound webhook event envelope.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookEvents {
    #[serde(default)]
    pub destination: String,
    #[serde(default)]
    pub events: Vec<WebhookEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookEvent {
    #[serde(rename = "type")]
    pub kind: String,
    pub message: Option<WebhookMessage>,
    pub source: WebhookSource,
    pub timestamp: i64,
    #[serde(default)]
    pub replyToken: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookMessage {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookSource {
    #[serde(rename = "type")]
    pub kind: String,
    pub groupId: Option<String>,
    pub userId: Option<String>,
    pub roomId: Option<String>,
}

/// Outbound push body (single text message to one recipient).
#[derive(Debug, Clone, Serialize)]
pub struct PushTextBody<'a> {
    pub to: &'a str,
    #[serde(rename = "type")]
    pub kind: &'a str,
    pub text: &'a str,
}
