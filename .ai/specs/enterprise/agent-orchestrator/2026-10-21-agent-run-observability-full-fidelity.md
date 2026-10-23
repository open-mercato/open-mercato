# Agent Orchestrator — Full-Fidelity Run Observability

> **Status:** Draft · **Date:** 2026-10-21 · **Package:** `packages/enterprise/src/modules/agent_orchestrator` (+ an additive observer hook in `packages/ai-assistant`, + a tiny run-observation collector in `packages/shared`)
> **Driven by:** the requirement to fully observe every agent run (versions, identity, parameters, cost, prompts as sent). The design is generic.
> **Builds on:** `next/2026-06-19-agent-trace-eval-capture.md` (trace tables, artifact offload, PII posture), `2026-07-07-lightweight-agent-runtime.md` (native per-step capture), `2026-10-12-process-flow-trace-replay-and-embeddable-decision-card.md` (Process Flow Trace, re-run lineage), `next/2026-06-19-agent-identity-and-on-behalf-of.md` (principals, `runAs`), `next/2026-06-19-agent-context-knowledge-plane.md` (TDCR bundles).
> **Supersedes:** the "P4 offloads the packed payload" placeholder in `lib/context/contextResolver.ts` and the trace spec's "full payloads offload to S3" line for LLM requests (it was implemented for tool calls and run output only).
> **Sibling specs:** [`2026-10-21-otel-genai-trace-export.md`](./2026-10-21-otel-genai-trace-export.md) (export of what this spec captures; its Phase 1 needs this spec's Phase 1 manifest for identity/version keys and Phase 2 for per-step `gen_ai.*`) · [`../../2026-10-21-chat-run-tracing-and-citations.md`](../../2026-10-21-chat-run-tracing-and-citations.md) (OSS; **owns** the model-call contract §6 — `AiAgentCallObserver`, `callSettings`, `modelSettings`, `trace.persist` — that this spec consumes) · [`2026-10-21-agent-invocation-access-and-identity-binding.md`](./2026-10-21-agent-invocation-access-and-identity-binding.md) (owns `invoker` / `entryPoint` / audit correlation; recorded here) · [`2026-10-21-output-integrity-guardrails.md`](./2026-10-21-output-integrity-guardrails.md) (raw-output artifact key recorded in the manifest) · [`2026-10-21-eval-reports-and-reproducible-regression.md`](./2026-10-21-eval-reports-and-reproducible-regression.md) (reads recorded `gen_ai.request.seed` to report whether a seed was honored) · [`../../2026-10-21-mcp-tool-exposure-parity-and-audit.md`](../../2026-10-21-mcp-tool-exposure-parity-and-audit.md) (`correlationId`, `channel`). Umbrella: [`../../2026-10-21-agent-platform-capabilities-roadmap.md`](../../2026-10-21-agent-platform-capabilities-roadmap.md).

## TLDR

**Key Points:**
- Every agent run (playground, `INVOKE_AGENT`, headless API, eval replay; native, OpenCode and ingested external runtimes) records **what was actually sent to the model and what came back, per LLM step**, plus **which versions of everything** produced it and **who** caused it — and the trace inspector shows it.
- The design adds **no database column and no table**. The module's migrations are squash-only (verified below), so all new data rides on existing jsonb (`agent_spans.attributes`), the existing encrypted artifact offload (`lib/trace/artifactStore.ts` → `storage-s3`), and the existing-but-unused `agent_context_bundles.payload_ref` and `agent_runs.agent_version` columns.

**Scope:**
- (a) Per-LLM-step request capture as sent: resolved system prompt (incl. merged prompt overrides, page context, attachments summary, task-plan and mutation-policy suffixes), message array, tool definitions with JSON schemas, response-format schema; and the response. Redaction + tenant-DEK encryption + size caps + retention + a **capture level** (`off` | `metadata` | `full`) per tenant and per agent.
- (b) Model parameters as sent (temperature, top_p, top_k, max output tokens, seed, stop sequences, penalties, provider options) and **per-step cost** via `modelPricing`.
- (c) Persisted retrieved-context payload (`payload_ref`) and per-source retrieval results.
- (d) A **run manifest** on every run: agent definition hash, prompt-override version, skill versions, tool-set hash, model/provider resolution, and an extensible `knowledgeVersions` map that tools/context modules contribute to (e.g. a rule-set version).
- (e) Identity recorded on the run (invoker kind, user id, API key id, agent principal, on-behalf-of, entry point). Binding the identity and correlating action logs to the run are owned by the sibling `2026-10-21-agent-invocation-access-and-identity-binding.md`; this spec records and renders them.
- (f) Trace UI: Request / Response panels per LLM step, run-to-run and step-to-step diff, copy-as-JSON, a Versions & Identity card.
- (g) Parity rules for native, OpenCode and ingested external runs; chat runs are owned by the OSS chat-tracing spec.

**Concerns:**
- Full prompts are the most PII-dense data the platform stores. Content is opt-in (`full`), encrypted with the tenant DEK, offloaded, retention-bounded, and viewable only with a NEW feature `agent_orchestrator.trace.view_content` (today `trace.view` is granted to `employee` by default).
- `full` capture needs `storage-s3` configured for the tenant. Without it the content is NOT stored inline (the row would be plaintext and capped); the step records `om.content.status = "storage_unavailable"` and the UI says so.
- Querying runs by identity or version is a jsonb scan on `agent_spans` until the next planned re-squash promotes those fields to columns (see Migration).

## Open Questions (autonomous defaults applied — confirm before implementation)

| # | Question | Default applied in this draft | Why |
|---|---|---|---|
| Q1 | A fresh-context scope review returned **SPLIT**: the brief bundles three independently deployable capabilities — **(i) run manifest** (versions + identity record, scope d/e; Phase 1, needs no storage and no policy), **(ii) per-step metadata, params, cost + capture policy** (scope b; Phase 2), **(iii) full content capture** (scope a/c/f: encrypted artifacts, redaction, retention, `trace.view_content`, Request/Response panels, diff; Phases 3–4, depends on (ii) for the policy). Split into two or three specs? | Keep one spec with the phases aligned to those three capabilities; each phase ships alone and in order. Recommended split if the maintainer prefers: (i)+(ii) "run manifest & step metadata" and (iii) "content capture". | The three share one storage seam (span attributes + manifest span), one key vocabulary (`genAiAttributes.ts`) and one squash-only rationale; splitting duplicates that. The GDPR-gated content part (iii) is the most natural cut. |
| Q2 | Who owns the ai-assistant hook? The OSS chat-tracing spec (`.ai/specs/2026-10-21-chat-run-tracing-and-citations.md`) adds an internal `resolveSystemPromptWithOverrideMeta` returning `{ prompt, override }`, an `agent_definition_hash` computed at registry load, and an `agent-run-recorder` wired into **both** `runAiAgentText` and `runAiAgentObject`. | **Resolved in the cross-spec pass:** the OSS chat-tracing spec §6 owns the whole model-call contract (`AiAgentCallObserver` with `onPromptResolved` / `onModelCallStart` / `onModelCallEnd`, `AiAgentCallSettings`, call-time `callSettings`, definition `modelSettings`, `trace: { persist, channel, correlationId }`). This spec consumes it (AO is the second observer consumer next to the OSS recorder) and passes `trace: { persist: false }` so the OSS recorder does **not** also persist AO native runs. Whichever spec lands first implements the shared pieces exactly as §6 specifies. | The hook is OSS code; its shape must be one contract, and one model call must produce one trace record. |
| Q3 | Default capture level for a tenant that configured nothing? | `metadata` for runtime runs, `metadata` for eval runs. `full` is always an explicit opt-in. | Content capture is a GDPR decision a tenant must make; metadata already answers "which prompt/version/params/cost". |
| Q4 | Accept jsonb-only storage now and promote hot fields (`invoker_user_id`, `api_key_id`, `definition_hash`) to `agent_runs` columns at the **next planned re-squash**, or re-squash now? | jsonb now; add the fields to the module's "next re-squash" list. | A re-squash today forces every existing AO database to drop and re-initialise the module's tables (see Migration). |
| Q5 | Add `agent_orchestrator.trace.view_content` as a new ACL feature (granted to `admin`/`superadmin` only by default)? | Yes. | `trace.view` is held by `employee`; full prompts must not widen to that audience by default. |
| Q6 | Should `full` capture also keep the raw provider HTTP request body (AI SDK `include.requestBody`)? | No by default; a per-tenant `includeProviderBody` flag (off) for provider-debugging. | The normalized prompt (system + messages + tools + params) is what auditors need; the raw body duplicates it and may contain provider-specific base64 attachments. |
| Q7 | Identity and action-log correlation are also specified by the sibling `2026-10-21-agent-invocation-access-and-identity-binding.md` (`AgentRunCtx.invoker: AgentInvoker`, `entryPoint`, `CommandRuntimeContext.auditCorrelation` → `action_logs.context_json.correlation.agentRunId`, `GET /runs/:id/actions`). | That spec **owns** identity binding and audit correlation. This spec only **records** its `invoker`/`entryPoint`/`channel`/`correlationId`/`runAs` in the run manifest and renders them. **Resolved in the cross-spec pass:** the identity spec dropped its `agent_runs.entry_point` column and now writes `om.entry_point` into this manifest; whichever spec lands first creates the shared builder `lib/trace/runManifest.ts`. | No duplicate mechanisms; one place decides who invoked a run. |
| Q8 | Capture defaults diverge: the OSS chat spec defaults chat runs to `full` (16 KB caps, system prompt only with an extra opt-in); this spec defaults AO runs to `metadata`. | Keep the divergence, stated in both specs (chat spec Q1 carries the mirror text): chat content is short conversational text under the user's own session and is already persisted as conversation messages; AO runs carry business records and composed system prompts, so AO `full` (complete provider request incl. system prompt, 1 MiB per artifact, S3 offload) is a stronger level than OSS `full` (encrypted columns, 16 KB, no system prompt). Same level names (`off|metadata|full`). Runs that ai-assistant hands to AO through the dispatcher follow this spec's policy only. | Different data profiles; same vocabulary keeps operators oriented. |

## Overview

The Agent Orchestrator (AO) already records an `AgentRun` per execution, an `llm` span per AI SDK step, a `tool` span + `AgentToolCall` per tool call (with encrypted offload of large payloads), an `AgentContextBundle` per context assembly, and renders it on `/backend/agent_orchestrator/traces/[id]` and in `ProcessFlowTrace`. What it does **not** record is the request the model actually received, the parameters it ran with, the per-step cost, the versions of the prompt/tools/knowledge that shaped it, and the identity that caused it. Those are exactly the questions an auditor, a regulator-facing reviewer, or an engineer debugging a wrong answer asks first: *"show me the exact prompt, the exact rule set, and who ran it."*

This spec closes that gap without new schema, reusing three existing mechanisms: span attributes (jsonb), the encrypted artifact offload, and the per-tenant module-config store.

> **Market Reference**: **Langfuse** (OSS LLM observability) and **Arize Phoenix / OpenInference**. Adopted: per-generation capture of the full input (system + messages + tools) and output, model parameters, usage and cost per generation; prompt versions linked to generations; a capture/masking switch. Adopted from **OpenTelemetry GenAI semantic conventions** (`gen_ai.*`, semconv 1.43 in `node_modules/@opentelemetry/semantic-conventions`): attribute names for model params, usage and operation names, so the sibling OTel export spec is a mapping, not a translation. Rejected: Langfuse's separate "prompt management" store (AO already has versioned prompt overrides in ai-assistant and file/code definitions in git) and storing content in plaintext columns (Langfuse's default) — OM stores content encrypted, offloaded and retention-bounded.

## Problem Statement

Verified against the code on 2026-10-21:

1. **No request capture.** `lib/runtime/nativeAgentRunner.ts` records, per step, only `{ modelId, finishReason, usage.{inputTokens,outputTokens}, toolCalls, endedAtMs }` (`recordStep`, ~L218–233). `lib/runtime/nativeTraceCapture.ts` (`buildNativeTracePayload`) writes the `llm:<model>` span with `attributes: { inputTokens, outputTokens, finishReason }` only. The system prompt, messages, tool definitions and output schema are built inside ai-assistant's `runAiAgentObject` (`packages/ai-assistant/src/modules/ai_assistant/lib/agent-runtime.ts`, ~L2158–2416) and never leave it: `generateText({ model, system: systemPrompt, messages: modelMessages, tools, … })`.
2. **No model parameters.** `runAiAgentObject` passes no `temperature`/`topP`/`maxOutputTokens`/`seed`; neither `AiAgentDefinition` nor `defineAgent` declares them. Provider defaults apply and nothing records that fact.
3. **Cost is run-level only.** `computeCostMinor` (`lib/runtime/modelPricing.ts`) is called once per run (`buildUsageStamp` in the native runner; null-only estimate in `traceIngestionService.ts`). It rounds to minor units (cents), so a per-step cost computed with it would round most steps to 0.
4. **Retrieved context is not persisted.** `ContextResolverImpl.assemble` (`lib/context/contextResolver.ts`) persists routed/pruned source refs and token counts but sets `payloadRef: null` with the comment "P4 offloads the packed payload". `payloadRef` is never set anywhere in the module. The untrusted spans surfaced to the guardrail are "surfaced in-memory only (never written to the persisted bundle)".
5. **No version stamping.** `agent_runs.agent_version` is set only by `applyRunFields` when an ingest payload carries `agentVersion` (and by a CLI seed). Native and OpenCode runners never set it. The prompt override (`AiAgentPromptOverride`, versioned `version int` in ai-assistant) is applied by `resolveBaseSystemPromptWithOverride` inside `composeSystemPrompt`, which returns only a string — the version is lost. No definition hash, tool-set hash or skill version exists anywhere.
6. **No identity on the run.** `agent_runs` has no caller column (verified in the squash migration DDL). `AgentRunCtx.userId` and `ctx.runAs` reach the command context (`buildCommandContext`, `lib/runtime/persistence.ts`) but are not persisted on the run. `agent_orchestrator.runs.create` has no `buildLog` and is not undoable, so it writes no `action_logs` row either. API-key invocations (`auth.isApiKey`, `auth.keyId` in `packages/shared/src/lib/auth/server.ts`) lose the key id. Agent writes under a principal are audited (`action_logs.actor_user_id` + `on_behalf_of_user_id`) but carry no run id; the join is actor + time.
7. **OpenCode runs are thinner still.** `openCodeAgentRunner.ts#ingestSessionTrace` emits only `tool` spans (or one synthetic `llm` span) with no tokens, model or cost per step; the message sent (`buildMessage`) embeds the live `_sessionToken` in free text.
8. **The UI cannot show what is not stored.** `backend/traces/[id]/page.tsx` has Context, Guardrails, Tool calls, Reasoning, Disposition and Files cards; no request/response view, no versions, no identity.

## Proposed Solution

### Storage map (no migration)

| Data | Location | Protection | Schema change |
|---|---|---|---|
| Per-step metadata: provider, request/response model, params as sent, usage (input/output/cached/reasoning), cost (micros), latency, finish reason, response id, content hashes + sizes, capture status | `agent_spans.attributes` of the step's `llm` span (keys `gen_ai.*` + `om.*`) | No content, ids/numbers/hashes only; plaintext like today | None |
| Per-step request content (system, messages, tool definitions, response-format schema, params, optional provider body) | `storage-s3`, NEW namespace `agent-trace-content`; key stored in `attributes["om.content.request.key"]` | Tenant DEK via `putArtifact` with NEW ref `ARTIFACT_REFS.llmRequest = { entityId: 'agent_orchestrator:agent_run', field: 'input' }` (reuses a declared map, same precedent as `ARTIFACT_REFS.runOutput` and `artifactFileStore`'s `caption` reuse) | None |
| Per-step response content (text, reasoning parts if returned, tool-call parts, structured object) | Same namespace; `attributes["om.content.response.key"]` | `ARTIFACT_REFS.llmResponse = { entityId: 'agent_orchestrator:agent_run', field: 'output' }` | None |
| Run manifest (versions, identity, capture-policy snapshot, platform trace carrier) | One `system` span per run: `name = "run.manifest"`, `externalSpanId = "<runId>:manifest"` | Ids, versions, hashes only | None |
| Display version | `agent_runs.agent_version` (existing `varchar(50)`, today unused for native/OpenCode) | — | None |
| Packed context payload + retrieval results | `storage-s3` (`agent-trace-content`) → `agent_context_bundles.payload_ref` (existing column, today always null) | `ARTIFACT_REFS.contextPayload = { entityId: 'agent_orchestrator:agent_run', field: 'input' }` | None |
| Per-retrieval summary (query hash, k, hit refs, scores, ranks) | Additive optional fields on `contextBundleRoutedSourcesSchema` items (jsonb, Zod-validated) | Refs/scores only; query text goes to the payload artifact | None |
| Tool-contributed knowledge versions / retrieval hits | Tool span `attributes["om.knowledge"]`, `attributes["om.retrieval"]` (ids/versions/scores) | Ids only | None |
| Action-log → run link | Owned by the identity-binding spec (`action_logs.context_json.correlation.agentRunId`) | — | None here |
| Capture policy | `moduleConfigService` record `agent_orchestrator/trace_capture_policy` (same store as `auto_approval_policy`, `lib/disposition/tenantAutoApprovalPolicy.ts`) | — | None |

### Capture levels

| Level | What is recorded per LLM step | Content artifacts |
|---|---|---|
| `off` | Exactly today's span (`inputTokens`, `outputTokens`, `finishReason`) plus the run manifest. Does NOT disable the trace — `OM_AGENT_TRACE_CAPTURE=off` remains the global kill switch for spans. | None |
| `metadata` (default) | `off` + provider, request/response model, params as sent (`null` = provider default, recorded explicitly), usage incl. cached/reasoning tokens when reported, `om.cost.micros`, latency, response id, `om.content.request.sha256` / `.bytes`, `om.content.response.sha256` / `.bytes`, `om.prompt.system.sha256`, `om.tools.sha256`, tool count | None |
| `full` | `metadata` + encrypted request/response artifacts + context payload artifact | Yes |

Resolution order (most specific wins): per-agent override → tenant default → deployment default (`OM_AGENT_TRACE_CONTENT_DEFAULT`, default `metadata`). Eval runs (`source = 'eval'`) use `evalLevel` (default = tenant default), so a tenant can capture `full` for synthetic eval traffic only. A deployment ceiling `OM_AGENT_TRACE_CONTENT_MAX=metadata` forbids `full` everywhere (regulated hosting).

### Redaction, caps and retention

- **Redaction before encryption** (the row/artifact is the exposure, not the page — same principle as `lib/trace/redactToolSummary.ts`):
  1. key-based `redactSecrets` over structured parts (tool args/results inside messages, provider options);
  2. NEW string-pattern pass `redactSecretStrings` for free text: the OpenCode session-authorization line (`[Session Authorization: <token>…]`), `Bearer …`, `Authorization:` headers — mirrors `packages/telemetry/src/facade/redact.ts` patterns (copied, not imported: enterprise does not depend on `@open-mercato/telemetry`);
  3. optional per-tenant `redactPii: true` → email/phone/IBAN/card patterns in free text, recorded as `om.content.redactions: [{ rule, count }]`.
  Encrypted entity fields were already removed from context records by `lib/context/redactor.ts` before the model saw them; that is not repeated.
- **Size caps:** `OM_AGENT_TRACE_CONTENT_MAX_BYTES` (default 1 MiB per artifact). Over the cap, the largest message contents are truncated with an explicit `{ "_truncated": true, "originalBytes": n }` marker and `om.content.truncated = true`. File/image parts are never stored: replaced by `{ type: 'file', mediaType, bytes, sha256 }`.
- **Retention:** `contentRetentionDays` (default 30, max 3650). A daily worker (`trace-content-retention`) lists the `agent-trace-content` namespace per tenant scope and deletes expired objects; spans are append-only and are not touched. The UI resolves a missing object to "content expired under the N-day retention policy" (artifact route returns `410`). Hashes, versions and metadata stay for the life of the span, so the prompt remains *identifiable* (and reconstructable from git + override history) after the content is gone. Operators SHOULD also set a bucket lifecycle rule on the namespace prefix as a backstop.
- **Erasure:** content is per-run addressable (`listRunContentKeys(runId)`), which the DSAR/erasure design (`next/gap-analysis/gap-12-comply-dsar-erasure.md`) needs; implementing DSAR is out of scope.

### Design Decisions

| Decision | Rationale |
|---|---|
| Content in `storage-s3`, never inline | `agent_spans.attributes` is plaintext jsonb capped at 4000 chars (`capSummary` in `traceIngestionService.ts`) and is not in `encryption.ts`. Encrypting `attributes` would force every span reader (`api/runs/[id]`, `flowLoader`, `executeApprovedProposal`) onto `findWithDecryption` and break existing plaintext rows. |
| Manifest as a `system` span, not a column | Squash-only migrations (see Migration). A span is append-only, tenant-scoped, already returned by `GET /runs/:id`, already exportable by the OTel spec, and needs no reader changes to be stored. |
| Capture via an observer hook in `runAiAgentObject`, not by wrapping the model | The prompt is composed inside ai-assistant; AI SDK 7.0.83 exposes `onLanguageModelCallStart` (`ModelInfo` + `tools` as prepared + `StandardizedPrompt` + `LanguageModelCallOptions`) and `onLanguageModelCallEnd` (`finishReason`, `usage`, `content`, `responseId`, `providerMetadata`, `performance.responseTimeMs`) on `generateText` (verified in `node_modules/ai/dist/index.d.ts`). That is the request *as sent* after `prepareStep`, not a reconstruction. A `wrapLanguageModel` middleware would see the same data but would have to be threaded through the model factory for every call site. |
| Cost in micros on the span, cents on the run | `computeCostMinor` rounds to minor units; per-step values need `computeCostMicros` (additive). The run total stays `cost_minor` (unchanged contract). |
| `knowledgeVersions` via a shared, no-op-by-default collector | Tools live in OSS modules that must not import enterprise code. A 30-line AsyncLocalStorage collector in `@open-mercato/shared` lets any tool report `reportKnowledgeVersion('<key>', '<version>')`; AO binds it per run. |
| New ACL feature for content | `trace.view` → `employee` by default (per the comment in `redactToolSummary.ts`). Content visibility is a separate, narrower grant. |

### Alternatives Considered

| Alternative | Why rejected |
|---|---|
| Re-squash the AO migration to add `agent_runs.invoker_user_id`, `definition_hash`, `capture_level`, and an `agent_llm_calls` table | Every existing AO database would have to drop and re-initialise the module's tables (the 2026-09-06 squash says so explicitly). Deferred to the next planned re-squash (Q4). |
| A separate module (own migrations) holding an `agent_llm_calls` table | Valid escape hatch for squash-only, but splits one trace across two modules and two ACL sets for data that is span-shaped anyway. Kept as the fallback if jsonb query performance proves insufficient. |
| AI SDK `experimental_telemetry` with a custom `Telemetry` integration | Same data, but the integration is global/per-call and couples capture to telemetry enablement; the telemetry spec (`.ai/specs/2026-04-29-telemetry-and-otel.md` S6) mandates `recordInputs/recordOutputs: false` for that channel. Capture belongs to the run, not to telemetry. |
| Storing content inline in `agent_tool_calls` (encrypted jsonb) as pseudo tool calls | Pollutes tool-call lists, flow nodes and eval scorers that count tool calls. |

## User Stories / Use Cases

- **Compliance reviewer** wants to **open one run and see the exact system prompt, retrieved rules, tool schemas and model parameters that produced a verdict, with the rule-set and prompt versions** so that **a decision can be defended or reproduced**.
- **Agent engineer** wants to **diff the request of a failing run against a passing re-run** so that **a prompt-override or tool-schema change is identified as the cause**.
- **Tenant admin** wants to **switch content capture to `full` for one agent for 7 days** so that **an incident can be debugged without capturing every agent's prompts**.
- **Auditor** wants to **list the runs a given user or API key caused, and the writes each run made** so that **accountability is traceable end to end**.
- **Platform operator** wants **eval runs captured in full while production stays on metadata** so that **regression analysis has full prompts without storing customer PII**.

## Architecture

```
caller (playground / INVOKE_AGENT / headless API / eval replay / delegate_agent)
  │  AgentRunCtx { …, invoker?, entryPoint? }            (identity-binding spec)
  ▼
NativeAgentRunner.run ──createRun──► agent_runs (agent_version stamped)
  │  withRunContext(runId) + bindRunObservation(collector)   (shared ALS, additive)
  │  observer = buildStepObserver(policy, runId)
  ▼
runAiAgentObject({ …, observe, callSettings, trace:{persist:false} })   (ai-assistant, chat-tracing spec §6)
  ├─ onPromptResolved({ systemPrompt, promptOverride:{id,version}|null, agentId, provider, modelId, toolNames })
  ├─ generateText({ …, onLanguageModelCallStart, onLanguageModelCallEnd })  → observe.onModelCall{Start,End}
  └─ tools ──► reportKnowledgeVersion / reportRetrieval (shared collector, no-op when unbound)
  ▼
captureNativeRunTrace (post-run, awaited — unchanged ordering vs disposition)
  ├─ llm spans: gen_ai.* + om.* attributes; content → putArtifact(agent-trace-content) when level=full
  ├─ tool spans: + om.knowledge / om.retrieval
  └─ run.manifest system span: versions, identity, policy, platform trace carrier
  ▼
GET /runs/:id (unchanged shape, more attributes) · GET /runs/:id/artifact?kind=llm_request|llm_response|context_payload
  ▼
traces/[id]: Request/Response panels · Diff · Copy as JSON · Versions & Identity card
```

### ai-assistant observer contract (OSS, additive — canonical definition in the chat-tracing spec §6)

The block below is a **reference copy** of the canonical contract in [`../../2026-10-21-chat-run-tracing-and-citations.md`](../../2026-10-21-chat-run-tracing-and-citations.md) §6 (file `lib/agent-call-contract.ts`); if the two ever differ, §6 wins. The settings field is named `callSettings` (type `AiAgentCallSettings`), the same name as the call-time input.

```ts
// packages/ai-assistant/src/modules/ai_assistant/lib/agent-call-contract.ts (canonical: chat-tracing spec §6)
export type AiAgentCallObserver = {
  onPromptResolved?(event: {
    agentId: string
    systemPrompt: string
    promptOverride: { id: string; version: number } | null
    pageContextHydrated: boolean
    attachmentCount: number
    provider: string | null
    modelId: string | null
  }): void | Promise<void>
  onModelCallStart?(event: {
    callId: string; stepNumber: number; provider: string; modelId: string
    system: string | undefined; messages: unknown[]; tools: ReadonlyArray<Record<string, unknown>> | undefined
    responseFormat: unknown | undefined
    callSettings: AiAgentCallSettings   // { temperature?, topP?, topK?, maxOutputTokens?, seed?, stopSequences?,
                                        //   presencePenalty?, frequencyPenalty?, providerOptions? } as sent
    startedAtMs: number
  }): void | Promise<void>
  onModelCallEnd?(event: {
    callId: string; finishReason: string; responseId: string | null; responseModelId: string | null
    usage: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; reasoningTokens?: number }
    content: unknown[]; providerMetadata?: Record<string, unknown>; responseTimeMs: number; endedAtMs: number
  }): void | Promise<void>
}
// RunAiAgentObjectInput gains: observe?: AiAgentCallObserver, callSettings?: AiAgentCallSettings,
//                              trace?: { persist?, channel?, correlationId? }   (all optional, chat-tracing spec §6)
```

- The native runner passes `callSettings` = the eval-run override (eval spec) merged over the agent's `modelSettings` (AO `defineAgent` forwards `modelSettings` to `defineAiAgent`), so what is declared, what is sent and what is recorded use one name and one type.

- Wired on all object-mode branches: the tool-loop `generateText`, the plain `generateObject`, `streamObject`, and the caller-supplied `input.generateObject` callback (the last three get `onModelCallStart` synthesized from `system`/`messages`/`schema` when the call-level hooks are not exposed; `stepNumber = 0`, `om.capture.fidelity = "reconstructed"` for the callback branch, whose actual call AO cannot see).
- Override metadata comes from `resolveSystemPromptWithOverrideMeta` (internal, `{ prompt, override }`, introduced by the OSS chat spec); the exported string-returning `composeSystemPrompt` keeps its signature (BC category 3).
- `RunAiAgentObjectInput.trace` is defined by the chat spec §6; the AO native runner passes `trace: { persist: false }` so the OSS recorder does not write a second run record for an AO run (AO persists its own).
- Observer callbacks run inside try/catch: a throwing observer is logged and ignored (same as `onStepFinish` handling in `buildLoopTraceCollector`). The observer never sees or alters the security-critical `prepareStep` result.
- The callback is invoked **after** `prepareStep` merges, so `tools` is the exposed set for that step (read-only agents already have mutation tools stripped).

### Run observation collector (shared, additive)

```ts
// packages/shared/src/lib/ai/run-observation.ts (NEW)
export function bindRunObservation<T>(collector: RunObservationCollector, fn: () => T): T
export function reportKnowledgeVersion(key: string, version: string, meta?: { label?: string }): void  // no-op when unbound
export function reportRetrieval(entry: { source: string; queryHash: string; k: number; hits: Array<{ ref: string; score?: number; version?: string }> }): void
```

- Keys are namespaced `<module>.<thing>` (e.g. `rules.rule_set`, `knowledge.article_set`); last write per key wins within a run; max 50 keys, 200 hits per retrieval (excess dropped with a counter).
- **OpenCode/MCP path:** tools execute in the `mcp:serve-http` process where the run ALS is empty (module AGENTS.md "Run correlation"). The MCP tool wrapper binds the collector by resolving the run from `agentRunSessionStore` via the `_sessionToken`, and flushes reports into the run's capture buffer (the same buffer that `CapturedToolCall`s use).

### Run manifest

`run.manifest` span `attributes` (all values strings/numbers/booleans/arrays of ids; total ≤ 4000 chars so `capSummary` never truncates — enforced by the builder):

```json
{
  "om.manifest.version": 1,
  "om.runtime": "native",
  "om.agent.id": "deals.health_check",
  "om.agent.definition_hash": "sha256:3f0c…(64 hex)",
  "om.agent.source": "code|file|ui",
  "om.prompt.override": { "id": "uuid", "version": 4 },
  "om.prompt.system.sha256": "…",
  "om.skills": [{ "id": "stage_playbook", "sha256": "…" }],
  "om.tools.sha256": "…", "om.tools.names": ["customers.get_deal", "…"],
  "om.model.declared": "claude-sonnet-4-5", "om.model.resolved": "claude-sonnet-4-5", "om.provider": "anthropic",
  "om.knowledge": { "rules.rule_set": "2026-10-20.3" },
  "om.invoker": { "kind": "user|api_key|workflow|agent_token|integration", "userId": "uuid|null", "apiKeyId": "uuid|null", "ownerUserId": "uuid|null" },
  "om.entry_point": "run_api|rerun|delegate|workflow|eval|ai_assistant|tool|agent_api",
  "om.channel": "chat|playground|run-object|mcp|tools-api|internal (only when entry_point is ai_assistant|tool)",
  "om.correlation_id": "string|null",
  "om.principal": { "agentPrincipalId": "uuid|null", "agentUserId": "uuid|null", "onBehalfOfUserId": "uuid|null" },
  "om.integrity.raw_output_key": "artifact key|absent (integrity spec; only when the final output differs from the model's)",
  "om.capture": { "level": "metadata", "source": "agent|tenant|deployment", "retentionDays": 30, "redactPii": false },
  "om.platform_trace": { "traceparent": "00-…" }
}
```

- `definition_hash`: sha256 over a canonical JSON of the registry entry's behavior-relevant fields — code agents: the ai-assistant `agent_definition_hash` of the underlying `defineAiAgent` (defined by the OSS chat spec: `{ systemPrompt, allowedTools (sorted), executionMode, output.schemaName, mutationPolicy, defaultProvider, defaultModel, loop }`) combined with the AO-only fields `{ resultKind, outcome JSON-Schema, agentType }`; file agents: the `sourceFiles[].{path,content}` already embedded in `generated/file-agents.generated.ts` where `inContext: true`. For file agents the hash is computed at `yarn generate` and emitted into the manifest (additive field `definitionHash` on each generated entry — BC category 14, additive).
- `agent_runs.agent_version` is stamped at `createRun` with `sha256:<first 16 hex>` when no explicit version exists. When `AgentDefinitionVersion` ships (`next/2026-06-19-agent-deployment-and-regression-gating.md`), its published version number takes precedence and the hash stays in the manifest.
- `om.platform_trace.traceparent` is `captureTelemetryTrace()` (`@open-mercato/shared/lib/telemetry/runtime`) at run start, so the OTel export can link the agent trace to the live request/worker trace. Absent when telemetry is off.
- The builder lives in `lib/trace/runManifest.ts` and is shared: the identity spec writes `om.invoker` / `om.entry_point` / `om.channel` / `om.correlation_id` through it, the integrity spec writes `om.integrity.raw_output_key`. Whichever spec lands first creates it. The manifest is the AO home for run-level facts under the shared migration policy (see Migration).
- Under a bound principal (`runAs`), the manifest insert is one of the AO append-only writes the identity spec's Phase 0 runtime-audit scope must admit (`AgentSpan` is on its allowlist); content artifacts are storage writes and unaffected.
- The manifest is written in the same post-run `ingestTrace` batch as the step spans, so the disposition trace-completeness gate (`dispositionService.ts`, `spanCount > 0`) is unaffected in timing; the gate is additionally tightened to count only `kind IN ('llm','tool')` so a manifest alone can never make a run look traced.

### LLM span attributes (per step)

| Key | Source | Level |
|---|---|---|
| `inputTokens`, `outputTokens`, `finishReason` (legacy keys, kept) | as today | all |
| `gen_ai.operation.name` = `chat` | constant | metadata |
| `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.response.id` | `onModelCallStart/End` | metadata |
| `gen_ai.request.temperature` / `.top_p` / `.top_k` / `.max_tokens` / `.seed` / `.stop_sequences` / `.presence_penalty` / `.frequency_penalty` | `callSettings` (absent key ⇒ provider default; `om.params.defaults = true` when all absent) | metadata |
| `gen_ai.usage.input_tokens` / `.output_tokens` / `.cache_read.input_tokens` / `.reasoning.output_tokens` | `usage` | metadata |
| `gen_ai.response.finish_reasons` | `finishReason` | metadata |
| `om.latency.ms` | `responseTimeMs` | metadata |
| `om.cost.micros`, `om.cost.currency`, `om.cost.pricing_source` (`default|env_override|unknown`) | `computeCostMicros(responseModel ?? requestModel, …)` | metadata |
| `om.prompt.system.sha256`, `om.tools.sha256`, `om.tools.count`, `om.messages.count` | hashes over the canonical JSON | metadata |
| `om.content.request.key` / `.sha256` / `.bytes`, `om.content.response.key` / `.sha256` / `.bytes`, `om.content.status` (`stored|storage_unavailable|disabled|over_cap_truncated`), `om.content.redactions` | artifact offload | full |
| `om.capture.fidelity` (`exact|reconstructed|reported`) | runtime | all |

Request artifact shape (`llm_request.v1`): `{ schema: 'om.llm_request.v1', provider, modelId, system, messages, tools: [{ name, description, inputSchema }], responseFormat, params, providerBody? }`. Response artifact (`llm_response.v1`): `{ schema, finishReason, content, object?, usage, providerMetadata? }`.

### Runtime parity

| Runtime | Fidelity | How |
|---|---|---|
| Native (`nativeAgentRunner.ts`) | `exact` | Observer hook as above; `recordStep` merges the observer's per-call record by order (one `onModelCallEnd` per step). |
| OpenCode (`openCodeAgentRunner.ts`) | `reconstructed` for the prompt, `reported` for usage | AO knows the rendered agent (manifest `sourceFiles`), the skills, and the exact message it sent (`buildMessage`, session token redacted). OpenCode composes its own system prompt around AGENT.md, so the true provider request is not observable. Per assistant message, the OpenCode session API reports `modelID`, `providerID`, `tokens` and `cost` — **ASSUMPTION to verify against the pinned `OPENCODE_VERSION`** in Phase 0; if present, the runner emits one `llm` span per assistant message with `om.capture.fidelity = "reported"`. |
| External (`POST /trace/ingest`) | whatever the adapter sends | Additive optional fields on `traceSpanIngestSchema`: `llm?: { provider?, requestModel?, responseModel?, params?, usage?, request?, response? }` and on `traceIngestSchema`: `manifest?: { …same keys minus identity… }`. `request`/`response` are offloaded per the tenant's capture level (dropped when not `full`). Identity for ingested runs is the HMAC-verified integration, recorded as `om.invoker.kind = "integration"`. Adapters MAY send `gen_ai.*` attributes directly in `attributes`; the shared mapping module (`lib/trace/genAiAttributes.ts`, also used by the OTel spec) normalizes them. |
| Chat / copilot (ai-assistant) | — | Out of scope here; `.ai/specs/2026-10-21-chat-run-tracing-and-citations.md` owns persistence of chat runs and MUST reuse `AiAgentCallObserver` and the capture policy semantics of this spec. |
| Eval replays (`source = 'eval'`) | same as runtime | Same runners; `evalLevel` policy. |
| Nested sub-agents (`delegate_agent`) | same | Each child run gets its own manifest; `parentRunId` already links them. |

### Identity and audit links (recorded here, owned by the identity-binding spec)

- **Owner:** `2026-10-21-agent-invocation-access-and-identity-binding.md` adds `AgentRunCtx.invoker?: AgentInvoker` (`user | api_key | workflow | agent_token`), `AgentRunCtx.entryPoint?: AgentEntryPoint`, central `runAs` resolution, and `CommandRuntimeContext.auditCorrelation` persisted as `action_logs.context_json.correlation.agentRunId` with `GET /runs/:id/actions` + an "Actions" card. This spec does not redefine any of that (Q7).
- **This spec records**, at run start, the resolved `ctx.invoker`, `ctx.entryPoint`, `ctx.channel`, `ctx.correlationId` and `ctx.runAs` (already threaded to `CommandRuntimeContext.runAs` by `buildCommandContext`) into the manifest keys `om.invoker`, `om.entry_point`, `om.principal`. Before the identity spec lands, `om.invoker` is derived from `ctx.userId` as `{ kind: 'user', userId }` (the same BC rule that spec uses) and `om.entry_point` is omitted. Ingested external runs record `{ kind: 'integration' }` (HMAC-verified caller; an AO-local value, not part of `AgentInvoker`).
- The Versions & Identity card links to that spec's "Actions" card / `GET /runs/:id/actions`; proposal dispositions are already linked (`agent_proposals.run_id`, `disposition_by`).

## Data Models

No new entities, no new columns. Changes are to **jsonb shapes** (Zod-validated) and to **module config**:

### `TraceCapturePolicy` (module config `agent_orchestrator/trace_capture_policy`, per tenant)
```ts
const traceCapturePolicySchema = z.object({
  level: z.enum(['off', 'metadata', 'full']).default('metadata'),
  evalLevel: z.enum(['off', 'metadata', 'full']).optional(),
  perAgent: z.record(z.string().max(100), z.object({
    level: z.enum(['off', 'metadata', 'full']),
    until: z.string().datetime().optional(),        // time-boxed override, e.g. incident debugging
  })).max(200).default({}),
  retentionDays: z.number().int().min(1).max(3650).default(30),
  redactPii: z.boolean().default(false),
  includeProviderBody: z.boolean().default(false),
})
```
Malformed/unreadable → fall back to the deployment default (`metadata`), never to a looser level (same rule as `resolveTenantAutoApprovalPolicy`).

### Additive Zod changes (`data/validators.ts`)
- `traceSpanIngestSchema`: `llm?: traceLlmIngestSchema` (optional).
- `traceIngestSchema`: `manifest?: traceManifestIngestSchema` (optional).
- `contextBundleRoutedSourcesSchema` items: `retrieval?: { queryHash: string; rank: number; k: number }` (optional).

### Encryption
No new `encryption.ts` entries: artifacts reuse `agent_orchestrator:agent_run` `input`/`output` maps (precedent: `ARTIFACT_REFS.runOutput`, `artifactFileStore` reusing `agent_run_artifact.caption`). `__tests__/encryption-map-entity-ids.test.ts` stays green because no map is added or renamed.

## API Contracts

All under `/api/agent_orchestrator`, all additive.

### `GET /runs/:id` (existing)
- Unchanged envelope `{ run, spans, toolCalls, … }`; spans carry the new attributes; adds `manifest` (the parsed `run.manifest` span attributes or `null`). Write correlation (`/runs/:id/actions`) is the identity-binding spec's route.
- Content is never inlined: only keys/hashes/sizes.

### `GET /runs/:id/artifact` (existing, extended)
- `kind` enum gains `llm_request | llm_response | context_payload`.
- Key ownership check extended: for `llm_*` the key MUST equal `om.content.{request|response}.key` on a span of this run; for `context_payload` it MUST equal `payload_ref` of a bundle of this run.
- **Auth:** `output|tool_request|tool_response` keep `trace.view`; the three new kinds require `agent_orchestrator.trace.view_content` (checked in-handler since `metadata` is per method). The integrity spec adds a fourth kind, `raw_output` (the model's object before integrity repair), gated by `trace.view` like `output` because it is the same data class.
- Responses: `200 { key, kind, payload }`, `404` (not this run's key), `410` (expired by retention), `502` (storage unavailable), `422`.
- Every successful content read writes an `access_logs` entry (`resourceKind = 'agent_orchestrator.agent_run.content'`, `resourceId = runId`) — reading a full prompt is itself auditable.

### `GET /runs/:id/compare?with=<otherRunId>&step=<n>` (NEW)
- Feature: `trace.view` for metadata diff; `trace.view_content` to include content diff.
- Response: `{ left: StepSummary, right: StepSummary, diff: { manifest: FieldDiff[], params: FieldDiff[], systemPrompt?: TextDiff, messages?: JsonDiff, tools?: JsonDiff } }` computed server-side (decrypting both artifacts in their own run scope; both runs MUST be in the caller's tenant+org).
- `openApi` exported.

### `GET|PUT /trace-capture/settings` (NEW)
- `GET` requires `agent_orchestrator.trace.view`; `PUT` requires `agent_orchestrator.agents.manage` + `agent_orchestrator.trace.view_content`.
- Body = `traceCapturePolicySchema`; response `{ policy, source: 'tenant' | 'default', deploymentCeiling }`.
- Writes go through a command `agent_orchestrator.traceCapturePolicy.update` (undoable: snapshot before/after, so a widening to `full` is in the audit log and reversible).

### `POST /trace/ingest` (existing)
- Additive optional `manifest` and per-span `llm` fields (above). HMAC contract unchanged.

## Internationalization (i18n)

New keys under `agent_orchestrator.trace.*`: `request`, `response`, `systemPrompt`, `messages`, `toolDefinitions`, `responseFormat`, `parameters`, `providerDefault`, `costPerStep`, `contentExpired`, `contentStorageUnavailable`, `contentNotCaptured`, `contentTruncated`, `copyAsJson`, `compareWith`, `versionsIdentity`, `definitionHash`, `promptOverrideVersion`, `knowledgeVersions`, `invoker`, `onBehalfOf`, `fidelity.exact|reconstructed|reported`; settings page `agent_orchestrator.settings.traceCapture.*`. All locales in the module's `i18n/` get entries (English copy + translations per `yarn i18n:check-values`).

## UI/UX

- **Trace page (`backend/traces/[id]/page.tsx`)**: each `llm` span row expands into a `Tabs` block — **Request** (System prompt in a monospace read-only block; Messages as role-labelled blocks; Tool definitions as a collapsible list with JSON schema; Response format; Parameters table where absent values render "provider default"), **Response** (content parts, structured object, finish reason, usage, cost). Content tabs lazy-load via `apiCall` to the artifact route and render `LoadingMessage`/`ErrorMessage`; status tokens via `StatusBadge` for `expired`/`not captured`/`storage unavailable`. Without `trace.view_content` the tabs show hashes and sizes plus an `Alert` explaining the missing permission.
- **Copy as JSON**: icon button (`aria-label`) per panel and per run ("whole run, metadata only" / "with content" when permitted) using the clipboard write API.
- **Diff**: "Compare with…" action on the run header (defaults to `rerun_of_run_id` or the previous run of the same agent and subject) opens a side-by-side diff dialog (`Cmd/Ctrl+Enter` = recompute, `Escape` = close); per-step alignment by step number.
- **Versions & Identity card**: definition hash (copyable), prompt-override version (links to ai-assistant override history), skills, tool-set hash, knowledge versions, invoker, principal/on-behalf-of, capture level + source, audit link.
- **Settings → Trace capture** (`backend/settings/trace-capture/`, sibling of `auto-approval`): `CrudForm` over the policy with optimistic locking via the module-config record's `updatedAt`.
- `ProcessFlowTrace` and `AgentTimeline` are unchanged except a small "full prompt captured" indicator on agent-run nodes (summaries stay redacted by construction, per module AGENTS.md).
- DS rules: semantic status tokens only, no arbitrary sizes, lucide icons, shared primitives.

### Frontend Architecture Contract (summary)
- Server/Client boundary: the trace page is already a client page (`"use client"`); new panels are client components under `components/trace/` lazy-loaded with `next/dynamic` so the diff library is not in the initial chunk.
- `"use client"` ledger: `LlmStepPanels.tsx` (tabs + lazy fetch), `RunCompareDialog.tsx` (dialog state), `TraceCaptureSettingsForm.tsx` (CrudForm). Each needs interactivity; no new providers.
- Client blob guardrail: content is fetched per panel on expand; never embedded in the page payload; panels virtualize message lists over 200 entries.
- Budget: trace page initial JS +≤ 15 KB gzip; diff dialog chunk ≤ 40 KB gzip (reuse an existing diff util if `packages/ui` has one; otherwise a minimal line diff, no new dependency without approval).
- Tests: hydration test for the trace page with and without `trace.view_content`.

## Configuration

| Env | Default | Meaning |
|---|---|---|
| `OM_AGENT_TRACE_CAPTURE` | `on` | Existing global kill switch for span capture (unchanged). |
| `OM_AGENT_TRACE_CONTENT_DEFAULT` | `metadata` | Deployment default level. |
| `OM_AGENT_TRACE_CONTENT_MAX` | `full` | Deployment ceiling (`metadata` forbids content capture). |
| `OM_AGENT_TRACE_CONTENT_MAX_BYTES` | `1048576` | Per-artifact cap. |
| `OM_AGENT_MODEL_PRICING` | — | Existing; now also feeds per-step cost. |

All new env vars mirrored into `apps/mercato/.env.example` and the create-app template (`yarn template:sync:fix`).

## Migration & Backward Compatibility

### Verified constraint: AO migrations are squash-only
- `packages/enterprise/src/modules/agent_orchestrator/__tests__/helpers/squashMigration.ts#readSquashMigrationSql` throws unless **exactly one** `Migration<ts>_agent_orchestrator.ts` exists; tests resolve the schema through it.
- The current file `migrations/Migration20260906141535_agent_orchestrator.ts` states: "a database that already ran the retired chain must drop and re-initialise this module's tables". MikroORM records migrations by name, so a re-squash with a new name re-runs `create table` on an existing database and fails.
- `migrations/adopt-squash.mjs` targets the **previous** squash (`Migration20260811150000_agent_orchestrator`) and does not adopt the current one — it is stale and is not a migration path for this change.
- Therefore this spec adds **no DDL**. Fields that would benefit from columns (`invoker_user_id`, `api_key_id`, `definition_hash`, `capture_level`) are recorded as "promote at next planned re-squash" in the module's AGENTS.md debt list; at that re-squash a one-off backfill reads them from `run.manifest` spans.
- **Shared policy (all 2026-10-21 AO specs state the same rule):** no AO DDL until the next planned re-squash; run-level facts go into the `run.manifest` span, content into the encrypted artifact offload, the rest into existing jsonb columns. The single consolidated "next re-squash" list (this spec's columns plus the identity spec's `entry_point` / `correlation_id`, the integrity spec's `raw_output_key`, the OTel spec's `agent_trace_exports` ledger and the eval spec's `agent_eval_set_snapshots` table) lives in the roadmap [`../../2026-10-21-agent-platform-capabilities-roadmap.md`](../../2026-10-21-agent-platform-capabilities-roadmap.md).

### Contract surfaces touched (all additive)
| Surface (BACKWARD_COMPATIBILITY.md) | Change | Class |
|---|---|---|
| 2. Types | `RunAiAgentObjectInput.observe?` / `callSettings?` / `trace?`, `AiAgentCallObserver`, `AiAgentCallSettings` (all defined by the chat-tracing spec §6), optional Zod fields (`AgentRunCtx.invoker?` / `entryPoint?` / `channel?` / `correlationId?` come from the identity-binding spec) | Additive |
| 3. Signatures | `composeSystemPrompt` keeps its string-returning signature; internal `resolveSystemPromptWithOverrideMeta` (chat spec) | Unchanged |
| 4. Import paths | New: `@open-mercato/shared/lib/ai/run-observation`; the observer types are exported from `@open-mercato/ai-assistant` (chat-tracing spec §6, file `lib/agent-call-contract.ts`) | Additive |
| 7. API routes | New `GET /runs/:id/compare`, `GET|PUT /trace-capture/settings`; new `kind` values on the artifact route | Additive |
| 8. DB schema | None | — |
| 10. ACL features | New `agent_orchestrator.trace.view_content` (+ `setup.ts` `defaultRoleFeatures` for admin/superadmin) | Additive |
| 14. Generated files | `definitionHash` added to each entry of `generated/file-agents.generated.ts` | Additive |
| Behavior | Trace-completeness gate counts `llm|tool` spans only | Tightening; no existing run had a manifest span, so no proposal changes outcome |

Existing runs have no manifest and no step metadata; the UI renders "not recorded (run predates capture)". No backfill.

## Implementation Plan

### Phase 0: Verification spikes (≤ 1 day)
1. Confirm AI SDK 7.0.83 `generateText` fires `onLanguageModelCallStart/End` per step in the tool loop with `prepareStep` applied (unit test with a mock model).
2. Confirm OpenCode session message API exposes per-message `tokens`/`cost`/`modelID` at the pinned version; record the finding in the spec changelog.
3. Confirm `storage-s3` `list`/`delete` availability on the DI-resolved storage service for the retention worker.

### Phase 1: Run manifest, identity, versions (no content)
1. `@open-mercato/shared/lib/ai/run-observation.ts` collector + unit tests.
2. Read `ctx.invoker` / `ctx.entryPoint` / `ctx.runAs` when present (identity-binding spec), else derive `{ kind: 'user', userId: ctx.userId }`.
3. Definition hashing (`lib/trace/definitionHash.ts`) for code agents; generator emits `definitionHash` for file agents; `createRun` stamps `agent_version`.
4. ai-assistant: `observe.onPromptResolved` fed by `resolveSystemPromptWithOverrideMeta` (reuse from the chat spec if landed, else add it); AO runner passes `trace: { persist: false }`.
5. `run.manifest` span built by the shared `lib/trace/runManifest.ts` (reuse if the identity spec created it) from `buildNativeTracePayload` and `ingestSessionTrace`, incl. `om.channel` / `om.correlation_id`; trace-completeness gate tightened.
6. Link the Versions & Identity card to the identity-binding spec's `GET /runs/:id/actions` when that route exists (feature-detected; hidden otherwise).
7. Versions & Identity card on the trace page.
8. Tests: unit (hash stability, manifest size cap, invoker fallback), integration `TC-AGENT-TRACE-004` (run via `POST /agents/:id/run` → manifest has definition hash, prompt-override version from a fixture override, and an invoker; trace-completeness gate still requires an `llm`/`tool` span).

### Phase 2: Per-step metadata, params and cost
1. ai-assistant `observe.onModelCallStart/End` on all object-mode branches, exactly as specified in the chat-tracing spec §6 (reuse if already landed); native runner forwards `callSettings` (eval override over `modelSettings`).
2. Native runner merges observer records into `NativeStepRecord`; `buildNativeTracePayload` writes `gen_ai.*`/`om.*` keys (legacy keys kept).
3. `computeCostMicros` in `modelPricing.ts`; run total unchanged.
4. `lib/trace/genAiAttributes.ts` (shared key constants + ingest normalization).
5. Capture policy: schema, resolver (`lib/trace/capturePolicy.ts`), settings API + command + page.
6. Parameters + cost per step in the trace UI.
7. Tests: unit (param defaults recorded, micros rounding, policy resolution precedence and ceiling), integration `TC-AGENT-TRACE-005` (scripted provider run → spans carry params/usage/cost; settings round-trip with optimistic lock).

### Phase 3: Content capture (`full`), context payload, retention
1. `redactSecretStrings` + optional PII pass; size capping; `llm_request.v1`/`llm_response.v1` builders.
2. `ARTIFACT_REFS.llmRequest/llmResponse/contextPayload`; namespace `agent-trace-content`; offload in `captureNativeRunTrace`.
3. `contextResolver.assemble` offloads the packed payload (routed records + untrusted span text + retrieval queries) when level = `full` and sets `payloadRef`; per-retrieval summary fields in `routed_sources`.
4. Artifact route new kinds + `trace.view_content` + access log + `410` on expiry.
5. Retention worker + scheduler entry.
6. Tests: unit (redaction of session token line, cap/truncation markers, file-part replacement), integration `TC-AGENT-TRACE-006` (level `full` → request artifact decrypts to the exact system prompt incl. a prompt override; user without `view_content` gets 403; after forced expiry → 410).

### Phase 4: UI depth, OpenCode and ingest parity
1. Request/Response tabs, Copy as JSON, Compare dialog + `GET /runs/:id/compare`.
2. OpenCode per-message `llm` spans (if Phase 0 confirms) with `fidelity = reported`; reconstructed request artifact.
3. Ingest schema `llm`/`manifest` fields + offload.
4. Tool-side `reportKnowledgeVersion`/`reportRetrieval` through the MCP session-store binding.
5. Tests: integration `TC-AGENT-TRACE-007` (compare two runs after changing a prompt override → diff shows the changed section), Playwright UI path for the trace tabs.

### File Manifest
| File | Action | Purpose |
|---|---|---|
| `packages/shared/src/lib/ai/run-observation.ts` | Create | Knowledge/retrieval collector |
| `packages/ai-assistant/src/modules/ai_assistant/lib/agent-call-contract.ts` | Create (or reuse) | Observer + call-settings contract (canonical: chat-tracing spec §6) |
| `…/agent_orchestrator/lib/trace/runManifest.ts` | Create (or reuse) | Shared manifest builder (identity + integrity keys too) |
| `packages/ai-assistant/src/modules/ai_assistant/lib/agent-runtime.ts` | Modify | Wire `observe` (shares `resolveSystemPromptWithOverrideMeta` with the chat spec) |
| `…/agent_orchestrator/lib/runtime/nativeAgentRunner.ts` | Modify | Observer, manifest inputs, `trace: { persist: false }` |
| `…/agent_orchestrator/lib/runtime/nativeTraceCapture.ts` | Modify | Attributes, content offload, manifest span |
| `…/agent_orchestrator/lib/runtime/openCodeAgentRunner.ts` | Modify | Manifest, redaction, reported llm spans |
| `…/agent_orchestrator/lib/runtime/modelPricing.ts` | Modify | `computeCostMicros` |
| `…/agent_orchestrator/lib/trace/{capturePolicy,definitionHash,genAiAttributes,contentCapture,redactStrings}.ts` | Create | Policy, hashing, keys, artifact builders, string redaction |
| `…/agent_orchestrator/lib/trace/artifactStore.ts` | Modify | New refs + namespace parameter |
| `…/agent_orchestrator/lib/trace/traceIngestionService.ts` | Modify | `llm`/`manifest` ingest fields |
| `…/agent_orchestrator/lib/context/contextResolver.ts` | Modify | Offload payload, set `payloadRef` |
| `…/agent_orchestrator/lib/disposition/dispositionService.ts` | Modify | Count `llm|tool` spans |
| `…/agent_orchestrator/api/runs/[id]/{route,artifact/route,compare/route}.ts` | Modify/Create | Manifest, content kinds, compare |
| `…/agent_orchestrator/api/trace-capture/settings/route.ts` | Create | Policy API |
| `…/agent_orchestrator/commands/traceCapture.ts` | Create | Undoable policy update |
| `…/agent_orchestrator/workers/trace-content-retention.ts` | Create | Retention |
| `…/agent_orchestrator/acl.ts`, `setup.ts` | Modify | New feature + default grants |
| `…/agent_orchestrator/backend/traces/[id]/page.tsx`, `components/trace/*` | Modify/Create | UI |
| `…/agent_orchestrator/backend/settings/trace-capture/*` | Create | Settings page |

### Testing Strategy
- Unit (Jest): observer wiring with a mock `LanguageModel`; manifest builder size cap; hash canonicalization; policy precedence/ceiling/time-boxed override; redaction (keys, session-token line, Bearer, emails when `redactPii`); cost micros; artifact key ownership checks.
- Integration (Playwright, self-contained fixtures, `OM_AI_PROVIDER=scripted`): TC-AGENT-TRACE-004…007 as above. Each creates its own agent run via API, sets capture policy via API, and resets it in `finally`. Storage-dependent cases run against the `storage-s3` profile (localstack) and are skipped with an explicit reason when storage is not configured.
- Tenant isolation: org B cannot fetch org A content keys (404) or compare across orgs (404).

## Risks & Impact Review

### Data Integrity Failures
- Capture is post-run and best-effort (as today); a crash mid-capture leaves a run with partial spans. Content offload happens before span insert; an orphaned artifact (upload succeeded, span insert failed) is harmless and expires with retention.
- Re-ingest is idempotent on `(agentRunId, externalSpanId)`; the manifest's deterministic `externalSpanId` prevents duplicates.

### Cascading Failures & Side Effects
- Observer exceptions are swallowed in ai-assistant; artifact offload is fail-open (`putArtifact` returns null) → `om.content.status = storage_unavailable`. A run never fails because observability failed.

### Tenant & Data Isolation Risks
- Artifacts are written and read under the run's own `(tenantId, organizationId)` storage scope (existing `artifactStore` contract); the artifact route validates key ownership against the addressed run before reading.
- The policy record is tenant-scoped (`moduleConfigService` with `tenantId`).

### Migration & Deployment Risks
- No DDL. Deployable without downtime. Rolling back the code leaves extra jsonb keys and S3 objects that older code ignores.

### Operational Risks
- Storage growth: at `full`, ~5–50 KB per step compressed-equivalent JSON; bounded by retention. Metadata adds ~1 KB per span row (≤ 4000-char cap enforced).
- Latency: hashing + encryption + upload add work to post-run capture, which is awaited before `run()` returns (disposition reads spans). Mitigation: content uploads run concurrently (bounded `Promise.all`, 4 at a time) and are skipped at levels below `full`; measure p95 capture time in Phase 2 and move content upload to a queued job if it exceeds 300 ms (the manifest and metadata stay synchronous so the disposition gate is unaffected).

#### Full prompts expose PII to a wider audience than intended
- **Scenario**: a tenant enables `full`; prompts contain customer data; `employee` holds `trace.view`.
- **Severity**: High
- **Affected area**: trace UI, artifact route
- **Mitigation**: separate `trace.view_content` feature (admin only by default); content never inlined in `GET /runs/:id`; access-logged reads; encryption at rest; retention; deployment ceiling.
- **Residual risk**: admins see content by design; acceptable and auditable.

#### Session token or secret captured in a prompt
- **Scenario**: OpenCode message embeds `_sessionToken`; a tool result echoes an API key.
- **Severity**: High
- **Affected area**: content artifacts
- **Mitigation**: key-based + string-pattern redaction before encryption; unit tests pin the OpenCode authorization line.
- **Residual risk**: secrets with no recognizable key or pattern; mitigated by encryption + retention.

#### jsonb-only identity/version queries degrade at scale
- **Scenario**: "runs by API key X" scans `agent_spans` jsonb on millions of rows.
- **Severity**: Medium
- **Affected area**: audit queries, OTel export filters
- **Mitigation**: manifest span is one row per run with `name = 'run.manifest'`; queries filter by `(organization_id, name, created_at)` first; columns promoted at the next re-squash (Q4).
- **Residual risk**: slow ad-hoc queries until then; acceptable for audit use.

#### Observer hook drifts with AI SDK minor versions
- **Scenario**: `onLanguageModelCallStart` is renamed or reshaped (AI SDK marks some callbacks experimental).
- **Severity**: Medium
- **Affected area**: native capture
- **Mitigation**: the observer adapts AI SDK events in one place (`agent-runtime.ts`); a contract test with a mock model fails loudly on shape change; capture degrades to today's step data, never fails the run.
- **Residual risk**: one release with reduced metadata.

## Final Compliance Report — 2026-10-21

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/enterprise/src/modules/agent_orchestrator/AGENTS.md`
- `packages/telemetry/AGENTS.md` (redaction posture, import restrictions)
- `BACKWARD_COMPATIBILITY.md`
- `.ai/specs/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Only ids in manifest/attributes; action-log correlation owned by the identity-binding spec |
| root AGENTS.md | Filter by organization_id / never cross-tenant | Compliant | Artifact + compare routes scope by run tenant/org |
| root AGENTS.md | Encryption for sensitive data, `findWithDecryption` | Compliant | Content encrypted via tenant DEK; reuses declared maps |
| root AGENTS.md | Zod validation for inputs | Compliant | Policy, ingest additions, query params |
| root AGENTS.md | Optimistic locking on new user-editable entities | Compliant | Policy form uses module-config `updatedAt` |
| root AGENTS.md | No hard-coded user-facing strings | Compliant | i18n keys listed |
| root AGENTS.md | `apiCall`, `LoadingMessage`/`ErrorMessage`, DS tokens | Compliant | UI section |
| AO AGENTS.md | Migrations squash-only | Compliant | No DDL |
| AO AGENTS.md | Trace rows append-only | Compliant | Manifest is a new span; no span mutation |
| AO AGENTS.md | Runner MUST persist trace before returning | Compliant | Ordering preserved; gate tightened |
| AO AGENTS.md | Flow summaries redacted by construction | Compliant | Flow unchanged |
| telemetry AGENTS.md | Never emit prompts/PII to telemetry | Compliant | Content stays in OM storage; export governed by the OTel spec |
| BACKWARD_COMPATIBILITY.md | Additive-only contract changes | Compliant | See table |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | Policy schema = settings API body |
| API contracts match UI/UX section | Pass | Artifact kinds + compare drive panels/diff |
| Risks cover all write operations | Pass | Capture, offload, policy update, retention delete |
| Commands defined for all mutations | Pass | Policy update is a command; capture rides `trace.ingest`/native capture as today |
| Cache strategy covers all read APIs | Pass | Run detail cache invalidated by existing `invalidateAgentRunCache` after capture; policy read cached per tenant with tag invalidation on update |

### Non-Compliant Items
None.

### Verdict
- **Fully compliant**: Approved — ready for implementation after Open Questions Q1–Q6 are confirmed.

## Changelog
### 2026-10-21
- Initial specification. Verified code facts: no request/params capture (`nativeAgentRunner.ts`, `nativeTraceCapture.ts`); run-level cents-rounded cost only (`modelPricing.ts`); `payloadRef` always null (`contextResolver.ts`); `agent_version` only from ingest; prompt-override version lost in `composeSystemPrompt`; no caller identity on `agent_runs` and no action log from `runs.create`; squash-only migrations with a stale `adopt-squash.mjs`. Correction to an earlier assumption: the `agent_runs` row does **not** record the caller.
- Review 2026-10-21: fresh-context scope check returned SPLIT (three capabilities); Q1 reworded to match the phases. Aligned with sibling specs written in parallel: identity binding and action-log correlation are owned by `2026-10-21-agent-invocation-access-and-identity-binding.md` (Q7; its `agent_runs.entry_point` column conflicts with the squash-only rule); prompt-override metadata, `agent_definition_hash` and `trace: { persist: false }` reuse the OSS chat-tracing spec (Q2, Q8).
- 2026-10-21 — cross-spec consistency pass: the observer / call-settings contract is now canonical in the OSS chat-tracing spec §6 (this spec keeps a reference copy; observer field `params` renamed `callSettings`, file `lib/agent-call-contract.ts`); Q2 and Q7 marked resolved (identity spec now writes `om.entry_point` into this manifest instead of a column); manifest gains `om.channel`, `om.correlation_id`, `om.integrity.raw_output_key`; manifest builder `lib/trace/runManifest.ts` shared with the identity and integrity specs; shared AO migration policy stated and the consolidated next-re-squash list moved to the roadmap; Q8 divergence text mirrored in the chat spec; artifact route documents the integrity spec's `raw_output` kind (`trace.view`); settings command renamed `agent_orchestrator.traceCapturePolicy.update` (AO command ids are camelCase, e.g. `evalRuns.start`); linked all sibling specs and the roadmap.
