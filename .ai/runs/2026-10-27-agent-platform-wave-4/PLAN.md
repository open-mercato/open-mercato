# Execution Plan — Agent platform capabilities, wave 4

- **Date:** 2026-10-27
- **Slug:** agent-platform-wave-4
- **Source specs:**
  - `.ai/specs/2026-10-21-agent-platform-capabilities-roadmap.md` (umbrella, wave 4)
  - `.ai/specs/enterprise/agent-orchestrator/2026-10-21-agent-run-observability-full-fidelity.md` (Phase 2; "LLM span attributes (per step)", "Capture levels", "`TraceCapturePolicy`", "`GET|PUT /trace-capture/settings`")
  - `.ai/specs/enterprise/agent-orchestrator/2026-10-21-otel-genai-trace-export.md` (Phase 1; OTEL-Q1 = hand-encoded OTLP/HTTP JSON, no `@opentelemetry/*` import in enterprise; OTEL-Q2 approved but content export is Phase 2, not here)
- **Base branch:** `main` (open-mercato/open-mercato), **stacked on** `feat/agent-platform-wave-3` (PR #8018 at `11031e1e6`, itself stacked on #8011 and #7794; none merged). Reviewers look only at commits after `11031e1e6`.
- **Branch:** `feat/agent-platform-wave-4`

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Add the gen_ai attribute vocabulary and ingest normalizer | dispatch | done | 99b7b97f4 |
| 1 | 1.2 | Add computeCostMicros with a pricing source | dispatch:cheap | done | a5b3f071c |
| 1 | 1.3 | Collect model-call observer records in the native runner | dispatch:capable | done | 9848cf9ec |
| 1 | 1.3-review-fix | Mark only caller-managed object calls as reconstructed | inline | done | 2e9fc9250 |
| 1 | 1.4 | Write gen_ai and om attributes on native llm spans | dispatch:capable | done | 81f8e2e3d |
| 2 | 2.1 | Add the trace capture policy schema and resolver | dispatch | done | 2ab104644 |
| 2 | 2.2 | Apply the capture policy to native and OpenCode runs and record om.capture | dispatch:capable | done | a13c43620 |
| 2 | 2.3 | Add the trace.view_content feature | dispatch:cheap | done | 8696df6eb |
| 2 | 2.4 | Add the trace capture settings API and undoable command | dispatch | done | 1d6c76567 |
| 2 | 2.5 | Add the trace capture settings page | dispatch | done | 763858447 |
| 3 | 3.1 | Show per-step model calls with parameters and cost on the trace page | dispatch | done | c993656a0 |
| 3 | 3.2 | Normalize gen_ai attributes on ingested llm spans | dispatch | done | 0ae12afcd |
| 3 | 3.3 | Cover step metadata and capture settings with integration tests | dispatch | done | 1092be826 |
| 4 | 4.1 | Add deterministic OTel ids and the OTLP JSON encoder | dispatch | done | 594eef24a |
| 4 | 4.2 | Add string redaction for exported attributes | dispatch:cheap | done | 0df0bab6b |
| 4 | 4.3 | Load a run export bundle with tenant scoping | dispatch | done | 6a1c06c66 |
| 4 | 4.4 | Map an agent run to OTLP resource spans | dispatch:capable | done | b2636d2a4 |
| 4 | 4.5 | Add OTel export settings resolution and the OTLP HTTP client | dispatch | done | 0107e7fdf |
| 4 | 4.6 | Add the export queue, subscribers and worker with retry | dispatch:capable | done | pending |
| 4 | 4.7 | Add the OTel export settings and test-span APIs | dispatch | todo | — |
| 4 | 4.8 | Add the OTel export settings page, health line and trace link | dispatch | todo | — |
| 4 | 4.9 | Add the otel:export backfill CLI | dispatch | todo | — |
| 4 | 4.10 | Add the local collector and Jaeger compose profile | dispatch:cheap | todo | — |
| 4 | 4.11 | Cover OTel export with integration tests | dispatch | todo | — |
| 5 | 5.1 | Document trace capture and OTel export and mirror env vars | dispatch:cheap | todo | — |
| 5 | 5.2 | Update the specs, roadmap and upgrade notes for wave 4 | inline | todo | — |

## Goal

Make every Agent Orchestrator LLM step answer "which model, with which parameters, how many tokens, at what cost" under a per-tenant capture policy, and let operators replay persisted AO traces into any OTLP backend with GenAI semantic conventions — opt-in, fail-open, no new dependencies, no DDL.

## Scope

- **Observability P2 (AO + reuse of the ai-assistant §6 observer):** native runner consumes `onModelCallStart/End`; per-step `gen_ai.*` / `om.*` span attributes (params as sent, usage incl. cached/reasoning, `om.cost.micros`, latency, response id, content hashes/sizes, fidelity); `computeCostMicros`; `lib/trace/genAiAttributes.ts` shared vocabulary + ingest normalization; `TraceCapturePolicy` in module config `agent_orchestrator/trace_capture_policy` with resolver (per-agent time-boxed override → tenant/eval level → deployment default; deployment ceiling); `om.capture` in the run manifest; settings API + undoable command `agent_orchestrator.traceCapturePolicy.update` + settings page; new ACL feature `agent_orchestrator.trace.view_content`; per-step parameters and cost on the trace page.
- **OTel P1 (AO):** `lib/trace/otel/{ids,otlpJson,loadRunExportBundle,mapAgentRunToOtlp,exportSettings,otlpHttpClient}.ts`; queue `agent-orchestrator-otel-export`, persistent subscribers on `agent_orchestrator.run.completed` / `.run.ingested`, worker with retry classification and `reportError` codes; `GET|PUT /otel-export/settings` (+ command `agent_orchestrator.otelExportSettings.update`), `POST /otel-export/test` (rate-limited); settings page, system-health line, trace-page deep link; CLI `otel:export`; compose profile collector → Jaeger; docs.
- No AO DDL (squash-only policy). No new npm dependency. No `@opentelemetry/*` import in enterprise.

## Non-goals

- Observability P3 (content artifacts, redaction of content, `llm_request`/`llm_response`, context payload, retention worker, `410`), P4 (Request/Response tabs, compare route + dialog, OpenCode per-message `llm` spans, ingest `llm`/`manifest` offload fields, MCP-path knowledge binding). In this wave `full` is an accepted policy level that records **metadata only** until P3; the spans say so with `om.content.status = "disabled"` and the settings page says so.
- OTel P2 (content events, protobuf, per-tenant endpoints, ledger table) and P3 (live streaming).
- Exporting chat/copilot runs from the OSS `ai_agent_runs` tables (OTEL Q7).
- Eval call-settings override (Eval P4): eval replays still send no `callSettings`.
- Fixing #7794's CI/conflicts and the earlier waves' open follow-ups.

## Code facts that shape the Steps (verified 2026-10-27 on `11031e1e6`)

Shorthand: `AA` = `packages/ai-assistant/src/modules/ai_assistant`, `AO` = `packages/enterprise/src/modules/agent_orchestrator`.

- `AA/lib/agent-call-contract.ts` has `AiAgentCallSettings` (l.3), `AiAgentRunTraceOptions` (l.17), events `AiAgentPromptResolvedEvent` / `AiAgentModelCallStartEvent` (l.33: `callId, stepNumber, provider, modelId, system, messages, tools, responseFormat, callSettings, startedAtMs`) / `AiAgentModelCallEndEvent` (l.53: `callId, finishReason, responseId, responseModelId, usage{inputTokens?,outputTokens?,cachedInputTokens?,reasoningTokens?}, content, providerMetadata?, responseTimeMs, endedAtMs`), `AiAgentCallObserver` (l.65). Observer exceptions are already isolated (`AA/lib/agent-call-observer.ts` `notifyModelCallObserver` l.203, `invokeEachObserver` l.432).
- `runAiAgentObject` (`AA/lib/agent-runtime.ts` l.2561) wires the observer on every object branch: tool loop → real AI SDK hooks (l.2787, exact, one start/end per step); `generateObject` / `streamObject` / caller `input.generateObject` → synthesized start/end with `stepNumber: 0`, `tools: undefined` (the callback branch is `reconstructed`). `callSettings` is merged with `agent.modelSettings` (l.2672) and forwarded to the SDK except in the caller-callback branch.
- AO native runner (`AO/lib/runtime/nativeAgentRunner.ts` l.462-485) already passes `trace: { persist: false }`, `callSettings` (from `ctx.callSettings`) and `observe: runObserver` when trace capture is enabled; `runObserver` (l.256) implements **only** `onPromptResolved`. Step records come from `loop.onStepFinish` → `buildNativeStepRecord` (l.335). `buildUsageStamp` (l.366) → `computeCostMinor` per run.
- `NativeStepRecord` (`AO/lib/runtime/nativeTraceCapture.ts` l.44): `{ modelId, finishReason, usage{inputTokens,outputTokens}, toolCalls, endedAtMs }`. `buildNativeTracePayload` (l.115) writes llm span attributes `{ inputTokens, outputTokens, finishReason }` (l.133); with no steps it writes one synthetic llm span (l.168); manifest span appended via `buildRunManifestSpan` (l.189). Kill switch `OM_AGENT_TRACE_CAPTURE` (`isNativeTraceCaptureEnabled` l.98).
- `AO/lib/trace/runManifest.ts`: `RunManifestCapture = { level, source, retentionDays, redactPii }` (l.38), `DEFAULT_CAPTURE` (l.105), `om.capture` emitted only when `input.capture` is set (l.179); `buildAgentRunManifestInput` (`runManifestEntry.ts` l.110) never sets it. `RunManifestCard.tsx` already renders `om.capture` (l.46, l.191). Size cap 4000 chars.
- `AO/lib/runtime/modelPricing.ts`: `computeCostMinor(model, in, out) → { costMinor, currency } | null` (l.133); `DEFAULT_PRICING` (l.40) per 1M tokens, `OM_AGENT_MODEL_PRICING` JSON override merged per call (l.70), `OM_AGENT_COST_CURRENCY` (l.95), `resolveModelPrice` (l.107). No cached/reasoning price.
- No `gen_ai.` string exists in AO; `lib/trace/genAiAttributes.ts` does not exist.
- Module config precedent: `AO/lib/disposition/tenantAutoApprovalPolicy.ts` (`moduleConfigService.getRecord(module, name, { tenantId })` + safeParse, fall back to default on any failure); route `AO/api/auto-approval/settings/route.ts` writes `setValue` directly, no command, no optimistic lock; page `AO/backend/settings/auto-approval/page.tsx` is marked `optimistic-lock-exempt` (no `updatedAt` on the config value) and saves through `useGuardedMutation` + `apiCall`. Siblings: `backend/settings/web-search/`.
- ACL: `agent_orchestrator.trace.view` (`acl.ts` l.30), `trace.correct` (l.32); no `trace.view_content`. `setup.ts` `defaultRoleFeatures` (l.65): admin/superadmin get `agent_orchestrator.*`; employee/operator/engineer have explicit lists.
- Events: `agent_orchestrator.run.completed` (`events.ts` l.16; emitted in `commands/runs.ts` l.167 complete, l.200 fail, persistent) and `agent_orchestrator.run.ingested` (l.22; emitted only by the `trace.ingest` command, `commands/trace.ts` l.61). The native trace capture runs **after** `completeRun`, so a delayed export job sees the spans.
- Queue: `AO/lib/queue.ts` constants + `getAgentOrchestratorQueue(name)` (l.46, `createModuleQueue`). `EnqueueOptions` is only `{ delayMs? }` (`packages/queue/src/types.ts` l.152) — **no job-id dedupe**. Worker shape: `workers/metric-rollup.ts` (`metadata: WorkerMeta = { queue, id, concurrency }`, default `handle(job, ctx)`). Persistent subscriber shape: `subscribers/process-run-completed.ts` (`metadata = { event, persistent: true, id }`).
- CLI: `AO/cli.ts` exports `ModuleCli[]` (`{ command, run(rest) }`, `parseArgs` l.27, `createRequestContainer`).
- System health: `AO/lib/systemHealth.ts` (pure; `HealthIndicatorId = 'webSearch'|'mcp'|'opencode'|'opencodeMcp'`, `rollupHealth`), rendered by `components/SystemHealthTile.tsx` / `components/health/SystemHealthPanel.tsx`.
- Rate limit precedent: `AO/lib/guardrails/publicEndpointRateLimit.ts` `enforcePublicEndpointRateLimit` + `readEndpointRateLimitConfig('AGENT_ORCH_…', {...})` (`api/trace/ingest/route.ts` l.26).
- Entities (`AO/data/entities.ts`): `AgentRun` has no `startedAt` (`createdAt` is the start; `completedAt`, `latencyMs`); `AgentSpan.parentSpanId` is the parent **row uuid**; `AgentProposal.disposition`/`dispositionBy`/`dispositionReason`; `AgentEvalResult.assertionKey/score/passed/severity`; `AgentGuardrailCheck.capability/phase/kind/result`; `ProcessInstance.workflowInstanceId/processDefinitionId/status`. Encrypted: run `input/output`, proposal `payload`, tool-call summaries, eval `evidence`, process `input/failure_reason/subject_title` — none of these are exported. `AgentSpan.attributes` is plaintext.
- `GET /runs/:id` returns `{ run, spans, toolCalls, evalResults, contextBundle, guardrailChecks, proposals, goldenCase }`; the trace page draws llm spans only as timeline bars (`backend/traces/[id]/page.tsx` l.1152-1238); `RunManifestCard` at l.1345.
- Telemetry: `captureTelemetryTrace()` (`packages/shared/src/lib/telemetry/runtime.ts` l.144) already feeds `om.platform_trace`. Redaction patterns live in `packages/telemetry/src/facade/redact.ts` (`EMAIL_RE`, `SECRET_HEADER_RE`, `AUTH_SCHEME_RE`, `SECRET_KEY_RE`); enterprise does not depend on `@open-mercato/telemetry`, so they are **copied**, not imported.
- i18n: `AO/i18n/{en,pl,de,es,ko}.json`; `__tests__/i18n-coverage.test.ts` requires identical sorted key sets and caps English-identical values (`UNTRANSLATED_CEILING = { pl: 67, de: 84, es: 55, ko: 105 }`) — translate properly, never raise the ceilings.
- Env: `apps/mercato/.env.example` has `OM_AGENT_TRACE_CAPTURE` (l.824), `OM_AGENT_MODEL_PRICING` (l.826), `OM_AGENT_COST_CURRENCY` (l.827); platform OTLP vars at l.1359-1380. `starters/docker/compose.fullapp.yml` has an `otel-collector` service (profile `telemetry`, image `otel/opentelemetry-collector:0.159.0`); `docker/otel-collector-config.yaml` exists (OTLP HTTP 4318, `debug` exporter).
- `ai` is 7.0.83. No scripted LLM provider exists — model-dependent integration cases skip.

## Implementation Plan

### Phase 1 — Observability P2: per-step metadata (AO)

#### 1.1 Add the gen_ai attribute vocabulary and ingest normalizer
- Create `AO/lib/trace/genAiAttributes.ts`: string constants for every key in the observability spec's "LLM span attributes" table and the OTel mapping table (`gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model|temperature|top_p|top_k|max_tokens|seed|stop_sequences|presence_penalty|frequency_penalty`, `gen_ai.response.model|id|finish_reasons`, `gen_ai.usage.input_tokens|output_tokens|cache_read.input_tokens|reasoning.output_tokens`, `gen_ai.agent.*`, `gen_ai.tool.*`, `gen_ai.workflow.name`, `gen_ai.evaluation.*`, `gen_ai.output.type`, `om.cost.micros|currency|pricing_source`, `om.latency.ms`, `om.prompt.system.sha256`, `om.tools.sha256|count`, `om.messages.count`, `om.content.request.sha256|bytes`, `om.content.response.sha256|bytes`, `om.content.status`, `om.capture.fidelity`, `om.params.defaults`), `GEN_AI_SEMCONV_VERSION = '1.43'`, and the legacy keys (`inputTokens`, `outputTokens`, `finishReason`).
- `readLlmSpanMetadata(attributes: unknown)` → a typed, zod-validated view (tolerates legacy-only spans; numbers coerced, unknown keys ignored) used by the UI, ingest and the OTel mapper.
- `normalizeGenAiAttributes(attributes)` → returns attributes with `gen_ai.*` values type-checked (drop wrong types), legacy keys backfilled from `gen_ai.usage.*` / `gen_ai.response.finish_reasons` and vice versa; never throws.
- Unit tests.

#### 1.2 Add computeCostMicros with a pricing source
- `computeCostMicros(model, usage: { inputTokens, outputTokens }) → { micros: number; currency: string; pricingSource: 'default' | 'env_override' } | null` in `modelPricing.ts` using the same table + override; `null` (caller records `pricingSource: 'unknown'`) when no price. Integer micros (`Math.round`). `computeCostMinor` unchanged.
- Unit tests: micros vs minor consistency, override source, unknown model, rounding of small steps (non-zero micros where minor rounds to 0).

#### 1.3 Collect model-call observer records in the native runner
- Extend the runner's `runObserver` with `onModelCallStart` / `onModelCallEnd` that build a `NativeModelCallRecord` per `callId`: provider, request model, response model, response id, finish reason, usage incl. cached/reasoning, `callSettings` as sent, latency, start/end ms, `stepNumber`, `fidelity` (`exact` for tool-loop steps; `reconstructed` for synthesized events — detect via `stepNumber === 0 && tools === undefined` only where unambiguous, otherwise via an explicit flag if the contract exposes one), and hashes/sizes: `sha256` + byte length of canonical JSON of `{ system, messages, tools, responseFormat, callSettings }` (request) and `{ finishReason, content }` (response), `om.prompt.system.sha256`, `om.tools.sha256` (sorted tool names + schemas), tool count, message count. **No content is retained** in the record after hashing.
- Keep the observer cheap: hashing runs once per call; failures inside it are swallowed by the existing safety wrapper.
- Add optional `call?: NativeModelCallRecord` to `NativeStepRecord`; merge by order (n-th `onModelCallEnd` ↔ n-th `onStepFinish`); calls with no matching step (object branches without tool loop) go to `fallbackCall` used by the synthetic llm span.
- Unit tests with a mocked `runAiAgentObject` that fires start/end events: merge by order, fallback call, hash stability, content not retained.

#### 1.3-review-fix Mark only caller-managed object calls as reconstructed
- The spec reserves `reconstructed` for the caller-supplied `input.generateObject` callback; plain `generateObject` / `streamObject` are issued by ai-assistant with the exact inputs, so they are `exact`. Additive `callerManaged?: boolean` on `AiAgentModelCallStartEvent`, set by `runAiAgentObject` for the callback branch; the AO recorder maps it to `reconstructed`.

#### 1.4 Write gen_ai and om attributes on native llm spans
- `buildNativeTracePayload` writes, per llm span, the legacy keys plus the metadata keys from 1.1 when a call record exists: params as sent (absent ⇒ key omitted; `om.params.defaults = true` when all absent), usage, finish reasons array, `om.latency.ms`, `om.cost.micros` / `.currency` / `.pricing_source` via `computeCostMicros(responseModel ?? requestModel, …)`, hashes/sizes, `om.capture.fidelity`, `gen_ai.output.type = 'json'`, `om.content.status = 'disabled'`.
- Accept a `captureLevel` input (default `metadata`; 2.2 wires the policy): `off` ⇒ exactly today's attributes.
- Span JSON must stay under the ingest `capSummary` cap (4000 chars): assert in a test with long stop sequences / provider options (stop sequences capped to 10 × 100 chars, provider options never written).
- Unit tests (`nativeTraceCapture` tests): metadata keys present, `off` keeps legacy shape, synthetic span uses the fallback call, cap respected.

### Phase 2 — Observability P2: capture policy

#### 2.1 Add the trace capture policy schema and resolver
- `traceCapturePolicySchema` in `data/validators.ts` (exactly the spec's shape; `perAgent` max 200, `until` ISO datetime).
- `AO/lib/trace/capturePolicy.ts`: `TRACE_CAPTURE_CONFIG_NAME = 'trace_capture_policy'`; `readTraceCapturePolicy(container, tenantId) → { policy, source: 'tenant' | 'default' }` (same fail-closed-to-default rule as `tenantAutoApprovalPolicy.ts`); `resolveCaptureLevel({ policy, policySource, agentId, runSource, now }) → RunManifestCapture` — precedence: per-agent override with unexpired `until` (source `agent`) → `evalLevel` for `source = 'eval'` / tenant `level` (source `tenant`) → `OM_AGENT_TRACE_CONTENT_DEFAULT` (default `metadata`, source `deployment`); then clamp by `OM_AGENT_TRACE_CONTENT_MAX` (`metadata` forbids `full`, default `full`); malformed env → `metadata`. Returns `retentionDays`, `redactPii` from the policy.
- Unit tests: precedence, expired override ignored, eval level, ceiling, malformed record/env fallbacks.

#### 2.2 Apply the capture policy to native and OpenCode runs and record om.capture
- Native runner resolves the policy once per run (tenant from ctx) and passes `captureLevel` to `captureNativeRunTrace` → `buildNativeTracePayload`, and `capture` to `buildAgentRunManifestInput` so the manifest carries `om.capture` again.
- Level `off` also skips the observer's start/end handlers (no hashing work).
- OpenCode runner: `om.capture` in its manifest (policy resolved the same way); no per-step change (P4).
- Unit tests: manifest carries `om.capture` with the right source; `off` keeps legacy spans; resolver failure falls back to `metadata`.

#### 2.3 Add the trace.view_content feature
- `acl.ts`: `agent_orchestrator.trace.view_content` (depends on `trace.view`), title/description i18n if the module localizes features. `setup.ts`: admin/superadmin already hold `agent_orchestrator.*` — add nothing to employee/operator/engineer; confirm with a test that `defaultRoleFeatures` for employee does not include it.
- `yarn generate` if the ACL registry is generated.

#### 2.4 Add the trace capture settings API and undoable command
- `AO/api/trace-capture/settings/route.ts`: `GET` (`trace.view`) → `{ policy, source, deploymentDefault, deploymentCeiling }`; `PUT` (`agents.manage` + `trace.view_content`, checked through `authorizeFeatures` where not expressible in metadata) validates with the schema and runs the command. `openApi` exported.
- `AO/commands/traceCapture.ts`: `agent_orchestrator.traceCapturePolicy.update` — reads the before snapshot, writes `setValue`, `buildLog` with before/after, `undo` restores the before value (or clears it when it was absent). Follow the AO command conventions (`commands/*.ts`, registration).
- Optimistic locking: if `moduleConfigService.getRecord` exposes `updatedAt`, return it and enforce it on PUT via the shared optimistic-lock helper (409 body); otherwise mark the route `optimistic-lock-exempt` with the same justification as `auto-approval` and record that in the spec changelog at 5.2.
- Unit tests: route auth (403 without `view_content`), validation 400, command undo.

#### 2.5 Add the trace capture settings page
- `AO/backend/settings/trace-capture/page.tsx` + `page.meta.ts` (Settings group, next to auto-approval/web-search; `requireFeatures: ['agent_orchestrator.trace.view']`). Form: level, eval level, retention days, redact PII, include provider body (disabled, P3 note), per-agent overrides (agent picker from `GET /agents`, level, optional until). Deployment default/ceiling shown read-only; `full` shows an `Alert` that content capture arrives with a later release and currently records metadata only. Read-only for users without `agents.manage` + `trace.view_content`.
- `CrudForm` if it fits a single-record config; otherwise the auto-approval pattern (`useGuardedMutation` + `apiCall`). DS tokens only, `LoadingMessage`/`ErrorMessage`, i18n en/pl/de/es/ko (translated).
- Unit/render test if the module has page tests; otherwise covered by 3.3.

### Phase 3 — Observability P2: surfaces and coverage

#### 3.1 Show per-step model calls with parameters and cost on the trace page
- New client component `AO/components/trace/LlmStepMetadataCard.tsx` rendered on `backend/traces/[id]/page.tsx` below the timeline: one row per `llm` span (from `GET /runs/:id` spans, read with `readLlmSpanMetadata`) — step, provider/model (request → response), parameters (absent ⇒ "provider default"), tokens (in/out/cached/reasoning), cost (micros formatted in the run currency), latency, finish reason, fidelity badge. Legacy spans render "not recorded (run predates capture)". No new API.
- i18n keys under `agent_orchestrator.trace.*` (spec list subset: `parameters`, `providerDefault`, `costPerStep`, `fidelity.*`, …) in all locales.
- Unit test for the row derivation (pure helper).

#### 3.2 Normalize gen_ai attributes on ingested llm spans
- `traceIngestionService` (or the `trace.ingest` command) passes `kind = 'llm'` span attributes through `normalizeGenAiAttributes` before `capSummary`, so external adapters that send `gen_ai.*` directly get the same shape (spec Runtime parity, "Adapters MAY send gen_ai.* attributes"). No schema change to the ingest body.
- Unit tests in the ingestion tests.

#### 3.3 Cover step metadata and capture settings with integration tests
- `TC-AGENT-TRACE-005` (AO integration folder, self-contained): settings round-trip via API (GET default → PUT tenant level + per-agent override → GET → reset in `finally`), 403 for a user without `trace.view_content`, 400 on invalid body; the scripted-run case asserting llm span `gen_ai.*` keys skips without a configured provider (existing skip helper). UI smoke of the settings page and the trace page card (screenshot attachments for checkpoint evidence).

### Phase 4 — OTel P1: replay export (AO)

#### 4.1 Add deterministic OTel ids and the OTLP JSON encoder
- `AO/lib/trace/otel/ids.ts`: `traceIdFor({ tenantId, workflowInstanceId, rootRunId })`, `runSpanId(runId)`, `agentSpanId(spanRowId)`, `workflowSpanId(workflowInstanceId)`, `dispositionSpanId(proposalId)`, `effectorSpanId` if needed — sha256 with the spec's prefixes, truncated, lowercase hex, all-zero guard.
- `AO/lib/trace/otel/otlpJson.ts`: pure types + `encodeOtlpTraceRequest(resourceSpans)` per OTLP/JSON (hex ids, string nanos, `AnyValue` incl. arrays/kvlists, int as string, `SpanKind` enum numbers, status codes, events, links).
- Golden-fixture unit tests.

#### 4.2 Add string redaction for exported attributes
- `AO/lib/trace/redactStrings.ts` (also the future P3 helper): `redactSecretStrings(text)` (Bearer/Basic/ApiKey schemes, `Authorization:`-style headers, the OpenCode session-authorization line) and `redactEmails(text)`; `redactAttributeValues(attributes)` applies secret-key masking (patterns copied from `packages/telemetry/src/facade/redact.ts`, comment-free, with a test that pins parity on shared samples) and string scrubbing recursively.
- Unit tests.

#### 4.3 Load a run export bundle with tenant scoping
- `AO/lib/trace/otel/loadRunExportBundle.ts`: given `runId`, load the run (by id, then scope = the row's tenant/org), its spans, tool calls (non-encrypted columns only: name, status, latency, error flag), proposals (disposition fields, no payload/reason), eval results (key, score, passed, severity — no evidence), guardrail checks (capability, phase, kind, result — no evidence), the process instance by `workflowInstanceId` (id, definition id, status, no subject), the root run id (walk `parentRunId`, bounded), the registry label for the agent, and the effector claim span. All queries filtered by tenant + organization from the run row. Returns `null` for missing/non-terminal runs.
- Unit tests with a mocked em (scoping asserted on every query).

#### 4.4 Map an agent run to OTLP resource spans
- `AO/lib/trace/otel/mapAgentRunToOtlp.ts`: pure `(bundle, { exportUserIds, serviceName, serviceVersion, environment }) → OtlpResourceSpans` following the spec mapping table: optional `invoke_workflow` root, `invoke_agent` run span (manifest keys merged; invoker user id as `enduser.id` only when `exportUserIds`), `chat {model}` CLIENT spans from llm spans (gen_ai keys via `readLlmSpanMetadata`, legacy keys mapped), `execute_tool` spans parented to their llm span via `parentSpanId` row ids, `om.{name}` system spans (manifest excluded), `om.proposal.disposition` spans and `om.proposal.execute` under them, `gen_ai.evaluation.result` and `om.guardrail.check` events, links to `om.platform_trace.traceparent` and `rerunOfRunId`. Status/timestamps per spec (`createdAt`/`completedAt` for runs). Resource attrs `service.name`, `service.version`, `om.tenant.id`, `om.organization.id`, `om.genai.semconv`, `deployment.environment.name` when given; scope `@open-mercato/enterprise/agent_orchestrator`. All string attributes pass `redactAttributeValues`. Chunk at 512 spans when > 1000.
- Fixture tests: standalone run, workflow with two runs, nested delegation, error run, toolless run, OpenCode run (tool spans only), disposition + effector, eval results; assert no encrypted/free-text fields appear.

#### 4.5 Add OTel export settings resolution and the OTLP HTTP client
- `AO/lib/trace/otel/exportSettings.ts`: deployment config from env (`OM_AGENT_OTEL_EXPORT`, `_ENDPOINT` → `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` → `OTEL_EXPORTER_OTLP_ENDPOINT + '/v1/traces'`, `_HEADERS` → `OTEL_EXPORTER_OTLP_HEADERS`, `_PROTOCOL` (only `http/json` accepted; others → disabled with a warning), `_DELAY_MS`, `_SERVICE_NAME`, `_SOURCES`, `_CONTENT` (read but content not implemented), `_TRACE_URL_TEMPLATE`); tenant settings from module config `otel_export` (`otelExportSettingsSchema` in `data/validators.ts`); `isExportEnabledFor({ deployment, tenant, agentId, runSource })`. Tenant read fails closed (disabled).
- `AO/lib/trace/otel/otlpHttpClient.ts`: `postOtlpTraces({ endpoint, headers, body, timeoutMs = 10000 })` with gzip (`node:zlib`), `fetch` + `AbortController`, header `x-om-otel-export: 1`; classification `ok | retry (429/502/503/504/network/timeout, Retry-After parsed) | drop (other 4xx/5xx)`. Headers never logged.
- Export health state: `AO/lib/trace/otel/exportHealth.ts` storing `{ lastSuccessAt, lastErrorAt, lastErrorCode }` per tenant in module config `otel_export_health` (no DDL).
- Unit tests (env precedence, header parsing, classification, timeout, gzip body).

#### 4.6 Add the export queue, subscribers and worker with retry
- `lib/queue.ts`: `AGENT_ORCHESTRATOR_OTEL_EXPORT_QUEUE = 'agent-orchestrator-otel-export'`, payload `{ runId: string; attempt: number }` only.
- Subscribers `subscribers/otel-export-run-completed.ts` and `subscribers/otel-export-run-ingested.ts` (persistent): when the deployment switch is on and the tenant opted in, enqueue with `delayMs = OM_AGENT_OTEL_EXPORT_DELAY_MS`. Never throw (fail-open; `reportError` on unexpected failure).
- `workers/otel-export.ts` (concurrency 2): load the bundle, **re-check** the tenant settings and allowlist/sources from the row (anti-forgery), map, encode, post; `retry` → re-enqueue with `attempt + 1` and exponential backoff (honor `Retry-After`, max 5 attempts) else `reportError('agent_orchestrator.otel_export_failed')`; `drop` → `reportError('agent_orchestrator.otel_export_rejected')`; update export health. Dedupe is not available on the queue (no job-id option): at-least-once with deterministic ids; record this deviation at 5.2.
- Unit tests for subscriber gating and worker branches (mocked client/queue).

#### 4.7 Add the OTel export settings and test-span APIs
- `AO/api/otel-export/settings/route.ts`: `GET` (`trace.view`) → `{ settings, deployment: { enabled, endpointConfigured, protocol, contentAllowed }, health }` (never the URL/headers; also returns the trace URL template presence); `PUT` (`agents.manage`) through command `agent_orchestrator.otelExportSettings.update` (undoable, before/after snapshot); `content: 'full'` → 422 `content_export_not_allowed` while `OM_AGENT_OTEL_EXPORT_CONTENT != allow` (spec contract), and 422 `content_export_unavailable` otherwise (content events are OTel P2, not built in this wave). Optimistic locking as in 2.4.
- `AO/api/otel-export/test/route.ts`: `POST` (`agents.manage`) sends one synthetic `om.export.test` span for the caller's tenant → `{ ok, httpStatus, latencyMs }`; rate-limited 1 per 10 s per tenant (`readEndpointRateLimitConfig('AGENT_ORCH_OTEL_EXPORT_TEST', …)` keyed by tenant). 409/422 when the deployment switch is off.
- `openApi` on both. Unit tests (auth, 422 matrix, no secret leakage, rate limit).

#### 4.8 Add the OTel export settings page, health line and trace link
- `AO/backend/settings/otel-export/page.tsx` + `page.meta.ts`: tenant settings form (enabled, export user ids, agent allowlist; content select disabled with explanation), read-only deployment block, "Send test span" button (`useGuardedMutation`), last success/error via `StatusBadge`.
- System health: add `otelExport` indicator to `lib/systemHealth.ts` (derived from the settings GET health, shown only when the deployment switch is on).
- Trace page: when export is on and `OM_AGENT_OTEL_TRACE_URL_TEMPLATE` is set, `GET /runs/:id` returns an additive `otel: { traceId, url }` (computed server-side with the ids helper; template only read server-side) and the page shows an "Open in tracing backend" icon link + copyable trace id.
- i18n `agent_orchestrator.settings.otelExport.*`, `agent_orchestrator.health.otelExport.*` in all locales. Unit tests for the indicator and the route field.

#### 4.9 Add the otel:export backfill CLI
- `cli.ts` command `otel:export` with `--run <id>` | `--since <iso> [--until <iso>]` `[--tenant <id>]` `[--dry-run]` `[--limit n]`: dry-run prints the encoded OTLP JSON to stdout (no network); otherwise enqueues jobs (or posts directly when no queue worker is running — follow the existing CLI precedent) respecting tenant settings. Terminal runs only.
- Unit tests for argument parsing and the dry-run path.

#### 4.10 Add the local collector and Jaeger compose profile
- `docker/otel-collector-config.jaeger.yaml` (OTLP HTTP receiver 4318, batch, exporters `debug` + `otlp` → Jaeger) and `starters/docker/compose.agent-otel.yml` (profile `agent-otel`: collector `otel/opentelemetry-collector:0.159.0` + `jaegertracing/jaeger` pinned 2.x tag ≥ 2 weeks old; UI 16686). Mirror into the create-app template only if the template carries the compose starters.

#### 4.11 Cover OTel export with integration tests
- `TC-AGENT-OTEL-001`: settings round-trip + 422 for `content: 'full'` + test-span endpoint returns a clear disabled response when the deployment switch is off (works in the ephemeral app without env changes).
- `TC-AGENT-OTEL-002`: with a fake OTLP receiver (Node HTTP server on a free port) — only when the app was started with `OM_AGENT_OTEL_EXPORT=on` and the endpoint pointing at the receiver (skip with an explicit reason otherwise): ingest a run through the HMAC `trace/ingest` route (no LLM needed), poll the receiver, assert one `invoke_agent` span with the deterministic trace id, child spans, tenant resource attributes and no content keys; tenant opted out → no request.
- `TC-AGENT-OTEL-003`: CLI `--dry-run` output parses as OTLP JSON (unit-level if invoking the CLI from Playwright is not supported; record the reason).

### Phase 5 — Close

#### 5.1 Document trace capture and OTel export and mirror env vars
- Docs: AO docs section (or `apps/docs/docs/framework/ai-assistant/`) pages "Trace capture policy and step metadata" and "Exporting agent traces to OpenTelemetry" (env table, tenant opt-in, PII policy, compose profile, backfill CLI, at-least-once/duplicates note).
- `apps/mercato/.env.example`: `OM_AGENT_TRACE_CONTENT_DEFAULT`, `OM_AGENT_TRACE_CONTENT_MAX`, the `OM_AGENT_OTEL_*` set, rate-limit vars for the test endpoint; `yarn template:sync:fix`.
- `AO/AGENTS.md`: capture policy + OTel export rules (keep within budget; `yarn agents:check-budget`).

#### 5.2 Update the specs, roadmap and upgrade notes for wave 4
- Observability spec: Phase 2 implemented + deviations; OTel spec: Phase 1 implemented + deviations (no job-id dedupe, health in module config, content select disabled); roadmap wave 4 row status; `UPGRADE_NOTES.md` entry (new feature `trace.view_content`, new env vars, new settings pages, new routes, trace span attribute additions, legacy keys kept).

## Risks

- **Stacked base:** the diff against `main` includes waves 1–3 until #7794, #8011 and #8018 merge; review only commits after `11031e1e6`.
- **Span size:** more attributes per llm span could hit the 4000-char `capSummary` cap; 1.4 caps stop sequences and never writes provider options, with a test.
- **Hashing cost:** canonical JSON + sha256 of long prompts per step; only at `metadata`+, after the call, never in the request path of the model.
- **Exporter safety:** export must never affect runs; everything is behind persistent subscribers + a worker, and all failures are `reportError` + health state. No dedupe on the queue → backends may show duplicates on retries (documented).
- **Data leaving the system:** the mapper exports ids/metadata only; a test asserts encrypted/free-text fields never appear; user ids only with tenant `exportUserIds`.
- **Validation limits:** no LLM provider → model-dependent cases skip; OTel delivery test needs the app started with exporter env — it skips with a reason otherwise. Unit coverage carries the behaviour.
- **Size:** 25 Steps. The safety checkpoint after ~20 Steps stops for user review.

## External References

None (`--skill-url` not used).
