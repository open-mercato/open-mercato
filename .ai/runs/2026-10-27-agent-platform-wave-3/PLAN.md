# Execution Plan — Agent platform capabilities, wave 3

- **Date:** 2026-10-27
- **Slug:** agent-platform-wave-3
- **Source specs:**
  - `.ai/specs/2026-10-21-agent-platform-capabilities-roadmap.md` (umbrella, wave 3)
  - `.ai/specs/2026-10-21-mcp-tool-exposure-parity-and-audit.md` (Phase 4 + Phase 5 call sites; §4 "Agent as one MCP tool", "Agent run dispatcher")
  - `.ai/specs/enterprise/agent-orchestrator/2026-10-21-agent-invocation-access-and-identity-binding.md` (Phases 1 and 5; §A, §E, "ai-assistant dispatcher seam")
  - `.ai/specs/enterprise/agent-orchestrator/2026-10-21-output-integrity-guardrails.md` (Phases 1–2)
  - `.ai/specs/2026-10-21-document-structure-extraction.md` (Phase 3)
- **Base branch:** `main` (open-mercato/open-mercato), **stacked on** `feat/agent-platform-wave-2` (PR #8011 at `2d3734ed6`, itself stacked on #7794; neither merged)
- **Branch:** `feat/agent-platform-wave-3`

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Add the agent run dispatcher port and soft resolver | dispatch | done | 5be83a2f0 |
| 1 | 1.2 | Add defineAgentTool with the ai-assistant engine and dispatcher routing | dispatch:capable | done | 4eb813fdc |
| 1 | 1.3 | Synthesize agent tools from defineAiAgent mcpTool declarations | dispatch | done | d194ba22a |
| 1 | 1.4 | Return structured agent-tool results on every MCP server and tools/execute | dispatch:capable | done | b22b07521 |
| 1 | 1.5 | Show the MCP exposure section on the AI assistant settings page | dispatch | done | 4bb405adb |
| 1 | 1.6 | Document agent tools in the MCP and agents docs | dispatch:cheap | done | 6256f5a5a |
| 2 | 2.1 | Declare requiredFeatures on AO agents and forward them to defineAiAgent | dispatch | done | 4901c900c |
| 2 | 2.2 | Enforce the per-agent invoke check in AgentRuntimeService.run | dispatch:capable | todo | — |
| 2 | 2.3 | Map invoke denials on the run, rerun, delegate, workflow and eval paths | dispatch | todo | — |
| 2 | 2.4 | Filter the agent list by invocability and expose invocable | dispatch | todo | — |
| 2 | 2.5 | Warn on workflow definitions whose grant cannot invoke an agent | dispatch | todo | — |
| 2 | 2.6 | Record invoker, entry point, channel and correlation id in the run manifest | dispatch | todo | — |
| 3 | 3.1 | Implement the AO agent run dispatcher and register it | dispatch:capable | todo | — |
| 3 | 3.2 | Delegate AO agents from run-object through the dispatcher | dispatch | todo | — |
| 3 | 3.3 | Add the agent-token run route behind OM_AGENT_API_ENABLED | dispatch:capable | todo | — |
| 3 | 3.4 | Expose an example AO agent with defineAgentTool and test module decoupling | dispatch | todo | — |
| 3 | 3.5 | Cover invoke access and agent dispatch with integration tests | dispatch | todo | — |
| 4 | 4.1 | Add the integrity path dialect, declaration schemas and defineAgent keys | dispatch:capable | todo | — |
| 4 | 4.2 | Add quote normalization with an index map and grapheme snapping | dispatch:capable | todo | — |
| 4 | 4.3 | Add the evidence_quote rule | dispatch | todo | — |
| 4 | 4.4 | Run the output pipeline in the native runner and return the final output | dispatch:capable | todo | — |
| 4 | 4.5 | Store the raw model output as an encrypted artifact | dispatch | todo | — |
| 4 | 4.6 | Hash and sync integrity sets and add the shadow-mode switch | dispatch | todo | — |
| 5 | 5.1 | Add the reference resolver contract and the reference_exists rule | dispatch | todo | — |
| 5 | 5.2 | Add the tool_consulted rule with optional prepare-step enforcement | dispatch:capable | todo | — |
| 5 | 5.3 | Add registerIntegrityChecker and the custom rule | dispatch | todo | — |
| 5 | 5.4 | Add an example integrity agent and resolver to agent_examples | dispatch | todo | — |
| 5 | 5.5 | Cover the integrity pipeline with integration tests | dispatch | todo | — |
| 6 | 6.1 | Add the attachments.get_document_sections AI tool | dispatch | todo | — |
| 6 | 6.2 | Add the document structure panel to the attachment dialog | dispatch:capable | todo | — |
| 6 | 6.3 | Cover the structure panel with an integration test | dispatch | todo | — |
| 7 | 7.1 | Mirror the new env vars into the app and create-app template | dispatch:cheap | todo | — |
| 7 | 7.2 | Update the specs, roadmap and upgrade notes for wave 3 | inline | todo | — |

## Goal

Make "one agent core, three doors" real and trustworthy: any object-mode agent (ai-assistant or Agent Orchestrator) can be published as one MCP/chat/tools-api tool through a single helper and a single dispatch seam, every door enforces the same per-agent invoke permission, AO agents reached from ai-assistant run inside `agentRuntime.run()` (no side door), structured outputs pass declarative integrity rules before disposition, and agents can read long documents by section.

## Scope

- **ai-assistant (OSS) — MCP P4:** `lib/agent-run-dispatcher.ts` (`AiAgentRunDispatcher`, `AI_AGENT_RUN_DISPATCHER_DI_KEY`, soft resolve), `lib/agent-tool.ts` (`defineAgentTool`), `defineAiAgent({ mcpTool })` synthesis in the tool loader, `structuredContent` + `outputSchema` on the HTTP / dev / stdio servers, agent-tool results on `/tools/execute`, a read-only MCP exposure section, docs.
- **agent_orchestrator (enterprise) — Identity P1:** `requiredFeatures` on `defineAgent` / `AGENT.md` frontmatter (forwarded to `defineAiAgent`), `lib/access/agentInvokeAccess.ts` enforced in `AgentRuntimeService.run()`, `AgentRunCtx.invoker/entryPoint/channel/correlationId/callSettings`, typed `AgentInvokeDeniedError`, filtered `GET /agents`, workflow save warning, manifest keys filled.
- **agent_orchestrator — Identity P5 + MCP P5:** `lib/runtime/aiAgentRunDispatcher.ts` registered in `di.ts`, `run-object` delegation (`runId: null` + `agentRunId`), agent-token route `POST /api/agent_orchestrator/agent-api/agents/:id/run` behind `OM_AGENT_API_ENABLED`, example in `agent_examples`.
- **agent_orchestrator — Integrity P1–P2:** `lib/guardrails/integrity/*` (paths, normalize, rules `evidence_quote` / `reference_exists` / `tool_consulted` / `custom`, pipeline, integrity sets), `@open-mercato/shared/lib/ai/referenceResolver.ts`, raw-output artifact (`ARTIFACT_REFS.runRawOutput`, artifact route `kind=raw_output`, manifest `om.integrity.raw_output_key`), `OM_AGENT_INTEGRITY` shadow mode, example agent + resolver.
- **attachments (OSS) — DocStructure P3:** `attachments/ai-tools.ts` with `attachments.get_document_sections`, a lazy `DocumentStructurePanel` tab in the attachment metadata dialog, i18n in en/pl/de/es/ko.
- No AO DDL (squash-only policy). No new OSS migration expected.

## Non-goals

- Identity P0 (shipped in wave 1), P2 (principals / `runAs` everywhere), P3 (tool ACL intersection, `OM_AGENT_TOOL_ACL_MODE`), P4 (`auditCorrelation` on `action_logs`, `GET /runs/:id/actions`).
- Integrity P3 (`abstain_or_review`, disposition hold, `run.review_requested`), P4 (untrusted inputs, delimiting), P5 (run API `integrity` field, trace UI, `guardrail_check` scorer, OpenCode pipeline).
- DocStructure P4 (per-section search). The optional `emitCitations` coupling: the helper does not exist yet (Chat P4), so the tool's `citation` / `locator` fields are the only citation surface.
- Chat object branch: `POST /api/ai_assistant/ai/chat` has no object branch on this base, so `run-object` is the only route that delegates.
- Fixing #7794's CI failures and conflicts, and the wave-1/wave-2 follow-ups listed in the handoff.

## Code facts that shape the Steps (verified 2026-10-27 on `2d3734ed6`)

- `AiToolDefinition.agentRef` (`lib/types.ts:184`, `AiToolAgentRef` :206) and `AiToolMcpOptions.outputSchema` (:190) already exist; nothing sets `agentRef` and nothing consumes `outputSchema`. `mcp-exposure.ts` already filters agent tools with `OM_MCP_AGENT_TOOLS` / `--no-agent-tools`; `/health` already reports `agentToolCount`.
- `runAiAgentObject` (`lib/agent-runtime.ts:2541`) has **no** `mutationPolicyOverride` input (the spec's Phase 4 step 1 assumes one). The read-only downgrade comes from `channel: 'mcp' | 'tools-api'` + `mutationMode` through `resolveAgentRunMutationPolicyOverride` (`agent-channel-policy.ts:57`). It returns `runId`.
- `checkAgentPolicy` (`lib/agent-policy.ts:157`) already enforces agent `requiredFeatures` (`agent_features_denied`). AO's `defineAgent` (`lib/sdk/defineAgent.ts:272-290`) does not forward `requiredFeatures` (finding F1/F5).
- `run-object` (`api/ai/run-object/route.ts`) maps `AgentPolicyError` through `statusForDenyCode` (:118); returns `{ runId, object, finishReason, usage }`.
- The tool loader never loads the agent registry; `loadAgentRegistry()` is memoized (`lib/agent-registry.ts:302`).
- MCP HTTP registers tools with `server.registerTool(name, { description, inputSchema, annotations })` (`http-server.ts:359`) and returns text-only success; stdio lists with `setRequestHandler` (`mcp-server.ts:147`).
- `AgentRunCtx` (`lib/runtime/persistence.ts:23-85`) has no invoker/entryPoint/channel/correlationId/callSettings. `run()` (`agentRuntime.ts:51-107`): the invoke check goes after `getAgentEntry` (:54), before admission.
- `RunManifestInput` already has `invoker` / `entryPoint` / `channel` / `correlationId`; `buildAgentRunManifestInput` (`runManifestEntry.ts:90`) never fills them.
- `delegate_agent` unwrapping: `ai-tools.ts:130-137`.
- `verifyAgentToken(container, token)` (`lib/identity/agentTokenService.ts:256`); rate-limit precedent `api/identity/token/route.ts` + `enforcePublicEndpointRateLimit`.
- `checkOutput` call in the native runner: `nativeAgentRunner.ts:499-505`, without `attemptedTools`. Step tool-call records exist only when `OM_AGENT_TRACE_CAPTURE !== 'off'` (`nativeTraceCapture.ts:98`). The manifest span is written inside `captureTrace` after `completeRun`.
- `guardrailSetBodySchema` (`data/validators.ts:889`) has `kind: z.literal('grounding')`; `guardrailKind` enum at :566; grounding versions are `g1-` + 24 hex chars (`groundingSets.ts:28`).
- `putArtifact` (`lib/trace/artifactStore.ts:133`), `ARTIFACT_REFS` (:35); the artifact route accepts `output | tool_request | tool_response` (`api/runs/[id]/artifact/route.ts:25`).
- No scripted LLM provider exists; AO runner tests mock `runAiAgentObject`, ai-assistant tests inject `generateObject`.
- Attachments: no `ai-tools.ts`; the service is DI `attachmentDocumentStructureService` (`lib/documentStructure/service.ts:224`, `listSections` input :153). There is **no attachment drawer**: the detail view is `AttachmentMetadataDialog` in `packages/ui/src/backend/detail/AttachmentMetadataDialog.tsx` (Tabs). `packages/ui` cannot import from `@open-mercato/core`, so the panel lives in `packages/ui/src/backend/detail/` and calls the structure API through `apiCall` (deviation from the spec's `attachments/components/` path; recorded in the spec changelog at 7.2).
- `agent_examples` is an app module at `apps/mercato/src/modules/agent_examples` mirrored in `packages/create-app/template/src/modules/agent_examples` (keep both in sync).

## Implementation Plan

### Phase 1 — MCP P4: agent as one tool (ai-assistant, OSS)

#### 1.1 Add the agent run dispatcher port and soft resolver
- Create `packages/ai-assistant/src/modules/ai_assistant/lib/agent-run-dispatcher.ts` exactly as MCP spec §4 "Agent run dispatcher": `AI_AGENT_RUN_DISPATCHER_DI_KEY = 'aiAgentRunDispatcher'`, `AiAgentRunDispatcher` (`owns`, `isAvailable`, `runObject` with `caller`, `channel: AiAgentRunChannel`, `via`, `correlationId`, `callSettings?`, `timeoutMs`, `signal?`), result type, `resolveAiAgentRunDispatcher(container)` (try/catch soft resolve, returns `null`), typed `AiAgentDispatchDeniedError` mapping (`agent_invoke_denied`, `agent_principal_missing`) as a code-carrying error class the implementer can throw.
- Export the types/const from the package entry (`@open-mercato/ai-assistant`).
- Unit tests: resolver returns null when unregistered / when resolve throws; returns the instance when registered.

#### 1.2 Add defineAgentTool with the ai-assistant engine and dispatcher routing
- Create `lib/agent-tool.ts` with `defineAgentTool(spec)` per MCP spec §4 Form B. Returns an `AiToolDefinition` with `isMutation: false`, tags `['agent', moduleId?]`, `agentRef: { agentId, engine }`, `mcp.outputSchema` (the wrapper result schema, when `outputSchema` is given), `requiredFeatures` = explicit or the agent's.
- Handler: correlation id from `ctx.auditCorrelation?.correlationId` or a new UUID; if the dispatcher `owns(agentId)` → `runObject({ via: 'tool', channel, caller: from ctx, ... })` and return `{ result, agentId, runId: null, agentRunId }`; else the ai-assistant engine: `checkAgentPolicy` (requestedExecutionMode `object`), then `runAiAgentObject({ agentId, input: toPrompt(input), authContext from ctx, container, enableTools: true, sessionId: correlationId, channel, mutationMode, trace: { channel, correlationId } })` (read-only downgrade happens through the channel rule; no `mutationPolicyOverride` input exists), validate `output.schema`, return `{ result, agentId, runId, agentRunId: null }`. Policy denials → thrown error carrying `AGENT_POLICY_DENIED` + deny code; unknown agent with no owning dispatcher or `isAvailable === false` → `AGENT_DISPATCHER_UNAVAILABLE`.
- Channel: the handler needs to know the door (`mcp`, `tools-api`, `chat`). Add the minimal additive field to `McpToolContext` (e.g. `channel?`) populated by `executeTool` from its `options.channel`; map executeTool's `'agent'` channel to `AiAgentRunChannel` `'chat'`.
- Timeouts: `timeoutMs` default 120 000 via `AbortController`.
- Add the error codes `AGENT_DISPATCHER_UNAVAILABLE`, `AGENT_POLICY_DENIED` to `ToolExecutionResult.errorCode` if not present, and map the thrown errors in `executeTool`.
- Unit tests `agent-tool.test.ts` per MCP spec Testing Strategy (policy denial, channel downgrade passed, output validated, unknown agent → unavailable, fake dispatcher receives `{ caller, channel, via: 'tool', correlationId }`, feature-superset validation).

#### 1.3 Synthesize agent tools from defineAiAgent mcpTool declarations
- Add `mcpTool?` to `AiAgentDefinition` (MCP spec Data Models).
- In the tool loader, after module tools load, load the agent registry and synthesize one tool per agent with `mcpTool` through `defineAgentTool` (Form A = sugar, engine ai-assistant, default name `${agent.id}.run`, default input schema `{ input: string 1..8000 }`, `toPrompt` default). Reject (logged, fail-soft) when the agent is not `executionMode: 'object'`, has no `output`, or declares `requiredFeatures` that are not a superset; skip on name collision with an existing tool.
- `mcpTool.expose === false` → `mcp.expose: false`.
- Unit tests in `tool-loader` tests.

#### 1.4 Return structured agent-tool results on every MCP server and tools/execute
- HTTP (`http-server.ts`) and dev (`mcp-dev-server.ts`): pass `outputSchema` (JSON schema of `mcp.outputSchema`) to `registerTool` when present; for tools with `agentRef`, success responses carry `structuredContent: { result, agentId, runId, agentRunId }` + a JSON text block + `_meta: { correlationId }`.
- stdio (`mcp-server.ts`): `outputSchema` in the list response, `structuredContent` in call results.
- Hide agent tools whose agent is unknown to the registry and not owned by an available dispatcher (`filterToolsForCaller` input or a pre-filter); direct calls return `AGENT_DISPATCHER_UNAVAILABLE`.
- Audit rows (`recordMcpToolCall`) gain `aiAgentRunId` / `agentRunId` in context when the tool is an agent tool.
- `/api/ai_assistant/tools/execute` returns the same `{ result, agentId, runId, agentRunId }` payload for agent tools.
- Unit tests extending `http-server.*`, `mcp-servers.*` tests.

#### 1.5 Show the MCP exposure section on the AI assistant settings page
- `GET /api/ai_assistant/tools?view=mcp` returns the effective exposure for the caller (exposed / hidden reason, `agentRef`, mutation mode) using `resolveMcpExposureConfig` + `isToolExposed`; `openApi` updated.
- Read-only "MCP exposure" section on `AiAssistantSettingsPageClient.tsx` (DS tokens, `StatusBadge`, `LoadingMessage`/`ErrorMessage`), i18n en/pl/de/es/ko (translated, not English copies).
- Unit test for the route view.

#### 1.6 Document agent tools in the MCP and agents docs
- `apps/docs/docs/framework/ai-assistant/mcp.mdx` ("MCP serves tools; an agent can be published as one tool", `structuredContent`, dispatcher, `OM_MCP_AGENT_TOOLS`), `agents.mdx` (`mcpTool`, `defineAgentTool`), `packages/ai-assistant/AGENTS.md` (agent tools rule, keep within budget — `yarn agents:check-budget`).

### Phase 2 — Identity P1: per-agent invoke permission (AO)

#### 2.1 Declare requiredFeatures on AO agents and forward them to defineAiAgent
- `DefineAgentInput.requiredFeatures?`, `AgentRegistryEntry.requiredFeatures?` (normalised), forwarded to `defineAiAgent({ requiredFeatures })` — this closes F1's policy gap on `run-object`.
- `requiredFeatures` frontmatter key in `lib/sdk/agentMarkdown.ts` and `packages/cli/src/lib/generators/extensions/agent-files.ts` (`FileAgentDescriptor.requiredFeatures?`); `yarn generate` (commit regenerated output only if tracked and changed by this key; `file-agents.generated.ts` must stay free of 64-hex digests).
- zod validation in `data/validators.ts`. Unit tests (defineAgent, markdown parser, generator).

#### 2.2 Enforce the per-agent invoke check in AgentRuntimeService.run
- `AgentRunCtx` additive fields (identity spec Data Models): `invoker?: AgentInvoker`, `entryPoint?: AgentEntryPoint`, `channel?: AiAgentRunChannel`, `correlationId?`, `callSettings?: AiAgentCallSettings` (forward `callSettings` to `runAiAgentObject` in the native runner).
- `lib/access/agentInvokeAccess.ts`: `resolveInvoker(ctx)` (absent ⇒ `{ kind: 'user', userId: ctx.userId }`), `loadInvokerAcl` (rbacService for users / API keys, superadmin, wildcard matching via the shared feature matcher), `assertAgentInvocable(entry, acl)`.
- Call it in `run()` after `getAgentEntry`, before admission; `OM_AGENT_INVOKE_ENFORCEMENT=off` → log-only (boot WARN). Nested `delegate_agent` runs check the parent run's invoker (propagated through ctx).
- `AgentInvokeDeniedError` (`code: 'agent_invoke_denied'`, `agentId`) in `lib/runtime/errors.ts`, re-exported like the others.
- Unit tests: no features → allowed; exact, wildcard, superadmin; API-key ACL; denied; kill switch; delegate inherits.

#### 2.3 Map invoke denials on the run, rerun, delegate, workflow and eval paths
- Run and rerun routes: `403 { error, code: 'agent_invoke_denied' }` (no feature names echoed); `openApi`.
- Routes set `ctx.invoker` (session user or API key with owner) and `entryPoint` (`run_api`, `rerun`).
- `delegate_agent`: `{ ok: false, error: 'agent_invoke_denied' }` as data; `entryPoint: 'delegate'`.
- Workflow `INVOKE_AGENT` (`invokeAgentForWorkflow.ts`): invoker `{ kind: 'workflow', actingUserId }`, typed failure reason; eval replay: operator invoker, case run `error` with that reason; `entryPoint` `workflow` / `eval`.
- Table-driven parity unit test over the entry-point adapters.

#### 2.4 Filter the agent list by invocability and expose invocable
- `GET /api/agent_orchestrator/agents`: non-managers (`agent_orchestrator.agents.manage` absent) see only invocable agents; items gain `requiredFeatures`, `invocable` (additive); `openApi`. Playground / pickers keep consuming the list (verify no client breaks).
- Unit test.

#### 2.5 Warn on workflow definitions whose grant cannot invoke an agent
- Optional `listAgentAccessRequirements?()` on the agent-workflow bridge (additive), implemented by AO; the core `workflows` definition save path returns a validation **warning** (not a block) when an `INVOKE_AGENT` step targets an agent whose features the grant does not cover. Unit tests on both sides; keep the module-decoupling test green.

#### 2.6 Record invoker, entry point, channel and correlation id in the run manifest
- Extend `buildAgentRunManifestInput` ctx pick with `invoker`, `entryPoint`, `channel`, `correlationId` and pass them through (native + OpenCode). Unit tests in `run-manifest*.test.ts`.

### Phase 3 — Identity P5: doors (AO + run-object)

#### 3.1 Implement the AO agent run dispatcher and register it
- `lib/runtime/aiAgentRunDispatcher.ts` per identity spec "ai-assistant dispatcher seam": `owns` = in the AO registry (after `ensureAgentsLoaded`), `isAvailable` = registered and not disabled by override; `runObject` maps `caller` → `invoker` (`user` / `api_key` with owner per Q5), `via` → `entryPoint` (`route` → `ai_assistant`, `tool` → `tool`), passes `channel`, `correlationId`, `callSettings`, timeout/signal; calls `agentRuntime.run()`; unwraps like `delegate_agent`; returns `{ result, agentRunId, usage, finishReason }`; rethrows `AgentInvokeDeniedError` as the port's typed denial.
- Register `aiAgentRunDispatcher` in `di.ts`. Unit tests with a mocked runtime.

#### 3.2 Delegate AO agents from run-object through the dispatcher
- `run-object` route: when the soft-resolved dispatcher `owns(agent)`, run `checkAgentPolicy` first (agent features now forwarded), then `runObject({ via: 'route', channel: 'run-object', correlationId, callSettings, caller })`; respond `{ runId: null, agentRunId, object, finishReason, usage }`; typed denial → 403 `agent_features_denied`-style existing code (no feature names); unavailable → existing unknown/409 path. `openApi` gains the additive `agentRunId`.
- Unit tests in `api/ai/run-object/__tests__/route.test.ts` with a fake dispatcher.

#### 3.3 Add the agent-token run route behind OM_AGENT_API_ENABLED
- `api/agent-api/agents/[id]/run/route.ts` (identity spec §E): disabled → 404; `enforcePublicEndpointRateLimit` before verification; `Authorization: Bearer` only, `verifyAgentToken`; invoker `{ kind: 'agent_token', ... }`, `runAs` from claims, grant scope must contain `agent_orchestrator.agents.run` or `agent:<targetAgentId>`; target agent features checked against the token principal's role; same body/response/error contract as the run route; `401` minimal on any token failure, `429`. `entryPoint: 'agent_api'`. `openApi`.
- Unit tests (disabled, bad token, scope missing, feature denied, success with mocked runtime).

#### 3.4 Expose an example AO agent with defineAgentTool and test module decoupling
- `agent_examples` `ai-tools.ts`: one `defineAgentTool({ agentId: <AO research agent> })` (mirror into the create-app template).
- Module-decoupling test: with `agent_orchestrator` absent, the AO-backed tool is hidden from `tools/list` and returns `AGENT_DISPATCHER_UNAVAILABLE`.
- Docs: `apps/docs` AO/ai-assistant pages on exposing an AO agent; `agent_orchestrator/AGENTS.md` note on `requiredFeatures` and the dispatcher (budget check).

#### 3.5 Cover invoke access and agent dispatch with integration tests
- `TC-AGENT-ACC-*` (AO `__integration__`) and `TC-AI-MCP-AGENT-TOOL-012` / `TC-AO-MCP-DISPATCH-001` as far as the environment allows: AO is not registered in the ephemeral app and there is no scripted LLM provider, so put validation-only cases (403 `agent_invoke_denied`, `GET /agents` filtering, agent-api disabled 404 / bad token 401, `run-object` 403 for a feature-gated agent) in specs that do not need a model, and gate model-dependent cases behind the existing provider-availability skip. Self-contained fixtures, cleanup in `finally`.

### Phase 4 — Integrity P1: pipeline + evidence_quote (AO)

#### 4.1 Add the integrity path dialect, declaration schemas and defineAgent keys
- `lib/guardrails/integrity/paths.ts`: dot-path dialect with `[*]` (no filters), read/write helpers that copy (immutable), validation of a path against a zod schema (unwrap optional/nullable/default/effects; arrays; objects).
- `data/validators.ts`: `integrityRuleSchema` (discriminated union incl. `evidence_quote`, `reference_exists`, `tool_consulted`, `custom`; `abstain_or_review` is Phase 3 and NOT added), `integritySummarySchema`, `guardrailKind` + `evidence_quote`, `reference_exists`, `tool_consulted`, `custom_integrity`; `integrityEvidenceSchema`.
- `defineAgent({ integrity })` stored on the registry entry; registration errors (invalid path vs `result.schema`, duplicate rule ids) throw `[internal]` errors.
- Unit tests.

#### 4.2 Add quote normalization with an index map and grapheme snapping
- `lib/guardrails/integrity/normalize.ts`: `exact`, `ws`, `nfkc_ws` (default), optional `caseInsensitive` + `locale`; index map back to original UTF-16 offsets; grapheme snapping with `Intl.Segmenter`; `offsetUnit` `utf16 | codepoint`.
- Property-style unit tests (round trip, NFKC, NBSP, curly quotes/dashes, soft hyphen/ZWJ, RTL, CJK, emoji ZWJ, combining marks, Turkish i with locale).

#### 4.3 Add the evidence_quote rule
- `lib/guardrails/integrity/rules/evidenceQuote.ts`: pure `(state, rule) → { output, check }` per spec (source `input` / `fromItem`, `minChars`, ambiguity by nearest claimed start, offsets recomputed and written back, canonical quote with `repairQuote`, `onViolation` drop/repair/flag/block; drop/repair recorded as `warn` with counts; evidence redacted: rule id, counts, ≤ 20 `{ itemPath, reason }`).
- Unit tests per spec.

#### 4.4 Run the output pipeline in the native runner and return the final output
- `lib/guardrails/integrity/pipeline.ts` `runOutputPipeline()`: step 1 schema (via `checkOutput`), step 2 integrity rules in order, step 3 re-validate (repair-breaks-schema → block `integrity_repair_invalid`), step 4 grounding, step 6 `tool_scope` with `attemptedTools` (for agents that declare `integrity`), result = final output + checks.
- Native runner: when `entry.integrity` is declared, collect step tool calls in memory regardless of `OM_AGENT_TRACE_CAPTURE`; call the pipeline instead of `checkOutput`; `shapeResult` / `completeRun` / `createProposal` use the final output. Agents without `integrity`: identical behaviour (existing tests green).
- Unit tests (pipeline order, immutability, block paths, no-integrity parity).

#### 4.5 Store the raw model output as an encrypted artifact
- `ARTIFACT_REFS.runRawOutput = { entityId: 'agent_orchestrator:agent_run', field: 'output' }`; upload before `completeRun` only when the final differs; fail-open; key in check evidence `rawOutput: { key, status }` and manifest `om.integrity.raw_output_key` (extend `RunManifestInput`/attributes + runner wiring).
- Artifact route `kind=raw_output` (`trace.view`), ownership = key referenced by a check row of this run, 404 otherwise.
- Unit tests.

#### 4.6 Hash and sync integrity sets and add the shadow-mode switch
- `lib/guardrails/integrity/integritySets.ts`: content hash `i1-` + 24 hex (mirroring `g1-`), registry populated from `defineAgent` declarations, `syncIntegritySets` in `setup.ts` next to grounding; `guardrailSetBodySchema` becomes a discriminated union `grounding | integrity` (existing grounding bodies parse unchanged); check rows carry `guardrailSetVersion` = integrity set version.
- `OM_AGENT_INTEGRITY=off`: evaluate and record, never drop/repair/block; boot log.
- Unit tests (hash stable across key order, sync idempotent, shadow mode leaves output unchanged).

### Phase 5 — Integrity P2: references, consultation, custom (AO + shared)

#### 5.1 Add the reference resolver contract and the reference_exists rule
- `packages/shared/src/lib/ai/referenceResolver.ts` (type-only contract per spec).
- `rules/referenceExists.ts`: collect ids (string, `{id,version}` via `idPath`/`versionPath`, `key@version` with `versionSeparator`), one batched `resolve` per rule via soft DI `agentReferenceResolver:<id>`, version pinning (`input` / constant / per-item), `onResolverMissing` (default `block`). Async pipeline support.
- Unit tests.

#### 5.2 Add the tool_consulted rule with optional prepare-step enforcement
- `rules/toolConsulted.ts`: cited values at `cites` must appear in a successful in-run tool call result at `returned` paths (or `matchArgs`), tool-name normalisation `a__b` ≡ `a.b`, failed and `{ found: false }` ignored, `includeSubRuns` (best-effort from delegate child records if available; otherwise documented limitation).
- `enforce: 'prepare_step'`: pass a `prepareStep` forcing `toolChoice: 'required'` until one of `tools` was called, composed with the agent's `loop.prepareStep` through `runAiAgentObject`'s `loop` input (verify the tool-enabled object path accepts it).
- Unit tests.

#### 5.3 Add registerIntegrityChecker and the custom rule
- `lib/sdk/integrityCheckers.ts` `registerIntegrityChecker(checkerId, fn)` (exported from the AO SDK), `rules/custom.ts` (violations as codes, optional `repairedOutput` re-validated, kind `custom_integrity`; unknown checker → block).
- Unit tests.

#### 5.4 Add an example integrity agent and resolver to agent_examples
- One example research agent declaring `evidence_quote` + `reference_exists` + `tool_consulted`, a small read-only resolver registered in `di.ts` under `agentReferenceResolver:<id>`, mirrored in the create-app template. Unit test of the resolver.

#### 5.5 Cover the integrity pipeline with integration tests
- `TC-AGENT-INT-*`: what runs without a model provider (registration errors surfaced, `GET /guardrail-checks?kind=evidence_quote` filter validation, artifact route `kind=raw_output` 404/403 contract); model-dependent cases gated by the provider skip. Self-contained fixtures.

### Phase 6 — DocStructure P3 (attachments, OSS)

#### 6.1 Add the attachments.get_document_sections AI tool
- `packages/core/src/modules/attachments/ai-tools.ts` (pack pattern like `staff/ai-tools.ts`) with `attachments.get_document_sections` per spec API Contracts (input/outputs, `headingContains` in-memory filter, `status: not_extracted | pending` + hint, `content` documented as untrusted data, no writes, `requiredFeatures: ['attachments.view']`, `isMutation: false`), via `attachmentDocumentStructureService`. `yarn generate`.
- Unit test `ai-tool.test.ts`.

#### 6.2 Add the document structure panel to the attachment dialog
- `packages/ui/src/backend/detail/DocumentStructurePanel.tsx` (`"use client"`), dynamically imported (`next/dynamic`) as a "Structure" tab in `AttachmentMetadataDialog`: status `StatusBadge`, Extract / Re-extract (`useGuardedMutation` + `apiCall`, visible with `attachments.manage`), lazy outline (2 levels, expand loads children via the sections API), `LoadingMessage`/`ErrorMessage`/`EmptyState`, DS tokens only, lucide icons.
- i18n keys per spec in the ui (or attachments) locale files for en/pl/de/es/ko — translated.
- RTL unit test (renders outline from API mock, expands a node).

#### 6.3 Cover the structure panel with an integration test
- `TC-ATT-STRUCT-007`: dialog shows the structure tab, expands a chapter, Re-extract visible only with `attachments.manage`. Self-contained (partition + upload via API, cleanup).

### Phase 7 — Close

#### 7.1 Mirror the new env vars into the app and create-app template
- `OM_AGENT_INVOKE_ENFORCEMENT`, `OM_AGENT_API_ENABLED`, `OM_AGENT_INTEGRITY` (and `OM_MCP_AGENT_TOOLS` if not already present) into `apps/mercato/.env.example`; `yarn template:sync:fix`.

#### 7.2 Update the specs, roadmap and upgrade notes for wave 3
- 2026-10-27 changelog entries in the four specs + roadmap (implementation deviations: no `mutationPolicyOverride`, channel on `McpToolContext`, panel in `packages/ui`, no chat object branch, no `emitCitations`), `UPGRADE_NOTES.md` (invoke enforcement may deny previously allowed AO runs; `OM_AGENT_INVOKE_ENFORCEMENT=off` kill switch; agent tools on MCP).

## Risks

- **Stacked base:** this PR's diff against `main` includes waves 1 and 2 until #7794 and #8011 merge; reviewers look only at commits after `2d3734ed6`.
- **Over-blocking:** enabling invoke checks can deny runs that worked before for agents that declare `requiredFeatures`. Agents without the key are unaffected; `OM_AGENT_INVOKE_ENFORCEMENT=off` is the kill switch.
- **Integrity regressions:** agents without `integrity` must keep byte-identical behaviour; covered by keeping existing runner tests green and a parity test.
- **Validation limits:** AO cannot run in the ephemeral app and there is no scripted LLM provider; model-dependent integration cases skip. Unit coverage carries the behaviour.
- **Size:** 33 Steps. The safety checkpoint after ~20 Steps stops for user review.

## External References

None (`--skill-url` not used).
