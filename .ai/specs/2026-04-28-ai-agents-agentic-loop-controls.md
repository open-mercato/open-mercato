# AI Agents — First-Class Agentic Loop Controls

**Date:** 2026-04-28
**Status:** Draft
**Scope:** OSS, `@open-mercato/ai-assistant`
**Extends:**
- `.ai/specs/implemented/2026-04-11-unified-ai-tooling-and-subagents.md` (the wrapper runtime: `runAiAgentText` / `runAiAgentObject`, policy gate, mutation approvals, `<AiChat>` UI parts)
- `.ai/specs/2026-04-27-ai-agents-provider-model-baseurl-overrides.md` (per-axis resolution chain reused for the loop knobs)

## TLDR

The unified AI runtime already runs a tool-using loop — `lib/agent-runtime.ts` calls `streamText({ ..., stopWhen: stepCountIs(maxSteps ?? 10) })` so the SDK does not collapse to a single model call. That is the **only** loop primitive currently exposed: `AiAgentDefinition` carries `maxSteps?: number` and nothing else. The Vercel AI SDK at the version we ship (`ai@^6.0.168`) supports a much richer agentic-loop surface — `stopWhen` arrays, `stepCountIs` / `hasToolCall` / custom `StopCondition`, `prepareStep` (rewrite model/tools/messages/system/toolChoice/activeTools per step), `experimental_repairToolCall`, `onStepFinish`, `experimental_onStepStart` / `experimental_onToolCallStart` / `experimental_onToolCallFinish`, plus the new `ToolLoopAgent` (`Experimental_Agent`) class with its own `prepareCall` hook. Today none of those reach Open Mercato agents, and the recently-added native escape hatch (the `generateText` / `generateObject` callbacks on `runAiAgentText` / `runAiAgentObject`) only forwards `model`, `tools`, `system`, `messages`, `maxSteps` — so callers who need `prepareStep` or `repairToolCall` must drop all the way to Option A (raw SDK) and lose the policy gate, mutation approvals, prompt composition, attachment bridging, and tenant overrides.

This spec promotes the loop from "one cap on step count" to a first-class part of the agent contract, on parity with how `2026-04-27-ai-agents-provider-model-baseurl-overrides.md` promoted provider/model/baseURL. It is additive — `maxSteps` remains, the wrapper keeps applying `stepCountIs(maxSteps ?? 10)` when the agent declares nothing else, and every existing call site keeps working with no diff.

We add:

- **Phase 0** — declarative `loop` block on `AiAgentDefinition` (`stopWhen`, `prepareStep`, `onStepFinish`, `repairToolCall`, `activeTools`, `toolChoice`, plus the existing `maxSteps` reshaped as `loop.maxSteps` with a deprecated alias). The runtime threads these into `streamText` / `generateText` for chat agents and into `streamObject` / `generateObject` only for the primitives the object SDK accepts. Land this alone so module authors can express "stop on `customers.update_deal_stage`" or "swap to a smaller model after step 3" without waiting for the rest.
- **Phase 1** — per-call loop overrides on `runAiAgentText({ loop })` / `runAiAgentObject({ loop })`, resolved through the same precedence chain used for provider/model/baseURL (request → caller → tenant override → agent default → wrapper default).
- **Phase 2** — wrapper-prepared loop options forwarded into the native `generateText` / `generateObject` callbacks so Option B in `agents.mdx` covers the full agentic-loop surface (today the callback receives `{ model, tools, system, messages, maxSteps }` only; it will receive `{ stopWhen, prepareStep, onStepFinish, experimental_repairToolCall, activeTools, toolChoice, abortSignal }` too). The runtime composes its own `prepareStep` with the user's so the mutation-approval contract is preserved.
- **Phase 3** — operator-facing `loop.budget` knob (per-tenant, per-agent overrides table extension) covering `maxSteps`, `maxToolCalls`, `maxWallClockMs`, `maxTokens`, plus a per-tenant kill switch (`loop.disabled = true` collapses the agent to a single model call). Reuses the override-table architecture from Phase 4 of the provider/model/baseURL spec.
- **Phase 4** — playground + `<AiChat>` debug surfaces: render the per-step trace (model used, tools called, repair attempts, `prepareStep` overrides applied, stop reason). Add a per-turn `loopPolicy` query param on the dispatcher route gated by the existing `allowRuntimeModelOverride` flag (which becomes `allowRuntimeOverride`).
- **Phase 5** — opt-in `ToolLoopAgent` (Vercel `Experimental_Agent`) backend: agents may declare `executionEngine: 'tool-loop-agent'` to delegate to the SDK's `Agent` class; the wrapper still composes prompt/tools/policy/approvals and threads them through `prepareCall`. Covers the "I want the AI SDK's first-class Agent ergonomics" use case without forking the runtime.

Object-mode constraint: `generateObject` / `streamObject` accept `stopWhen` only on certain providers and ignore `prepareStep` / `repairToolCall` entirely. The runtime applies what the SDK accepts, no-ops the rest, and emits a single dev-time warning per agent — never a silent drop. (This also retires the dead `(generateArgs as Record<string, unknown>).stopWhen = stopWhen` cast in `agent-runtime.ts:597`.)

OpenCode Code Mode is **not** touched.

## Overview

Three audiences want first-class agentic loops, in priority order:

1. **Module authors** (today: `customers`, `catalog`, `inbox_ops`) want declarative loop control: "this agent must stop right after it calls `catalog.apply_attribute_extraction` because the result is shown to the user verbatim", "this agent's first step uses Sonnet then steps 2+ use Haiku to keep cost down", "if the model produces a malformed `customers.update_deal_stage` argument, repair it to the closest valid stage instead of failing the turn".
2. **Operators** (settings UI) want budget control: "cap every agent in this tenant at 6 steps", "kill-switch `catalog.merchandising_assistant` because last week's run cost $40 in one turn".
3. **Power users** (callers of `runAiAgentText` / `runAiAgentObject`) want per-call escape hatches: "for this evaluation harness run, override `prepareStep` to capture every intermediate message" — without giving up the policy gate, mutation approvals, or `<AiChat>` UI parts.

Today only audience #1's "step count cap" is reachable, via `agent.maxSteps`. Audiences #2 and #3 cannot do their jobs without going to Option A (raw SDK) and losing the wrapper.

## Problem Statement

### P1 — Loop control collapses to one knob

`AiAgentDefinition` exposes `maxSteps?: number` (defined at `lib/ai-agent-definition.ts:49`). The runtime applies it as `stopWhen: stepCountIs(agent.maxSteps ?? 10)` (at `lib/agent-runtime.ts:373–386` for chat, `:555–557` for object).

Real agents need more than a step cap:

- **`customers.account_assistant`** wants to stop the loop the moment `customers.update_deal_stage` is called so the operator sees the proposal card before the model "summarizes the change". Today the model can keep calling read tools after it has emitted the mutation, which delays the approval card.
- **`catalog.merchandising_assistant`** wants step 1 on Claude Sonnet (`reasoning-heavy`) and steps 2+ on Claude Haiku (`tool-heavy`) — i.e., a per-step model swap. This is exactly what Vercel SDK's `prepareStep` is for.
- **`inbox_ops`** (legacy stack, will adopt the new framework in Phase 3 of the unification spec) wants to **repair** common malformed tool-call shapes (e.g., the model emits a 5-digit zip when the schema wants `string`) without the loop terminating with a tool-validation error.

None of these work today. The first one cannot be expressed; the second one requires forking the runtime; the third one drops to Option A.

### P2 — The native SDK escape hatch covers `generateText`, not the loop

The recently-added `generateText` / `generateObject` callback hooks on `runAiAgentText` / `runAiAgentObject` (`agents.mdx` "Option B", commit `434bbc561`) thread the wrapper's `model`, `tools`, `system`, `messages`, `maxSteps` through to a user callback that ultimately calls AI SDK `generateText` / `streamText` / `generateObject` / `streamObject`.

The callback signature documented in `agents.mdx`:

```ts
generateText: async ({ model, tools, system, messages, maxSteps }) => { /* call AI SDK */ }
```

Misses every other loop primitive. A caller who wants `prepareStep` has to either:

- Ignore the supplied bag and reconstruct the world (and lose the wrapper's mutation-approval composition because the caller cannot recreate the runtime's `prepareStep`-shaped `prepareMutation` interception), or
- Drop to Option A (raw SDK), losing policy gate, prompt composition, tenant overrides, attachments, and `<AiChat>` UI parts.

### P3 — Mutation approvals depend on a wrapper-owned `prepareStep`, but no wrapper-owned `prepareStep` exists

The mutation-approval contract (D16, see `apps/docs/docs/framework/ai-assistant/mutation-approvals.mdx`) requires that any `isMutation: true` tool's call is **intercepted before execution** so it lands in `ai_pending_actions` instead of running. Today the interception happens inside the tool wrappers built by `resolveAiAgentTools` (`lib/agent-tools.ts`) — every mutation tool's wrapper rewrites the handler to call `prepareMutation(...)` instead of the real handler.

This is fine **as long as the user does not supply their own tools to the AI SDK call**. The Phase 2 native callback already documents that "If your callback ignores the supplied `tools` ... you also bypass tool whitelisting, prompt composition, and mutation approvals." But the cleaner contract is **wrapper-owned `prepareStep`**: a loop hook that re-asserts the tool whitelist + mutation-approval interception per step, no matter how the caller composes the rest. We don't have one today.

### P4 — `stopWhen` on `generateObject` is dead code

`agent-runtime.ts:591–598` already documents the issue:

```ts
if (stopWhen) {
  // generateObject shares `CallSettings` with generateText; stopWhen is ignored
  // by the typed surface but harmless for providers that respect it...
  ;(generateArgs as Record<string, unknown>).stopWhen = stopWhen
}
```

We are casting through `unknown` to set a field the SDK admits it ignores. Two of the three real "object" providers (Anthropic, OpenAI) drop it; Google occasionally honors it. The cast is a footgun — it implies object-mode supports `stopWhen` when in practice it doesn't. The right answer is to (a) remove the cast and (b) document the object-mode contract in the spec/AGENTS.md/agents.mdx so module authors do not assume parity with chat-mode.

### P5 — Operators have no budget control

Two real incidents on the develop branch in the last week:

- A `catalog.merchandising_assistant` run looped 18 times against a 50-product bulk update, each step calling `catalog.list_products` with overlapping page windows. With `maxSteps: 20` (the SDK default for the new `Agent` class) the loop never tripped, and the run cost ~$40 of Anthropic credits.
- A `customers.account_assistant` run on a tenant with no API rate-limit ceiling exhausted the Anthropic per-minute quota mid-step, which left an `ai_pending_actions` row in `pending` for 18 minutes (until the cleanup worker expired it) — far longer than the operator-tolerable "approve within ~2 minutes" window.

Operators have no per-tenant knob to say "cap at 6 steps", "cap at 30 seconds wall-clock", or "kill-switch this agent". They can edit `agent.maxSteps` in code, but that ships with the next deploy, not in 30 seconds.

### P6 — Loop telemetry is invisible in the playground

The agent playground at `/backend/config/ai-assistant/playground` shows the final assistant message and the resolved provider/model/baseURL header (per the 2026-04-27 spec). It shows nothing about the **loop**:

- How many steps actually ran.
- Which model each step used (relevant once `prepareStep` can swap models).
- Which tools were called per step.
- Whether `repairToolCall` fired and what it repaired.
- Why the loop stopped (`stepCountIs`, `hasToolCall`, finish reason `'stop'` / `'tool-calls'` / `'length'`, manual abort, budget kill-switch).

Without this, a module author tuning `prepareStep` is debugging blind.

## Proposed Solution

### Resolution chain — per loop axis

Each loop axis (`stopWhen`, `prepareStep`, `onStepFinish`, `repairToolCall`, `activeTools`, `toolChoice`, `maxSteps`, `budget`) walks the same precedence used by the provider/model/baseURL spec. This keeps the mental model **one rule** — "request → caller → tenant override → agent default → wrapper default" — instead of N different chains.

| # | Source                                                                | Type of override                          |
|---|-----------------------------------------------------------------------|-------------------------------------------|
| 1 | Per-request HTTP query / chat-UI picker (`?loopBudget=tight`)         | Phase 4 — gated by `allowRuntimeOverride` |
| 2 | Caller override — `runAiAgentText({ loop: { ... } })`                  | Phase 1                                    |
| 3 | Per-tenant settings override (DB) — `ai_agent_runtime_overrides.loop_*` | Phase 3                                  |
| 4 | `<MODULE>_AI_LOOP_*` env (only `MAX_STEPS`, `BUDGET_TOKENS`, `BUDGET_MS`) | Phase 3                                |
| 5 | Agent definition — `agent.loop` (also accepts the legacy `agent.maxSteps`) | Phase 0                                |
| 6 | Wrapper default (`stepCountIs(10)` for chat, `undefined` for object)  | existing                                  |

Steps 1 and 3 are gated by `agent.allowRuntimeOverride` (renamed from `allowRuntimeModelOverride` in the provider/model spec — same flag, broader scope; renaming covered in Phase 4).

### Phase 0 — declarative `loop` block on `AiAgentDefinition`

Add `loop?: AiAgentLoopConfig` to `AiAgentDefinition`. Keep `maxSteps?: number` as a deprecated alias that the runtime maps to `loop.maxSteps`. Wrapping in a single object keeps the surface tidy and makes the override table simple (one column per loop axis).

```ts
// lib/ai-agent-definition.ts (additive)
export type AiAgentLoopStopCondition =
  | { kind: 'stepCount'; count: number }            // → stepCountIs(count)
  | { kind: 'hasToolCall'; toolName: string }       // → hasToolCall(toolName)
  | { kind: 'custom'; stop: StopCondition<ToolSet> } // raw SDK predicate; runtime forbids it from a JSON-only override source

export interface AiAgentLoopBudget {
  maxToolCalls?: number   // hard cap across all steps in this turn; budget tracker aborts if exceeded
  maxWallClockMs?: number // wall-clock cap per turn; runtime aborts via AbortController
  maxTokens?: number      // input+output cap; aggregated from step `usage` fields
}

export interface AiAgentLoopConfig {
  maxSteps?: number
  stopWhen?: AiAgentLoopStopCondition | AiAgentLoopStopCondition[]
  prepareStep?: PrepareStepFunction<ToolSet>          // typed alias of AI SDK PrepareStepFunction
  onStepFinish?: GenerateTextOnStepFinishCallback<ToolSet>
  onStepStart?: GenerateTextOnStepStartCallback<ToolSet>           // experimental_onStepStart in the SDK; we expose it stable
  onToolCallStart?: GenerateTextOnToolCallStartCallback<ToolSet>   // experimental_onToolCallStart
  onToolCallFinish?: GenerateTextOnToolCallFinishCallback<ToolSet> // experimental_onToolCallFinish
  repairToolCall?: ToolCallRepairFunction<ToolSet>    // experimental_repairToolCall
  activeTools?: string[]                               // narrow per-step tool surface (still subset of allowedTools)
  toolChoice?: ToolChoice<ToolSet>
  budget?: AiAgentLoopBudget
  allowRuntimeOverride?: boolean                       // renamed from allowRuntimeModelOverride; default true
}

export interface AiAgentDefinition {
  // ... existing fields ...
  /** @deprecated Use `loop.maxSteps` instead. Honored as alias when `loop` is omitted. */
  maxSteps?: number
  loop?: AiAgentLoopConfig
}
```

The runtime resolves the effective config in this order (highest first), once per turn:

1. `runAiAgentText({ loop })` per-call override (Phase 1).
2. Tenant override row (Phase 3).
3. `agent.loop`.
4. Legacy `agent.maxSteps` mapped to `{ maxSteps: agent.maxSteps }`.
5. Wrapper default — chat: `{ maxSteps: 10 }`; object: `{ maxSteps: undefined }`.

The runtime translates `stopWhen` items via the AI SDK helpers (`stepCountIs`, `hasToolCall`) and passes a `StopCondition[]` to `streamText` / `generateText`. Tenant-sourced overrides may use only `kind: 'stepCount'` and `kind: 'hasToolCall'` (the JSON-safe variants); `kind: 'custom'` is rejected at the override repository (Phase 3).

The runtime always **composes** its own `prepareStep` with the user's:

```ts
const wrapperPrepareStep: PrepareStepFunction<ToolSet> = async (state) => {
  // a) re-narrow tools to `effectiveLoop.activeTools ?? agent.allowedTools`,
  //    re-check policy, re-route mutation tools through prepareMutation
  const guarded = composeWrapperStep(state, agent, effectiveLoop)
  // b) call user's prepareStep (if any) on top of the guarded state
  if (effectiveLoop.prepareStep) {
    const userOverride = await effectiveLoop.prepareStep({ ...state, ...guarded })
    return mergeStepOverrides(guarded, userOverride, agent) // merge enforces "tools subset of allowedTools, no mutation bypass"
  }
  return guarded
}
```

`mergeStepOverrides(...)` enforces:

- `tools` returned by the user's `prepareStep` MUST be a subset of `agent.allowedTools` after wrapper guarding. Anything extra is dropped, and a single per-turn warning is logged via the existing playground/debug channel.
- A user-supplied `prepareStep` that returns a `tools` map whose mutation tools are unwrapped (i.e., point at the raw handler instead of the `prepareMutation`-wrapped one) is rejected with `AgentPolicyError` code `loop_violates_mutation_policy`.

`onStepFinish` aggregates into a `LoopTrace` (see Phase 4); the user's `onStepFinish` is invoked after the wrapper's, and exceptions thrown by the user's hook are caught and logged but do not abort the turn (matches the SDK's own contract).

### Phase 1 — per-call loop overrides

`runAiAgentText({ loop })` and `runAiAgentObject({ loop })` accept the same `AiAgentLoopConfig`, validated and merged with the agent's via the same `mergeStepOverrides` rules. The `loop` field is gated by `agent.loop?.allowRuntimeOverride ?? true` — agents that pin a loop policy for correctness reasons can opt out.

For object mode, the runtime accepts `loop.maxSteps`, `loop.budget`, and `loop.onStepFinish` (the SDK fires it for `generateObject` too as of `ai@6`). It **rejects** `loop.prepareStep`, `loop.repairToolCall`, `loop.stopWhen`, `loop.activeTools`, `loop.toolChoice` with `AgentPolicyError` code `loop_unsupported_in_object_mode`. The cast at `agent-runtime.ts:597` is removed.

### Phase 2 — extend the native AI SDK callback signature

Today (post 434bbc561):

```ts
runAiAgentText({
  agentId, container, authContext, prompt,
  generateText: async ({ model, tools, system, messages, maxSteps }) => {
    return generateText({ model, tools, system, messages, maxSteps, providerOptions: { ... } })
  },
})
```

Phase 2 changes the bag so the wrapper-prepared loop primitives are available too:

```ts
runAiAgentText({
  agentId, container, authContext, prompt,
  generateText: async ({
    model, tools, system, messages,
    // existing maxSteps stays (alias for stopWhen array containing stepCountIs)
    maxSteps,
    // NEW Phase 2:
    stopWhen,            // StopCondition[] composed from agent.loop + caller loop override
    prepareStep,         // PrepareStepFunction wrapping policy + mutation-approval guards
    onStepFinish,        // wrapper trace aggregator + user hook chained
    onStepStart, onToolCallStart, onToolCallFinish,
    experimental_repairToolCall,
    activeTools, toolChoice,
    abortSignal,         // pre-wired to the per-turn AbortController used by budget enforcement
  }) => {
    return generateText({
      model, tools, system, messages,
      stopWhen, prepareStep, onStepFinish, onStepStart,
      experimental_onToolCallStart: onToolCallStart,
      experimental_onToolCallFinish: onToolCallFinish,
      experimental_repairToolCall,
      activeTools, toolChoice, abortSignal,
      providerOptions: { /* user's stuff */ },
    })
  },
})
```

The callback may pass any subset of those fields through to the SDK, but the wrapper documents (and AGENTS.md MUST-rules) that **dropping `stopWhen` is the same as dropping the agent's loop policy** (single-step run only); **dropping `prepareStep` is the same as dropping mutation-approval guards** (the same warning that already exists for "ignoring `tools`" in `agents.mdx`). The runtime cannot detect which fields the callback used vs. which it dropped, so this stays a documented contract, not a runtime check.

The matching `runAiAgentObject({ generateObject })` callback gets the equivalent additions — minus the chat-only fields the SDK rejects.

### Phase 3 — operator-facing budget + kill switch

Extend the `ai_agent_runtime_overrides` table (introduced in the provider/model spec Phase 4) with loop columns. All nullable; `null` means "no override on this axis":

| Column                     | Type        | Purpose                                                     |
|----------------------------|-------------|-------------------------------------------------------------|
| `loop_disabled`            | `boolean`   | Kill switch — when `true`, runtime forces `stopWhen: stepCountIs(1)` and ignores all other loop config. |
| `loop_max_steps`           | `int`       | Override `loop.maxSteps`.                                   |
| `loop_max_tool_calls`      | `int`       | Override `loop.budget.maxToolCalls`.                        |
| `loop_max_wall_clock_ms`   | `int`       | Override `loop.budget.maxWallClockMs`.                      |
| `loop_max_tokens`          | `int`       | Override `loop.budget.maxTokens`.                           |
| `loop_stop_when_json`      | `jsonb`     | Override `loop.stopWhen`. JSON-safe variants only (`stepCount`, `hasToolCall`); validator rejects `kind: 'custom'`. |
| `loop_active_tools_json`   | `jsonb`     | Override `loop.activeTools` (must be subset of `agent.allowedTools`). |

Migration: `Migration<...>_ai_agent_loop_overrides`, additive only — no rename of existing columns.

Tenant settings UI gains a "Loop policy" section: read-only display of the agent's declared loop config, an inline editor for the seven columns above, and a "kill switch" toggle that flips `loop_disabled`. The settings page MUST require `ai_assistant.settings.manage` (existing feature). When `loop_disabled` is set, the UI shows a status banner on the playground page and on `<AiChat>` headers ("agent loop disabled by tenant policy") so the operator team is not blindsided.

Env shorthand for static deployments — `<MODULE>_AI_LOOP_MAX_STEPS=6`, `<MODULE>_AI_LOOP_MAX_WALL_CLOCK_MS=30000`, `<MODULE>_AI_LOOP_MAX_TOKENS=200000`. Lower precedence than the DB override (matches the model spec).

Budget enforcement runs in the wrapper-owned `prepareStep` and `onStepFinish`. `maxSteps` is hard-capped by `stepCountIs` (already enforced by the SDK). `maxToolCalls` is tracked in the per-turn `LoopTrace` accumulator and aborts via the per-turn `AbortController` once exceeded. `maxWallClockMs` is enforced by a `setTimeout` that calls `controller.abort('budget:wallClock')`. `maxTokens` is enforced by aggregating `step.usage` and aborting on exceed.

When a budget abort fires mid-step, the runtime returns the partial assistant turn (whatever the SDK has already streamed) and emits a typed `loopAbortReason` field on the dispatcher response and on `LoopTrace` so the playground/`<AiChat>` can render "stopped: budget (wallClock)" instead of a generic abort.

### Phase 4 — playground + `<AiChat>` debug surfaces

The wrapper-owned `onStepFinish` builds a typed `LoopTrace`:

```ts
export interface LoopStepRecord {
  stepIndex: number
  modelId: string                      // resolved per step (relevant once prepareStep swaps models)
  toolCalls: Array<{ toolName: string; args: unknown; result?: unknown; error?: { code: string; message: string }; repairAttempted: boolean; durationMs: number }>
  textDelta: string                    // raw assistant text emitted in this step
  usage: { inputTokens: number; outputTokens: number }
  finishReason: 'stop' | 'tool-calls' | 'length' | 'content-filter' | 'error'
}

export interface LoopTrace {
  agentId: string
  turnId: string
  steps: LoopStepRecord[]
  stopReason: 'step-count' | 'has-tool-call' | 'custom-stop' | 'budget-tokens' | 'budget-tool-calls' | 'budget-wall-clock' | 'tenant-disabled' | 'finish-reason' | 'abort'
  totalDurationMs: number
  totalUsage: { inputTokens: number; outputTokens: number }
}
```

The playground page (`backend/config/ai-assistant/playground/page.tsx`) gains a "Loop" panel that renders `LoopTrace` per turn — collapsed by default, expandable per step. `<AiChat>` exposes the same trace via a debug toggle (already wired to the existing debug panel pattern).

`POST /api/ai_assistant/ai/chat` gains an additive query param `?loopBudget=<preset>` (`tight` | `default` | `loose` — validated against the agent's `allowRuntimeOverride` flag). Same pattern as `?provider=&model=&baseUrl=` from the model spec — gated by `allowRuntimeOverride`, sent by the chat UI picker, used by the playground "compare loops" experiment.

Rename `AiAgentDefinition.allowRuntimeModelOverride` (introduced in the provider/model spec) to `allowRuntimeOverride`. Keep the old field name as a deprecated alias on the type and at the resolution layer for one minor release. Since neither field has shipped to a stable release yet (the model spec is itself draft), the rename has zero stable-API impact.

### Phase 5 — opt-in `ToolLoopAgent` backend

`ai@6` ships `Experimental_Agent` (alias `ToolLoopAgent`) — a reusable `Agent` class with its own `prepareCall` hook and a default `stopWhen: stepCountIs(20)`. It is closer to "an agent" semantically than `streamText` plus knobs, and several upcoming SDK features (multi-agent handoff, streaming approval responses) land there first.

Add `executionEngine?: 'stream-text' | 'tool-loop-agent'` to `AiAgentDefinition` (default `'stream-text'`, the current behavior). When set to `'tool-loop-agent'`, the runtime constructs a `ToolLoopAgent` once per agent registry entry, hands it the resolved `model`, `tools`, `system`, `stopWhen`, `prepareStep` (still wrapper-composed), and dispatches via `agent.generate(...)` / `agent.stream(...)` per turn. The wrapper-owned `prepareStep` is threaded through `prepareCall` so policy + mutation-approval guarantees still hold.

The escape-hatch callback gains an `agent` field on the prepared options bag when this engine is selected, so callers can call `agent.generate(...)` with their own `providerOptions` directly.

This phase is opt-in per agent and adds no churn to existing agents.

## Architecture

### Runtime data flow (chat agent, Phase 0+1+2)

```
runAiAgentText({ agentId, prompt, loop: callerLoop, generateText: cb })
   │
   ▼
checkAgentPolicy(agent, authContext)         (existing)
resolveAiAgentTools(agent, allowedTools)     (existing — wraps mutations w/ prepareMutation)
composeSystemPrompt(agent, pageContext)       (existing)
createModelFactory(...).resolve()             (existing)
   │
   ▼
resolveEffectiveLoopConfig(agent, callerLoop, tenantOverride, env, wrapperDefault)
   │  → AiAgentLoopConfig (effectiveLoop)
   ▼
buildWrapperPrepareStep(agent, effectiveLoop) → composes user.prepareStep
buildLoopTraceCollector(turnId)               → wraps onStepFinish + budget enforcement
buildAbortController(effectiveLoop.budget)    → wires wallClock/tokens to controller.abort
   │
   ▼
preparedOptions = { model, tools, system, messages, maxSteps,
                    stopWhen, prepareStep, onStepFinish, onStepStart,
                    experimental_onToolCallStart, experimental_onToolCallFinish,
                    experimental_repairToolCall, activeTools, toolChoice, abortSignal }
   │
   ├── if `cb` (escape hatch): cb(preparedOptions)  ← caller may forward subset
   └── else: streamText(preparedOptions)            ← default path
   │
   ▼
streamText / cb returns; LoopTrace finalized; mutation approvals materialized via existing `ai_pending_actions` insertions
```

### Runtime data flow (object agent, Phase 0+1+2)

Same shape as chat, with these differences enforced by `resolveEffectiveLoopConfig`:

- `loop.prepareStep` / `loop.repairToolCall` / `loop.stopWhen` / `loop.activeTools` / `loop.toolChoice` are rejected with `loop_unsupported_in_object_mode`.
- Only `loop.maxSteps`, `loop.budget`, `loop.onStepFinish`, `loop.onStepStart` are honored.
- The dead `(generateArgs as Record<string, unknown>).stopWhen` cast is removed.

### Composing wrapper `prepareStep` with user `prepareStep`

```ts
function buildWrapperPrepareStep(
  agent: AiAgentDefinition,
  effectiveLoop: AiAgentLoopConfig,
  authContext: AiChatRequestContext,
  toolRegistry: ResolvedAiToolMap,
): PrepareStepFunction<ToolSet> {
  return async (state) => {
    const wrapperOverride: PrepareStepResult<ToolSet> = {}

    // 1) Narrow tools to `effectiveLoop.activeTools ?? agent.allowedTools`.
    if (effectiveLoop.activeTools && effectiveLoop.activeTools.length > 0) {
      wrapperOverride.activeTools = effectiveLoop.activeTools.filter(
        (name) => agent.allowedTools.includes(name),
      )
    }

    // 2) Apply tenant kill-switch.
    if (effectiveLoop.disabled) {
      // Cannot inject stopWhen mid-loop; rely on resolveEffectiveLoopConfig
      // having already replaced stopWhen with stepCountIs(1).
    }

    // 3) Defer to the user's prepareStep, then merge.
    if (effectiveLoop.prepareStep) {
      const userOverride = await effectiveLoop.prepareStep(state)
      return mergeStepOverrides(state, wrapperOverride, userOverride, agent, toolRegistry)
    }

    return wrapperOverride
  }
}
```

`mergeStepOverrides` is the security-critical piece. It guarantees:

- Any `tools` map returned by the user is intersected with `toolRegistry` (the policy-gated, mutation-approval-wrapped map). If the user returned a raw `customers.update_deal_stage` handler, the merged map points at the wrapped one.
- Any `activeTools` returned by the user is intersected with `agent.allowedTools`. Out-of-set names are dropped with a single `loop:active_tools_filtered` warning.
- A user-returned `system` or `messages` is honored (these are non-policy fields).
- A user-returned `model` or `toolChoice` is honored (model resolution is already policy-checked at the factory level, and `toolChoice` cannot escalate beyond active tools).

### Operator override resolution

Reuses the table introduced in `2026-04-27-ai-agents-provider-model-baseurl-overrides.md` Phase 4. Repository helper `findRuntimeOverride(tenantId, organizationId | null, agentId)` is extended to return the loop columns alongside the provider/model/baseURL columns. The repository validates `loop_stop_when_json` and `loop_active_tools_json` at write time so a malformed override never reaches the runtime.

### Compatibility with mutation approvals (D16)

The existing contract:

1. Tool registry wraps every `isMutation: true` tool's `execute` with `prepareMutation(...)`.
2. Model emits a tool call → SDK invokes the wrapped `execute` → `prepareMutation` writes to `ai_pending_actions` and returns `{ status: 'pending', pendingActionId }` to the model.
3. Model continues (or the loop terminates per `stopWhen: hasToolCall(...)`).
4. Operator confirms in `<AiChat>` → `executePendingActionConfirm` runs the real handler.

This spec preserves the contract intact:

- The wrapper `prepareStep` re-asserts the wrapped tool map per step. A user `prepareStep` that returns a `tools` map cannot smuggle in raw mutation handlers (rejected by `mergeStepOverrides`).
- The new `stopWhen` recipe `{ kind: 'hasToolCall', toolName: 'customers.update_deal_stage' }` lets module authors say "stop right after the mutation card is queued, do not let the model continue" — a real use case raised by the customers team.
- Budget aborts (`maxWallClockMs`, `maxToolCalls`) cannot leave a "half-applied" mutation because the mutation is staged in `ai_pending_actions`, not executed inline. Existing TTL + cleanup worker handles abandoned approvals.

## Data Models

### Migration: `Migration<...>_ai_agent_loop_overrides`

Adds columns to the existing `ai_agent_runtime_overrides` table. All nullable, all default `NULL`:

| Column                  | Type      | Default | Notes                                      |
|-------------------------|-----------|---------|--------------------------------------------|
| `loop_disabled`         | `boolean` | `NULL`  | Kill switch.                               |
| `loop_max_steps`        | `int`     | `NULL`  | Override.                                  |
| `loop_max_tool_calls`   | `int`     | `NULL`  | Override.                                  |
| `loop_max_wall_clock_ms`| `int`     | `NULL`  | Override.                                  |
| `loop_max_tokens`       | `int`     | `NULL`  | Override.                                  |
| `loop_stop_when_json`   | `jsonb`   | `NULL`  | JSON-safe variants only.                   |
| `loop_active_tools_json`| `jsonb`   | `NULL`  | Subset of `agent.allowedTools`.            |

No indexes added — primary key + tenant scope already cover the lookup pattern. Migration is reversible; downgrade drops the columns.

### Type additions

```ts
// packages/ai-assistant/src/modules/ai_assistant/lib/ai-agent-definition.ts
export type AiAgentExecutionEngine = 'stream-text' | 'tool-loop-agent'

export interface AiAgentDefinition {
  // ... existing ...
  executionEngine?: AiAgentExecutionEngine     // Phase 5
  loop?: AiAgentLoopConfig                      // Phase 0
  /** @deprecated Use `loop.maxSteps`. */
  maxSteps?: number
  /** @deprecated Renamed to `allowRuntimeOverride` in Phase 4. */
  allowRuntimeModelOverride?: boolean
  allowRuntimeOverride?: boolean
}
```

### `LoopTrace` event payload

`LoopTrace` is **not** persisted. It is in-memory only and surfaced via the dispatcher SSE stream and the playground/`<AiChat>` debug panel. Persisting per-turn loop traces would create an audit-trail compliance question we do not want to open in this spec — see Risks.

## API Contracts

### `runAiAgentText` / `runAiAgentObject` input changes

```ts
export interface RunAiAgentTextInput {
  // ... existing ...
  loop?: Partial<AiAgentLoopConfig>           // Phase 1
  generateText?: (preparedOptions: PreparedAiSdkOptions) => Promise<GenerateTextResult> | ReturnType<typeof streamText>  // Phase 2 (extended)
}

export interface RunAiAgentObjectInput<TSchema = unknown> {
  // ... existing ...
  loop?: Partial<Pick<AiAgentLoopConfig, 'maxSteps' | 'budget' | 'onStepFinish' | 'onStepStart' | 'allowRuntimeOverride'>>  // Phase 1 (object-safe subset)
  generateObject?: (preparedOptions: PreparedAiSdkObjectOptions) => Promise<GenerateObjectResult<TSchema>> | ReturnType<typeof streamObject>  // Phase 2
}

export interface PreparedAiSdkOptions {
  model: LanguageModel
  tools: ToolSet
  system: string
  messages: ModelMessage[]
  // existing
  maxSteps: number
  // Phase 2 additions:
  stopWhen: StopCondition<ToolSet> | StopCondition<ToolSet>[]
  prepareStep: PrepareStepFunction<ToolSet>
  onStepFinish: GenerateTextOnStepFinishCallback<ToolSet>
  onStepStart: GenerateTextOnStepStartCallback<ToolSet>
  onToolCallStart: GenerateTextOnToolCallStartCallback<ToolSet>
  onToolCallFinish: GenerateTextOnToolCallFinishCallback<ToolSet>
  experimental_repairToolCall?: ToolCallRepairFunction<ToolSet>
  activeTools?: string[]
  toolChoice?: ToolChoice<ToolSet>
  abortSignal: AbortSignal
}
```

### `POST /api/ai_assistant/ai/chat` query params

Additive, all optional, all gated by `allowRuntimeOverride`:

| Param             | Type      | Effect                                                |
|-------------------|-----------|-------------------------------------------------------|
| `loopMaxSteps`    | `int`     | Caller override of `loop.maxSteps` for this turn.     |
| `loopBudget`      | `tight \| default \| loose` | Preset that maps to a fixed `loop.budget` triple. |
| `loopActiveTools` | comma list | Caller override of `loop.activeTools`.              |

`loopStopWhen` is **not** exposed via query params — too easy to footgun (you could lock the loop to never terminate). Caller code that needs `stopWhen` overrides must use `runAiAgentText({ loop: { stopWhen: ... } })`.

### Error codes

`AgentPolicyError.code` gains:

| Code                                    | Origin                                                     |
|-----------------------------------------|------------------------------------------------------------|
| `loop_unsupported_in_object_mode`       | Object-mode rejects `prepareStep` / `repairToolCall` / `stopWhen` / `activeTools` / `toolChoice`. |
| `loop_violates_mutation_policy`         | User `prepareStep` returned a `tools` map with a raw mutation handler. |
| `loop_active_tools_outside_allowlist`   | `loop.activeTools` had names not in `agent.allowedTools`. (Permissive: dropped + warning, not thrown, except when caller-supplied — then thrown.) |
| `loop_budget_exceeded`                  | Budget abort short-circuited the turn. Surfaced as a *finish* condition, not a 5xx. |
| `loop_disabled_by_tenant`               | Tenant kill switch active; runtime still completes the turn but as a single-step run. Logged at `info`, not raised. |

## Risks & Impact Review

| # | Risk                                                                       | Severity | Affected area                                | Mitigation                                                                                                  | Residual                                  |
|---|----------------------------------------------------------------------------|----------|----------------------------------------------|-------------------------------------------------------------------------------------------------------------|-------------------------------------------|
| 1 | A user `prepareStep` smuggles a raw mutation handler into the tool map.    | High     | Mutation approvals (D16)                     | `mergeStepOverrides` re-intersects with the wrapper-owned tool map; raw handlers are replaced by wrapped. Test in `agent-runtime.test.ts`. | None — defense in depth holds.            |
| 2 | A budget abort lands mid-mutation and leaves an inconsistent state.        | Med      | Mutation approvals + tenant data            | Mutations stage in `ai_pending_actions`, not inline. Cleanup worker handles abandoned approvals.            | None.                                      |
| 3 | A misconfigured `stopWhen: hasToolCall(non-existent-tool)` runs forever.   | Med      | Cost                                         | Wrapper always passes `stepCountIs(loop.maxSteps ?? 10)` alongside user-supplied stop conditions. SDK treats `stopWhen` as OR semantics, so the step-count fallback always trips. | Cost ceiling = `maxSteps * step cost`.    |
| 4 | Object-mode users assume `stopWhen` works because chat-mode has it.        | Low      | DX                                           | `loop_unsupported_in_object_mode` thrown at definition load + `runAiAgentObject` call site. Documented in agents.mdx and module AGENTS.md. | None.                                      |
| 5 | Tenant override JSON is malformed (e.g., `loop_stop_when_json` has `kind: 'unknown'`). | Med | Runtime crash on every turn        | Repository validator at write time + runtime falls back to agent default with a `warn`-level log on read.   | One bad write blocked at boundary.        |
| 6 | `prepareStep` rebuilds the message array in a way that breaks attachments. | Low      | Attachment bridging                          | Wrapper `prepareStep` runs *first*; user `prepareStep` runs on the already-attached state. If user returns a fresh `messages`, the warning in agents.mdx applies (callback contract). | Documented contract.                      |
| 7 | `Phase 5` `ToolLoopAgent` opts into different default semantics (e.g., `stepCountIs(20)`). | Low | DX                                  | Default replaced at construction with the agent's resolved `loop` config; never relies on the SDK default.  | None.                                      |
| 8 | LoopTrace is in-memory only; an SRE cannot post-mortem a bad run.          | Med      | Observability                                | Existing telemetry integration (Phase 5.x of unification spec) emits per-step events to OpenTelemetry. Persistence is explicitly out of scope. | Operators can wire OTel sink themselves.  |
| 9 | `allowRuntimeModelOverride` rename to `allowRuntimeOverride` mid-phase.    | Low      | API surface                                  | Both names coexist for one minor release; new field wins; deprecated field warns at definition load. Provider/model spec is itself unimplemented, so blast radius is one branch. | None — additive rename.                   |
| 10| Removal of the dead `(generateArgs as Record<string, unknown>).stopWhen` cast changes object-mode behavior on Google. | Low | Object-mode consumers | Google-Gemini object users get a one-line release-note entry; the cast was already documented as ignored in 2 of 3 providers. | None.                                      |
| 11| Mass rollout of `loop_disabled = true` by an operator leaves users with single-step assistants and no warning. | Med | UX | Settings UI shows a banner on every page mounting `<AiChat>` for a disabled agent + a row banner in the playground. Telemetry counter `ai_assistant.loop_disabled.activations`. | Operator-driven; covered by audit.       |

## Final Compliance Report

### Backward Compatibility (per `BACKWARD_COMPATIBILITY.md`)

| Surface                          | Change                                                                                  | Classification                                | OK?  |
|----------------------------------|-----------------------------------------------------------------------------------------|-----------------------------------------------|------|
| Auto-discovery file conventions  | None (no new file shape; `ai-agents.ts` semantics unchanged).                           | FROZEN                                        | ✓    |
| Type definitions                 | `AiAgentDefinition` gains optional `loop`, `executionEngine`, `allowRuntimeOverride`. `maxSteps` becomes `@deprecated` alias of `loop.maxSteps`. | STABLE — additive | ✓    |
| Function signatures              | `runAiAgentText` / `runAiAgentObject` gain optional `loop`. Native callback bag gains optional fields. | STABLE — additive | ✓    |
| Import paths                     | None.                                                                                   | STABLE                                        | ✓    |
| Event IDs                        | None.                                                                                   | FROZEN                                        | ✓    |
| Widget injection spot IDs        | None.                                                                                   | FROZEN                                        | ✓    |
| API route URLs                   | `POST /api/ai_assistant/ai/chat` gains optional `loopMaxSteps` / `loopBudget` / `loopActiveTools` query params. Response shape additive (`loopTrace`, `loopAbortReason`). | STABLE — additive | ✓ |
| Database schema                  | `ai_agent_runtime_overrides` gains 7 nullable columns.                                  | ADDITIVE-ONLY                                 | ✓    |
| DI service names                 | None.                                                                                   | STABLE                                        | ✓    |
| ACL feature IDs                  | None — the existing `ai_assistant.settings.manage` covers the new UI section.           | FROZEN                                        | ✓    |
| Notification type IDs            | None.                                                                                   | FROZEN                                        | ✓    |
| CLI commands                     | None.                                                                                   | STABLE                                        | ✓    |
| Generated file contracts         | `ai-agents.generated.ts` gains the new optional fields. `BootstrapData` shape unchanged. | STABLE — additive                            | ✓    |

The `allowRuntimeModelOverride` → `allowRuntimeOverride` rename is the only rename, and the pre-rename name has not yet shipped to a stable release (its parent spec is `Draft`). Both names ship side-by-side for one minor release with the deprecated alias.

### Integration Coverage

Per the root `AGENTS.md` rule that every new feature MUST list integration coverage:

- **API:** `POST /api/ai_assistant/ai/chat` with each new query param (`loopMaxSteps`, `loopBudget`, `loopActiveTools`); reject when `allowRuntimeOverride: false`.
- **Settings:** `/backend/config/ai-assistant` Loop policy panel — read, write, kill-switch toggle, banner display. Permission gate (`ai_assistant.settings.manage`).
- **Playground:** `/backend/config/ai-assistant/playground` — Loop trace renders all stop reasons (`step-count`, `has-tool-call`, `budget-tokens`, `budget-tool-calls`, `budget-wall-clock`, `tenant-disabled`, `finish-reason`, `abort`).
- **Chat UI:** `<AiChat>` Loop debug panel; `loopBudget` picker (when `allowRuntimeOverride`); banner when `loop_disabled`.
- **Mutation approvals:** `customers.update_deal_stage` agent run with `stopWhen: { kind: 'hasToolCall', toolName: 'customers.update_deal_stage' }` — confirm the loop terminates immediately and the approval card materializes.
- **Object mode:** `runAiAgentObject({ loop: { prepareStep } })` rejects with `loop_unsupported_in_object_mode`.

Integration tests live under `packages/ai-assistant/src/modules/ai_assistant/__integration__/` (existing pattern from `TC-AI-AGENT-SETTINGS-005`). New ids: `TC-AI-AGENT-LOOP-{001…006}`.

### Out of Scope

- OpenCode Code Mode (separate `mcp:serve` stack — unchanged).
- Persisted `LoopTrace` audit log (would need new table + retention policy).
- Cross-agent loop budgets ("this tenant has $X/day across all agents") — separate spec.
- Streaming partial mutation previews ("approve the first 10 of 50 bulk-update rows mid-loop") — separate spec, depends on this one.
- Rebinding `OPENCODE_PROVIDER` / `OPENCODE_MODEL` to the new framework — covered by the provider/model spec.

## Extension — Token Usage Tracking & Stats Page

> **Status:** Phase 6 of this spec. Independent of Phases 0–5 — can ship in any order, but reuses the `LoopTrace` shape from Phase 4 as the in-memory source of truth before persistence.

### TLDR

Every turn through `runAiAgentText` / `runAiAgentObject` already receives `usage: { inputTokens, outputTokens }` from the AI SDK (see `agent-runtime.ts:441,453,572,580,606`) and Phase 4 already builds a per-step `LoopStepRecord.usage`. Today nothing persists those numbers — they are dropped on the floor at the end of the turn. This phase adds a thin **persistence + aggregation + display** stack so operators can answer the three questions they keep asking:

1. **"What did agent X cost yesterday?"** — per-agent, per-day rollup (input + output tokens, by model).
2. **"What is the cost split per model in this tenant?"** — per-model, per-day rollup across all agents.
3. **"Show me the conversation that just consumed 80k tokens."** — per-session detail, drillable from either rollup.

We add one persistence table (`ai_token_usage_events`), one materialized rollup table (`ai_token_usage_daily`), a session id propagated end-to-end, a thin `recordTokenUsage` collector wired into the wrapper-owned `onStepFinish`, two read APIs, and a new "Usage" tab on the existing AI assistant settings page (`/backend/config/ai-assistant`). No pricing — the spec stores token counts only; price multiplication is a separate (and tenant-configurable) concern handled by a follow-up.

### Problem Statement

#### P7 — Token usage is observed-and-discarded

The runtime knows token counts on every step (chat: per-step `OnStepFinishEvent.usage`; object: final `usage`). They are surfaced in the dispatcher response and the `LoopTrace` Phase 4 will render in the playground, but nothing **persists** them. After the turn finishes the data is gone — there is no way to compute "total tokens consumed by `catalog.merchandising_assistant` last week" without re-running the load.

#### P8 — Operators cannot diagnose cost spikes

The two real incidents cited in P5 (the $40 catalog run, the customers stall during a quota exhaustion) were **diagnosed by tailing logs**. There is no first-class "open the settings page, look at this week's usage" surface. We have a settings page (`backend/config/ai-assistant/page.tsx`) and a playground (`.../playground/page.tsx`) — neither shows usage.

#### P9 — There is no per-session correlation

A "session" today means different things in different code paths:

- **OpenCode Code Mode**: `sessionId` from OpenCode, returned in the SSE `done` event, persisted in `opencodeSessionIdRef`.
- **Unified framework chat**: `conversationId` is already plumbed through `runAiAgentText` (we saw it at `agent-runtime.ts:350`), but it is optional and not echoed back to the caller.
- **Object-mode** runs: no notion of a session.

Cost analysis needs a single `sessionId` that ties every step of every turn together so "show me the session that cost 80k tokens" is answerable. This phase formalizes it.

### Proposed Solution

#### Phase 6.0 — `ai_token_usage_events` event log

New persistence table. Append-only. One row per **step** (chat) or per **turn** (object). Tenant-scoped, additive — no rename of any existing column.

| Column                  | Type            | Notes                                                                 |
|-------------------------|-----------------|-----------------------------------------------------------------------|
| `id`                    | `uuid` PK       |                                                                       |
| `tenant_id`             | `uuid` FK       | `null` only for the system-scope playground.                          |
| `organization_id`       | `uuid` FK       | nullable.                                                             |
| `user_id`               | `uuid` FK       | resolves the session principal.                                       |
| `agent_id`              | `text`          | e.g. `customers.account_assistant`.                                   |
| `module_id`             | `text`          | e.g. `customers`. Convenience for module-scoped reports.              |
| `session_id`            | `uuid`          | per-conversation; same value across every step + every turn of a chat. |
| `turn_id`               | `uuid`          | per-turn; matches `LoopTrace.turnId` from Phase 4.                    |
| `step_index`            | `int`           | step index within the turn (`0` for object-mode).                     |
| `provider_id`           | `text`          | `anthropic` / `openai` / `google` / preset id.                        |
| `model_id`              | `text`          | resolved per step (relevant once `prepareStep` swaps models).         |
| `input_tokens`          | `int`           | from `usage.inputTokens` (defaults to `0` when absent).               |
| `output_tokens`         | `int`           | from `usage.outputTokens`.                                            |
| `cached_input_tokens`   | `int` nullable  | populated when the SDK exposes it (Anthropic prompt caching, OpenAI cache hits). |
| `reasoning_tokens`      | `int` nullable  | populated when the model returns reasoning-token usage (Claude thinking, o-family). |
| `finish_reason`         | `text` nullable | `'stop'` / `'tool-calls'` / `'length'` / etc. — handy for filtering "length-aborted" rows. |
| `loop_abort_reason`     | `text` nullable | from Phase 4 `LoopTrace.stopReason` when the step finished the loop.   |
| `created_at`            | `timestamptz`   | step finish time.                                                     |

Indexes:

- `(tenant_id, created_at DESC)` — primary read pattern.
- `(tenant_id, agent_id, created_at DESC)` — per-agent rollup.
- `(tenant_id, model_id, created_at DESC)` — per-model rollup.
- `(tenant_id, session_id, turn_id, step_index)` — session drilldown.

Retention: configurable via env `AI_TOKEN_USAGE_EVENTS_RETENTION_DAYS` (default `90`). A new worker (Phase 6.4) prunes rows older than the retention window. The aggregated `ai_token_usage_daily` table is **not** pruned — it stays forever.

#### Phase 6.1 — `ai_token_usage_daily` rollup

Materialized daily rollup. One row per `(tenant_id, day, agent_id, model_id)` tuple. Updated incrementally by the same hook that writes the event (UPSERT via Postgres `INSERT ... ON CONFLICT DO UPDATE`), so the rollup never gets behind even if the worker is down.

| Column                  | Type            | Notes                                                                 |
|-------------------------|-----------------|-----------------------------------------------------------------------|
| `id`                    | `uuid` PK       |                                                                       |
| `tenant_id`             | `uuid` FK       |                                                                       |
| `organization_id`       | `uuid` FK       | nullable.                                                             |
| `day`                   | `date`          | UTC day boundary; tenant-local rendering happens client-side.         |
| `agent_id`              | `text`          |                                                                       |
| `model_id`              | `text`          |                                                                       |
| `provider_id`           | `text`          | denormalized for filter joins.                                        |
| `input_tokens`          | `bigint`        | sum.                                                                  |
| `output_tokens`         | `bigint`        | sum.                                                                  |
| `cached_input_tokens`   | `bigint`        | sum (defaults to `0`).                                                |
| `reasoning_tokens`      | `bigint`        | sum (defaults to `0`).                                                |
| `step_count`            | `bigint`        | total steps observed.                                                 |
| `turn_count`            | `bigint`        | distinct turns observed.                                              |
| `session_count`         | `bigint`        | distinct sessions observed (computed on read via `COUNT(DISTINCT)` or maintained by a daily reconciliation worker — see "Session count maintenance" below). |
| `created_at`            | `timestamptz`   |                                                                       |
| `updated_at`            | `timestamptz`   |                                                                       |

Unique constraint on `(tenant_id, day, agent_id, model_id, organization_id)` — the read path always groups by these axes, and the UPSERT relies on the constraint.

**Session count maintenance.** Counting "distinct sessions per day per agent per model" cannot be done by a pure UPSERT (a session that spans multiple agent_id rows must not be double-counted *within* the row but must be counted in each row independently). The hook tracks "first event in `(tenant, day, agent, model, session)` window" via a per-row `LATERAL` exists check at write time and increments `session_count` only on the first event for that tuple. For read consistency, a daily reconciliation worker (Phase 6.4) recomputes `session_count` from the events table — not because the live counter is wrong, but because retention pruning the events table would otherwise leave the rollup stranded with a number it can no longer prove.

#### Phase 6.2 — Session id plumbing

The unified framework already plumbs `conversationId?: string` through `RunAiAgentTextInput.conversationId` (visible at `agent-runtime.ts:350`). This phase:

1. Renames the wire concept to `sessionId` (additive — `conversationId` stays as a deprecated alias for one minor release; no caller has to change).
2. Generates a fresh `sessionId` server-side when the dispatcher receives a chat without one and echoes it back on the SSE `done` event (mirrors the OpenCode pattern at `apps/docs/.../agents.mdx`).
3. Threads `sessionId` into `runAiAgentObject` too. Object mode does not "have a conversation," but a batched/scheduled object run still needs a correlation id so token rows are groupable.
4. Generates a per-call `turnId` (uuid) inside `runAiAgentText` / `runAiAgentObject` and surfaces it in `LoopTrace` (Phase 4) and the response payload.

The `<AiChat>` component already keeps a session id in state for OpenCode mode; the same hook gets a second variant for the unified framework. The hook also persists `sessionId` to `localStorage` keyed by agent id so refreshes do not lose the thread.

#### Phase 6.3 — `recordTokenUsage` collector

One thin function, registered in `lib/token-usage-recorder.ts`, called from inside the wrapper-owned `onStepFinish` (Phase 4):

```ts
export interface RecordTokenUsageInput {
  authContext: AiChatRequestContext   // tenant/org/user
  agentId: string
  moduleId: string
  sessionId: string
  turnId: string
  stepIndex: number
  providerId: string
  modelId: string
  usage: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; reasoningTokens?: number }
  finishReason?: string
  loopAbortReason?: string
}

export async function recordTokenUsage(input: RecordTokenUsageInput, container: AwilixContainer): Promise<void>
```

Behavior:

- Inserts one row in `ai_token_usage_events`.
- Upserts the matching `ai_token_usage_daily` row.
- Wrapped in a single transaction; on transaction failure the function logs at `warn` and does **not** throw — token tracking MUST NOT break the agent turn (operators have lost approvals to log-table failures before; never again).
- Emits a typed event `ai.token_usage.recorded` (additive, payload `{ tenantId, agentId, sessionId, turnId, stepIndex, modelId, inputTokens, outputTokens }`) so downstream subscribers (real-time cost dashboards, metering integrations) can plug in without polling the table. Standard `createModuleEvents` registration.

The wrapper resolves `providerId` + `modelId` from `createModelFactory.lastResolved()` (already exposed for the playground header per the provider/model spec) so the recorder does not duplicate model-resolution logic.

For object-mode where `streamObject` returns `usage` as a `Promise<...>`, the wrapper awaits the promise after the response stream closes and writes one row with `step_index = 0`. For `generateObject` (single-shot) the row is written synchronously after the result resolves.

For Phase 5's `ToolLoopAgent` engine, the recorder is wired the same way — `Experimental_Agent.onStepFinish` is the same hook shape.

#### Phase 6.4 — Retention worker

New module worker `workers/ai-token-usage-prune`:

- Queue: `ai-token-usage-prune`, concurrency `1`, system-scope, daily interval.
- Reads `AI_TOKEN_USAGE_EVENTS_RETENTION_DAYS` (default `90`). Deletes events older than the cutoff in batches of `5_000` to avoid long locks.
- Reconciles `ai_token_usage_daily.session_count` from the events table for the trailing 7 days — protects against drift caused by delayed event delivery or an outage that left the live counter stale.
- Manual invocation: `yarn mercato ai_assistant run-token-usage-prune`.

#### Phase 6.5 — Read APIs

All gated by `ai_assistant.settings.manage` (existing feature; the same gate as the rest of the settings UI).

##### `GET /api/ai_assistant/usage/daily`

Read the rollup. Returns one entry per `(day, agent_id, model_id)` tuple in the requested window.

Query params:

- `from` (`YYYY-MM-DD`, required)
- `to` (`YYYY-MM-DD`, required, inclusive)
- `agentId` (optional, repeatable; defaults to all agents the caller has visibility on)
- `modelId` (optional, repeatable)
- `groupBy` (`agent` | `model` | `agent,model` | `day`; default `agent,model`)

Response (additive — additive payload fields only, never a rename):

```ts
type UsageDailyResponse = {
  window: { from: string; to: string }
  rows: Array<{
    day: string
    agentId: string | null   // null when groupBy collapses agent
    modelId: string | null   // null when groupBy collapses model
    providerId: string | null
    inputTokens: number
    outputTokens: number
    cachedInputTokens: number
    reasoningTokens: number
    stepCount: number
    turnCount: number
    sessionCount: number
  }>
  totals: {
    inputTokens: number
    outputTokens: number
    cachedInputTokens: number
    reasoningTokens: number
    stepCount: number
    turnCount: number
    sessionCount: number
  }
}
```

Hard cap: `to - from <= 365 days` (rollup is small enough that a year-window query is cheap). Beyond that → `400 invalid_window`.

##### `GET /api/ai_assistant/usage/sessions`

List the sessions sorted by token spend. Reads from `ai_token_usage_events` (the rollup does not carry session detail).

Query params: `from`, `to`, `agentId?`, `modelId?`, `userId?`, `sortBy=tokens|recent`, `limit<=100`, `cursor?`.

Response: list of `{ sessionId, agentId, userId, startedAt, endedAt, turnCount, inputTokens, outputTokens, modelsUsed: string[] }`. Cursor-based pagination.

##### `GET /api/ai_assistant/usage/sessions/:sessionId`

Drill into a single session. Returns the per-turn, per-step break-down: `{ session, turns: [{ turnId, startedAt, finishReason, loopAbortReason, steps: [{ stepIndex, modelId, inputTokens, outputTokens, ... }] }] }`. Used by the "open this session" link from the rollup table.

#### Phase 6.6 — Settings page "Usage" tab

`backend/config/ai-assistant/page.tsx` becomes a tabbed shell:

| Tab            | Source                                                                 |
|----------------|------------------------------------------------------------------------|
| Providers      | existing `AiAssistantSettingsPageClient`                                |
| MCP servers    | existing `McpServersSection`                                            |
| Agents         | existing `agents/AiAgentSettingsPageClient` (mounted as a tab, not a separate page; the standalone page stays for deep-link compatibility) |
| **Usage** (new) | `usage/AiUsageStatsPageClient` (new component)                          |

The Usage tab renders three views, switched by a sub-selector:

1. **Per agent (last 7 / 30 / 90 days)** — `DataTable` with rows = `(agent, day)`, columns = `inputTokens`, `outputTokens`, `turnCount`, `sessionCount`. Sticky totals row at the bottom. Default sort: `outputTokens DESC`.
2. **Per model (last 7 / 30 / 90 days)** — same shape, rows = `(model, day)`. Useful when reasoning about provider switches under the Phase 4 query-param picker.
3. **Recent sessions** — top-N list by token spend in the window, with a "View" button that opens a side sheet rendering the per-step trace from `GET /api/ai_assistant/usage/sessions/:sessionId`.

Filters: tenant-scoped by default (the route is feature-gated to `ai_assistant.settings.manage` — operators only). Date-range picker, agent picker, model picker. Empty state per the design system rules. CSV export button calls the same `usage/daily` endpoint with `Accept: text/csv` (additive `Accept` handling on the route).

UI components — uses the existing `@open-mercato/ui` primitives (`DataTable`, `EmptyState`, `LoadingMessage`, `SectionHeader`, `Alert`, `StatusBadge` for finish reasons). No new design tokens. Number formatting: thousands separators per locale via `useT`. No graphs in the first cut — table-only — to keep this a single phase. A follow-up phase can add a sparkline column.

#### Phase 6.7 — Playground integration

The playground already shows the resolved provider/model header per the provider/model spec. Add a single "Tokens this turn: X in / Y out" line under the response area, sourced from the same `LoopTrace` already rendered for the loop debug panel. This is a free win because the data is already in the trace — it just needs a render line.

### Architecture

```
runAiAgentText/Object turn
    │
    ▼
wrapper-owned onStepFinish (Phase 4)  ──►  recordTokenUsage(input, container)
                                             │
                                             ├── INSERT ai_token_usage_events (1 row)
                                             ├── UPSERT ai_token_usage_daily   (1 row, +counters)
                                             └── emit `ai.token_usage.recorded` (createModuleEvents)
                                                   │
                                                   └── (optional) downstream subscribers
                                                         (cost dashboards, metering, alerts)

settings page Usage tab
    │
    ├── GET /api/ai_assistant/usage/daily   ──► ai_token_usage_daily
    └── GET /api/ai_assistant/usage/sessions[/...]  ──► ai_token_usage_events

retention worker (daily, system-scope)
    │
    ├── DELETE FROM ai_token_usage_events WHERE created_at < cutoff   (5k batches)
    └── reconcile ai_token_usage_daily.session_count for trailing 7 days
```

### Data Models

#### Migration: `Migration<...>_ai_token_usage`

- Adds `ai_token_usage_events` and `ai_token_usage_daily` tables.
- Adds the four indexes listed in 6.0.
- Reversible. Down migration drops the two tables.
- No backfill — pre-migration turns are simply not visible. The settings page renders an info banner ("Token usage tracking started on YYYY-MM-DD") for any window that overlaps the migration date.

### API Contracts

| Route                                              | Method | Auth                                          | Purpose                                         |
|----------------------------------------------------|--------|-----------------------------------------------|-------------------------------------------------|
| `/api/ai_assistant/usage/daily`                    | GET    | `requireAuth` + `ai_assistant.settings.manage` | Per-day rollup with optional `groupBy`.         |
| `/api/ai_assistant/usage/sessions`                 | GET    | same                                          | Top sessions in window.                         |
| `/api/ai_assistant/usage/sessions/:sessionId`      | GET    | same                                          | Per-step trace for one session.                 |

OpenAPI spec exported per route; CRUD `makeCrudRoute` is not appropriate here (these are read-only aggregations) — hand-rolled handlers, but they go through `apiResponse(...)` and `defineApiHandler(...)` for consistency.

### Risks & Impact Review

| #   | Risk                                                              | Severity | Mitigation                                                                                              | Residual                                  |
|-----|-------------------------------------------------------------------|----------|---------------------------------------------------------------------------------------------------------|-------------------------------------------|
| R12 | `recordTokenUsage` failure breaks the agent turn.                 | High     | Wrapped in try/catch; logged at `warn`; never thrown. Tenant data integrity unaffected.                 | A bad batch of warnings in the logs.      |
| R13 | High-frequency object runs (e.g., bulk extraction) flood `ai_token_usage_events`. | Med | One row per turn for object-mode (not per step), batched UPSERT, retention worker, configurable retention window. | Disk usage capped by retention.           |
| R14 | Session count drifts after retention prune.                       | Med      | Daily reconciliation worker recomputes `session_count` for trailing 7 days from events.                 | Older windows drift by at most retention. |
| R15 | Token data is sensitive (reveals user behavior).                  | Med      | Settings page is feature-gated to `ai_assistant.settings.manage`; events table not exposed via any public route. | Same posture as the rest of the settings.|
| R16 | Cached token counts vary per provider semantics.                  | Low      | Schema accepts nullable `cached_input_tokens` / `reasoning_tokens`; rollup defaults to 0; UI labels them as provider-reported. | Documented contract.                      |
| R17 | A misconfigured agent fires a turn per second (hot loop) and balloons the events table. | Med | Phase 3 budget controls already cap step counts and wall-clock; retention worker contains storage; spike alarm via `ai.token_usage.recorded` subscriber. | Capped by budget; observable.            |

### Final Compliance Report

| Surface                          | Change                                                        | Classification                | OK?  |
|----------------------------------|---------------------------------------------------------------|-------------------------------|------|
| Auto-discovery file conventions  | None.                                                         | FROZEN                        | ✓    |
| Type definitions                 | New `RecordTokenUsageInput`; `RunAiAgentTextInput.conversationId` aliased to `sessionId`. | STABLE — additive | ✓ |
| Function signatures              | New `recordTokenUsage`; runtime gains `sessionId` + `turnId` echo. | STABLE — additive          | ✓    |
| Import paths                     | New `lib/token-usage-recorder.ts`.                            | STABLE                        | ✓    |
| Event IDs                        | New `ai.token_usage.recorded`.                                | FROZEN — additive ID          | ✓    |
| Widget injection spot IDs        | None.                                                         | FROZEN                        | ✓    |
| API route URLs                   | New `/api/ai_assistant/usage/...` routes.                     | STABLE — additive             | ✓    |
| Database schema                  | Two new tables.                                               | ADDITIVE-ONLY                 | ✓    |
| DI service names                 | New `aiTokenUsageRecorder` (optional registration).           | STABLE                        | ✓    |
| ACL feature IDs                  | Reuses `ai_assistant.settings.manage`.                        | FROZEN                        | ✓    |
| Notification type IDs            | None.                                                         | FROZEN                        | ✓    |
| CLI commands                     | New `ai_assistant run-token-usage-prune`.                     | STABLE — additive             | ✓    |
| Generated file contracts         | None.                                                         | STABLE                        | ✓    |

### Integration Coverage

- `TC-AI-AGENT-USAGE-001` — single chat turn writes one event per step + one daily rollup row; rollup totals match event sums.
- `TC-AI-AGENT-USAGE-002` — second turn in the same session reuses `sessionId`, increments `turn_count`, leaves `session_count` unchanged.
- `TC-AI-AGENT-USAGE-003` — `prepareStep` swaps the model mid-turn; events record the correct `model_id` per step; rollup splits across two model rows.
- `TC-AI-AGENT-USAGE-004` — `GET /api/ai_assistant/usage/daily?groupBy=agent` returns expected aggregation; `from`/`to` clamping works.
- `TC-AI-AGENT-USAGE-005` — settings page Usage tab renders all three views, empty state, banner when window pre-dates migration.
- `TC-AI-AGENT-USAGE-006` — retention worker deletes rows older than cutoff, reconciles `session_count` for trailing 7 days.
- `TC-AI-AGENT-USAGE-007` — `recordTokenUsage` failure (simulated DB error) does NOT abort the agent turn; warning logged; SSE response still completes.

### Out of Scope

- **Pricing / cost in dollars.** Token counts only. A follow-up spec may add a tenant-configurable `provider_pricing` table with `(provider_id, model_id, input_per_million, output_per_million, effective_from)` and computed `usd_cost` columns on the rollup. Out of scope here because pricing changes weekly and policy decisions ("when does a price change apply retroactively?") are their own debate.
- **Real-time streaming dashboard.** The events emit `ai.token_usage.recorded`, but the spec ships only the table-based settings tab. Live-streaming dashboard is a downstream consumer.
- **Per-tool token attribution.** The SDK does not expose per-tool-call token usage, only per-step. Until it does, "this tool cost X tokens" is a non-question.
- **Cross-tenant aggregation for SaaS billing.** Operators see only their tenant. A platform-level rollup is a separate enterprise spec.

## Implementation Checklist

Phase 0 — Declarative `loop` block (~2 days):
- [ ] Extend `ai-agent-definition.ts` with `AiAgentLoopConfig`, `AiAgentLoopStopCondition`, `AiAgentLoopBudget`, `executionEngine`, `allowRuntimeOverride`. Mark `maxSteps` `@deprecated`.
- [ ] Add `resolveEffectiveLoopConfig(...)` to `lib/agent-runtime.ts`. Map `agent.maxSteps` → `loop.maxSteps`. Apply chat/object-mode rejection rules.
- [ ] Add `buildWrapperPrepareStep(...)` and `mergeStepOverrides(...)`. Compose with user `prepareStep`.
- [ ] Add `buildLoopTraceCollector(...)`; thread through `onStepFinish`.
- [ ] Remove the dead `stopWhen` cast at `agent-runtime.ts:597`. Update the comment block.
- [ ] Unit tests: stop-condition mapping (`stepCountIs`, `hasToolCall`), `mergeStepOverrides` rejects raw mutation handlers, object-mode rejects `prepareStep`.
- [ ] `yarn generate` — confirm `ai-agents.generated.ts` includes the new optional fields.
- [ ] Update `packages/ai-assistant/AGENTS.md` and `apps/docs/docs/framework/ai-assistant/agents.mdx`.

Phase 1 — Per-call loop override (~1 day):
- [ ] Extend `RunAiAgentTextInput` / `RunAiAgentObjectInput` with `loop?: Partial<AiAgentLoopConfig>`.
- [ ] Resolution chain validates per-axis precedence; honor `allowRuntimeOverride`.
- [ ] Unit tests: caller override beats agent default; `allowRuntimeOverride: false` rejects caller `loop`.

Phase 2 — Native callback signature (~1 day):
- [ ] Extend `PreparedAiSdkOptions` / `PreparedAiSdkObjectOptions` with the new fields.
- [ ] Update `agents.mdx` Option B examples to show `prepareStep` / `repairToolCall` forwarding.
- [ ] Add a "what you still lose" callout for callbacks that drop the new fields.

Phase 3 — Operator overrides (~3 days):
- [ ] Migration `Migration<...>_ai_agent_loop_overrides` adds 7 nullable columns. Reversible.
- [ ] Repository: `findRuntimeOverride` returns the new fields; write-time validator rejects malformed `loop_stop_when_json` / `loop_active_tools_json`.
- [ ] Settings page Loop panel (read/write, kill-switch toggle, banner). Permission gate `ai_assistant.settings.manage`.
- [ ] Env shorthand: `<MODULE>_AI_LOOP_MAX_STEPS` / `<MODULE>_AI_LOOP_MAX_WALL_CLOCK_MS` / `<MODULE>_AI_LOOP_MAX_TOKENS`.
- [ ] Budget enforcement: `AbortController` wired to wallClock + tokens.
- [ ] Integration test `TC-AI-AGENT-LOOP-001`: tenant kill-switch → single-step run + banner.

Phase 4 — Debug surfaces (~2 days):
- [ ] Playground Loop panel renders `LoopTrace`.
- [ ] `<AiChat>` debug panel renders `LoopTrace` per turn.
- [ ] Dispatcher SSE stream emits `loop-step-finish` and `loop-finish` events.
- [ ] Query params `loopMaxSteps`, `loopBudget`, `loopActiveTools` on `POST /api/ai_assistant/ai/chat`. Validate against `allowRuntimeOverride`.
- [ ] Rename `allowRuntimeModelOverride` → `allowRuntimeOverride` (with one-release alias).
- [ ] Integration test `TC-AI-AGENT-LOOP-002`: per-turn `?loopBudget=tight` honored.

Phase 5 — `ToolLoopAgent` engine (~2 days, opt-in):
- [ ] `executionEngine: 'tool-loop-agent'` constructs `Experimental_Agent` per registry entry.
- [ ] Threads wrapper `prepareStep` through `prepareCall`.
- [ ] Adds `agent` to `PreparedAiSdkOptions` for the escape hatch.
- [ ] Integration test `TC-AI-AGENT-LOOP-006`: an agent declared with `executionEngine: 'tool-loop-agent'` round-trips through the same policy + approval contract as the default engine.

Phase 6 — Token usage tracking & stats page (~3 days):
- [ ] Migration `Migration<...>_ai_token_usage` adds `ai_token_usage_events` and `ai_token_usage_daily` with the four indexes. Reversible.
- [ ] MikroORM entities + zod validators + repository helpers (`insertEvent`, `upsertDailyRollup`, `findDailyRollup`, `findSessions`, `findSessionTrace`, `pruneOlderThan`, `reconcileSessionCount`).
- [ ] `lib/token-usage-recorder.ts` with `recordTokenUsage(input, container)` — try/catch wrapped, never throws, emits `ai.token_usage.recorded`.
- [ ] Wire `recordTokenUsage` into the wrapper-owned `onStepFinish` from Phase 4. Object-mode path awaits the `usage` promise after the stream closes.
- [ ] Rename `RunAiAgentTextInput.conversationId` → `sessionId` (additive alias). Generate `turnId` per call. Echo both on the SSE `done` event.
- [ ] Read APIs: `GET /api/ai_assistant/usage/daily`, `/usage/sessions`, `/usage/sessions/:sessionId` with OpenAPI spec. CSV export via `Accept: text/csv`.
- [ ] Settings page tabbed shell + new `usage/AiUsageStatsPageClient` (per-agent / per-model / recent-sessions views). Side-sheet drilldown. Date-range, agent, model filters. Empty state + pre-migration banner.
- [ ] Playground "Tokens this turn" line wired from `LoopTrace`.
- [ ] Worker `workers/ai-token-usage-prune` (daily, system-scope). Manual CLI invocation `yarn mercato ai_assistant run-token-usage-prune`.
- [ ] Env: `AI_TOKEN_USAGE_EVENTS_RETENTION_DAYS` (default `90`).
- [ ] Integration tests `TC-AI-AGENT-USAGE-001…007`.
- [ ] Update `packages/ai-assistant/AGENTS.md` with the new event id, worker, CLI, env var, and route group.

## Changelog

### 2026-04-28 — Phase 6 added (token usage tracking & stats page)

- Added Phase 6 (Token Usage Tracking & Stats Page): event log + daily rollup tables, `sessionId` / `turnId` plumbing, `recordTokenUsage` collector wired to the wrapper-owned `onStepFinish`, three read APIs under `/api/ai_assistant/usage/*`, new "Usage" tab on `/backend/config/ai-assistant` with per-agent / per-model / recent-sessions views, retention worker, additive `ai.token_usage.recorded` event id.
- Pricing in dollars and a real-time streaming dashboard are explicitly out of scope and deferred to follow-ups.
- Token tracking failures NEVER abort the agent turn (R12 mitigation).
- Reuses `ai_assistant.settings.manage` — no new ACL feature ids.

### 2026-04-28 — Initial draft

- Drafted Phases 0–5 of first-class agentic-loop controls extending the unified AI tooling spec and the provider/model/baseURL override spec.
- Anchored `AiAgentLoopConfig` on AI SDK 6.0.168's loop primitives (`stopWhen` arrays, `prepareStep`, `experimental_repairToolCall`, `onStepFinish`, `onStepStart`, `onToolCall*`, `activeTools`, `toolChoice`).
- Specified the wrapper-owned `prepareStep` contract that re-asserts policy + mutation-approval guards over any user `prepareStep` (`mergeStepOverrides`).
- Added the operator-facing per-tenant loop override columns and kill switch on `ai_agent_runtime_overrides`.
- Specified the Phase 2 extension to the native `generateText` / `generateObject` escape-hatch callback bag so callers can use the full agentic-loop surface without dropping the wrapper.
- Documented removal of the dead `(generateArgs as Record<string, unknown>).stopWhen` cast at `agent-runtime.ts:597` and the object-mode contract that rejects loop primitives the SDK ignores.
- Renamed (additive alias) `allowRuntimeModelOverride` → `allowRuntimeOverride` since the same flag now gates loop overrides too.
- Listed integration coverage ids `TC-AI-AGENT-LOOP-001…006` per the root AGENTS.md "every new feature MUST list integration coverage" rule.
