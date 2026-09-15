//! `ModelSuggestionSink` for ordinary (non-companion) GeekClaw conversations.
//!
//! Mirrors the companion-profile branch in `nomifun-companion::companion`, but
//! routes the suggestion to a conversation's authoritative `model` column (when
//! still unset → auto-adopt) or to `conversation.extra.model_suggestion` (when a
//! model is already confirmed → staged proposal for the user to accept in the
//! UI). Wraps only `IConversationRepository` so it is constructible from the
//! factory wiring without materializing a full `ConversationService`.

use std::sync::Arc;

use async_trait::async_trait;
use nomifun_common::{
    ModelSuggestion, ModelSuggestionSink, ProviderWithModel, now_ms,
};
use nomifun_db::{ConversationRowUpdate, IConversationRepository};

/// Sink that persists an AI model suggestion for a regular conversation.
pub struct ConversationModelSuggestionSink {
    repo: Arc<dyn IConversationRepository>,
}

impl ConversationModelSuggestionSink {
    pub fn new(repo: Arc<dyn IConversationRepository>) -> Self {
        Self { repo }
    }
}

#[async_trait]
impl ModelSuggestionSink for ConversationModelSuggestionSink {
    async fn suggest_model(
        &self,
        conversation_id: &str,
        provider_id: &str,
        model: &str,
        reason: &str,
    ) -> Result<String, String> {
        let pwm = ProviderWithModel {
            provider_id: provider_id.to_owned(),
            model: model.to_owned(),
            use_model: None,
        };
        pwm.validate().map_err(|e| e)?;

        let row = self
            .repo
            .get(conversation_id)
            .await
            .map_err(|e| format!("读取会话失败: {e}"))?
            .ok_or_else(|| "会话不存在".to_owned())?;

        // Authoritative model already confirmed → stage a proposal in extra.
        let current_model: Option<ProviderWithModel> = row
            .model
            .as_deref()
            .and_then(|s| serde_json::from_str::<ProviderWithModel>(s).ok());

        if current_model.is_some() {
            let suggestion = ModelSuggestion {
                provider_id: provider_id.to_owned(),
                model: model.to_owned(),
                reason: reason.to_owned(),
                suggested_at: now_ms(),
            };
            let mut extra: serde_json::Value =
                serde_json::from_str(&row.extra).unwrap_or(serde_json::json!({}));
            if !extra.is_object() {
                extra = serde_json::json!({});
            }
            extra["model_suggestion"] =
                serde_json::to_value(&suggestion).map_err(|e| format!("序列化建议失败: {e}"))?;
            let extra_str =
                serde_json::to_string(&extra).map_err(|e| format!("序列化 extra 失败: {e}"))?;
            self.repo
                .update(
                    conversation_id,
                    &ConversationRowUpdate {
                        extra: Some(extra_str),
                        updated_at: Some(now_ms()),
                        ..Default::default()
                    },
                )
                .await
                .map_err(|e| format!("写入模型建议失败: {e}"))?;
            return Ok(format!(
                "已记录模型推荐 {provider_id}/{model}（待你在界面确认）：{reason}"
            ));
        }

        // No authoritative model yet → auto-adopt on this first AI proposal.
        let json = serde_json::to_string(&pwm).map_err(|e| format!("序列化模型失败: {e}"))?;
        self.repo
            .update(
                conversation_id,
                &ConversationRowUpdate {
                    model: Some(Some(json)),
                    updated_at: Some(now_ms()),
                    ..Default::default()
                },
            )
            .await
            .map_err(|e| format!("写入模型失败: {e}"))?;
        Ok(format!("已为会话采用推荐模型 {provider_id}/{model}：{reason}"))
    }
}
