mod claude;
pub(crate) mod cli_helpers;
mod codebuddy;
mod codex;
mod gemini;
mod geekclaw;
mod nomifun;
mod opencode;
mod qwen;

pub use claude::ClaudeAdapter;
pub use codebuddy::CodeBuddyAdapter;
pub use codex::CodexAdapter;
pub use gemini::GeminiAdapter;
pub use geekclaw::NomiAdapter;
pub use nomifun::NomifunAdapter;
pub use opencode::OpencodeAdapter;
pub use qwen::QwenAdapter;
