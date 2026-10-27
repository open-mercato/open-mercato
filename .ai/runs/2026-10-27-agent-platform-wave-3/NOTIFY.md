# Notify — 2026-10-27-agent-platform-wave-3

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-10-27T07:37:13Z — run started
- Brief: agent platform roadmap wave 3 — MCP P4 + Identity P1 + Identity P5 (one release, ID-Q3), Integrity P1–P2, DocStructure P3; one PR to open-mercato/open-mercato `main`.
- External skill URLs: none

## 2026-10-27T07:37:13Z — decision: stacked base
- #7794 (wave 1) and #8011 (wave 2) are open and unmerged (#7794 still conflicts with `main`, failing `test` + CodeQL). Wave 3 depends on wave-2 code (`runId`, `AiAgentRunChannel`, §6, `runManifest.ts`), so it stacks on `feat/agent-platform-wave-2` @ `2d3734ed6`, as wave 2 stacked on wave 1.

## 2026-10-27T07:37:13Z — decision: spec deviations found during planning
- `runAiAgentObject` has no `mutationPolicyOverride`; `defineAgentTool` relies on the existing channel rule (`mcp` / `tools-api` → read-only unless `approval`).
- The chat route has no object branch; only `run-object` delegates.
- `emitCitations` does not exist (Chat P4); the document-sections tool returns `citation` / `locator` fields only.
- No attachment drawer exists; the structure panel becomes a lazy tab in `packages/ui` `AttachmentMetadataDialog` (ui cannot import core).
- `abstain_or_review` is Integrity P3 and is not added to the rule union in this wave.

## 2026-10-27T07:37:13Z — environment: no agent pushes to upstream
- Executors commit locally without pushing; the user pushes at checkpoints. The per-Step "push" rule is replaced by "local HEAD contains the commit".

## 2026-10-27T07:37:13Z — subagent delegation
- Two read-only Explore subagents surveyed the code (MCP/identity, integrity/doc-structure) before planning.

## 2026-10-27T08:12:10Z — draft PR opened
- https://github.com/open-mercato/open-mercato/pull/8018 (draft, claimed: assignee + in-progress + claim comment) after the user's first push.

## 2026-10-27T08:12:10Z — checkpoint 1 (Steps 1.1..1.5)
- ai-assistant jest 158/158 suites, shared ai 67 tests, typecheck, lint, i18n sync/usage, build:app --force: pass. UI browser check skipped (no dev server for this worktree); McpExposureSection covered by an RTL test.
- Subagent delegations: one executor per Step (1.1–1.5), sequential.
- Decisions from executors: `AgentToolError` lives in its own file (import cycle with tool-executor); agent-tool `requiredFeatures` are materialized by the tool loader after loading the agent registry; `outputSchema` is not advertised for mutation tools (pending-approval results would fail SDK output validation); `createDevMcpServer` keeps its sync signature with an optional pre-filtered tool list.

## 2026-10-27T08:45:29Z — checkpoint 2 (Steps 1.6, 2.1..2.4)
- AO jest 185 suites / 1715 tests, core workflows, cli agent-files, ai-assistant jest, i18n, typecheck, lint, build:app --force: pass. UI browser check skipped (no dev env; AO not registrable in the ephemeral app).
- Decisions from executors:
  - File agents never reach an ai-assistant definition (`registerFileAgent` skips `defineAiAgent`), so their `requiredFeatures` are enforced only by the AO runtime check.
  - The file-agent manifest is regenerated only with `OM_ENABLE_ENTERPRISE_MODULES=true OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true`. Unrelated generator drift in the two type-import lines of `file-agents.generated.ts` was reverted to the committed form, so the commit carries only the new key.
  - Invoker ACL loading fails closed (no grants on RBAC error or when the org restriction excludes the run's org); this only affects agents that declare `requiredFeatures`.
  - OpenCode `delegate_agent` runs in the MCP process without a run context, so the child is checked against the tool caller's user.
  - Core `workflows` `failInvokeAgentStep` now records the error's string `code` in `errorData.code` / `details.code` (additive; any coded agent error).
  - With `OM_AGENT_INVOKE_ENFORCEMENT=off`, `GET /agents` reports every agent `invocable: true`, matching the runtime.
- Review note for the final pass: the run/rerun 403 body carries an English `error` string, like the routes' other errors; the Playground translates the code.
