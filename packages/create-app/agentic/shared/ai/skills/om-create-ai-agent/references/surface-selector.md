# AI Surface Selector

Load this reference before creating files.

| Need | Surface |
|---|---|
| Chat or structured in-product assistant | Module `ai-agents.ts`. |
| Reusable domain operation available to agents | Module `ai-tools.ts` / split tool packs. |
| Explicit MCP/OpenCode registry tool | Low-level `registerMcpTool`; inspect installed `ai_assistant` facts and preserve per-request MCP/RBAC. Prefer `defineAiTool` for ordinary product-agent tools. |
| Dynamic API exploration/execution in OpenCode | Installed Code Mode `search` + `execute`; OpenAPI discovery plus endpoint-level RBAC. |
| Add prompt/tools/suggestions to installed agent | `aiAgentExtensions`. |
| Replace/disable installed agent/tool | Agent/tool override or module entry override. |
| Record-specific launcher | Widget-injected `AiChat` with scoped page context. |
| Coding/repository automation with outcomes/files/subagents | Installed agent-orchestrator file contract. |
| Long-lived human/retry process | Workflow engine, optionally calling an object-mode agent. |

Use exact installed orchestrator context for file agents; do not conflate them with product module agents.

MCP/OpenCode configuration, authentication, provider precedence, and session semantics are ask-first contract surfaces. Route them through the `ai-workflow` guide and the installed `.ai/guides/modules/ai_assistant/index.md` fact sheet rather than guessing.
