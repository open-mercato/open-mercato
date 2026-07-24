# AI Surface Selector

Load this reference before creating files.

| Need | Surface |
|---|---|
| Chat or structured in-product assistant | Module `ai-agents.ts`. |
| Reusable domain operation available to agents | Module `ai-tools.ts` / split tool packs. |
| Add prompt/tools/suggestions to installed agent | `aiAgentExtensions`. |
| Replace/disable installed agent/tool | Agent/tool override or module entry override. |
| Record-specific launcher | Widget-injected `AiChat` with scoped page context. |
| Coding/repository automation with outcomes/files/subagents | Installed agent-orchestrator file contract. |
| Long-lived human/retry process | Workflow engine, optionally calling an object-mode agent. |

Use exact installed orchestrator context for file agents; do not conflate them with product module agents.
