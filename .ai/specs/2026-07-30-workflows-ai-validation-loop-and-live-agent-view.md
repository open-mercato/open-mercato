# Workflows AI: Draft Validation Loop & Live Agent-Action View

## TLDR

Two AI reliability upgrades for the workflows module, documented together but delivered as independently shippable phases:

1. **Draft validation loop (Phase 1, core-only).** The "Draft a workflow with AI" agent (`workflows.workflow_author`) is single-shot today and hard-fails when its output misses the real definition schema (e.g. an `INVOKE_AGENT` step missing `config.agentId` / `config.onResult`). We give the agent a read-only **`validate_workflow_definition` tool** backed by the real schemas and turn on the runtime's existing `enableTools` object-mode loop so it self-corrects before returning, keep the route's post-generation validation as a server-side guardrail, and make the drafting catalog **fail-closed on `INVOKE_AGENT`** when the install exposes no usable agents.
2. **Live agent-action view (Phase 2, core + enterprise + ai-assistant).** An `INVOKE_AGENT` activity runs in a background worker that parks/resumes; run views only refetch on coarse `workflows.instance.*` events. We stream each agent action — including token-level "thinking" text — into the run view live and ephemerally, via a dedicated per-run SSE channel fed by a transient worker→browser relay (never the DOM Event Bridge).

## Decisions & Resolved Open Questions

These were raised at the skeleton gate and resolved by the maintainer before design. They are recorded here (not re-opened) so the rationale is traceable.

- **D1 — One bundled spec, phased independently (settled).** The scope-cohesion check flagged that Phase 1 (authoring-time, core-only) and Phase 2 (runtime, cross-package) are two independently deployable capabilities with no shared integration seam. The maintainer chose to document them in **one spec, delivered as independent phases** (Phase 1 ships and reverts entirely on its own). This is a deliberate documentation choice, not a claim of technical coupling; either phase can be lifted into its own file later without rework.
- **D2 — Loop mechanism: real validation tool + server guardrail (settled).** Chosen over a purely server-side repeat-prompt loop and over giving the agent write tools.
- **D3 — Live granularity: token-level "thinking" text (settled).** Chosen over "steps + tool calls only." This is the decision that makes the worker→browser relay necessary; the trade-off is recorded in *Risks* but the decision **stands** — it is not deferred to Phase 2 kickoff.
- **D4 — Persistence: ephemeral, live-only (settled).** No storage of streamed actions; reopening a finished run shows no action history.
- **D5 — No-agent case: fail-closed (settled).** The validate tool and drafting catalog forbid `INVOKE_AGENT` when the install exposes no usable agents.
- **D6 — Peer dependency: block on the enterprise `agent_orchestrator` peer (settled).** Phase 2 includes the peer's producer changes so live actions work end-to-end; this makes Phase 2 cross-package (three coordinated PRs).

## Problem Statement

**Draft failures are dead-ends.** `api/definitions/generate/route.ts:181-206` calls the model exactly once. The output passes a permissive generation schema (`lib/ai-authoring.ts:111-122`, activity `config` typed as `z.record(z.string(), z.unknown())`) but is then re-validated against the strict definition schema (`data/validators.ts:389-457` → `invokeAgentConfigSchema` in `data/activity-config-schemas.ts:153-177`, which requires `agentId: z.string().min(1)` and an `onResult` union). A partial `INVOKE_AGENT` config surfaces to the user as `transitions.0.activities.0.config.agentId: Invalid input: expected string, received undefined` + `config.onResult: Invalid input`, with the whole draft discarded and *"does not describe a workflow"* shown. "Generate again" re-sends the identical prompt — the model never sees its own error. The `INVOKE_AGENT` failure is especially likely because its config schema is a strict `z.object` with two required fields while most other activity configs are tolerant `z.looseObject`s.

**Agent execution is a black box at runtime.** `INVOKE_AGENT` enqueues a worker job and parks the step on `agent_orchestrator.proposal.ready` (`lib/activity-executor.ts:1338-1465`, `lib/activity-worker-handler.ts:360-463`). The run view (`components/run/useLiveRunUpdates.ts`) only learns "this instance advanced" from six `clientBroadcast` lifecycle events (`events.ts:37-42`) and refetches. There is no per-action, per-tool, or per-token visibility into what the agent is doing while it runs.

## Proposed Solution

- **Phase 1** reuses the runtime's already-built object-mode tool loop (`runAiAgentObject({ enableTools: true })` → `generateText({ tools, output: Output.object({ schema }) })`, `agent-runtime.ts:1979-2016`). The agent gains one read-only tool that runs the exact server-side validation the route runs, so the model iterates to a valid definition inside a bounded loop. The route keeps its final `safeParse` + `evaluateWorkflowDefinition` as the trust boundary — the tool advises the model; the route still decides.
- **Phase 2** copies the AI-chat streaming pattern (`POST /api/ai_assistant/ai/chat`, `text/event-stream`, `text-delta` vocabulary) but bridges the worker/browser process gap the chat path doesn't have: the enterprise native runner switches the workflow agent call to streaming and publishes token/step/tool deltas to a transient, tenant-scoped relay; a new core SSE endpoint subscribes per run and forwards to a run-view hook. Everything is ephemeral (no storage), matching the decision that streamed thinking is live-only.

## Research & Prior Art

- **n8n / Windmill (authoring):** both validate node configs against typed schemas at edit time and surface structured problems; neither runs a model-in-the-loop repair. Our `validate_workflow_definition` tool is the same schema, exposed to the model instead of only to the canvas — a modest, well-scoped step past their UX.
- **LangGraph Studio / LangSmith, Temporal Web (runtime):** the leaders stream per-step traces (tool calls, inputs/outputs) and, in LangGraph, token-level model output. Crucially they also treat streamed traces as **ephemeral live telemetry distinct from the durable run history** — which validates the Q2 "live-only" choice and the decision to keep token deltas off the durable event bus. What they carry that we deliberately skip in this spec: persisted, replayable trace timelines (a later concern, explicitly out of scope here).
- **Takeaway:** the unique work is not "stream tokens" (a solved pattern we reuse) but **streaming from a parked background worker**, which the chat dispatcher never has to do.

## Architecture

### Phase 1 — Draft validation loop (core-only)

Data flow: dialog → `POST /api/workflows/definitions/generate` → `resolveWorkflowDraftRunner()` → `runAiAgentObject({ enableTools: true })` → model calls `validate_workflow_definition` (0..N times) → final `Output.object` → route re-validates (guardrail) → `{ ok } | { ok:false, reason, messages }`.

Components (all `packages/core/src/modules/workflows/`):

1. **New tool** `ai-tools.ts` → `workflows.validate_workflow_definition` via `defineAiTool` (`isMutation: false`, `requiredFeatures: ['workflows.definitions.create']`, serializable result). Handler receives the request-scoped `McpToolContext` (`packages/ai-assistant/.../lib/types.ts:8-27`) with the Awilix `container`, so it runs the same two-stage parse (`workflowDraftGenerationSchema` → `workflowDefinitionDataSchema`) **plus** `evaluateWorkflowDefinition` (`lib/definition-evaluation`) exactly as the route does. Returns `{ ok: boolean, errorCount, warningCount, problems: Array<{ path, code, message, severity }> }` — the machine-readable issue list the UX-redesign spec (§ line 271) already anticipates as self-correction fuel.
2. **Agent change** `ai-agents.ts` → `workflows.workflow_author`: `allowedTools: ['workflows.validate_workflow_definition']`, keep `executionMode: 'object'` (the `enableTools` branch stays object mode and returns `{ mode: 'generate', object }`, so the runner's `result.mode === 'generate'` assertion is unaffected), add a conservative `loop.budget` (a validate loop needs ~2–4 steps; e.g. `{ maxToolCalls: 4, maxWallClockMs: 20_000, maxTokens: 120_000 }`) and rely on the runtime's `stepCountIs` cap. The trust-boundary header comment (currently asserting `allowedTools: []` is the boundary) is rewritten to document the controlled relaxation: one **read-only** tool, no mutation surface, approval gate N/A.
3. **Runner** `lib/ai-draft-runner.ts:84-90` → add `enableTools: true` (and pass `loop` if we want per-request tightening). `result.object` handling is unchanged.
4. **Fail-closed catalog** `lib/ai-authoring.ts` → extend `WorkflowDraftCatalog` / `buildWorkflowDraftCatalog` with a pure `agents: readonly { id, label }[]` input (mirroring `commands`/`functions`) and add a prompt rule: *"Do not use the `INVOKE_AGENT` activity type unless the agents catalog is non-empty; when empty, `INVOKE_AGENT` is forbidden."* The route (`api/definitions/generate/route.ts:161-176`) feeds the list from the **optional** `agentWorkflowBridge.listAgentOutcomeContracts?.()` peer (try/catch; absent ⇒ empty ⇒ forbidden). The `validate_workflow_definition` tool independently rejects any `INVOKE_AGENT` step when its resolved agents list is empty, so fail-closed holds even if the model ignores the prompt.

Agents-list consistency: the route resolves the agents list once and both feeds it into the prompt catalog and makes it available to the tool's validation context, so the prompt and the tool agree within a generation. The tool additionally re-checks fail-closed at validation time (the peer set is stable within a request), which is defense-in-depth, not a divergence risk.

Trust boundary note: this consciously revises the documented "in-Studio draft path never reaches a tool" intent. The relaxation is bounded to a single read-only validator; the module `AGENTS.md` AI table and the agent header comment are updated to record the decision.

### Phase 2 — Live agent-action view (core + enterprise + ai-assistant)

The chat dispatcher streams because the browser holds an SSE connection to the *same request* running `streamText`. A workflow agent step has **no such shared request** — it runs in a queue worker (`handleInvokeAgentJob`), parked from the run view's perspective. So Phase 2 adds a transient relay between the two processes.

Producer → relay → consumer:

1. **ai-assistant (additive):** `runAiAgentObject` gains an optional `onAgentAction?(action)` observer (union: `{ type:'step-start' }`, `{ type:'text-delta', delta }`, `{ type:'tool-call', name, input }`, `{ type:'tool-result', name }`, `{ type:'step-finish', usage? }`, `{ type:'finish' }`). When present it takes the existing `mode:'stream'` path (`streamObject`, `agent-runtime.ts:2035-2087`), iterating `textStream` for token deltas and `onStepFinish` for step/tool events, still resolving the final `.object`. Absent ⇒ current non-streaming `generateObject` behavior, unchanged.
2. **enterprise `agent_orchestrator` (additive, separate PR):** `nativeAgentRunner.ts:321-345` passes an `onAgentAction` that publishes each action to a **transient tenant+org-scoped relay** keyed `wf:agent-actions:{tenantId}:{organizationId}:{instanceId}:{stepInstanceId}` (org in the key gives defense-in-depth beyond the endpoint's auth check). **Transport (canonical-mechanism decision):** the relay MUST be **DI-resolved, never `new Redis(...)`**. Preference order, decided during Step 2b spike: (a) reuse the `packages/events` cross-process bridge's pub/sub layer (Postgres `LISTEN/NOTIFY`, already DI-wired) on a **dedicated, uncapped, un-deduped channel** separate from the 4 KB/500 ms `clientBroadcast` path; (b) if NOTIFY throughput proves insufficient for token deltas, a DI-provided Redis pub/sub client sourced from the existing cache/queue Redis infra (`@open-mercato/cache` / `@open-mercato/queue`), resolved via the container. Hand-rolling a raw client is forbidden. Whichever wins, it is deliberately NOT the DOM Event Bridge (4 KB cap + 500 ms dedup would corrupt a token stream). The `agentWorkflowBridge` interface (`invokeAgentForWorkflow.ts:69-80`) is unchanged; the emitter is internal to the runner. **Backpressure:** the producer coalesces token deltas on a short flush interval (~50–100 ms) into a bounded per-step buffer with drop-oldest on overflow, so a slow/absent consumer can never stall or memory-balloon the worker. Publishing is best-effort and wrapped so a relay outage never affects agent execution or the parked-step resume.
3. **core (additive):** new SSE endpoint `GET /api/workflows/instances/[id]/agent-stream` — `text/event-stream`, gated via a per-method `metadata.GET` export (`requireAuth` + the run-view read feature), scoped so it only ever subscribes to the **caller's own tenant/org** relay keys for that instance (cross-tenant subscription is impossible by construction — tenant + org are baked into the channel key from the session, never the query). It resolves the instance, authorizes, subscribes to the relay for the active step(s), and forwards frames as `text-delta` / `agent-action` SSE events. **Lifetime & limits:** returns **404** (not 403) for an instance outside the caller's tenant/org or unknown, so existence is never confirmed to a foreigner; sends a heartbeat comment on the run's existing SSE cadence; **auto-closes** when the instance reaches a terminal state or after a max connection lifetime; a per-user concurrent-connection cap prevents tab-fanout leaks. **openApi:** documented as a streaming `text/event-stream` response (no JSON body schema; frame vocabulary described in prose). No persistence. Streamed model "thinking" text is rendered as **text, never HTML** (React auto-escaping; no `dangerouslySetInnerHTML`), so a model that emits markup cannot inject into the run view.
4. **core run-view (additive):** new hook `useLiveAgentActions(instanceId, stepInstanceId)` consuming the endpoint and a small "Agent activity" live panel in the run detail (token text appended as it streams; tool calls rendered as a compact action log). `useLiveRunUpdates.ts` stays exactly as-is — lifecycle refetch remains the source of truth for run state; agent streaming is additive live telemetry.

## Data Model

- **Phase 1:** none. No new tables, columns, or migrations. Reuses feature `workflows.definitions.create`.
- **Phase 2:** none persisted (ephemeral by decision). The relay is a transient pub/sub channel, not storage. No migration.

## API Contracts

- **Phase 1 — `POST /api/workflows/definitions/generate`** (existing): response shape unchanged (`{ ok } | { ok:false, reason, messages }`). Internal behavior only changes (tool loop + fail-closed catalog). The new tool `workflows.validate_workflow_definition` is an internal AI-tool contract, not an HTTP route.
- **Phase 2 — `GET /api/workflows/instances/[id]/agent-stream`** (new): `text/event-stream` via a per-method `metadata.GET` export (`requireAuth` + run-view read feature). SSE frames: `text-delta` `{ delta }`, `agent-action` `{ kind, name?, at }`, terminal `finish`. No request body; `id` is validated as the instance UUID. Returns **404** for unknown or out-of-tenant/org instances (no existence disclosure). Auto-closes on terminal instance state or max-lifetime; per-user connection cap. 4 KB cap does NOT apply (dedicated relay channel, not the DOM bridge). `openApi`: streaming response, `text/event-stream`, frames described in prose.

## UI/UX

- **Phase 1:** `WorkflowAiDraftDialog.tsx` is largely unchanged — the same "Generate draft" → refusal-or-ready flow. Copy tweak: on the now-rarer refusal, the per-issue `messages` still render (they are the guardrail output). Optionally surface a subtle "validated N times" affordance; not required. `Cmd/Ctrl+Enter` submit / `Escape` cancel already honored (Drawer).
- **Phase 2:** a live "Agent activity" section in the run detail view: streamed thinking text (monospace, auto-scroll, DS tokens — no arbitrary sizes/colors), a compact tool-call action log, and an idle/"no live detail available" empty state when the relay yields nothing (peer absent, worker finished before connect, or relay down). Uses shared primitives (`EmptyState`, `Spinner`/`LoadingMessage`, `SectionHeader`), `aria-label` on any icon-only control. All new strings ("Agent activity", the empty-state copy, action-log labels) route through `useT()` with `workflows.run.agentActivity.*` keys added to every locale file (`en/pl/de/es`); no hard-coded user-facing text.

## Edge Cases & Failure Scenarios

- **Model ignores the fail-closed prompt and emits `INVOKE_AGENT` with no agents** → the `validate_workflow_definition` tool returns an error problem; loop corrects, or the route guardrail rejects. No unrunnable draft reaches the canvas.
- **Tool loop never converges within budget** → runtime hits `loop.budget` / `stepCountIs`; route validates the last object; on failure returns the same `{ ok:false, reason:'schemaError', messages }` as today (graceful regression to current behavior, not worse).
- **AI peer absent** → `resolveWorkflowDraftRunner()` returns unavailable exactly as today; tool loop is moot.
- **Phase 2 relay down / Redis unavailable** → publish is best-effort; agent still runs and resumes; SSE endpoint shows "no live detail available"; run view falls back to lifecycle refetch. **Agent execution correctness never depends on the stream.**
- **Browser connects after the worker already finished** → ephemeral: earlier tokens are gone; endpoint sends `finish`; panel shows the completed state via the normal refetch. Acceptable per the live-only decision.
- **Reconnect mid-stream** → tokens streamed during the gap are lost (ephemeral); no attempt to replay.
- **Cross-tenant leak attempt** (guessing another instance id) → endpoint authorizes the instance against the session tenant/org before subscribing; channel key derives tenantId from the session, so a foreign instance yields 403/empty, never another tenant's reasoning.

## Risks & Impact Review

- **Blast radius Phase 1:** low. Additive tool + one agent-config flip + a pure catalog field, all behind the existing draft path; the route guardrail is unchanged so a bad loop can't produce worse output than today. `risk-medium` at most.
- **Blast radius Phase 2:** higher and cross-package (`ai-assistant` runtime + enterprise `agent_orchestrator` runner + core endpoint/UI) and introduces a Redis-pub/sub dependency on the streaming path. `risk-high`. The worker→browser relay is the central complexity and the thing most likely to be cut down (see note) — but the agent-execution path degrades safely without it.
- **Contract surfaces (all additive, per `BACKWARD_COMPATIBILITY.md`):** new AI-tool id; new SSE API route; new `onAgentAction` param on `runAiAgentObject` (optional); new run-view hook. No renames/removals. The `agentWorkflowBridge` interface is untouched. Event IDs: none added (the relay is not an `EventDefinition`).
- **Cross-repo/PR split:** `agent_orchestrator` is in-repo (`packages/enterprise`) but an optional DI peer, so its runner change ships as its own PR coordinated with the ai-assistant additive param (publish ai-assistant change first, then enterprise consumes it, then core endpoint/UI). Core Phase 1 is fully independent and ships first.
- **Rollback:** Phase 1 — revert `enableTools` flag / `allowedTools` (instant return to single-shot). Phase 2 — feature-flag the streaming producer and the run-view panel; disabling the flag reverts to today's refetch-only view with zero data-model impact (nothing persisted).
- **Cost trade-off (decided, D3/D6):** token-level "thinking" streaming (D3) plus blocking on the peer (D6) is the reason Phase 2 needs a worker→browser relay the chat path never needed — research surfaced the async-worker execution model after the decision. A "steps + tool calls only" granularity would drop the token-delta relay and most of the producer work; that alternative was considered and **not** chosen. The decision stands; this note records the accepted cost, not an open question. If Phase 2 estimation later forces a cut, dropping to steps-only is the pre-identified lever (it degrades D3, requires no other structural change).

## Phasing

- **Phase 1 — Draft validation loop.** Core-only, independently shippable, delivers the immediate fix for the reported error. Ships first.
- **Phase 2 — Live agent-action view.** Cross-package, gated behind a flag, sequenced ai-assistant → enterprise → core.

## Implementation Plan

### Phase 1 (core `packages/core/src/modules/workflows/`)

1. Add `ai-tools.ts` exporting `aiTools` with `workflows.validate_workflow_definition` (`defineAiTool`, `isMutation:false`, `requiredFeatures:['workflows.definitions.create']`, input = draft object schema, handler runs two-stage parse + `evaluateWorkflowDefinition` via `ctx.container`, returns `{ ok, errorCount, warningCount, problems[] }`). Unit-test the handler against a known-bad `INVOKE_AGENT` draft and a valid draft. *App works: tool registered, unused.*
2. Extend `WorkflowDraftCatalog` + `buildWorkflowDraftCatalog` (`lib/ai-authoring.ts`) with a pure `agents` field and the fail-closed prompt rule; unit-test prompt output with empty vs non-empty agents. *App works: catalog richer, behavior unchanged until wired.*
3. Feed the agents list in `api/definitions/generate/route.ts` from the optional `agentWorkflowBridge.listAgentOutcomeContracts?.()` (try/catch → `[]`). *App works.*
4. Flip `ai-agents.ts` (`allowedTools`, `loop.budget`, revised header comment) and set `enableTools:true` in `lib/ai-draft-runner.ts`; run `yarn generate`. Integration-test the generate route end-to-end: a prompt that previously produced the `agentId`/`onResult` failure now returns `ok:true` (or a clean guardrail refusal). *App works: fix live.*
5. Update module `AGENTS.md` AI table + a short note in the workflows draft doc-comments; `yarn mercato configs cache structural --all-tenants`. Full validation gate.

### Phase 2

**2a — ai-assistant (PR A):** add optional `onAgentAction` to `runAiAgentObject`; when present, take the `streamObject` path and emit step/tool/token actions; default path unchanged. Unit-test that the observer fires token deltas and the final object still resolves.

**2b — enterprise `agent_orchestrator` (PR B, depends on A):** in `nativeAgentRunner.ts`, publish `onAgentAction` deltas to the transient tenant-scoped relay (Redis pub/sub + in-process dev fallback); best-effort, isolated from execution. Test relay publish + a publish-failure-is-swallowed case.

**2c — core (PR C, depends on B):** add `GET /api/workflows/instances/[id]/agent-stream` (auth, tenant/org scope, SSE forward from relay); add `useLiveAgentActions` hook + the run-view "Agent activity" panel behind a feature flag; keep `useLiveRunUpdates` untouched. **Test harness:** the endpoint/hook are tested against a **stub producer** that publishes a scripted, deterministic sequence of `text-delta`/`agent-action`/`finish` frames directly onto the relay channel — no live model or worker needed. This isolates the transport/auth/UI path from model nondeterminism. Integration-test: authorized live stream forwards the scripted deltas in order; a foreign/unknown instance id returns 404; relay-absent (no producer) shows the graceful empty state; connection auto-closes on `finish`.

## Integration Coverage (required)

- **API paths:** `POST /api/workflows/definitions/generate` (Phase 1 — self-correction success + guardrail refusal + fail-closed INVOKE_AGENT); `GET /api/workflows/instances/[id]/agent-stream` (Phase 2 — authorized stream, cross-tenant refusal, relay-absent empty state).
- **UI paths:** AI draft dialog generate→apply (Phase 1); run-detail live "Agent activity" panel streaming + empty state (Phase 2).
- Tests self-contained: create the definition/instance fixtures in setup via API, tear down in finally; no reliance on seeded data.

## Final Compliance Report

| MUST | Verdict | Notes |
|------|---------|-------|
| One deployable capability per spec | ⚠️ Accepted deviation | Two capabilities bundled by maintainer decision (D1); phases are independently shippable/revertable. |
| Canonical primitives (`defineAiTool`, `runAiAgentObject`, DI-resolved transport, `useT`) | ✅ | Phase 1 reuses the runtime tool-loop + validators; Phase 2 relay is DI-resolved (raw Redis forbidden). |
| Tenant/org isolation | ✅ | Tool runs under request-scoped `McpToolContext`; SSE endpoint 404s foreign instances; relay key carries tenant+org. |
| Zod validation on inputs | ✅ | Two-stage parse in the tool; instance id UUID-validated on the SSE route. |
| Sensitive data / encryption | ✅ N/A | Nothing persisted; streamed text is ephemeral, rendered as escaped text (no PII column, no crypto). |
| Backward compatibility (additive only) | ✅ | New tool id, new SSE route, optional `onAgentAction`, new hook; no renames/removals; `agentWorkflowBridge` untouched. |
| Rollback story | ✅ | Phase 1: revert `enableTools`/`allowedTools`. Phase 2: feature flag; nothing to unwind (ephemeral). |
| Design System / i18n | ✅ | Shared primitives, DS tokens, `aria-label`; all new strings via `useT()` across `en/pl/de/es`. |
| Failure modes documented | ✅ | Non-convergence, peer/relay absent, late connect, reconnect, cross-tenant, backpressure all covered. |
| Every step testable | ✅ | Each step has a named unit/integration test; Phase 2 transport tested via a deterministic stub producer. |
| No hand-rolled crypto / raw infra clients | ✅ | Relay transport DI-resolved; raw Redis explicitly forbidden. |

Outstanding for Phase 2 kickoff (implementation-time, not spec-blocking): finalize relay transport choice (events-NOTIFY vs DI Redis) via the Step 2b spike; confirm max SSE connection lifetime and per-user cap values.

## Changelog

- **2026-07-30** — Initial spec authored (skeleton → Open-Questions gate → research → design → adversarial scope-cohesion review → revisions). Resolved D1–D6 at the gate. Applied review findings: recorded bundling + token-level decisions explicitly (H1/H2), specified DI-resolved relay transport and forbade raw Redis (H3), added org-scoped relay key (L2), SSE 404/lifetime/connection-cap semantics (M3), producer backpressure (M4), deterministic stub-producer test harness (M5), i18n key plan + XSS-safe text rendering (M6), `openApi`/`metadata` treatment for the SSE route (L1/L3), agents-list consistency note (L4), and this Final Compliance Report + Changelog (M1).
