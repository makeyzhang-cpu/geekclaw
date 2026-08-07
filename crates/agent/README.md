# crates/agent

AI agent engine crates. Package names use the `geekclaw-*` prefix.

Current crates:

| Crate | Role |
| --- | --- |
| `geekclaw-types` | Provider-neutral data types. |
| `geekclaw-protocol` | Host/agent command and event protocol. |
| `geekclaw-compact` | Conversation compaction and context shaping. |
| `geekclaw-config` | Provider, auth, hook, and runtime configuration. |
| `geekclaw-providers` | LLM provider clients and streaming logic. |
| `geekclaw-tools` | Built-in tool registry. |
| `geekclaw-mcp` | MCP client, config, transports, and tool proxying. |
| `geekclaw-skills` | Skill discovery, loading, and execution support. |
| `geekclaw-memory` | Long-term project/user memory. |
| `geekclaw-agent` | Core session engine, tool execution, and Agent delegation. |
| `geekclaw-cli` | Standalone `geekclaw` CLI. |
| `geekclaw-computer` | Desktop computer-use tool implementation. |
| `geekclaw-a11y` | Accessibility helpers used by computer-use flows. |
| `geekclaw-browser-engine` | Self-hosted browser/CDP automation engine. |
| `geekclaw-browser` | Browser-use tool layer. |

## Boundary

- `crates/agent` must not depend on `geekclaw-*` backend crates.
- Backend access to the agent layer should pass through
  `crates/backend/nomifun-ai-agent`.
- Shared utilities that genuinely belong on both sides live under
  `crates/shared`.
