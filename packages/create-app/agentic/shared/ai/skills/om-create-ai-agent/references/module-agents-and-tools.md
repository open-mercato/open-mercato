# Module Agents and Tools

Load for typed in-product AI.

1. Put `ai-agents.ts`/`ai-tools.ts` at module root and export typed arrays.
2. Declare stable namespaced agent/tool IDs, module ID, label/description/prompt, allowed tools, execution mode, provider/model defaults, ACL, media, read-only/mutation posture, and loop budget.
3. Give each tool a Zod input, scoped/wildcard ACL, correct mutation flag, bounded serializable result, and no direct cross-module table access.
4. Write tools call `prepareMutation`; the execute callback dispatches a command with optimistic locking and side effects. No write occurs before approval.
5. Grant features in `acl.ts`/`setup.ts`; use page-context resolvers and UI parts only when required.
6. Run `yarn generate` and refresh structural cache when visibility/disable behavior changed.

## Low-Level MCP/OpenCode Branch

Use this branch only when the request explicitly targets MCP, OpenCode, or Code Mode rather than a normal typed module agent.

1. Register a direct tool with `registerMcpTool(tool, { moduleId })`; use a stable MCP-compatible name, Zod `inputSchema`, non-empty `requiredFeatures` for tenant data, and a bounded serializable result.
2. Keep the MCP server stateless per HTTP request. Production authenticates the server with `x-api-key` and the actual user/tool call with `_sessionToken`, then reloads scope and applies wildcard-aware per-tool ACL.
3. Code Mode `search` reads generated OpenAPI; `execute` uses sandboxed `api.request()` and must preserve endpoint-level RBAC. It does not authorize undocumented or featureless mutations.
4. Ask before OpenCode config/Docker changes, MCP auth changes, or session-token format/TTL changes. Preserve chat `sessionId` through the installed OpenCode handlers.
5. Do not use low-level registration to bypass `defineAiTool` + `prepareMutation`; new domain mutations stay on the typed approval path.

Test provider missing, denied feature/scope, invalid tool args, loop budget/stop, approval/cancel/expire/stale version, partial failure, and actual post-approval data.
