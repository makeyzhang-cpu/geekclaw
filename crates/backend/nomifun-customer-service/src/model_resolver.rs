//! 客服智能体的模型自动择优（auto model routing）。
//!
//! # 为什么需要它
//!
//! 客服是**对外服务**：访客不会等你修好模型配置。而现实里模型通道随时可能失效
//! ——密钥过期、额度用尽、云端托管模型下线（2026-09 出现过托管免费模型全线
//! 返回 400）。一旦失效，表现就是访客收到一句"暂时无法回复"。
//!
//! 所以这里做两件事：
//!
//! 1. **择优**：智能体没显式指定模型（或指定的已不可用）时，从用户在 GeekClaw
//!    里已配置的模型通道中按固定规则挑最优的一个。
//! 2. **兜底**：即使显式指定了模型，失败时也按候选链自动换下一个再试一次。
//!    这比"一次性失败"更贴近商业产品的预期。
//!
//! # 排序规则（"最优"的定义）
//!
//! 服务商：`local` 优先于 `cloud`（本地是用户自己的密钥，可控；云端托管受平台
//! 侧供给影响），再按 `sort_order` 升序、`created_at` 升序（保证结果稳定可复现）。
//! 模型：只看 `enabled` 且具备 chat 能力者，按 `sort_order` 升序；健康探针
//! 报 `error` 的排到同组末尾（不直接剔除——探针结果可能过期，而兜底链会兜住）。

use std::sync::Arc;

use nomifun_common::ProviderWithModel;
use nomifun_db::models::{CsAgentRow, Provider};
use nomifun_db::{IProviderModelRepository, IProviderRepository};

/// 单次回合最多尝试的模型数。
///
/// 3 是个折中：足以跨过"首选通道整体挂掉"，又不至于在真正欠费/封号时把三家
/// 服务商各刷一遍（每次都是真实计费调用）。
pub const MAX_CANDIDATES: usize = 3;

/// 只读的模型目录视图：把"已配置的模型通道"整理成可排序的候选。
pub struct CsModelResolver {
    providers: Arc<dyn IProviderRepository>,
    models: Arc<dyn IProviderModelRepository>,
}

impl CsModelResolver {
    pub fn new(
        providers: Arc<dyn IProviderRepository>,
        models: Arc<dyn IProviderModelRepository>,
    ) -> Self {
        Self { providers, models }
    }

    /// 该智能体本次回合应该依次尝试的模型。第一个是首选。
    ///
    /// - 显式配置了 `(provider_id, model)` 且该组合当前可用 → 排第一。
    /// - 其后追加自动择优候选（去重），总数不超过 `MAX_CANDIDATES`。
    /// - 目录读取失败时**不报错**：退化为"仅显式配置"，由既有逻辑处理。
    ///   客服是读路径，不该因为目录抖动而整体不可用。
    pub async fn candidates(&self, agent: &CsAgentRow) -> Vec<ProviderWithModel> {
        let mut out: Vec<ProviderWithModel> = Vec::new();

        let configured = match (agent.provider_id.as_deref(), agent.model.as_deref()) {
            (Some(provider_id), Some(model))
                if !provider_id.is_empty() && !model.is_empty() =>
            {
                Some(ProviderWithModel {
                    provider_id: provider_id.to_owned(),
                    model: model.to_owned(),
                    use_model: None,
                })
            }
            _ => None,
        };

        let auto = self.ranked().await;

        // 显式配置只有"当前确实存在且启用"时才当首选。否则（比如用户删掉了
        // 那个服务商）直接让位给自动择优，避免每次都先撞一次南墙。
        if let Some(candidate) = configured {
            if auto
                .iter()
                .any(|c| c.provider_id == candidate.provider_id && c.model == candidate.model)
            {
                out.push(candidate);
            }
        }

        for candidate in auto {
            if out.len() >= MAX_CANDIDATES {
                break;
            }
            if out.iter().any(|c| {
                c.provider_id == candidate.provider_id && c.model == candidate.model
            }) {
                continue;
            }
            out.push(candidate);
        }
        out
    }

    /// 全目录择优：每个服务商出它最好的一个 chat 模型，再按服务商排序。
    async fn ranked(&self) -> Vec<ProviderWithModel> {
        let providers = match self.providers.list().await {
            Ok(list) => list,
            Err(error) => {
                tracing::warn!(%error, "cs auto model: provider catalog read failed");
                return Vec::new();
            }
        };

        let mut usable: Vec<Provider> = providers.into_iter().filter(|p| p.enabled).collect();
        usable.sort_by(|a, b| {
            local_first(a)
                .cmp(&local_first(b))
                .then(a.sort_order.cmp(&b.sort_order))
                .then(a.created_at.cmp(&b.created_at))
                .then(a.provider_id.cmp(&b.provider_id))
        });

        let mut out = Vec::new();
        for provider in usable {
            if out.len() >= MAX_CANDIDATES {
                break;
            }
            if let Some(model) = self.best_chat_model(&provider).await {
                out.push(ProviderWithModel {
                    provider_id: provider.provider_id,
                    model,
                    use_model: None,
                });
            }
        }
        out
    }

    /// 一个服务商下当前最好的 chat 模型名。
    async fn best_chat_model(&self, provider: &Provider) -> Option<String> {
        let rows = match self.models.list_for_provider(&provider.provider_id).await {
            Ok(rows) => rows,
            Err(error) => {
                tracing::warn!(
                    provider_id = %provider.provider_id,
                    %error,
                    "cs auto model: provider model list read failed"
                );
                return None;
            }
        };

        let mut usable: Vec<(i64, bool, String)> = rows
            .into_iter()
            .filter(|row| row.enabled && is_chat_capable(&row.tasks))
            .map(|row| (row.sort_order, health_is_bad(row.health.as_deref()), row.model))
            .collect();
        usable.sort_by(|a, b| a.1.cmp(&b.1).then(a.0.cmp(&b.0)).then(a.2.cmp(&b.2)));
        usable.into_iter().next().map(|(_, _, model)| model)
    }
}

/// `local`（用户自建，密钥自持）排在 `cloud`（平台托管）之前。
fn local_first(provider: &Provider) -> u8 {
    if provider.source == "local" { 0 } else { 1 }
}

/// `tasks` 是 `ModelTask[]` 的 JSON 文本。空数组视为"未分类、按可用处理"；
/// 非空时必须含 chat 才算可用（避免挑中只能做向量/图像的模型）。
fn is_chat_capable(tasks_json: &str) -> bool {
    match serde_json::from_str::<Vec<String>>(tasks_json) {
        Ok(tasks) => tasks.is_empty() || tasks.iter().any(|t| t.eq_ignore_ascii_case("chat")),
        Err(_) => true,
    }
}

/// `health` 是 `ModelHealthStatus` 的 JSON 文本；只识别明显的失败态。
/// 解析不出来时按健康处理（探针结果可能过期，兜底链会兜住真失败）。
fn health_is_bad(health_json: Option<&str>) -> bool {
    let Some(json) = health_json else { return false };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(json) else {
        return false;
    };
    value
        .get("status")
        .and_then(|v| v.as_str())
        .map(|s| matches!(s.to_ascii_lowercase().as_str(), "error" | "failed" | "unhealthy"))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_capability_parsing_is_lenient() {
        assert!(is_chat_capable("[]"));
        assert!(is_chat_capable(r#"["chat"]"#));
        assert!(is_chat_capable(r#"["Chat","embedding"]"#));
        assert!(!is_chat_capable(r#"["embedding","rerank"]"#));
        // 非预期格式不让整条链路挂掉
        assert!(is_chat_capable("not-json"));
    }

    #[test]
    fn health_bad_only_on_explicit_failure() {
        assert!(health_is_bad(Some(r#"{"status":"error"}"#)));
        assert!(health_is_bad(Some(r#"{"status":"unhealthy"}"#)));
        assert!(!health_is_bad(Some(r#"{"status":"ok"}"#)));
        assert!(!health_is_bad(None));
        assert!(!health_is_bad(Some("garbage")));
    }

    #[test]
    fn local_providers_rank_before_cloud() {
        let local = Provider {
            id: 1,
            provider_id: "00000000-0000-7000-8000-000000000001".into(),
            platform: "openai".into(),
            name: "mine".into(),
            base_url: String::new(),
            api_key_encrypted: String::new(),
            enabled: true,
            bedrock_config: None,
            is_full_url: false,
            sort_order: 999,
            source: "local".into(),
            cloud_key: None,
            created_at: 10,
            updated_at: 10,
        };
        let cloud = Provider {
            id: 2,
            provider_id: "00000000-0000-7000-8000-000000000002".into(),
            platform: "openai".into(),
            name: "hosted".into(),
            base_url: String::new(),
            api_key_encrypted: String::new(),
            enabled: true,
            bedrock_config: None,
            is_full_url: false,
            sort_order: 0,
            source: "cloud".into(),
            cloud_key: Some("k".into()),
            created_at: 1,
            updated_at: 1,
        };
        // sort_order 更差（999 > 0）也仍然靠 source 赢
        assert!(local_first(&local) < local_first(&cloud));
    }
}
