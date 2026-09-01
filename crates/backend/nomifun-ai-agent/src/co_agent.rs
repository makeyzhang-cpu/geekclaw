//! Collaborative co-agent ("协同共答") orchestration — the "everything is a
//! plugin" thread, slice 1.
//!
//! Goal (v1, non-semantic merge): on each dialogue turn, run a *parallel*
//! co-agent that reuses the system-configured provider/key (never a second
//! credential), and return its final answer + tool trace as a signed
//! "collaborator" block. The main turn is **never** mutated — the frontend
//! calls this route in parallel and renders the block alongside the primary
//! reply. This keeps the shipping conversation flow untouched (stability
//! first) while delivering the co-answer capability at the API boundary.
//!
//! The co-agent reuses the exact provider-resolution + one-shot completion
//! path already proven in `knowledge_completer` (`resolve_provider_config` +
//! `one_shot_completion`), so it inherits the system key, base URL, and
//! OpenAI-compatible provider mapping for free.

use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use nomifun_common::AppError;
use nomifun_db::{IProviderModelRepository, IProviderRepository};
use serde::{Deserialize, Serialize};

use crate::factory::provider_config::{one_shot_completion, resolve_provider_config, user_message};
use crate::knowledge_completer::resolve_default_model;

/// Gradient switch for how aggressively the co-agent participates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum CoAgentMode {
    /// Never participates.
    Off,
    /// Only when the user (or frontend) explicitly invokes it. The route
    /// treats this identically to `Off` for *automatic* turns — callers must
    /// opt in per request — so a stray auto-turn can never silently spend
    /// tokens.
    Manual,
    /// Participates only when the user message contains a configured keyword.
    Keyword,
    /// Participates on every turn.
    #[default]
    Auto,
}

impl CoAgentMode {
    /// Pure decision: should the co-agent run for this message under `self`?
    ///
    /// `Manual` intentionally returns `false` here — the caller must invoke
    /// the co-agent explicitly (e.g. a "ask collaborator" button), never via
    /// the automatic gate, so manual mode can't leak into a background call.
    pub fn should_run(self, message: &str, keywords: &[String]) -> bool {
        match self {
            CoAgentMode::Off | CoAgentMode::Manual => false,
            CoAgentMode::Keyword => keywords.iter().any(|k| message.contains(k.as_str())),
            CoAgentMode::Auto => true,
        }
    }
}

fn default_system_prompt() -> String {
    "你是 GeekClaw 的协同协作者。请基于用户的提问给出独立、有补充价值的见解或另一种解题思路，\
     语言风格与主助手保持一致，不重复已显而易见的结论。"
        .to_owned()
}

fn default_name() -> String {
    "协作者".to_owned()
}

/// Runtime configuration for the co-agent. Sent by the frontend (which owns
/// the toggle UI) so no DB schema change is required for v1.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoAgentConfig {
    #[serde(default)]
    pub mode: CoAgentMode,
    /// Keywords that trigger participation when `mode = Keyword`.
    #[serde(default)]
    pub keywords: Vec<String>,
    /// System prompt for the co-agent.
    #[serde(default = "default_system_prompt")]
    pub system_prompt: String,
    /// Optional explicit `(provider_id, model)`. When empty, the app's default
    /// provider/model is used (the system-configured key).
    #[serde(default)]
    pub provider_id: String,
    #[serde(default)]
    pub model: String,
    /// Display name rendered in the collaborator block.
    #[serde(default = "default_name")]
    pub name: String,
    /// Maximum turns of `history` to feed as context (0 = only the current
    /// message).
    #[serde(default)]
    pub history_window: usize,
}

impl Default for CoAgentConfig {
    fn default() -> Self {
        Self {
            mode: CoAgentMode::default(),
            keywords: Vec::new(),
            system_prompt: default_system_prompt(),
            provider_id: String::new(),
            model: String::new(),
            name: default_name(),
            history_window: 6,
        }
    }
}

/// The co-agent's contribution for one turn. Rendered by the frontend as a
/// signed "collaborator" block — never semantically merged into the primary
/// answer in v1.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoAgentResult {
    pub name: String,
    pub answer: String,
    /// Tool invocations the co-agent performed, if any (empty in v1 — the
    /// co-agent has no tools yet; reserved for the v1.5 curated-plugin SDK).
    #[serde(default)]
    pub tool_calls: Vec<String>,
}

/// Abstraction over the underlying LLM call so the orchestrator is fully
/// unit-testable without network access. The production implementation
/// ([`SystemProviderCoAgent`]) resolves the system provider/key.
#[async_trait]
pub trait CoAgentLlm: Send + Sync {
    async fn complete(&self, system: &str, user: &str) -> Result<String, AppError>;
}

/// Production LLM runner: reuses the system-configured provider and key via
/// the same `resolve_provider_config` + `one_shot_completion` path as the
/// knowledge autogen completer. Honors an optional explicit `(provider_id,
/// model)` override; otherwise falls back to the app default.
pub struct SystemProviderCoAgent {
    pub provider_repo: Arc<dyn IProviderRepository>,
    pub provider_model_repo: Arc<dyn IProviderModelRepository>,
    pub encryption_key: [u8; 32],
    pub workspace: PathBuf,
    pub provider_id: String,
    pub model: String,
}

impl SystemProviderCoAgent {
    async fn resolve_target(&self) -> Result<(String, String), AppError> {
        if !self.provider_id.is_empty() && !self.model.is_empty() {
            return Ok((self.provider_id.clone(), self.model.clone()));
        }
        resolve_default_model(&self.provider_repo, &self.provider_model_repo)
            .await
            .ok_or_else(|| {
                AppError::Conflict(
                    "co-agent unavailable: no enabled provider/model is configured".into(),
                )
            })
    }
}

const CO_AGENT_MAX_TOKENS: u32 = 4096;

#[async_trait]
impl CoAgentLlm for SystemProviderCoAgent {
    async fn complete(&self, system: &str, user: &str) -> Result<String, AppError> {
        let (provider_id, model) = self.resolve_target().await?;
        let cfg = resolve_provider_config(
            &self.provider_repo,
            &self.provider_model_repo,
            &self.encryption_key,
            &provider_id,
            &model,
            &self.workspace,
        )
        .await?;
        one_shot_completion(&cfg, system, vec![user_message(user)], CO_AGENT_MAX_TOKENS).await
    }
}

/// Builds the user-side prompt from conversation history + the current
/// message, capped at `history_window` recent turns.
fn build_user_prompt(history: &[String], message: &str, window: usize) -> String {
    if history.is_empty() {
        return message.to_owned();
    }
    let start = if window == 0 || history.len() <= window {
        0
    } else {
        history.len() - window
    };
    let mut buf = String::new();
    for h in &history[start..] {
        buf.push_str(h);
        buf.push('\n');
    }
    buf.push_str(message);
    buf
}

/// Orchestrates a single co-agent turn: assemble the prompt, run the LLM, and
/// wrap the answer in a [`CoAgentResult`]. Mode gating (`should_run`) is the
/// caller's responsibility so this function is unambiguous about when it runs.
pub struct CoAgentOrchestrator {
    llm: Arc<dyn CoAgentLlm>,
    config: CoAgentConfig,
}

impl CoAgentOrchestrator {
    pub fn new(llm: Arc<dyn CoAgentLlm>, config: CoAgentConfig) -> Self {
        Self { llm, config }
    }

    /// Whether the automatic gate would let the co-agent run for `message`.
    pub fn should_run(&self, message: &str) -> bool {
        self.config.mode.should_run(message, &self.config.keywords)
    }

    /// Run the co-agent for this turn. Returns the signed collaborator block.
    pub async fn run(&self, message: &str, history: &[String]) -> Result<CoAgentResult, AppError> {
        let user = build_user_prompt(history, message, self.config.history_window);
        let answer = self.llm.complete(&self.config.system_prompt, &user).await?;
        Ok(CoAgentResult {
            name: self.config.name.clone(),
            answer,
            tool_calls: Vec::new(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // --- pure mode-gating logic -------------------------------------------------

    #[test]
    fn mode_off_never_runs() {
        assert!(!CoAgentMode::Off.should_run("请帮我写代码", &[]));
    }

    #[test]
    fn mode_manual_never_auto_runs() {
        // Manual must not leak into the automatic gate.
        assert!(!CoAgentMode::Manual.should_run("请帮我写代码", &[]));
    }

    #[test]
    fn mode_auto_always_runs() {
        assert!(CoAgentMode::Auto.should_run("", &[]));
        assert!(CoAgentMode::Auto.should_run("任意消息", &[]));
    }

    #[test]
    fn mode_keyword_matches_any_configured_keyword() {
        let kws = vec!["代码".to_string(), "解释".to_string()];
        assert!(CoAgentMode::Keyword.should_run("请帮我写代码", &kws));
        assert!(CoAgentMode::Keyword.should_run("解释一下这个概念", &kws));
        assert!(!CoAgentMode::Keyword.should_run("今天天气怎么样", &kws));
    }

    #[test]
    fn keyword_match_is_substring_case_sensitive_on_ascii() {
        let kws = vec!["Rust".to_string()];
        assert!(CoAgentMode::Keyword.should_run("用 Rust 实现一个队列", &kws));
        assert!(!CoAgentMode::Keyword.should_run("用 rust 实现一个队列", &kws));
    }

    // --- prompt assembly --------------------------------------------------------

    #[test]
    fn build_user_prompt_uses_only_windowed_history() {
        let history: Vec<String> = (0..10).map(|i| format!("turn{i}")).collect();
        let got = build_user_prompt(&history, "现在问", 3);
        assert!(got.contains("turn7"));
        assert!(got.contains("turn8"));
        assert!(got.contains("turn9"));
        assert!(!got.contains("turn0"));
        assert!(got.ends_with("现在问"));
    }

    #[test]
    fn build_user_prompt_empty_history_is_just_message() {
        assert_eq!(build_user_prompt(&[], "hi", 6), "hi");
    }

    // --- orchestrator with a mock runner (no network) --------------------------

    struct StubLlm {
        answer: String,
        calls: Mutex<Vec<(String, String)>>,
    }

    #[async_trait]
    impl CoAgentLlm for StubLlm {
        async fn complete(&self, system: &str, user: &str) -> Result<String, AppError> {
            self.calls.lock().unwrap().push((system.to_owned(), user.to_owned()));
            Ok(self.answer.clone())
        }
    }

    #[tokio::test]
    async fn orchestrator_runs_and_wraps_result() {
        let cfg = CoAgentConfig {
            name: "测试协作者".into(),
            system_prompt: "SYS".into(),
            ..Default::default()
        };
        let stub = Arc::new(StubLlm {
            answer: "协作者回复".into(),
            calls: Mutex::new(Vec::new()),
        });
        let orch = CoAgentOrchestrator::new(stub.clone(), cfg);
        let res = orch
            .run("问题", &["上一轮A".into(), "上一轮B".into()])
            .await
            .unwrap();
        assert_eq!(res.name, "测试协作者");
        assert_eq!(res.answer, "协作者回复");
        assert!(res.tool_calls.is_empty());
        let calls = stub.calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "SYS");
        // history is concatenated ahead of the current message
        assert!(calls[0].1.contains("上一轮A"));
        assert!(calls[0].1.contains("上一轮B"));
        assert!(calls[0].1.ends_with("问题"));
    }

    #[tokio::test]
    async fn orchestrator_should_run_reflects_config_mode() {
        let off = CoAgentOrchestrator::new(
            Arc::new(StubLlm {
                answer: String::new(),
                calls: Mutex::new(Vec::new()),
            }),
            CoAgentConfig {
                mode: CoAgentMode::Off,
                ..Default::default()
            },
        );
        assert!(!off.should_run("任何消息"));

        let keyword = CoAgentOrchestrator::new(
            Arc::new(StubLlm {
                answer: String::new(),
                calls: Mutex::new(Vec::new()),
            }),
            CoAgentConfig {
                mode: CoAgentMode::Keyword,
                keywords: vec!["紧急".into()],
                ..Default::default()
            },
        );
        assert!(!keyword.should_run("普通问题"));
        assert!(keyword.should_run("这是一个紧急问题"));
    }
}
