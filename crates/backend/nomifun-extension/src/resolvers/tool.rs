//! Resolver for backend `tools` contributions.
//!
//! Tools never embed executable code. A contributed tool declares an
//! `input_schema` and a `bridge` to an already-vetted executor (a builtin
//! Rust tool or a contributed MCP server), so the extension system stays safe
//! by construction.

use crate::resolvers::extension_source_key;
use crate::types::{ExtTool, ResolvedTool};

/// Resolve declared backend tools into runtime-ready structures.
///
/// A tool whose `source_key` fails validation is logged and skipped — one bad
/// tool must not block the rest of the extension's contributions.
pub fn resolve_tools(tools: &[ExtTool], extension_name: &str) -> Vec<ResolvedTool> {
    let mut resolved = Vec::with_capacity(tools.len());
    for tool in tools {
        let source_key = match extension_source_key(extension_name, &tool.source_key) {
            Ok(key) => key,
            Err(error) => {
                tracing::warn!(
                    extension = extension_name,
                    tool = tool.source_key,
                    %error,
                    "Skipping tool with invalid source_key"
                );
                continue;
            }
        };
        resolved.push(ResolvedTool {
            extension_name: extension_name.to_owned(),
            source_key,
            name: tool.name.clone(),
            description: tool.description.clone(),
            input_schema: tool.input_schema.clone(),
            bridge: tool.bridge.clone(),
        });
    }
    resolved
}
