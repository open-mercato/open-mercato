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
