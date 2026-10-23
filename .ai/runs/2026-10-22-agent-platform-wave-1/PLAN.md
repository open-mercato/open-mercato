# Execution Plan — Agent platform capabilities, wave 1

- **Date:** 2026-10-22
- **Slug:** agent-platform-wave-1
- **Source specs:**
  - `.ai/specs/2026-10-21-agent-platform-capabilities-roadmap.md` (umbrella, wave 1)
  - `.ai/specs/2026-10-21-mcp-tool-exposure-parity-and-audit.md` (Phases 1–3)
  - `.ai/specs/2026-10-21-chat-run-tracing-and-citations.md` (Phase 1)
  - `.ai/specs/enterprise/agent-orchestrator/2026-10-21-agent-invocation-access-and-identity-binding.md` (Phase 0)
  - `.ai/specs/enterprise/agent-orchestrator/2026-10-21-eval-reports-and-reproducible-regression.md` (Phase 1)
  - `.ai/specs/2026-10-21-document-structure-extraction.md` (Phases 1–2)
- **Base branch:** `main` (open-mercato/open-mercato)
- **Branch:** `feat/agent-platform-wave-1`

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 0 | 0.1 | Align the wave-1 specs with upstream code facts found in triage | inline | done | 23c07ed2d |
| 1 | 1.1 | Add the MCP exposure config resolver and caller filter | dispatch | done | 15d058533 |
| 1 | 1.2 | Add optional mcp and agentRef fields to AiToolDefinition | dispatch:cheap | done | f834a959c |
| 1 | 1.3 | Filter tools/list per principal on the MCP HTTP server | dispatch:capable | done | 92caf7317 |
| 1 | 1.4 | Use the shared exposure filter in the dev and stdio MCP servers | dispatch | done | d27ed59bc |
| 1 | 1.5 | Add MCP exposure CLI flags and mcp:list-tools --effective | dispatch | done | bed3a53a3 |
| 2 | 2.1 | Add the best-effort MCP tool-call audit writer | dispatch | done | 73290b478 |
| 2 | 2.2 | Audit every MCP and tools/execute call with correlation ids | dispatch | done | f34f8d391 |
| 2 | 2.3 | Read AUDIT_LOGS_CORE_RESOURCE_KINDS_EXTRA in access log retention | dispatch:cheap | done | 4e3310ffb |
| 3 | 3.1 | Add the channel option and direct/deny mutation modes to executeTool | dispatch | done | 3ec373f9c |
| 3 | 3.2 | Add channel, api_key_id and correlation_id to ai_pending_actions | dispatch:capable | done | 5e186eb68 |
| 3 | 3.3 | Queue raw MCP and tools/execute writes as pending actions in approval mode | dispatch:capable | done | 16c6b37ef |
| 3 | 3.4 | Scope pending actions to owners and approvers with a channel-aware recheck | dispatch:capable | done | bbd5704be |
| 3 | 3.5 | Run agent tools with their own mutation policy in approval mode | dispatch | done | adae6763c |
| 3 | 3.6 | Add the approver feature and backoffice approval notifications | dispatch | done | 03a5ac8eb |
| 3 | 3.7 | Add the pending-actions list route and get_pending_action tool | dispatch | done | 279fe4a65 |
| 3 | 3.8 | Add the Pending AI actions backend page with nav badge | dispatch:capable | done | 01a418e79 |
| 3 | 3.9 | Document MCP exposure, audit and approval mode with integration tests | dispatch | done | 86d6c763f |
| 4 | 4.1 | Cover a full native agent run under runAs | dispatch:capable | done | d21111368 |
| 4 | 4.2 | Add the runtime-audit write scope and entity allowlist to the no-bypass guard | dispatch | done | 247141ea8 |
| 4 | 4.3 | Wrap AO runtime audit writes in the runtime-audit scope | dispatch | done | a9c8e751e |
| 5 | 5.1 | Add the AI SDK 7 loop step extraction helper | dispatch | done | 7158ebe0c |
| 5 | 5.2 | Time tool executions per tool call id | dispatch | done | 098973f29 |
| 5 | 5.3 | Build chat and object loop traces from the extraction helper | dispatch | done | 4b42bc23e |
| 5 | 5.4 | Record AO native trace tool calls through the extraction helper | dispatch | done | 1ae775ef3 |
| 6 | 6.1 | Link replayed judge results to eval case runs and pass expected | dispatch | done | e6390004a |
| 6 | 6.2 | Build the portable eval report model with flaky detection | dispatch | done | c2fd50b6e |
| 6 | 6.3 | Render eval reports as Markdown and JUnit | dispatch:cheap | done | 97b03a230 |
| 6 | 6.4 | Add eval gate report CLI flags and exit codes | dispatch | done | f231ce3e6 |
| 6 | 6.5 | Add the eval run report route and download menu | dispatch | done | 0fc0190bd |
| 7 | 7.1 | Add document structure types and locators | dispatch:cheap | done | a3d44b1f0 |
| 7 | 7.2 | Add the plain-text structure engine and engine registry | dispatch | done | 12dbe4a4e |
| 7 | 7.3 | Add the section structurer | dispatch:capable | done | bd9503935 |
| 7 | 7.4 | Add the PDF layout engine | dispatch:capable | done | 905dd4825 |
| 7 | 7.5 | Add the DOCX structure engine | dispatch | done | 15995cd08 |
| 8 | 8.1 | Add document structure entities, partition flags, encryption and migration | dispatch:capable | done | 0be444c63 |
| 8 | 8.2 | Add partition structure switches to validators, API and form | dispatch | done | ece4c398f |
| 8 | 8.3 | Expose page-scoped OCR and add the OCR structure engine | dispatch | done | d3b63d378 |
| 8 | 8.4 | Add the document structure queue and worker | dispatch:capable | done | d5fd005bb |
| 8 | 8.4-review-fix | Keep the previous live extraction when a re-extraction fails | dispatch | done | ceb64a2ca |
| 8 | 8.5 | Enqueue extraction on upload and purge structure on delete | dispatch | done | 5060a3549 |
| 8 | 8.6 | Add the document structure service and DI registrations | dispatch | done | fe6806877 |
| 8 | 8.7 | Add document structure API routes, command and integration tests | dispatch | todo | — |
| 8 | 8.8 | Add the structure CLI and env documentation | dispatch:cheap | todo | — |

## Goal

Land wave 1 of the agent platform roadmap on `main`: MCP exposure control, per-call audit and the approval mutation mode (with owner scoping for pending actions); the AI SDK 7 trace-extraction fix for chat, object and AO native runs; the AO no-bypass guard fix under `runAs`; eval judge linkage and portable reports; and deterministic document structure extraction with persistence and API.

## Scope

- `packages/ai-assistant` (`ai_assistant`): MCP servers, tool executor, pending actions (migration), ACL, notifications, backend page, CLI, docs.
- `packages/core` `audit_logs` (retention env) and `attachments` (structure engines, entities, migration, worker, API, CLI).
- `packages/enterprise` `agent_orchestrator`: no-bypass guard, runtime write wrapping, native trace extraction, eval judge linkage and reports. No AO DDL (squash-only policy).
- `packages/ui`: only if the loop-trace panel or citation types need a touch (none planned).

## Non-goals

- MCP Phases 4–5 (`defineAgentTool`, dispatcher port), identity Phases 1–5, chat Phases 2–4 (§6 contract, persistence, UI, citations), eval Phases 2–5, document structure Phases 3–4. All are later waves.
- Changing the default `OM_MCP_MUTATION_MODE` (stays `direct` when unset; operator choice).
- Encrypting the legacy `Attachment.content` column (follow-up recorded in the spec).

## Risks

- **Security behaviour change (Step 3.4):** pending actions are currently readable and confirmable by any same-tenant/org user with `ai_assistant.view` (`AiPendingActionRepository.getById` ignores the user). Chat rows become owner-only. Called out in the PR and UPGRADE_NOTES.
- **`tools/list` filtering** changes what external MCP clients see (documented behaviour; calls already failed).
- **API-key callers without an owning user** cannot create pending rows (`created_by_user_id` is a NOT NULL uuid) — fail closed with an explicit error code.
- **No-bypass allowlist must include `AgentRun`** (trace ingest updates it) or native capture must go through the `trace.ingest` command; decided in Step 4.2 and recorded in the spec.
- **pdfjs layout heuristics** are fragile (two-column order); structure extraction runs on a CPU-bound worker with concurrency 2.
- **Size:** 43 Steps; the executor safety checkpoint (~20 consecutive Steps) will pause the run for review mid-way.

## External References

None.

## Implementation Plan

### Phase 0 — Spec alignment

#### Step 0.1 — Align the wave-1 specs with upstream code facts found in triage
- MCP spec: pending actions are not owner-scoped today (security finding, fixed in Step 3.4); cancel reason already exists; approval path is `/backend/config/ai-assistant/pending-actions/<id>`; API-key callers need `auth.userId` and fail closed without an owner; notifications cleared with `deleteBySource`; `createMcpServerForRequest` becomes async.
- Chat spec: AO has no `extractStepToolCalls`; AO native runner has the same pre-SDK-5 defect inline in `recordStep`; the OSS helper is new and AO adopts it.
- Identity spec: `persistVerdict` pass/warn path throws unconditionally under `runAs`; context bundle, trace capture, artifacts and session store fail silently; allowlist must cover `AgentRun`.
- Document spec: OCR already has a page cap (`OM_ATTACHMENT_OCR_MAX_PAGES`) and in-process queue; reuse the existing cap env; attachments has no `data/validators.ts`.
- Changelog entries dated 2026-10-22.

### Phase 1 — MCP exposure (MCP spec Phase 1)

#### Step 1.1 — Add the MCP exposure config resolver and caller filter
- `packages/ai-assistant/src/modules/ai_assistant/lib/mcp-exposure.ts`: `McpExposureConfig`, `resolveMcpExposureConfig(env, cliArgs)`, `isToolExposed`, `filterToolsForCaller`; exact names and trailing `*` globs; precedence CLI > env > default; `mutationMode` `direct|deny|approval`.
- Tests: `lib/__tests__/mcp-exposure.test.ts`.

#### Step 1.2 — Add optional mcp and agentRef fields to AiToolDefinition
- `lib/types.ts`: `mcp?: { expose?, outputSchema? }`, `agentRef?`.
- Regression test that `loadModuleTools` keeps the fields.

#### Step 1.3 — Filter tools/list per principal on the MCP HTTP server
- `lib/http-server.ts`: async `createMcpServerForRequest`; list principal from optional `x-om-session-token` header (401 when invalid) else API-key ACL; register only filtered tools; `/health` `exposure` block; export `createMcpHttpRequestHandler` for tests.
- Tests: `lib/__tests__/http-server.list-filter.test.ts`.

#### Step 1.4 — Use the shared exposure filter in the dev and stdio MCP servers
- `lib/mcp-dev-server.ts`, `lib/mcp-server.ts` call `filterToolsForCaller`. Extend existing tests.

#### Step 1.5 — Add MCP exposure CLI flags and mcp:list-tools --effective
- `cli.ts`: `--tools`, `--exclude-tools`, `--mutation-mode`, `--no-agent-tools` on `mcp:serve` / `mcp:serve-http`; `mcp:list-tools --effective --as-api-key`. Tests for parsing and pass-through.

### Phase 2 — MCP audit (MCP spec Phase 2)

#### Step 2.1 — Add the best-effort MCP tool-call audit writer
- `lib/mcp-audit.ts`: `recordMcpToolCall(container, entry)`; soft-resolve `accessLogService`; 500 ms bound; `argKeys` only; outcome mapping; correlation id validation (≤128 chars) else UUID. Tests.

#### Step 2.2 — Audit every MCP and tools/execute call with correlation ids
- Wrap call handlers in http, dev and stdio servers and `api/tools/execute/route.ts`; `_meta.correlationId` on MCP results. Tests.

#### Step 2.3 — Read AUDIT_LOGS_CORE_RESOURCE_KINDS_EXTRA in access log retention
- `packages/core/src/modules/audit_logs/services/accessLogService.ts` via a testable helper. Test.

### Phase 3 — Mutation mode and approval (MCP spec Phase 3)

#### Step 3.1 — Add the channel option and direct/deny mutation modes to executeTool
- `lib/tool-executor.ts` `executeTool(name, input, ctx, options?: { channel })` (default `agent`); `deny` → hidden + `MUTATION_REQUIRES_APPROVAL`; `direct` startup WARN; `lib/types.ts` error codes + `pendingApproval?`; servers pass `mcp`; `/tools/execute` passes `tools-api` and returns 403. Tests.

#### Step 3.2 — Add channel, api_key_id and correlation_id to ai_pending_actions
- Entity fields + index; stacked `Migration<ts>_ai_assistant.ts` + snapshot; `AI_RAW_TOOL_AGENT_ID`; registry guard for the reserved id; repository `create` accepts new fields, `getByIdForApprover`, `listForCaller`. Tests.

#### Step 3.3 — Queue raw MCP and tools/execute writes as pending actions in approval mode
- Extract private helpers from `prepareMutation`; `prepareRawToolMutation` (TTL `OM_MCP_PENDING_ACTION_TTL_SECONDS`, default 86400); `approval` branch in `executeTool`; MCP `pending_approval` structured result; `/tools/execute` 202; creator from session user or API key owner, fail closed when none. Tests; existing `prepare-mutation` tests stay green.

#### Step 3.4 — Scope pending actions to owners and approvers with a channel-aware recheck
- `lib/pending-action-recheck.ts` channel branch (`tool_not_exposed`, `requester_revoked`, `requester_features_denied`); GET/confirm/cancel routes use `getByIdForApprover`: chat rows owner-only, MCP rows owner or approver; executor runs as approver with `auditCorrelation`. Tests.

#### Step 3.5 — Run agent tools with their own mutation policy in approval mode
- `lib/agent-tools.ts` / `prepare-mutation.ts`: lift read-only downgrade only in `approval` mode, stamp `channel`, return `pendingActionIds`. Tests per mode.

#### Step 3.6 — Add the approver feature and backoffice approval notifications
- `acl.ts` `ai_assistant.pending_actions.approve`; `setup.ts` admin grant; notification type `ai_assistant.pending_action.awaiting_approval` + renderer; `lib/pending-action-notify.ts` (requester + `createForFeature`, `groupKey` = pending action id, `deleteBySource` on approve/reject/expire). Tests.

#### Step 3.7 — Add the pending-actions list route and get_pending_action tool
- `api/ai/actions/route.ts` (zod query, `pageSize` ≤ 100, whitelist serializer, OpenAPI); `ai_assistant.get_pending_action` read tool. Tests.

#### Step 3.8 — Add the Pending AI actions backend page with nav badge
- `backend/config/ai-assistant/pending-actions/` list + `[id]` detail (`MutationPreviewCard`, approve/reject via `useGuardedMutation`, reject dialog with Cmd/Ctrl+Enter / Escape); nav badge widget; i18n in all locales. Component tests.

#### Step 3.9 — Document MCP exposure, audit and approval mode with integration tests
- `apps/docs/docs/framework/ai-assistant/mcp.mdx`, `packages/ai-assistant/AGENTS.md`, `UPGRADE_NOTES.md`; `.env.example` + template sync; Playwright `TC-AI-MCP-EXPOSURE-010`, `-MUTATION-013`, `-AUDIT-014`, `-APPROVAL-015`, `-APPROVAL-016`.

### Phase 4 — AO no-bypass guard under runAs (identity spec Phase 0)

#### Step 4.1 — Cover a full native agent run under runAs
- `__tests__/native-run-under-runas.test.ts`: scripted native run with context module + grounding; asserts guardrail checks, context bundle, spans/tool calls and eval results persist. Lands marked `test.failing`/skipped-with-reason only if the harness requires; otherwise lands together with expectations that Step 4.3 turns green — keep the suite green at every commit by asserting current behaviour is a thrown `AgentWriteBypassError` and flipping the assertion in 4.3.

#### Step 4.2 — Add the runtime-audit write scope and entity allowlist to the no-bypass guard
- `lib/identity/agentWriteScope.ts` `withRuntimeAuditWrite`, `isRuntimeAuditWriteActive`; allowlist in `agentNoBypassSubscriber.ts` (guardrail checks, context bundles, spans, tool calls, eval results, artifacts, run sessions, and `AgentRun` runtime updates). Tests.

#### Step 4.3 — Wrap AO runtime audit writes in the runtime-audit scope
- `persistVerdict`, context bundle persist, `captureNativeRunTrace`, artifact collection, session store, eval result writes. Step 4.1 test expects success.

### Phase 5 — AI SDK 7 trace extraction (chat spec Phase 1)

#### Step 5.1 — Add the AI SDK 7 loop step extraction helper
- `lib/loop-step-extraction.ts` (`extractStepToolCalls`, `extractStepMeta`, timings type); SDK 7 `input` / `toolResults.output` / `tool-error` with legacy fallback. Tests.

#### Step 5.2 — Time tool executions per tool call id
- `lib/agent-tools.ts` reads `{ toolCallId }` from `execute` options and records start/end per turn. Tests.

#### Step 5.3 — Build chat and object loop traces from the extraction helper
- `buildLoopTraceCollector` uses the helper; optional `toolCallId` on `LoopStepRecord`. Legacy-shape tests stay green; new SDK 7 test.

#### Step 5.4 — Record AO native trace tool calls through the extraction helper
- `nativeAgentRunner.ts` `recordStep` uses the helper; `NativeStepToolCall` aligned. Tests.

### Phase 6 — Eval reports (eval spec Phase 1)

#### Step 6.1 — Link replayed judge results to eval case runs and pass expected
- `llmJudge.ts` optional linkage arg (`evalCaseRunId`, `expected`, per-case assertions); `evalReplayService.runCase` passes it. Tests.

#### Step 6.2 — Build the portable eval report model with flaky detection
- `lib/eval/report/{reportSchema,flaky,buildEvalReport}.ts`. Tests.

#### Step 6.3 — Render eval reports as Markdown and JUnit
- `renderMarkdown.ts`, `renderJunit.ts`, golden tests incl. escaping.

#### Step 6.4 — Add eval gate report CLI flags and exit codes
- `cli.ts` `--report`, `--format`, `--include-payloads`, `--fail-on-flaky`, `--min-pass-score`, `OM_EVAL_TENANT_ID` / `OM_EVAL_ORG_ID`. Tests.

#### Step 6.5 — Add the eval run report route and download menu
- `api/eval-runs/[id]/report/route.ts` (OpenAPI, 409 while running, `?partial`), download menu on `backend/eval-runs/[id]/page.tsx`, i18n; integration `TC-AGENT-EVAL-REPORT-001/002`.

### Phase 7 — Document structure engines (document spec Phase 1)

#### Step 7.1 — Add document structure types and locators
#### Step 7.2 — Add the plain-text structure engine and engine registry
#### Step 7.3 — Add the section structurer
#### Step 7.4 — Add the PDF layout engine
#### Step 7.5 — Add the DOCX structure engine
- All under `packages/core/src/modules/attachments/lib/documentStructure/`, per the spec's Phase 1 and the triage notes (pdfjs geometry, `pdf-lib` test fixtures, `mammoth.convertToHtml` parsed without a new dependency). Unit tests per step.

### Phase 8 — Document structure persistence and API (document spec Phase 2)

#### Step 8.1 — Add document structure entities, partition flags, encryption and migration
#### Step 8.2 — Add partition structure switches to validators, API and form
#### Step 8.3 — Expose page-scoped OCR and add the OCR structure engine
#### Step 8.4 — Add the document structure queue and worker
#### Step 8.4-review-fix — Keep the previous live extraction when a re-extraction fails
- A failed or timed-out run must not supersede a live `completed`/`partial`/`skipped` extraction (spec Risks: "A crash leaves the previous extraction live"); record the failure without removing the previous live row. Re-check that the attachment still exists before commit and abort if it was deleted mid-job (spec Risks).

#### Step 8.5 — Enqueue extraction on upload and purge structure on delete
#### Step 8.6 — Add the document structure service and DI registrations
#### Step 8.7 — Add document structure API routes, command and integration tests
#### Step 8.8 — Add the structure CLI and env documentation
- Per the spec's Phase 2 and the triage notes (reuse `OM_ATTACHMENT_OCR_MAX_PAGES`; purge respects `releaseScoped` `flush:false`; integration `TC-ATT-STRUCT-001..005`).
