# Chat Run Tracing and Citations

> **Status:** Draft · **Date:** 2026-10-21 · **Packages:** `@open-mercato/ai-assistant` (module `ai_assistant`), `@open-mercato/ui` (`src/ai`) · **Touches (additive):** `@open-mercato/enterprise` `agent_orchestrator` (reuse of the shared extraction helper and citation registry; optional run mirroring)
> **Motivating use case:** a chat copilot must show where an answer came from (rule references) and leave the same kind of run record as the headless and MCP channels. This spec is generic.
> **Related specs:** [`implemented/2026-04-28-ai-agents-agentic-loop-controls.md`](implemented/2026-04-28-ai-agents-agentic-loop-controls.md) (introduced `LoopTrace` / `buildLoopTraceCollector`, explicitly "not persisted"), [`2026-05-05-ai-chat-server-side-conversation-storage.md`](2026-05-05-ai-chat-server-side-conversation-storage.md), [`implemented/2026-05-22-ai-chat-conversation-sharing.md`](implemented/2026-05-22-ai-chat-conversation-sharing.md), [`enterprise/agent-orchestrator/next/2026-06-19-agent-trace-eval-capture.md`](enterprise/agent-orchestrator/next/2026-06-19-agent-trace-eval-capture.md) (AO `agent_runs` / `agent_spans` / `agent_tool_calls`), [`enterprise/agent-orchestrator/2026-07-07-lightweight-agent-runtime.md`](enterprise/agent-orchestrator/2026-07-07-lightweight-agent-runtime.md) (AO native runner built on `runAiAgentObject`), [`enterprise/agent-orchestrator/2026-10-12-process-flow-trace-replay-and-embeddable-decision-card.md`](enterprise/agent-orchestrator/2026-10-12-process-flow-trace-replay-and-embeddable-decision-card.md) (AO `citationResolvers`), [`2026-10-12-knowledge-articles-module.md`](2026-10-12-knowledge-articles-module.md) (`kb` citations, `key@version`), companion [`2026-10-21-mcp-tool-exposure-parity-and-audit.md`](2026-10-21-mcp-tool-exposure-parity-and-audit.md). Sibling enterprise specs written in parallel: [`enterprise/agent-orchestrator/2026-10-21-agent-run-observability-full-fidelity.md`](enterprise/agent-orchestrator/2026-10-21-agent-run-observability-full-fidelity.md) (full prompt / tool definitions / params on AO traces) and [`enterprise/agent-orchestrator/2026-10-21-otel-genai-trace-export.md`](enterprise/agent-orchestrator/2026-10-21-otel-genai-trace-export.md) (OTLP export; `model_params` here uses OTel GenAI attribute names so it can map onto it), [`enterprise/agent-orchestrator/2026-10-21-eval-reports-and-reproducible-regression.md`](enterprise/agent-orchestrator/2026-10-21-eval-reports-and-reproducible-regression.md) (consumes `callSettings` / `modelSettings` from §6), [`enterprise/agent-orchestrator/2026-10-21-agent-invocation-access-and-identity-binding.md`](enterprise/agent-orchestrator/2026-10-21-agent-invocation-access-and-identity-binding.md) (AO implementation of the agent run dispatcher used by `run-object` / chat), [`enterprise/agent-orchestrator/2026-10-21-output-integrity-guardrails.md`](enterprise/agent-orchestrator/2026-10-21-output-integrity-guardrails.md) (AO citation/evidence verification). Umbrella and shared decisions: [`2026-10-21-agent-platform-capabilities-roadmap.md`](2026-10-21-agent-platform-capabilities-roadmap.md).

## TLDR

**Key Points:**
- The in-app chat records token usage and conversation messages, but **not the run**. The per-turn `LoopTrace` is streamed to the browser once (`loop-finish`) and lost on reload. Its tool-call fields are also empty under AI SDK 7, because `buildLoopTraceCollector` reads `args` / `result`, which no longer exist. Agents cannot show **sources** in chat, because no citations UI part exists.
- This spec fixes the collector once for both OSS and enterprise and persists every ai-assistant agent run (chat, run-object, MCP agent tools) in three small OSS tables. Each run records the agent id/version, the prompt-override version, the model and the parameters. A backend trace view is linked from the chat message. A generic citations UI part, with a shared resolver registry, works in `AiChat` and in the AO decision card.

**Scope:**
1. Shared AI SDK 7 step extraction helper in ai-assistant, used by `buildLoopTraceCollector` and by AO `nativeTraceCapture`.
2. OSS run persistence: `ai_agent_runs`, `ai_agent_run_steps`, `ai_agent_run_tool_calls` (encrypted content, retention worker), plus an `ai_assistant.agent_run.completed` event as the extension point.
3. Backend run list + run detail pages, linked from the chat message and the `LoopTracePanel`.
4. `ai_assistant:citations` UI part, `emitCitations(ctx, ...)` tool helper, and a citation resolver registry moved from AO to `@open-mercato/ui/ai` (AO keeps a re-export).
5. Run metadata: agent id, `version` + definition hash, prompt-override id/version, provider/model, loop parameters, call settings as sent, channel, correlation id.
6. The shared **model-call contract** of `runAiAgentText` / `runAiAgentObject` (§6, canonical here because it is OSS code): `AiAgentCallSettings`, call-time `callSettings`, definition-level `modelSettings`, the `observe` hook (`AiAgentCallObserver`) and the `trace` input (`persist`, `channel`, `correlationId`). The AO observability and eval specs consume it and do not redefine it.

**Concerns:**
- Persisting tool arguments/results and model text stores personal data. Mitigated by encryption maps, size caps, a capture-level switch and a 30-day default retention.
- AO native runs go through `runAiAgentObject`. Without an opt-out they would be recorded twice (OSS + AO). The AO runner passes `trace: { persist: false }`.

## Open Questions

Each question carries the default this spec assumes.

- **Q1 — Default content capture level.** `OM_AI_RUN_TRACE_CAPTURE=full|metadata|off`. Default assumed: `full` (encrypted, capped at 16 KB per payload) because a trace without tool inputs/outputs cannot answer "why did the agent say this". The system prompt text is **not** stored by default (hash + override version only; `OM_AI_RUN_TRACE_CAPTURE_PROMPT=on` opts in). **Deliberate divergence from AO** (the AO observability spec defaults to `metadata`, 1 MiB per artifact, S3 offload): the level names are shared (`off | metadata | full`), but OSS `full` stores conversational text and tool I/O in encrypted columns, capped at 16 KB, and still excludes the system prompt; AO `full` stores the complete provider request (system prompt, messages, tool schemas) of business-record agents. A chat turn is short text under the user's own session and is already persisted as conversation messages; an AO run carries business records and composed prompts. Runs that `run-object` / chat hand to AO through the dispatcher follow AO's policy, not this one (no OSS row is written for them).
- **Q2 — Should AO mirror chat runs into `agent_runs` (evals, golden match on chat traffic)?** Default assumed: **not in this spec**. The `ai_assistant.agent_run.completed` event + `aiAgentRunReader` DI service are the hook; an AO-side subscriber is a separate enterprise spec.
- **Q3 — Who may see a run trace?** Default assumed: `ai_assistant.runs.view` grants runs in conversations the user can read plus the user's own headless/MCP runs; `ai_assistant.runs.view_all` grants every run in the tenant/org. Participants of a shared conversation (`visibility: shared|organization`) see its runs only if they also hold `ai_assistant.runs.view`.
- **Q4 — Citation part id.** Default assumed: `ai_assistant:citations` (module-namespaced, per the UI-part MUST rule in `ui-parts.mdx`) rather than `ai:citations`. FROZEN once shipped.

---

## Overview

The ai-assistant runtime runs typed agents in two modes. **Chat** (`runAiAgentText`, streamed via `POST /api/ai_assistant/ai/chat`) and **object** (`runAiAgentObject`, used by `POST /api/ai_assistant/ai/run-object`, the AO native runner and, per the companion spec, MCP agent tools). Both build a `LoopTrace` through `buildLoopTraceCollector` (`lib/agent-runtime.ts`). The chat path streams it as a `loop-finish` SSE event, which `useAiChat` keeps in React state (`lastLoopTrace`) and `LoopTracePanel` renders in the debug panel. The object path returns `steps` on the result. Nothing is persisted except per-step token usage (`ai_token_usage_events`, `lib/token-usage-recorder.ts`) and conversation messages (`ai_chat_messages`, including server-emitted `ui_parts`).

The enterprise Agent Orchestrator has a full trace plane (`agent_runs` → `agent_spans` → `agent_tool_calls`, `/backend/traces/[id]`). It covers only AO runs, and it already fixed the AI SDK 7 extraction (`extractStepToolCalls` in `packages/enterprise/src/modules/agent_orchestrator/lib/runtime/nativeTraceCapture.ts`).

This spec gives OSS a small, self-sufficient run record, fixes the shared bug once, and adds citations as a first-class chat element.

> **Market reference:** Langfuse and OpenTelemetry GenAI semantic conventions (traces → spans with `gen_ai.request.model`, `gen_ai.usage.*`, tool-call spans). Vercel AI SDK `StepResult` (`toolCalls[].input`, `toolResults[].output`, `content[].type === 'tool-error'`). Perplexity / ChatGPT search-style numbered source lists. **Adopted:** run → step → tool-call hierarchy; OTel-compatible attribute names in `model_params`, so a future OTLP exporter maps 1:1; numbered source cards under the answer. **Rejected:** a generic span tree with arbitrary nesting (AO owns that; ai-assistant runs are flat: steps with tool calls); model-emitted free-text citations as the primary source (they can be fabricated; tool-emitted citations reflect what was actually retrieved).

## Problem Statement

Verified against the code on `develop` (2026-10-21):

1. **Collector reads pre-AI-SDK-5 fields.** `buildLoopTraceCollector` (`lib/agent-runtime.ts`) maps `event.toolCalls` with `args: raw.args ?? {}` and `result: raw.result`. Errors come only from `experimental_toToolResultError`, and durations from `startTime` / `endTime`. ai-assistant depends on `ai@^7` (`packages/ai-assistant/package.json`). Under AI SDK 7 a tool call carries `input`, results live in a separate `toolResults[]` keyed by `toolCallId` (`output`), and tool errors are `content[]` parts of type `tool-error`. So every chat trace shows `args: {}`, `result: undefined`, no error and `durationMs: 0`. The `steps` returned by `runAiAgentObject` (built by the same collector) have the same defect. AO worked around it with its own `extractStepToolCalls`, wired from the raw `onStepFinish` event in `lib/runtime/nativeAgentRunner.ts`.
2. **Chat runs are not persisted.** `LoopTrace` is documented as *"Not persisted — in-memory only"* (`lib/ai-agent-definition.ts`). It is emitted only when `emitLoopTrace` is set (the chat route sets it) and is kept client-side only (`packages/ui/src/ai/useAiChat.ts` `lastLoopTrace`; `LoopTracePanel.tsx`, shown only in debug mode). After a reload, or for any other user, there is no record of which tools ran with which inputs. `run-object` runs leave only token-usage rows.
3. **No run metadata.** Nothing records which agent revision answered, which tenant prompt override was active (`AiAgentPromptOverride.version`, read by `repo.getLatest` in the prompt composition path of `agent-runtime.ts`, which discards the version), which provider/model ran, or with which loop parameters. `AiAgentDefinition` has no `version` field.
4. **No backend trace view for chat.** The only trace UI is the debug `LoopTracePanel` (hard-coded English strings, no `useT`) and AO's `/backend/traces/[id]` for AO runs.
5. **No citations in chat.** Built-in server-emitted parts are the four mutation cards (`RESERVED_AI_UI_PART_IDS` in `packages/ui/src/ai/ui-part-slots.ts`). Record cards (`open-mercato:<kind>` fences) are entity cards, not sources. AO has a citation model (`CitationRef { kind, ref, label, steps, href }`) and a client resolver registry (`registerCitationResolver` in `agent_orchestrator/components/citationResolvers.ts`), but it lives in enterprise and only the decision card uses it.
6. **Tools cannot emit UI parts.** `ui-parts.mdx` shows `ctx.uiParts?.enqueue(...)` from a tool handler, but `McpToolContext` (`lib/types.ts`) has no `uiParts` field. The `AiUiPartQueue` built in `resolveAiAgentTools` (`lib/agent-tools.ts`) is passed only to the mutation interceptor (`mutation.uiPartQueue.enqueue(uiPart)`). Read tools therefore cannot attach citations (or any part) today; the docs describe an API that does not exist.

## Proposed Solution

### 1. One extraction helper (fix)

Create `packages/ai-assistant/src/modules/ai_assistant/lib/loop-step-extraction.ts`. It holds the AI SDK 7–aware logic now in AO's `extractStepToolCalls`, generalized:

```ts
export type RawStepEvent = {
  toolCalls?: Array<{ toolCallId?: string; toolName?: string; input?: unknown; args?: unknown; result?: unknown;
    experimental_toToolResultError?: { code?: string; message?: string }; startTime?: number; endTime?: number }>
  toolResults?: Array<{ toolCallId?: string; output?: unknown; result?: unknown }>
  content?: Array<{ type?: string; toolCallId?: string; error?: unknown }>
  text?: string; finishReason?: string; response?: { modelId?: string }
  usage?: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; reasoningTokens?: number }
}
export type ExtractedToolCall = {
  toolCallId: string | null; toolName: string; args: unknown; result: unknown
  error?: { code: string; message: string }; durationMs: number
}
export function extractStepToolCalls(raw: RawStepEvent, timings?: ToolCallTimings): ExtractedToolCall[]
export function extractStepMeta(raw: RawStepEvent): { modelId: string; finishReason: string; text: string; usage: {...} }
```

- **Location decision:** ai-assistant, not `packages/shared`. The shape is AI-SDK-specific and `LoopStepRecord` already lives in ai-assistant. Enterprise already depends on `@open-mercato/ai-assistant` (`packages/enterprise/package.json`), and OSS never imports enterprise. `packages/shared/src/lib/ai/*` holds provider/model helpers with no step semantics.
- Legacy fallbacks are kept (`args`, `result`, `experimental_toToolResultError`) so an older provider adapter or a test fixture keeps working.
- **Durations:** AI SDK 7 tool calls carry no `startTime` / `endTime`. The runtime owns tool execution (`adaptToolToAiSdk` in `lib/agent-tools.ts`), so it records `performance.now()` around each `execute` into a per-turn `ToolCallTimings` map keyed by `toolCallId` (available in the AI SDK `execute(input, { toolCallId })` options). The helper reads that map.
- `buildLoopTraceCollector` uses the helper; `LoopStepRecord.toolCalls[]` gains optional `toolCallId` (additive). The display de-sanitization (`desanitizeToolNameForDisplay`) stays in the collector.
- AO: `nativeTraceCapture.ts` imports the helper and re-exports `extractStepToolCalls` / `NativeStepToolCall` as aliases (keeps its tests and imports stable).

### 2. OSS run persistence

**Decision: three OSS tables in `ai_assistant`, plus an event as the extension point.** No sink interface that AO must implement.

| Option | Verdict |
|---|---|
| OSS tables in ai-assistant (chosen) | OSS stays self-sufficient (no enterprise needed to answer "what did the chat agent do"). Runs are flat (steps → tool calls) and small. The schema is tailored to chat (conversation/turn link, prompt-override version) |
| Sink interface (`AiAgentRunTraceSink`) implemented by AO, no OSS storage | OSS without enterprise would have no trace; violates "keep OSS self-sufficient" |
| Write chat runs directly into AO tables | OSS → enterprise dependency; forbidden |
| Event + reader (chosen, in addition) | Canonical cross-module mechanism (`packages/core/AGENTS.md` → Cross-Module Coupling: events for side effects). AO (downstream) subscribes and calls the ai-assistant reader; ai-assistant never names AO |

**Write path.**
- `runAiAgentText` and `runAiAgentObject` accept an optional `runId` (caller-generated UUID) and `trace?: AiAgentRunTraceOptions` (§6: `{ persist?: boolean; channel?: AiAgentRunChannel; correlationId?: string }`). Defaults: `persist: true` unless `OM_AI_RUN_TRACE_CAPTURE=off`. The `runId` is generated when omitted.
- The run is written **once, after the turn settles**, by a new `lib/agent-run-recorder.ts`. It uses a forked EM in one transaction (run + steps + tool calls), best-effort, mirroring `recordTokenUsage` (never throws; logs and calls `reportError` on failure). For chat this happens in the existing post-stream pump (`appendLoopFinishToStream`, generalized to run its finalize hook whether or not `emitLoopTrace` is set). For object mode it happens after `generateText` / `generateObject` resolves, or in `catch` with `status: 'failed'`. An aborted stream records `status: 'aborted'` with the steps collected so far.
- **No row at start.** A process crash mid-turn loses that run (token-usage rows still exist). This halves writes on the hot path; the tradeoff is accepted.
- Callers:
  - Chat route (`api/ai/chat/route.ts`): generates `runId`, passes it, adds `runId` to the `loop-finish` event and to the persisted assistant message `metadata.runId` (field already encrypted). Channel `chat`, or `playground` when the playground calls it.
  - `run-object` route: channel `run-object`. When the agent id is owned by the `aiAgentRunDispatcher` (MCP spec §4; AO), the route delegates and writes **no** OSS row; the response carries `runId: null` and the dispatcher's `agentRunId`.
  - MCP agent tools (companion spec): channel `mcp`; `/tools/execute` agent tools: channel `tools-api`; `correlationId` from the request (`x-correlation-id` or generated).
  - AO native runner: passes `trace: { persist: false }` (AO captures its own spans). Until that one-line enterprise change ships, duplicates land with channel `internal` and are harmless.
- After commit, emit `ai_assistant.agent_run.completed` (persistent) with `{ runId, tenantId, organizationId, agentId, channel, status, conversationId }`. Payload has ids only, no content.

**Capture levels** (`OM_AI_RUN_TRACE_CAPTURE`): `full` (default) stores `input_text`, `output_text`, step `text`, tool `args` / `result` (each capped at `OM_AI_RUN_TRACE_MAX_PAYLOAD_BYTES`, default 16384, via `lib/truncate.ts`, with a `*_truncated` flag). `metadata` stores everything except content fields (tool names, arg key names, sizes, timings, tokens, errors codes). `off` disables persistence. The system prompt is stored only with `OM_AI_RUN_TRACE_CAPTURE_PROMPT=on`; otherwise only `system_prompt_hash`.

**Retention.** Worker `workers/ai-agent-run-prune.ts` (queue `ai-agent-run-prune`) plus CLI `mercato ai_assistant run-agent-run-prune`, following `ai-token-usage-prune`. It hard-deletes runs (cascade: steps, tool calls, by `run_id`) older than `AI_AGENT_RUNS_RETENTION_DAYS` (default 30), in batches of 1000. Deleting a conversation through `conversation-storage` soft-deletes its runs (`deleted_at`) in the same operation; the prune worker removes soft-deleted rows on the next pass.

### 3. Run metadata

| Field | Source |
|---|---|
| `agent_id`, `module_id` | `AiAgentDefinition` |
| `agent_version` | New optional `AiAgentDefinition.version?: string` (authors bump it on meaningful changes) |
| `agent_definition_hash` | SHA-256 of canonical JSON `{ systemPrompt, allowedTools (sorted), executionMode, output.schemaName, mutationPolicy, defaultProvider, defaultModel, modelSettings, loop (serializable subset) }`, computed once at registry load; detects silent changes when `version` is not bumped |
| `prompt_override_id`, `prompt_override_version` | The `AiAgentPromptOverride` row used (`repo.getLatest`). An internal `resolveSystemPromptWithOverrideMeta` returns `{ prompt, override }`; the exported prompt-composition function keeps its signature |
| `effective_mutation_policy` | `resolveEffectiveMutationPolicy(...)` result |
| `provider_id`, `model_id`, `base_url_host` | Resolved model (host only, never the full URL or credentials) |
| `model_params` (jsonb) | `{ maxSteps, toolChoice, budget, activeTools, stopWhen: kinds[], allowRuntimeOverride, modelSource: 'request'\|'runtime-override'\|'agent'\|'default', 'gen_ai.request.*'? }` — the `gen_ai.request.*` keys (temperature, top_p, top_k, max_tokens, seed, stop_sequences, presence_penalty, frequency_penalty) are the call settings **as sent** on the first model call, taken from `observe.onModelCallStart` (§6); absent key = provider default. Same key names as the AO observability spec's LLM span attributes |
| `tool_names` | Tools resolved for the turn (after policy filtering) |
| `channel`, `conversation_id`, `turn_id`, `correlation_id`, `user_id`, `api_key_id` | Caller context |

### 4. Backend trace view

- `GET /api/ai_assistant/ai/runs`: list (DataTable); `GET /api/ai_assistant/ai/runs/:id`: run + steps + tool calls; `GET /api/ai_assistant/ai/conversations/:conversationId/runs`: runs of a conversation (reuses the conversation read-access check from `conversation-storage`).
- Pages `backend/config/ai-assistant/runs/page.tsx` (list) and `backend/config/ai-assistant/runs/[id]/page.tsx` (detail), both following the existing `usage/` pattern: a server `page.tsx` with a client island.
- Links: the chat assistant message footer shows an icon-only "View run trace" button (`aria-label`, lucide `Activity` icon) when `message.metadata.runId` is present and the user holds `ai_assistant.runs.view`; `LoopTracePanel` shows "Open full trace" when the `loop-finish` event carries `runId`.

### 5. Citations

**Model** (`lib/citations.ts` in ai-assistant, zod-validated; mirrored type in `@open-mercato/ui/ai`):

```ts
export const aiCitationSchema = z.object({
  kind: z.string().regex(/^[a-z0-9_.:-]{1,64}$/),   // e.g. 'kb', 'record', 'url', 'attachment'
  ref: z.string().min(1).max(512),                   // e.g. 'refund-policy@4', 'customers.person:<uuid>'
  label: z.string().max(200).optional(),
  version: z.string().max(64).optional(),
  quote: z.string().max(1000).optional(),            // the retrieved passage, not model text
  locator: z.string().max(200).optional(),           // '§3.2', 'p. 14', '#S2'
  href: z.string().max(2048).refine(isSafeHref).optional(), // relative '/' or http(s) only
  steps: z.array(z.string().max(64)).max(20).optional(),    // AO compatibility
})
export type AiCitation = z.infer<typeof aiCitationSchema>
```

This is a strict superset of AO's `CitationRef`, so an AO citation renders unchanged.

**Emission.**
- `McpToolContext` gains optional `uiParts?: AiUiPartQueue` (additive). `adaptToolToAiSdk` passes the per-turn queue to **every** tool handler, not only to the mutation interceptor. This makes the documented `ctx.uiParts?.enqueue(...)` real. On MCP and `/tools/execute` the field stays undefined.
- Helper `emitCitations(ctx, citations, opts?: { title?: string })`, exported from `@open-mercato/ai-assistant`: validates, drops invalid entries with a warning, de-duplicates by `kind+ref+locator`, caps at 20 per call, and enqueues `{ componentId: 'ai_assistant:citations', props: { citations, title } }`. With no queue it is a no-op, so tools also return citations in their result for MCP and object-mode consumers.
- The recorder aggregates every citations part of a turn into `ai_agent_runs.citations` (encrypted), so the trace view shows the sources of a run.
- Prompt guidance: agents that cite add one sentence to their prompt ("Sources are shown to the user automatically; refer to them as [1], [2] in order"). Nothing parses model text for citations.

**Rendering** (`packages/ui/src/ai/parts/CitationsPart.tsx`, registered under `ai_assistant:citations` in the default registry next to the approval cards). Consecutive citation parts on one assistant message are merged into one numbered list. Each entry is resolved through the registry: the title is resolved or falls back to the label, then the ref. The quote is shown as a `blockquote` clamped to 3 lines with an expand control. The locator is shown as muted text. A relative `href` opens in-app through `next/link`; an absolute `href` opens in a new tab with `rel="noopener noreferrer"`. A failing or unknown resolver degrades to label + `href` and never breaks the message.

**Resolver registry.** Move the generic part of `agent_orchestrator/components/citationResolvers.ts` to `packages/ui/src/ai/citations/registry.ts` (`registerCitationResolver`, `getCitationResolver`, `listCitationResolverKinds`, `resolveCitation`, `fallbackCitation`, types), exported from `@open-mercato/ui/ai`. AO's file becomes a re-export shim, so its deep import path keeps working and both the decision card and `AiChat` share **one** registry: a module that registers a `kb` resolver once gets it in both. Module-owned resolvers register client-side from the module's existing client bootstrap (same as `registerAiUiPart`).

**Agreement with AO (implemented 2026-10-12 decision-card spec, not edited here).** The registry keeps that spec's contract unchanged: resolver input `{ kind, ref, label?, steps?, href? }`, output `{ title, href?, steps?: [{ id, text }] } | null`, `globalThis` storage, last registration wins, fallback `label ?? ref` + `href`. The new optional `version`, `quote`, `locator` fields are passed to resolvers as extra keys and ignored by resolvers that do not read them. AO proposal evidence (`proposalEvidenceSchema.citations`) keeps its own write-side limits (ref ≤ 300 chars, ≤ 50 per action); `aiCitationSchema` is the render-side superset (ref ≤ 512), so every AO citation renders and a chat citation longer than 300 chars is not valid as AO evidence. Versioned refs use the `key@version` convention in both (`kb` citations from the knowledge-articles spec; the AO integrity spec's `reference_exists` rule parses the same `@` separator). Verifying that a cited source exists or was actually consulted is AO-only (integrity spec `reference_exists` / `tool_consulted`); OSS chat renders what tools emitted and does not verify it.

### 6. Model-call contract (canonical; shared with the AO observability and eval specs)

Three specs need to pass settings into, and observe, the model calls that `runAiAgentText` / `runAiAgentObject` make. They share **one** contract, defined here because it is OSS ai-assistant code. Whichever spec ships first implements the part it needs exactly as written here; the others reuse it.

```ts
// lib/agent-call-contract.ts (new), types exported from '@open-mercato/ai-assistant'
export type AiAgentCallSettings = {                // names follow the AI SDK 7 CallSettings
  temperature?: number; topP?: number; topK?: number; maxOutputTokens?: number; seed?: number
  stopSequences?: string[]; presencePenalty?: number; frequencyPenalty?: number
  providerOptions?: Record<string, unknown>
}
export type AiAgentRunChannel = 'chat' | 'playground' | 'run-object' | 'mcp' | 'tools-api' | 'internal'
export type AiAgentRunTraceOptions = { persist?: boolean; channel?: AiAgentRunChannel; correlationId?: string }

export type AiAgentCallObserver = {
  onPromptResolved?(event: { agentId: string; systemPrompt: string; promptOverride: { id: string; version: number } | null
    pageContextHydrated: boolean; attachmentCount: number; provider: string | null; modelId: string | null }): void | Promise<void>
  onModelCallStart?(event: { callId: string; stepNumber: number; provider: string; modelId: string
    system: string | undefined; messages: unknown[]; tools: ReadonlyArray<Record<string, unknown>> | undefined
    responseFormat: unknown | undefined; callSettings: AiAgentCallSettings; startedAtMs: number }): void | Promise<void>
  onModelCallEnd?(event: { callId: string; finishReason: string; responseId: string | null; responseModelId: string | null
    usage: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; reasoningTokens?: number }
    content: unknown[]; providerMetadata?: Record<string, unknown>; responseTimeMs: number; endedAtMs: number }): void | Promise<void>
}

// AiAgentDefinition gains:            modelSettings?: AiAgentCallSettings        (agent default)
// RunAiAgentTextInput / RunAiAgentObjectInput gain:
//   callSettings?: AiAgentCallSettings   (call-time; merged over modelSettings key by key)
//   observe?: AiAgentCallObserver
//   trace?: AiAgentRunTraceOptions
//   runId?: string
```

- **Names.** `modelSettings` is the declaration on an agent definition (OSS `defineAiAgent`, and AO `defineAgent`, which forwards it to `defineAiAgent`); `callSettings` is the call-time input and the name of what the observer reports as sent. Precedence: `callSettings` > `modelSettings` > provider default. No other names (`params`, `evalOverrides` at the ai-assistant boundary) are used.
- **Observer owner and wiring.** `observe` is invoked by ai-assistant from AI SDK 7's `generateText` call-level hooks (`onLanguageModelCallStart` / `onLanguageModelCallEnd`) on every object- and text-mode branch, after `prepareStep` has merged, inside try/catch (a throwing observer is logged and ignored). Branches whose call-level hooks are not exposed (`generateObject`, `streamObject`, a caller-supplied `generateObject`) synthesize `onModelCallStart` from `system` / `messages` / schema with `stepNumber = 0`. The OSS run recorder (§2) is itself an observer consumer (it fills `model_params` from `onModelCallStart.callSettings`); AO's native runner is the second consumer (observability spec). One model call → one observer event → one trace record.
- **Persist flag.** `trace.persist === false` suppresses the OSS recorder for that call; AO passes `trace: { persist: false }` because it persists its own run.
- **Prompt override metadata** comes from the internal `resolveSystemPromptWithOverrideMeta` (§3); `composeSystemPrompt` keeps its string-returning signature.
- **Hash.** `agent_definition_hash` (§3) is computed at registry load and includes `modelSettings` when declared, so a settings change is a definition change.

### Design Decisions

| Decision | Rationale |
|---|---|
| Write once after the turn, not at start | One transaction per turn on the hot path; a crash loses only that run's trace |
| Flat run → step → tool call | Matches the AI SDK loop; AO keeps the general span tree |
| Content encrypted + capped + retention 30 d | GDPR: tool I/O can contain personal data; caps bound storage |
| System prompt hash by default | Prompts can embed tenant data via `resolvePageContext`; the hash + override version reproduce the prompt from code + DB in most cases |
| Citations emitted by tools, not parsed from text | Grounded in retrieved data; deterministic; no prompt-format coupling |
| One citation registry in `ui` | Removes the enterprise-only limitation; AO keeps its import path |

### Alternatives Considered

| Alternative | Why rejected |
|---|---|
| Persist the `loop-finish` payload client-side or from the browser | Untrusted, misses headless/MCP runs |
| Store traces in `ai_chat_messages.metadata` | Not queryable, no runs for non-chat channels, bloats message reads |
| Citations as record-card fences (`open-mercato:citation`) | Model-emitted, fabricable; record cards are for entities |
| Put the extraction helper in `packages/shared` | Shared has no AI SDK step semantics; ai-assistant is already the common dependency |

## User Stories / Use Cases

- A **support lead** wants to open a chat answer from yesterday and see which tools ran with which inputs and results, so that a wrong answer can be diagnosed.
- A **compliance reviewer** wants each run to record the agent version, prompt-override version and model, so that a past answer can be tied to the configuration that produced it.
- An **end user** wants to see the sources behind an answer (title, passage, section, link), so that the answer can be checked.
- A **module author** wants to emit citations from a retrieval tool with one call, and render a domain-specific title/link through a resolver.
- An **enterprise operator** wants chat runs available to AO later (evals) without the OSS package depending on AO.

## Architecture

```mermaid
flowchart LR
  subgraph Runtime["ai-assistant runtime"]
    T[adaptToolToAiSdk\n(timings + ctx.uiParts)]
    C[buildLoopTraceCollector\n→ loop-step-extraction]
    Q[(AiUiPartQueue)]
    R[agent-run-recorder\n(one tx, best-effort)]
  end
  CH[/POST ai/chat/] --> Runtime
  RO[/POST ai/run-object/] --> Runtime
  MCP[MCP agent tool] --> Runtime
  AON[AO native runner\npersist:false] --> Runtime
  T --> C --> R
  T -- emitCitations --> Q --> SSE[data-aiui → AiChat CitationsPart]
  R --> DB[(ai_agent_runs\nai_agent_run_steps\nai_agent_run_tool_calls)]
  R -- ai_assistant.agent_run.completed --> EV((event bus))
  EV -. optional, enterprise .-> AOS[AO subscriber → aiAgentRunReader]
  DB --> API[/GET ai/runs, ai/runs/:id/] --> UI[backend runs pages]
  CHUI[AiChat message footer / LoopTracePanel] -- runId --> UI
```

### Commands & Events
- No undoable commands: runs are system telemetry written by the runtime, not user-editable records. There is no update/delete API (retention only), so optimistic locking does not apply. `updated_at` exists for convention.
- **Event:** `ai_assistant.agent_run.completed` (category `system`, persistent, `clientBroadcast: false`).
- **DI:** `aiAgentRunReader` (`getRun(scope, runId)`, `listSteps(scope, runId)`, `listToolCalls(scope, runId)`) reads through `findWithDecryption`.

## Data Models

All three entities live in `packages/ai-assistant/src/modules/ai_assistant/data/entities.ts` and are scoped by `tenant_id` + `organization_id`. They hold no ORM relations to other modules (FK ids only; `run_id` is a plain uuid column, consistent with the module's existing style).

### AiAgentRun (`ai_agent_runs`)
- `id` uuid (= `runId`), `tenant_id` uuid, `organization_id` uuid nullable
- `user_id` uuid nullable, `api_key_id` uuid nullable
- `agent_id` text, `module_id` text, `agent_version` text nullable, `agent_definition_hash` text
- `prompt_override_id` uuid nullable, `prompt_override_version` int nullable
- `execution_mode` text (`chat` | `object`), `channel` text (`chat` | `playground` | `run-object` | `mcp` | `tools-api` | `internal`)
- `conversation_id` text nullable, `turn_id` uuid, `correlation_id` text nullable
- `provider_id` text, `model_id` text, `base_url_host` text nullable, `model_params` jsonb
- `effective_mutation_policy` text, `tool_names` text[]
- `status` text (`completed` | `failed` | `aborted`), `stop_reason` text nullable, `finish_reason` text nullable
- `input_tokens` int, `output_tokens` int, `cached_input_tokens` int nullable, `reasoning_tokens` int nullable
- `step_count` int, `tool_call_count` int, `duration_ms` int, `started_at` timestamptz, `completed_at` timestamptz
- `input_text` text nullable **(encrypted)**, `output_text` text nullable **(encrypted)**, `content_truncated` boolean
- `system_prompt_hash` text, `system_prompt` text nullable **(encrypted, opt-in)**
- `citations` jsonb nullable **(encrypted)**
- `error_code` text nullable, `error_message` text nullable **(encrypted)**
- `capture_level` text (`full` | `metadata`)
- `created_at`, `updated_at`, `deleted_at`
- Indexes: `(tenant_id, organization_id, created_at desc)`, `(tenant_id, conversation_id, created_at)`, `(tenant_id, agent_id, created_at)`, `(tenant_id, user_id, created_at)`, `(tenant_id, correlation_id)`

### AiAgentRunStep (`ai_agent_run_steps`)
- `id` uuid, `tenant_id`, `organization_id`, `run_id` uuid, `step_index` int
- `model_id` text, `finish_reason` text, `input_tokens` int, `output_tokens` int
- `text` text nullable **(encrypted)**, `text_truncated` boolean, `ended_at` timestamptz, `duration_ms` int
- `created_at`, `updated_at`
- Unique `(run_id, step_index)`

### AiAgentRunToolCall (`ai_agent_run_tool_calls`)
- `id` uuid, `tenant_id`, `organization_id`, `run_id` uuid, `step_index` int, `call_index` int
- `tool_call_id` text nullable, `tool_name` text, `is_mutation` boolean, `pending_action_id` uuid nullable (FK id to `ai_pending_actions` when the call was intercepted)
- `arg_keys` text[] (always), `args` jsonb nullable **(encrypted)**, `result` jsonb nullable **(encrypted)**, `args_truncated` boolean, `result_truncated` boolean, `result_bytes` int
- `error_code` text nullable, `error_message` text nullable **(encrypted)**, `duration_ms` int
- `created_at`, `updated_at`
- Unique `(run_id, step_index, call_index)`; index `(tenant_id, tool_name, created_at)`

### Encryption (`ai_assistant/encryption.ts`, additive entries)

```ts
{ entityId: 'ai_assistant:ai_agent_run', fields: [{ field: 'input_text' }, { field: 'output_text' }, { field: 'system_prompt' }, { field: 'citations' }, { field: 'error_message' }] },
{ entityId: 'ai_assistant:ai_agent_run_step', fields: [{ field: 'text' }] },
{ entityId: 'ai_assistant:ai_agent_run_tool_call', fields: [{ field: 'args' }, { field: 'result' }, { field: 'error_message' }] },
```

All reads use `findWithDecryption` / `findOneWithDecryption`.

### Additive type changes
- `AiAgentDefinition.version?: string`, `AiAgentDefinition.modelSettings?: AiAgentCallSettings` (§6)
- `LoopStepRecord.toolCalls[].toolCallId?: string`; `LoopTrace.runId?: string`
- `RunAiAgentTextInput` / `RunAiAgentObjectInput`: `runId?: string`, `trace?: AiAgentRunTraceOptions`, `callSettings?: AiAgentCallSettings`, `observe?: AiAgentCallObserver` (§6)
- `RunAiAgentObjectGenerateResult.runId?: string`
- `McpToolContext.uiParts?: AiUiPartQueue`

### Migration
One migration `Migration<timestamp>_ai_assistant.ts` creating the three tables and indexes, generated with `yarn db:generate`, snapshot `migrations/.snapshot-open-mercato.json` updated. No backfill.

## API Contracts

All routes export `openApi`, validate with zod (`data/validators.ts`), scope by tenant/org from auth, and keep `pageSize ≤ 100`.

### List runs
- `GET /api/ai_assistant/ai/runs?agentId&channel&status&userId&conversationId&from&to&page&pageSize`
- Guard: `requireAuth`, `requireFeatures: ['ai_assistant.runs.view']`. Without `ai_assistant.runs.view_all`, results are restricted to `user_id = caller` OR `conversation_id IN (conversations the caller can read)`.
- Implementation: `makeCrudRoute` list-only (`GET`), `buildFilters` adds the scope restriction; no create/update/delete handlers.
- Response: `{ items: [{ id, agentId, agentVersion, channel, status, modelId, providerId, inputTokens, outputTokens, toolCallCount, durationMs, conversationId, userId, startedAt, completedAt, updatedAt }], total, page, pageSize, totalPages }`. List rows carry **no content fields**.

### Run detail
- `GET /api/ai_assistant/ai/runs/:id`. Same guard and scope rule; 404 when out of scope (no existence leak).
- Response: `{ run: {...all metadata, inputText?, outputText?, citations?, error?}, steps: [...], toolCalls: [...], links: { conversationId?, pendingActionIds[] } }`.

### Conversation runs
- `GET /api/ai_assistant/ai/conversations/:conversationId/runs`. Requires `ai_assistant.runs.view` + read access to the conversation (existing participant/visibility rules). Returns the list shape ordered by `started_at`.

### SSE (chat)
- `loop-finish` event payload gains `trace.runId` (additive).
- New UI part chunk: `data: {"type":"data-aiui","payload":{"componentId":"ai_assistant:citations","props":{"citations":[...],"title":"..."}}}`.

### `POST /api/ai_assistant/ai/run-object`
- Response gains `runId` (additive; `ai_agent_runs.id`). For agent ids owned by the `aiAgentRunDispatcher` (AO), `runId` is `null` and the response gains `agentRunId` instead (see the shared correlation vocabulary in the roadmap).
- Request gains optional `callSettings` (§6), validated by zod; ignored keys are rejected.

## Internationalization (i18n)

New keys in `ai_assistant` locales (en + existing locales):
- `ai_assistant.runs.navTitle`, `ai_assistant.runs.list.title`, `ai_assistant.runs.list.empty`, `ai_assistant.runs.columns.{agent,channel,status,model,tokens,toolCalls,duration,startedAt}`, `ai_assistant.runs.status.{completed,failed,aborted}`, `ai_assistant.runs.channel.{chat,playground,run-object,mcp,tools-api,internal}`
- `ai_assistant.runs.detail.{title,metadata,steps,toolCalls,input,output,citations,promptOverride,agentVersion,definitionHash,modelParams,contentNotCaptured,truncated,openConversation,pendingAction}`
- `ai_assistant.chat.viewRunTrace`, `ai_assistant.chat.openFullTrace`
- `ui.ai.citations.title`, `ui.ai.citations.showMore`, `ui.ai.citations.showLess`, `ui.ai.citations.openSource`
- `ui.ai.loopTrace.{title,steps,tokens,noSteps}`: replaces the hard-coded strings in `LoopTracePanel.tsx` (Boy Scout rule)

## UI/UX

- **Runs list** (`/backend/config/ai-assistant/runs`, settings group "Module Configs" next to "AI Usage"): `DataTable` with filters (agent, channel, status, date range), `StatusBadge` for status (semantic tokens: success / error / warning), row click → detail. `EmptyState` when empty. `LoadingMessage` / `ErrorMessage` from `@open-mercato/ui/backend/detail`.
- **Run detail** (`/backend/config/ai-assistant/runs/[id]`): header facts (agent + version + hash short, prompt override version, model, channel, tokens, duration, status), "Open conversation" link when `conversationId`; `CollapsibleSection` per step with its tool calls (name, duration, error `Alert`, JSON viewers for args/result with a "truncated" badge); a "Sources" section rendering `CitationsPart` read-only; content-not-captured notice when `capture_level = metadata`.
- **Chat**: icon-only footer button on assistant messages (`aria-label` = `ai_assistant.chat.viewRunTrace`); citations list under the message text, numbered, keyboard-focusable entries.
- DS: no hard-coded status colors, no arbitrary sizes, lucide icons, no inline `<svg>`. The new page `page.meta.ts` uses a lucide icon component rather than `React.createElement('svg', ...)` (the `usage/page.meta.ts` pattern is not copied).

### Frontend Architecture Contract

**Server/Client boundary map**

| Route / surface | Server root | Client islands | Data owner | Notes |
|---|---|---|---|---|
| `/backend/config/ai-assistant/runs` | `runs/page.tsx` | `AiRunsListPageClient` | `GET /api/ai_assistant/ai/runs` via `apiCall` | No page-root `"use client"` |
| `/backend/config/ai-assistant/runs/[id]` | `runs/[id]/page.tsx` | `AiRunDetailPageClient` (+ leaf `RunToolCallJson`) | `GET /api/ai_assistant/ai/runs/:id` | JSON viewer leaf lazy-mounted per expanded call |
| `<AiChat>` (existing) | n/a (already client) | `CitationsPart` leaf, footer trace button | SSE stream | Registered in default UI-part registry |

**`"use client"` ledger**

| File | Reason | Imported by | Heavy deps? | Cleanup / hydration risk | Alternative rejected |
|---|---|---|---|---|---|
| `runs/AiRunsListPageClient.tsx` | Stateful DataTable filters/paging | `runs/page.tsx` | DataTable (existing) | None beyond DataTable | Server table: DataTable is client-only |
| `runs/[id]/AiRunDetailPageClient.tsx` | Collapsible sections, fetch-on-mount | `runs/[id]/page.tsx` | No | None | Server render: needs per-section expand state |
| `packages/ui/src/ai/parts/CitationsPart.tsx` | Async resolver calls, expand state | UI-part registry | No | Resolver promises cancelled on unmount | Static render: resolvers are async |
| `packages/ui/src/ai/LoopTracePanel.tsx` (touched) | Existing client file; adds `useT` + link | `AiChat` | No | None | — |

**Budgets**

| Budget | Default target | Spec value |
|---|---|---|
| Generated backend page-root `"use client"` | 0 new unallowlisted | 0 |
| Touched client files over 300 LOC | 0 unless justified | 0 new; `AiChat.tsx` already exceeds 300 LOC and only gains a footer button + registry entry (no new logic in it) |
| Heavy browser libraries at page/provider root | 0 | 0 (JSON rendering uses existing `pre`/code block primitive) |
| Per-route hydration smoke | required | runs list + detail |
| Performance evidence | static check + one signal | `yarn check:client-boundaries` + run-recorder p95 overhead measured in unit benchmark (< 5 ms off the response path) |

**Provider / bootstrap scope**

| Provider/bootstrap | Global? | Scope | Why | Exit criteria |
|---|---|---|---|---|
| Default AI UI-part registry (`ui-part-registry.ts`) | Yes (existing) | `AiChat` consumers | Register `ai_assistant:citations` beside the approval cards | n/a (small leaf) |
| Citation resolver registry (`ui/src/ai/citations/registry.ts`) | Yes (globalThis map, existing pattern) | Modules register their kinds | Shared by chat + AO decision card | n/a |

## Configuration

| Env | Default | Meaning |
|---|---|---|
| `OM_AI_RUN_TRACE_CAPTURE` | `full` | `full` \| `metadata` \| `off` |
| `OM_AI_RUN_TRACE_CAPTURE_PROMPT` | `off` | Store the composed system prompt (encrypted) |
| `OM_AI_RUN_TRACE_MAX_PAYLOAD_BYTES` | `16384` | Cap per stored payload |
| `AI_AGENT_RUNS_RETENTION_DAYS` | `30` | Prune horizon |

Mirror into `apps/mercato/.env.example` and the create-app template (`yarn template:sync:fix`).

## Access Control

`ai_assistant/acl.ts` (additive): `ai_assistant.runs.view` (dependsOn `ai_assistant.view`) and `ai_assistant.runs.view_all` (dependsOn `ai_assistant.runs.view`). `setup.ts` `defaultRoleFeatures`: `admin` gets both, `employee` gets `ai_assistant.runs.view`. Existing tenants: `yarn mercato auth sync-role-acls`.

## Migration & Backward Compatibility

| # | Surface | Change | Class | BC handling |
|---|---|---|---|---|
| 2 | Types (`AiAgentDefinition`, `LoopStepRecord`, `LoopTrace`, `RunAiAgent*Input/Result`, `McpToolContext`; new `AiAgentCallSettings`, `AiAgentCallObserver`, `AiAgentRunChannel`, `AiAgentRunTraceOptions`) | Optional fields / new exported types only | STABLE, additive | None |
| 3 | `buildLoopTraceCollector` | Same signature; output now populated correctly | STABLE | Behaviour fix; consumers previously received `{}` / `undefined` |
| 4 | Import paths | New `@open-mercato/ui/ai` exports (citations registry, `CitationsPart`); AO `components/citationResolvers.ts` becomes a re-export shim | STABLE | Old AO path keeps working; `@deprecated` JSDoc pointing to `@open-mercato/ui/ai` |
| 5 | Event IDs | New `ai_assistant.agent_run.completed` | FROZEN once shipped | — |
| 7 | API routes | New `GET` routes; `run-object` and `loop-finish` gain `runId` | additive | — |
| 8 | DB | Three new tables | ADDITIVE-ONLY | Migration + snapshot |
| 9 | DI | New `aiAgentRunReader` | additive | — |
| 10 | ACL | New `ai_assistant.runs.view`, `ai_assistant.runs.view_all` | FROZEN once shipped | `setup.ts` + sync command |
| 12 | UI part id | New `ai_assistant:citations` | FROZEN once shipped | — |
| 13 | CLI | New `run-agent-run-prune` | additive | — |

Docs to update in the same change: `apps/docs/docs/framework/ai-assistant/ui-parts.mdx` (citations part; correct the `ctx.uiParts` example to match the now-real field), `agents.mdx` (`version`, run tracing), `packages/ai-assistant/AGENTS.md` (run recorder rules, capture env), `packages/ui/AGENTS.md` (citations registry), `UPGRADE_NOTES.md` (new tables, env, ACL sync).

## Implementation Plan

### Phase 1: Fix the collector (no schema change)
1. Add `lib/loop-step-extraction.ts` with unit tests ported from AO `native-trace-tool-calls.test.ts` plus legacy-field cases.
2. Tool timing map in `adaptToolToAiSdk` keyed by `toolCallId`.
3. `buildLoopTraceCollector` uses the helper; add `toolCallId`.
4. AO `nativeTraceCapture.ts` imports the helper and re-exports the old names; AO tests unchanged and green.

### Phase 2: Run persistence
1. Entities, validators, encryption map entries, migration + snapshot.
2. `lib/agent-call-contract.ts` (§6: `AiAgentCallSettings`, `modelSettings`, `callSettings` forwarding, `observe` wiring on every branch, `trace` options) — skip any part an AO spec already landed exactly as specified in §6. `lib/agent-run-recorder.ts` (one tx, best-effort, capture levels, caps, consumes `observe`), definition hash at registry load, `resolveSystemPromptWithOverrideMeta`.
3. Wire `runAiAgentText` (generalized post-stream finalize hook) and `runAiAgentObject` (success / failure); `runId` + `trace` inputs; chat route stamps `metadata.runId` and `loop-finish.trace.runId`; `run-object` returns `runId`.
4. Event `ai_assistant.agent_run.completed`; DI `aiAgentRunReader`.
5. Retention worker + CLI; conversation delete soft-deletes runs.
6. AO native runner passes `trace: { persist: false }` (enterprise one-liner, same release).

### Phase 3: Trace API and UI
1. ACL features + `setup.ts`; routes with `openApi`.
2. Runs list + detail pages; chat footer button; `LoopTracePanel` i18n + link.

### Phase 4: Citations
1. `lib/citations.ts` (schema, `isSafeHref`, `emitCitations`); `McpToolContext.uiParts` passed to every tool by `adaptToolToAiSdk`.
2. `packages/ui/src/ai/citations/registry.ts` (moved), AO shim; `CitationsPart` + registration; merge of consecutive parts.
3. Recorder aggregates citations into the run; detail page "Sources".
4. Reference usage: `search.hybrid_search` / `search.get_record_context` (`ai-tools/search-pack.ts`) emit `record`-kind citations for returned hits (opt-in by agent prompt; no behaviour change for agents that ignore the part).

### File Manifest

| File | Action | Purpose |
|---|---|---|
| `packages/ai-assistant/src/modules/ai_assistant/lib/loop-step-extraction.ts` | Create | Shared AI SDK 7 extraction |
| `packages/ai-assistant/src/modules/ai_assistant/lib/agent-runtime.ts` | Modify | Collector fix, `runId`/`trace`, recorder wiring |
| `packages/ai-assistant/src/modules/ai_assistant/lib/agent-tools.ts` | Modify | Timings, `ctx.uiParts` for every tool |
| `packages/ai-assistant/src/modules/ai_assistant/lib/agent-run-recorder.ts` | Create | Persistence |
| `packages/ai-assistant/src/modules/ai_assistant/lib/agent-call-contract.ts` | Create | §6 shared model-call contract (types + observer adapter) |
| `packages/ai-assistant/src/modules/ai_assistant/lib/citations.ts` | Create | Schema + `emitCitations` |
| `packages/ai-assistant/src/modules/ai_assistant/lib/types.ts` | Modify | `McpToolContext.uiParts` |
| `packages/ai-assistant/src/modules/ai_assistant/lib/ai-agent-definition.ts` | Modify | `version`, `LoopTrace.runId`, `toolCallId` |
| `packages/ai-assistant/src/modules/ai_assistant/data/entities.ts` | Modify | Three entities |
| `packages/ai-assistant/src/modules/ai_assistant/data/validators.ts` | Modify | List/detail query schemas |
| `packages/ai-assistant/src/modules/ai_assistant/encryption.ts` | Modify | Encryption entries |
| `packages/ai-assistant/src/modules/ai_assistant/acl.ts`, `setup.ts` | Modify | Features + defaults |
| `packages/ai-assistant/src/modules/ai_assistant/events.ts` | Modify | New event |
| `packages/ai-assistant/src/modules/ai_assistant/di.ts` | Modify | `aiAgentRunReader` |
| `packages/ai-assistant/src/modules/ai_assistant/api/ai/runs/route.ts`, `runs/[id]/route.ts`, `conversations/[conversationId]/runs/route.ts` | Create | APIs |
| `packages/ai-assistant/src/modules/ai_assistant/api/ai/chat/route.ts`, `run-object/route.ts` | Modify | `runId` plumbing |
| `packages/ai-assistant/src/modules/ai_assistant/backend/config/ai-assistant/runs/**` | Create | Pages |
| `packages/ai-assistant/src/modules/ai_assistant/workers/ai-agent-run-prune.ts`, `cli.ts` | Create / Modify | Retention |
| `packages/ai-assistant/src/modules/ai_assistant/migrations/Migration<ts>_ai_assistant.ts` | Create | Schema |
| `packages/ui/src/ai/citations/registry.ts`, `parts/CitationsPart.tsx`, `ui-part-registry.ts`, `AiChat.tsx`, `LoopTracePanel.tsx`, `useAiChat.ts`, `index.ts` | Create / Modify | Citations + trace link |
| `packages/enterprise/src/modules/agent_orchestrator/lib/runtime/nativeTraceCapture.ts`, `nativeAgentRunner.ts`, `components/citationResolvers.ts` | Modify | Reuse helper, `persist:false`, registry shim |

### Testing Strategy

**Unit (Jest):**
- `loop-step-extraction.test.ts`: AI SDK 7 `input` / `toolResults.output` / `tool-error` parts; legacy `args`/`result`; unmatched result ids; timings map.
- `agent-runtime.loop-trace.test.ts`: collector returns populated args/results with a mocked `onStepFinish` event shaped like AI SDK 7.
- `agent-run-recorder.test.ts`: capture levels, truncation flags, encryption-relevant fields omitted at `metadata`, failure never throws, aborted status, citations aggregation.
- Definition hash stability (same definition → same hash; prompt change → different hash; `modelSettings` change → different hash).
- `agent-call-contract.test.ts`: `callSettings` merged over `modelSettings` key by key and forwarded to the AI SDK call; `observe.onModelCallStart` fires once per step with the settings as sent (mock model, tool loop with `prepareStep`); a throwing observer does not fail the run; `trace.persist: false` writes no run.
- `citations.test.ts`: schema, `isSafeHref` rejects `javascript:` / `data:`; dedupe; no-op without queue.
- `ui`: `CitationsPart.test.tsx` (merge, fallback on resolver throw, external link rel), `citations/registry.test.ts` (moved AO tests), `LoopTracePanel` i18n.
- AO: existing `native-trace-tool-calls.test.ts` and `proposal-decision-card.test.tsx` stay green through the shims.

**Integration (Playwright, `ai_assistant/__integration__/`, self-contained fixtures, cleanup in `finally`; stubbed model via the existing test provider used by `TC-AI-AGENT-LOOP-001-006`):**
- `TC-AI-RUN-TRACE-015`: chat turn with one tool call → `GET /ai/conversations/:id/runs` returns one run; `GET /ai/runs/:id` shows the tool call with non-empty `args` and `result`, `modelId`, `promptOverrideVersion` (create a prompt override fixture first), `agentDefinitionHash`.
- `TC-AI-RUN-TRACE-016`: `run-object` returns `runId`; run row has `channel: 'run-object'`.
- `TC-AI-RUN-TRACE-017`: access: user B without `runs.view_all` gets 404 for user A's private-conversation run; with a shared conversation + `runs.view` gets 200.
- `TC-AI-RUN-TRACE-018`: `OM_AI_RUN_TRACE_CAPTURE=metadata` (test env toggle) → no `args` / `result` / text stored; `argKeys` present.
- `TC-AI-RUN-UI-019`: runs list page loads (hydration smoke), filter by agent, open detail, "Open conversation" link.
- `TC-AI-CITATIONS-020`: test tool calling `emitCitations` → `data-aiui` chunk with `ai_assistant:citations`; message renders numbered sources; reload restores them (persisted `ui_parts`); run detail "Sources" shows them.

## Risks & Impact Review

### Data Integrity Failures
- Run + steps + tool calls are written in one transaction; a failure leaves no partial run. A crash mid-turn loses the run but not token usage or messages.
- Conversation deletion soft-deletes runs in the same operation; if that update fails, the prune worker still removes runs by age.

### Cascading Failures & Side Effects
- Recorder failure never affects the chat response (post-stream, best-effort, `reportError`).
- `ai_assistant.agent_run.completed` subscribers run asynchronously (persistent event); a failing subscriber never blocks the recorder.

### Tenant & Data Isolation Risks
- Every query scopes by `tenant_id` + `organization_id` from auth; detail returns 404 out of scope.
- Shared conversations: run visibility follows the conversation's read rules plus the feature, never wider.

### Migration & Deployment Risks
- New tables only; no backfill; zero-downtime. Rollback leaves unused tables.

### Operational Risks
- Storage: about 1 run + N steps + M tool calls per chat turn, with payloads capped at 16 KB. At 10k turns/day with 3 tool calls each, that is ~40k rows/day and under ~1.5 GB per 30 days at worst-case caps. Retention bounds growth; `metadata` capture level is the lever for heavy tenants.
- Hot path: recorder runs after the response stream closes; measured overhead target < 5 ms on the request thread.

### Risk Register

#### Personal data persisted in traces
- **Scenario**: Tool args/results or model text contain customer PII and stay in `ai_agent_run_*` tables.
- **Severity**: High
- **Affected area**: GDPR / data-subject requests, `ai_assistant`
- **Mitigation**: Encryption maps on all content columns; `findWithDecryption`; 16 KB caps; default 30-day retention; `metadata` / `off` capture levels; system prompt off by default; feature-gated read API.
- **Residual risk**: No per-subject erasure index for runs (content is encrypted and not searchable); erasure relies on retention or conversation deletion. Documented.

#### Duplicate runs for AO native runs
- **Scenario**: AO runner calls `runAiAgentObject` before the `persist:false` change ships.
- **Severity**: Low
- **Affected area**: Storage, runs list noise
- **Mitigation**: Same-release enterprise change; such rows carry `channel: 'internal'` and are filterable.
- **Residual risk**: Minimal.

#### Citation link injection
- **Scenario**: A tool or a manipulated retrieved document produces a `javascript:` or phishing `href`.
- **Severity**: Medium
- **Affected area**: Chat UI
- **Mitigation**: `isSafeHref` server-side (relative or http(s) only) plus a second check client-side; external links open in a new tab with `noopener noreferrer`; resolvers can rewrite hrefs to trusted routes.
- **Residual risk**: An http(s) link to a hostile site from a poisoned source; the label shows the host.

#### Fabricated sources
- **Scenario**: Users trust citations that do not support the answer.
- **Severity**: Medium
- **Affected area**: Answer quality perception
- **Mitigation**: Citations come only from tool results (what was retrieved), never parsed from model text; the quote is the retrieved passage. Grounding checks (cite-or-abstain) remain an AO guardrail.
- **Residual risk**: A retrieved-but-unused source can still appear; acceptable and labelled "Sources consulted".

#### Collector change alters what playground/debug shows
- **Scenario**: Consumers that relied on empty `args` (none known) see real data.
- **Severity**: Low
- **Affected area**: Playground, debug panel
- **Mitigation**: The debug panel is gated by `debug`; data comes from the caller's own turn.
- **Residual risk**: None.

## Final Compliance Report — 2026-10-21

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/ai-assistant/AGENTS.md`
- `packages/ui/AGENTS.md` (UI parts, DataTable, loading/error states)
- `packages/core/AGENTS.md` (Encryption, Cross-Module Coupling, Module Setup / ACL grant sync)
- `packages/enterprise/src/modules/agent_orchestrator/AGENTS.md` (citations, trace plane)
- `.ai/specs/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | FK ids only (`pending_action_id`, `conversation_id`, `user_id`) |
| root AGENTS.md | Filter by `organization_id` | Compliant | All queries scoped |
| root AGENTS.md | `findWithDecryption` for encrypted reads | Compliant | Reader + routes |
| root AGENTS.md | Optimistic locking on new user-editable entities | N/A | Runs are system telemetry, not user-editable; no update/delete API |
| root AGENTS.md | Never hard-code user-facing strings | Compliant | New keys; `LoopTracePanel` migrated |
| root AGENTS.md | DS: no hard-coded status colors / arbitrary sizes | Compliant | `StatusBadge`, semantic tokens |
| root AGENTS.md | `pageSize ≤ 100` | Compliant | Validators cap at 100 |
| packages/core/AGENTS.md | Upstream never resolves consumer | Compliant | Event + reader; AO subscribes |
| packages/core/AGENTS.md | ACL grant sync in `setup.ts` | Compliant | Defaults + sync command |
| packages/core/AGENTS.md | API routes export `openApi` | Compliant | All new routes |
| packages/ai-assistant/AGENTS.md | Never log credentials / raw tenant data | Compliant | Recorder logs ids only; content persisted encrypted |
| packages/ui/AGENTS.md | Namespaced, stable UI part ids | Compliant | `ai_assistant:citations` |
| BACKWARD_COMPATIBILITY.md | Additive changes; shims for moved paths | Compliant | AO citation path + extraction names re-exported |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | List omits content; detail returns encrypted fields decrypted |
| API contracts match UI/UX section | Pass | List/detail/conversation runs |
| Risks cover all write operations | Pass | Recorder, prune, conversation soft-delete |
| Commands defined for all mutations | Pass | No user mutations; system writes documented |
| Cache strategy covers all read APIs | Pass | No cache (low-traffic admin reads); CRUD list default behaviour |

### Non-Compliant Items
- None.

### Verdict
- **Fully compliant**: ready for implementation once Q1–Q4 defaults are confirmed.

## Future Work
- AO subscriber mirroring chat runs into `agent_runs` for online evals (Q2).
- OTLP exporter mapping `ai_agent_runs` → OTel GenAI spans (planned, not built).
- Per-step cost (price tables) on runs.
- Retrieved-context capture (full passages) beyond citations.

## Changelog
### 2026-10-21
- Initial specification (shared AI SDK 7 extraction, OSS run persistence, trace view, citations part + shared resolver registry, run metadata).
- 2026-10-21 — cross-spec consistency pass: added §6 as the canonical OSS model-call contract (`AiAgentCallSettings`, definition `modelSettings`, call-time `callSettings`, `observe: AiAgentCallObserver` with `onModelCallStart/End`, `trace: { persist, channel, correlationId }`) consumed by the AO observability and eval specs (they previously defined parts of it separately, with `params` vs `callSettings` naming); `model_params` now records `gen_ai.request.*` as sent via the observer; `channel` gains `tools-api`; `run-object` returns `agentRunId` (and writes no OSS row) for dispatcher-owned agents; explicit justification of the `full`-by-default divergence from AO's `metadata` default; citation registry contract checked against the implemented 2026-10-12 AO decision-card spec (ref caps, `key@version`, integrity verification is AO-only); linked sibling specs and the roadmap.
