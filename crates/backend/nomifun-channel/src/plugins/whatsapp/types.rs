/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// WhatsApp Cloud API wire types (subset used by v1).
// Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples

use serde::{Deserialize, Serialize};

/// Top-level webhook envelope.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookPayload {
    pub object: String,
    #[serde(default)]
    pub entry: Vec<WebhookEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookEntry {
    pub id: String,
    #[serde(default)]
    pub changes: Vec<WebhookChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookChange {
    pub field: String,
    pub value: WebhookChangeValue,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookChangeValue {
    #[serde(default)]
    pub messaging_product: String,
    #[serde(default)]
    pub metadata: WebhookMetadata,
    #[serde(default)]
    pub messages: Vec<WebhookMessage>,
    #[serde(default)]
    pub statuses: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WebhookMetadata {
    pub display_phone_number: String,
    pub phone_number_id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WebhookMessage {
    pub from: String,
    pub id: String,
    pub timestamp: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub text: Option<WebhookTextBody>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookTextBody {
    pub body: String,
}

/// Outbound send body.
#[derive(Debug, Clone, Serialize)]
pub struct SendMessageBody<'a> {
    pub messaging_product: &'a str,
    #[serde(rename = "to")]
    pub recipient: &'a str,
    #[serde(rename = "type")]
    pub kind: &'a str,
    pub text: SendTextBody<'a>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SendTextBody<'a> {
    pub body: &'a str,
}

/// Outbound API response.
#[derive(Debug, Clone, Deserialize)]
pub struct SendMessageResponse {
    pub messages: Vec<SendMessageResponseItem>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SendMessageResponseItem {
    pub id: String,
}
