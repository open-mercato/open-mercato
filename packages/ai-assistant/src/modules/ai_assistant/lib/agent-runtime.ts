import { createContainer } from 'awilix'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  GenerateObjectResult,
  GenerateTextResult,
  LanguageModel,
  PrepareStepFunction,
  PrepareStepResult,
  StreamObjectResult,
  StreamTextResult,
  ToolSet,
  UIMessage,
} from 'ai'
import {
  convertToModelMessages,
  generateObject,
  hasToolCall,
  stepCountIs,
  streamObject,
  streamText,
} from 'ai'
import type { StopCondition } from 'ai'
import type { ZodTypeAny } from 'zod'
import { createModelFactory } from './model-factory'
import type {
  AiAgentDefinition,
  AiAgentLoopConfig,
  AiAgentPageContextInput,
  AiAgentStructuredOutput,
  LoopStepRecord,
  LoopTrace,
} from './ai-agent-definition'
import type {
  AiChatRequestContext,
  AiResolvedAttachmentPart,
} from './attachment-bridge-types'
import { resolveAiAgentTools, AgentPolicyError } from './agent-tools'
import { resolveEffectiveMutationPolicy } from './agent-policy'
import { toolRegistry } from './tool-registry'
import {
  attachmentPartsToUiFileParts,
  resolveAttachmentPartsForAgent,
  summarizeAttachmentPartsForPrompt,
} from './attachment-parts'
import { AiAgentPromptOverrideRepository } from '../data/repositories/AiAgentPromptOverrideRepository'
import { AiAgentMutationPolicyOverrideRepository } from '../data/repositories/AiAgentMutationPolicyOverrideRepository'
import { AiAgentRuntimeOverrideRepository } from '../data/repositories/AiAgentRuntimeOverrideRepository'
import { composeSystemPromptWithOverride } from './prompt-override-merge'
import { isKnownMutationPolicy } from './agent-policy'
import type { AiAgentMutationPolicy } from './ai-agent-definition'

// Ensure built-in LLM providers are registered. Side-effect import; identical to
// what `./ai-sdk.ts` consumers already rely on.
import './llm-bootstrap'

export interface AgentRequestPageContext {
  pageId?: string | null
  entityType?: string | null
  recordId?: string | null
  [key: string]: unknown
}

export interface RunAiAgentTextInput {
  agentId: string
  messages: UIMessage[]
  attachmentIds?: string[]
  pageContext?: AgentRequestPageContext
  debug?: boolean
  /**
   * Phase 1 exposes the caller-supplied auth context directly on the helper
   * input. Phase 4 may wrap this behind a thinner public API once a global
   * request-context resolver exists. Helpers running inside the HTTP
   * dispatcher receive the same `AiChatRequestContext` used by `checkAgentPolicy`.
   */
  authContext: AiChatRequestContext
  /**
   * Optional per-call model id override that wins over `agent.defaultModel`.
   * The production model-factory extraction lives in Step 5.1; this Step
   * accepts a literal model id string so the Phase 1 runtime already honors
   * `agent.defaultModel` without inventing a new indirection layer.
   */
  modelOverride?: string
  /**
   * Optional request-time provider override. When non-empty, wins for the
   * provider axis at the same priority as `modelOverride` for the model axis.
   * A value that does not match any registered provider id is silently ignored.
   *
   * Phase 1 of spec `2026-04-27-ai-agents-provider-model-baseurl-overrides`.
   */
  providerOverride?: string
  /**
   * Optional per-call base URL override. Wins over every other source in the
   * baseURL resolution chain. Intended for programmatic callers only — the
   * HTTP query-param baseUrl and the AI_RUNTIME_BASEURL_ALLOWLIST arrive in
   * Phase 4a and MUST NOT be exposed here.
   *
   * Phase 2 of spec `2026-04-27-ai-agents-provider-model-baseurl-overrides`.
   */
  baseUrlOverride?: string
  /**
   * Per-request HTTP dispatcher override (query params `?provider=`, `?model=`,
   * `?baseUrl=`). Validated by the dispatcher route before being forwarded
   * here. Wins over tenantOverride and all lower-priority sources when
   * `agent.allowRuntimeModelOverride !== false`.
   *
   * Phase 4a of spec `2026-04-27-ai-agents-provider-model-baseurl-overrides`.
   */
  requestOverride?: {
    providerId?: string | null
    modelId?: string | null
    baseURL?: string | null
  }
  /**
   * Optional DI container used by `resolvePageContext` callbacks. When omitted
   * and the agent declares a `resolvePageContext`, hydration is skipped with a
   * warning (callbacks that need database/DI cannot run safely without one).
   */
  container?: AwilixContainer
  /**
   * Optional stable chat-turn conversation id forwarded from `<AiChat>`.
   * Bridged into the Step 5.6 `prepareMutation` idempotency hash so repeated
   * turns within the same chat collapse onto the same pending action. When
   * omitted, the idempotency hash falls back to `null` which still preserves
   * per-tenant/org uniqueness within the TTL window.
   */
  conversationId?: string | null
  /**
   * Optional per-call loop config override. Fields set here win over the
   * agent's `loop` declaration and the tenant DB override. The override is
   * gated by `agent.loop?.allowRuntimeOverride ?? true` — agents that pin
   * a loop policy for correctness reasons can set `allowRuntimeOverride: false`
   * to reject any per-call override with `AgentPolicyError` code
   * `loop_runtime_override_disabled`.
   *
   * Phase 1 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
   */
  loop?: Partial<AiAgentLoopConfig>
  /**
   * Optional escape-hatch callback that receives the fully prepared AI SDK
   * options bag and must return the SDK result (either from `streamText` or
   * `generateText`). When supplied, the wrapper still enforces every policy
   * guardrail (features, tool allowlist, mutation approval, model factory,
   * prompt composition, attachment bridging) and then hands control to this
   * callback instead of calling `streamText` directly.
   *
   * The callback MUST pass `stopWhen` and `prepareStep` through to the AI SDK
   * call — dropping either one disables the agent's loop policy or mutation
   * approval guards respectively. See `agents.mdx` §"Option B" for the full
   * contract and what you lose when fields are omitted.
   *
   * Phase 2 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
   */
  generateText?: (
    options: PreparedAiSdkOptions,
  ) => Promise<GenerateTextResult<ToolSet> | StreamTextResult<ToolSet>>
  /**
   * When `true`, the runtime appends a `loop-finish` SSE event to the
   * response stream after the AI SDK stream closes. The event payload is the
   * serialized `LoopTrace` for the turn (agent id, turn id, per-step records,
   * stop reason, total duration, total usage).
   *
   * Consumed by `useAiChat` to populate `lastLoopTrace` and by the playground
   * debug panel to render the per-turn trace via `LoopTracePanel`.
   *
   * Phase 4 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
   */
  emitLoopTrace?: boolean
}

/**
 * The wrapper default loop config used when neither the caller, tenant, agent,
 * nor legacy maxSteps supplies any config. Chat mode defaults to `{ maxSteps: 10 }`
 * to ensure tool-using agents can loop; object mode defaults to an empty config
 * (single structured-output call, no explicit step cap).
 */
const WRAPPER_DEFAULT_LOOP_CHAT: AiAgentLoopConfig = { maxSteps: 10 }
const WRAPPER_DEFAULT_LOOP_OBJECT: AiAgentLoopConfig = {}

/**
 * Named loop-budget preset values for `?loopBudget=<preset>` query param.
 *
 * Phase 4 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
 */
export type AiAgentLoopBudgetPreset = 'tight' | 'default' | 'loose'

/**
 * Maps a `loopBudget` preset name to the corresponding `AiAgentLoopBudget`
 * triple. `'default'` returns `undefined` (no override — agent default applies).
 * Values are pinned per spec §"loopBudget preset values (Phase 4)".
 */
export function resolveLoopBudgetPreset(
  preset: AiAgentLoopBudgetPreset,
): Partial<AiAgentLoopConfig> | undefined {
  switch (preset) {
    case 'tight':
      return { budget: { maxSteps: 3, maxWallClockMs: 10_000, maxTokens: 50_000 } }
    case 'loose':
      return { budget: { maxSteps: 20, maxWallClockMs: 120_000, maxTokens: 500_000 } }
    case 'default':
      return undefined
  }
}

const SSE_ENCODER = new TextEncoder()

/**
 * Wraps a streaming `Response` to append a typed `loop-finish` SSE event
 * after the AI SDK stream closes. The event carries the serialized `LoopTrace`
 * for the turn so the `useAiChat` hook can render it in the debug panel.
 *
 * Phase 4 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
 */
function appendLoopFinishToStream(
  baseResponse: Response,
  finalizeLoopTrace: () => LoopTrace,
): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()

  async function pump(): Promise<void> {
    if (!baseResponse.body) {
      await writer.close()
      return
    }
    const reader = baseResponse.body.getReader()
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        await writer.write(value)
      }
      const trace = finalizeLoopTrace()
      const eventLine = `data: ${JSON.stringify({ type: 'loop-finish', trace })}\n\n`
      await writer.write(SSE_ENCODER.encode(eventLine))
    } catch {
      // Pass through — the reader abort is surfaced by the upstream consumer.
    } finally {
      reader.releaseLock()
      await writer.close().catch(() => undefined)
    }
  }

  void pump()
  return new Response(readable, {
    status: baseResponse.status,
    headers: baseResponse.headers,
  })
}

/**
 * The fully prepared options bag handed to the `runAiAgentText({ generateText })`
 * escape-hatch callback. Callers receive a complete set of wrapper-composed
 * loop primitives so they can forward them to `streamText` / `generateText`.
 *
 * SECURITY CONTRACT: callers MUST forward `prepareStep` to the AI SDK call.
 * Dropping it removes the per-step tool-allowlist re-check and the mutation-
 * approval wrapping. Dropping `stopWhen` removes the agent's loop policy and
 * the R3 step-count fallback.
 *
 * Phase 2 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
 */
export interface PreparedAiSdkOptions {
  model: LanguageModel
  tools: ToolSet
  system: string
  messages: Awaited<ReturnType<typeof convertToModelMessages>>
  /** Alias kept for SDK compat — equals `stopWhen` array's effective maxSteps. */
  maxSteps: number
  /**
   * Wrapper-composed stop conditions (R3 mitigated: always ends with
   * `stepCountIs(maxSteps)`). MUST be forwarded to the SDK call.
   */
  stopWhen: StopCondition<ToolSet>[]
  /**
   * Wrapper-owned `PrepareStepFunction` that re-asserts the tool allowlist and
   * mutation-approval wrapping per step. SECURITY-CRITICAL: callers MUST
   * forward this to the SDK call or they lose mutation-approval guarantees.
   */
  prepareStep: PrepareStepFunction<ToolSet>
  /** Wrapper trace aggregator chained with the agent's `onStepFinish` hook. */
  onStepFinish: AiAgentLoopConfig['onStepFinish']
  onStepStart: AiAgentLoopConfig['onStepStart']
  onToolCallStart: AiAgentLoopConfig['onToolCallStart']
  onToolCallFinish: AiAgentLoopConfig['onToolCallFinish']
  experimental_repairToolCall: AiAgentLoopConfig['repairToolCall']
  activeTools: AiAgentLoopConfig['activeTools']
  toolChoice: AiAgentLoopConfig['toolChoice']
  /**
   * Pre-wired to the per-turn `AbortController` used by budget enforcement
   * (Phase 3). Forward to the SDK call so budget limits can abort in-flight
   * requests. May be `undefined` when budget enforcement is not yet active
   * (Phases 0–2); the SDK treats `undefined` the same as no signal.
   */
  abortSignal: AbortSignal | undefined
  /**
   * Finalizes the per-turn `LoopTrace` and returns it. Callers that use the
   * `generateText` escape-hatch SHOULD call this after the SDK call resolves so
   * the trace is available for logging or SSE emission.
   *
   * Phase 4 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
   */
  finalizeLoopTrace: () => LoopTrace
}

/**
 * The fully prepared options bag handed to the `runAiAgentObject({ generateObject })`
 * escape-hatch callback. Object-mode subset — chat-only fields are absent.
 *
 * Phase 2 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
 */
export interface PreparedAiSdkObjectOptions {
  model: LanguageModel
  system: string
  messages: Awaited<ReturnType<typeof convertToModelMessages>>
  schemaName: string
  schema: unknown
  maxSteps: number | undefined
  onStepFinish: AiAgentLoopConfig['onStepFinish']
  onStepStart: AiAgentLoopConfig['onStepStart']
  abortSignal: AbortSignal | undefined
}

/**
 * Guards the per-call loop override against agents that have opted out of
 * runtime overrides by setting `loop.allowRuntimeOverride: false`.
 *
 * Throws `AgentPolicyError` with code `loop_runtime_override_disabled` when
 * the agent has opted out and a caller override was supplied.
 *
 * Phase 1 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
 */
function assertLoopRuntimeOverrideAllowed(
  agent: AiAgentDefinition,
  callerLoop: Partial<AiAgentLoopConfig> | undefined,
): void {
  if (!callerLoop) return
  const allowed = agent.loop?.allowRuntimeOverride ?? true
  if (!allowed) {
    throw new AgentPolicyError(
      'loop_runtime_override_disabled',
      `Agent "${agent.id}" has disabled per-call loop overrides (loop.allowRuntimeOverride: false). Remove the loop override to proceed.`,
    )
  }
}

/**
 * Reads `<MODULE>_AI_LOOP_*` env shorthands for the given module id.
 * Returns a partial `AiAgentLoopConfig` containing only the axes that are
 * explicitly set in the environment. Missing or malformed values are silently
 * ignored (fail-open — env vars are a best-effort static deployment mechanism).
 *
 * Supported variables (Phase 3 of spec
 * `2026-04-28-ai-agents-agentic-loop-controls`):
 *
 * - `<MODULE>_AI_LOOP_MAX_STEPS`       — maps to `loop.maxSteps`
 * - `<MODULE>_AI_LOOP_MAX_WALL_CLOCK_MS` — maps to `loop.budget.maxWallClockMs`
 * - `<MODULE>_AI_LOOP_MAX_TOKENS`      — maps to `loop.budget.maxTokens`
 */
function readModuleLoopEnv(moduleId: string): Partial<AiAgentLoopConfig> {
  const prefix = moduleId.toUpperCase()
  const partial: Partial<AiAgentLoopConfig> = {}

  const maxStepsRaw = process.env[`${prefix}_AI_LOOP_MAX_STEPS`]
  if (maxStepsRaw) {
    const parsed = parseInt(maxStepsRaw.trim(), 10)
    if (!isNaN(parsed) && parsed > 0) partial.maxSteps = parsed
  }

  const maxWallClockRaw = process.env[`${prefix}_AI_LOOP_MAX_WALL_CLOCK_MS`]
  const maxTokensRaw = process.env[`${prefix}_AI_LOOP_MAX_TOKENS`]

  if (maxWallClockRaw || maxTokensRaw) {
    const budgetPartial: AiAgentLoopConfig['budget'] = {}
    if (maxWallClockRaw) {
      const parsed = parseInt(maxWallClockRaw.trim(), 10)
      if (!isNaN(parsed) && parsed > 0) budgetPartial.maxWallClockMs = parsed
    }
    if (maxTokensRaw) {
      const parsed = parseInt(maxTokensRaw.trim(), 10)
      if (!isNaN(parsed) && parsed > 0) budgetPartial.maxTokens = parsed
    }
    if (Object.keys(budgetPartial).length > 0) partial.budget = budgetPartial
  }

  return partial
}

/**
 * Resolves the effective loop config for a turn by walking the precedence
 * chain (highest first):
 *
 * 1. `callerLoop` — per-call `runAiAgentText({ loop })` override (Phase 1).
 * 2. Tenant override row — NOT yet implemented in DB; always `undefined` here.
 *    // TODO(Phase 1782-3): hydrate loop columns from ai_agent_runtime_overrides
 * 3. `<MODULE>_AI_LOOP_*` env shorthands (Phase 3) — only MAX_STEPS,
 *    MAX_WALL_CLOCK_MS, MAX_TOKENS. Lower precedence than DB override but higher
 *    than the agent's code-declared defaults.
 * 4. `agent.loop` — agent's declarative loop config.
 * 5. `agent.maxSteps` (deprecated alias) — mapped to `{ maxSteps: agent.maxSteps }`.
 * 6. `wrapperDefault` — the wrapper's hardcoded fallback.
 *
 * Each source contributes only the fields it sets explicitly; fields absent at
 * a higher-priority source fall through to a lower-priority one. The merge is
 * performed left-to-right with higher-priority sources winning field-by-field.
 *
 * Throws `AgentPolicyError` code `loop_runtime_override_disabled` when the
 * agent opts out of per-call overrides and a caller loop was supplied.
 *
 * Phase 0 + Phase 1 + Phase 3 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
 */
export function resolveEffectiveLoopConfig(
  agent: AiAgentDefinition,
  callerLoop?: Partial<AiAgentLoopConfig> | undefined,
  wrapperDefault?: AiAgentLoopConfig,
): AiAgentLoopConfig {
  assertLoopRuntimeOverrideAllowed(agent, callerLoop)

  const effectiveDefault = wrapperDefault ?? WRAPPER_DEFAULT_LOOP_CHAT

  // Build base from lowest-priority: wrapper default → legacy maxSteps → agent.loop
  const legacyMaxSteps: AiAgentLoopConfig | undefined =
    typeof agent.maxSteps === 'number' && agent.maxSteps > 0 && !agent.loop
      ? { maxSteps: agent.maxSteps }
      : undefined

  const base: AiAgentLoopConfig = {
    ...effectiveDefault,
    ...(legacyMaxSteps ?? {}),
    ...(agent.loop ?? {}),
  }

  // Phase 3 — env shorthands at priority 3 (above agent.loop, below DB override).
  // TODO(Phase 1782-3): hydrate loop columns from ai_agent_runtime_overrides
  // and merge tenantOverride here at priority #2 (above envOverride).
  const envOverride = readModuleLoopEnv(agent.moduleId)
  const withEnv: AiAgentLoopConfig = {
    ...base,
    ...envOverride,
    ...(envOverride.budget != null
      ? { budget: { ...(base.budget ?? {}), ...envOverride.budget } }
      : {}),
  }

  const withCaller: AiAgentLoopConfig = callerLoop
    ? { ...withEnv, ...callerLoop }
    : withEnv

  // Phase 3 — kill switch: when disabled is set to true, force maxSteps: 1 so the
  // agent executes as a single model call with no tool looping. All other loop config
  // is preserved (budget, etc.) but the step cap wins.
  if (withCaller.disabled === true) {
    return { ...withCaller, maxSteps: 1 }
  }

  return withCaller
}

/**
 * The reason a budget limit was hit, exposed on `LoopAbortReason` (Phase 3).
 */
export type LoopBudgetAbortReason =
  | 'budget-tool-calls'
  | 'budget-wall-clock'
  | 'budget-tokens'

/**
 * Tracks per-turn budget usage and aborts the run when any limit is exceeded.
 *
 * Usage:
 * 1. Construct with the loop budget and the turn's `AbortController`.
 * 2. Call `wire(onStepFinish)` to get a composed `onStepFinish` that feeds
 *    usage data into the enforcer on every completed step.
 * 3. The enforcer calls `abortController.abort()` with a typed
 *    `LoopBudgetAbortReason` when a limit is hit.
 *
 * Phase 3 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
 */
export class BudgetEnforcer {
  private toolCallsUsed = 0
  private tokensUsed = 0
  readonly turnStartMs: number
  abortReason: LoopBudgetAbortReason | null = null

  constructor(
    private readonly budget: AiAgentLoopConfig['budget'],
    private readonly abortController: AbortController,
  ) {
    this.turnStartMs = Date.now()
  }

  get hasActiveBudget(): boolean {
    const b = this.budget
    return (
      b !== undefined &&
      (b.maxToolCalls !== undefined || b.maxWallClockMs !== undefined || b.maxTokens !== undefined)
    )
  }

  recordStep(usage: { inputTokens?: number; outputTokens?: number; toolCalls?: number }): void {
    if (!this.budget) return
    this.toolCallsUsed += usage.toolCalls ?? 0
    this.tokensUsed += (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
    this.checkLimits()
  }

  private checkLimits(): void {
    const b = this.budget
    if (!b) return

    if (b.maxToolCalls !== undefined && this.toolCallsUsed >= b.maxToolCalls) {
      this.abort('budget-tool-calls')
      return
    }

    const elapsedMs = Date.now() - this.turnStartMs
    if (b.maxWallClockMs !== undefined && elapsedMs >= b.maxWallClockMs) {
      this.abort('budget-wall-clock')
      return
    }

    if (b.maxTokens !== undefined && this.tokensUsed >= b.maxTokens) {
      this.abort('budget-tokens')
    }
  }

  private abort(reason: LoopBudgetAbortReason): void {
    if (this.abortReason !== null) return
    this.abortReason = reason
    console.info(
      `[AI Agents] Budget exceeded — aborting turn. Reason: ${reason}. ` +
        `toolCalls=${this.toolCallsUsed}, tokens=${this.tokensUsed}, ` +
        `elapsedMs=${Date.now() - this.turnStartMs}.`,
    )
    this.abortController.abort(reason)
  }

  wire(
    userOnStepFinish: AiAgentLoopConfig['onStepFinish'],
  ): AiAgentLoopConfig['onStepFinish'] {
    if (!this.hasActiveBudget) return userOnStepFinish
    return async (event) => {
      this.recordStep({
        inputTokens: event.usage?.inputTokens,
        outputTokens: event.usage?.outputTokens,
        toolCalls: event.toolCalls?.length,
      })
      if (userOnStepFinish) {
        try {
          await userOnStepFinish(event)
        } catch (err) {
          console.error('[AI Agents] User onStepFinish threw; ignoring:', err)
        }
      }
    }
  }
}

/**
 * Builds a wrapper-owned `onStepFinish` collector that aggregates per-step
 * usage and tool-call data into a `LoopTrace` object. The collector chains
 * the user's `onStepFinish` after it aggregates (exceptions from the user's
 * hook are caught and logged but do not abort the turn).
 *
 * Returns both the wired `onStepFinish` hook and a `finalize()` function that
 * resolves the `LoopTrace` once the turn is complete. The `budgetEnforcer`
 * is already wired into `onStepFinish` at a lower layer — this collector sits
 * above it.
 *
 * Phase 4 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
 */
export function buildLoopTraceCollector(
  agentId: string,
  turnId: string,
  userOnStepFinish: AiAgentLoopConfig['onStepFinish'],
): {
  onStepFinish: AiAgentLoopConfig['onStepFinish']
  finalize: (abortReason: LoopBudgetAbortReason | null) => LoopTrace
} {
  const turnStartMs = Date.now()
  const steps: LoopStepRecord[] = []

  const onStepFinish: AiAgentLoopConfig['onStepFinish'] = async (event) => {
    const stepIndex = steps.length
    const toolCalls = (event.toolCalls ?? []).map((tc) => {
      const raw = tc as unknown as {
        toolName?: string
        args?: unknown
        result?: unknown
        experimental_toToolResultError?: { code?: string; message?: string }
        repairAttempted?: boolean
        startTime?: number
        endTime?: number
      }
      return {
        toolName: raw.toolName ?? 'unknown',
        args: raw.args ?? {},
        result: raw.result,
        error: raw.experimental_toToolResultError
          ? {
              code: String(raw.experimental_toToolResultError?.code ?? 'unknown'),
              message: String(raw.experimental_toToolResultError?.message ?? ''),
            }
          : undefined,
        repairAttempted: raw.repairAttempted === true,
        durationMs:
          typeof raw.startTime === 'number' && typeof raw.endTime === 'number'
            ? raw.endTime - raw.startTime
            : 0,
      }
    })

    const textDelta =
      (event as unknown as { text?: string }).text ?? ''

    const finishReason = (
      (event as unknown as { finishReason?: string }).finishReason ?? 'stop'
    ) as LoopStepRecord['finishReason']

    const modelId =
      (event as unknown as { response?: { modelId?: string } }).response?.modelId ?? 'unknown'

    steps.push({
      stepIndex,
      modelId,
      toolCalls,
      textDelta,
      usage: {
        inputTokens: event.usage?.inputTokens ?? 0,
        outputTokens: event.usage?.outputTokens ?? 0,
      },
      finishReason,
    })

    if (userOnStepFinish) {
      try {
        await userOnStepFinish(event)
      } catch (err) {
        console.error('[AI Agents] User onStepFinish in LoopTrace collector threw; ignoring:', err)
      }
    }
  }

  function finalize(abortReason: LoopBudgetAbortReason | null): LoopTrace {
    const totalDurationMs = Date.now() - turnStartMs
    const totalUsage = steps.reduce(
      (acc, step) => ({
        inputTokens: acc.inputTokens + step.usage.inputTokens,
        outputTokens: acc.outputTokens + step.usage.outputTokens,
      }),
      { inputTokens: 0, outputTokens: 0 },
    )

    let stopReason: LoopTrace['stopReason'] = 'finish-reason'
    if (abortReason === 'budget-tool-calls') stopReason = 'budget-tool-calls'
    else if (abortReason === 'budget-wall-clock') stopReason = 'budget-wall-clock'
    else if (abortReason === 'budget-tokens') stopReason = 'budget-tokens'

    return {
      agentId,
      turnId,
      steps,
      stopReason,
      totalDurationMs,
      totalUsage,
    }
  }

  return { onStepFinish, finalize }
}

/**
 * Translates serializable `AiAgentLoopStopCondition` items into the Vercel AI
 * SDK `StopCondition` array ready to pass to `streamText` / `generateText`.
 *
 * The wrapper ALWAYS appends `stepCountIs(maxSteps ?? 10)` as the final item
 * in the returned array (R3 mitigation). This guarantees that a misconfigured
 * `hasToolCall` for a non-existent tool can never cause an infinite loop
 * because the SDK treats `stopWhen` arrays with OR semantics — the step-count
 * fallback will always trip eventually.
 *
 * Phase 0 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
 */
export function translateStopConditions(
  loopConfig: AiAgentLoopConfig,
): StopCondition<Record<string, unknown>>[] {
  const effectiveMaxSteps = loopConfig.maxSteps ?? 10
  const userConditions: StopCondition<Record<string, unknown>>[] = []

  const rawStopWhen = loopConfig.stopWhen
  if (rawStopWhen) {
    const items = Array.isArray(rawStopWhen) ? rawStopWhen : [rawStopWhen]
    for (const item of items) {
      if (item.kind === 'stepCount') {
        userConditions.push(stepCountIs(item.count))
      } else if (item.kind === 'hasToolCall') {
        userConditions.push(hasToolCall(item.toolName))
      } else if (item.kind === 'custom') {
        userConditions.push(item.stop as StopCondition<Record<string, unknown>>)
      }
    }
  }

  // Always append the hard step-count fallback (R3 mitigation).
  return [...userConditions, stepCountIs(effectiveMaxSteps)]
}

/**
 * Security-critical merge of the wrapper-owned step override with the user's
 * `prepareStep` return value.
 *
 * Guarantees (R1 mitigation — preserving the mutation-approval contract):
 * 1. Any `tools` map returned by the user is intersected with `toolRegistry`
 *    (the policy-gated, mutation-approval-wrapped map). If the user returned
 *    a raw mutation handler, the merged map points at the wrapped one.
 * 2. Any `activeTools` returned by the user is intersected with
 *    `agent.allowedTools`. Out-of-set names are dropped with a single
 *    `loop:active_tools_filtered` warning.
 * 3. A user-returned `tools` map that contains a mutation tool pointing at the
 *    raw handler (not the wrapped one) is rejected with
 *    `AgentPolicyError` code `loop_violates_mutation_policy`.
 * 4. Non-policy fields (`model`, `toolChoice`, `system`, `messages`) from the
 *    user override are honored as-is.
 *
 * Phase 0 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
 */
export function mergeStepOverrides(
  wrapperOverride: PrepareStepResult<ToolSet>,
  userOverride: PrepareStepResult<ToolSet> | undefined | null,
  agent: AiAgentDefinition,
  wrappedToolRegistry: Record<string, unknown>,
): PrepareStepResult<ToolSet> {
  if (!userOverride) return wrapperOverride

  const merged: PrepareStepResult<ToolSet> = { ...wrapperOverride }

  if (userOverride.model !== undefined) {
    merged.model = userOverride.model
  }
  if (userOverride.toolChoice !== undefined) {
    merged.toolChoice = userOverride.toolChoice
  }

  if (userOverride.activeTools !== undefined) {
    const filtered = userOverride.activeTools.filter((name) => {
      const allowed = agent.allowedTools.includes(name)
      if (!allowed) {
        console.warn(
          `[AI Agents] loop:active_tools_filtered — tool "${name}" is not in agent "${agent.id}" allowedTools; dropping from activeTools.`,
        )
      }
      return allowed
    })
    merged.activeTools = filtered
  }

  if (userOverride.tools !== undefined) {
    const userTools = userOverride.tools as Record<string, unknown>
    const mergedTools: Record<string, unknown> = {}

    for (const [toolKey, userHandler] of Object.entries(userTools)) {
      const wrappedHandler = wrappedToolRegistry[toolKey]
      if (!wrappedHandler) {
        console.warn(
          `[AI Agents] mergeStepOverrides — tool "${toolKey}" from user prepareStep is not in the wrapper tool registry; dropping.`,
        )
        continue
      }
      if (userHandler !== wrappedHandler) {
        const toolDef = toolRegistry.getTool(
          toolKey.replace(/__/g, '.'),
        ) as { isMutation?: boolean } | undefined
        if (toolDef?.isMutation === true) {
          throw new AgentPolicyError(
            'loop_violates_mutation_policy',
            `User prepareStep returned a tools map with raw (unwrapped) mutation handler for "${toolKey}". This bypasses the mutation-approval gate and is rejected.`,
          )
        }
      }
      mergedTools[toolKey] = wrappedHandler
    }
    merged.tools = mergedTools as PrepareStepResult<ToolSet>['tools']
  }

  return merged
}

/**
 * Builds the wrapper-owned `PrepareStepFunction` that enforces the tool
 * allowlist and mutation-approval contract on every step, then composes
 * the user's `prepareStep` on top via `mergeStepOverrides`.
 *
 * This is the SECURITY-CRITICAL function for Phase 0. The wrapper `prepareStep`
 * ensures:
 * - Tool active-set is always a subset of `effectiveLoop.activeTools ?? agent.allowedTools`.
 * - Mutation tools always point at the prepareMutation-wrapped handlers.
 * - User's `prepareStep` return value cannot smuggle raw mutation handlers.
 *
 * Phase 0 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
 */
export function buildWrapperPrepareStep(
  agent: AiAgentDefinition,
  effectiveLoop: AiAgentLoopConfig,
  wrappedTools: Record<string, unknown>,
): PrepareStepFunction<ToolSet> {
  return async (state) => {
    const wrapperOverride: PrepareStepResult<ToolSet> = {}

    if (effectiveLoop.activeTools && effectiveLoop.activeTools.length > 0) {
      wrapperOverride.activeTools = effectiveLoop.activeTools.filter((name) => {
        const allowed = agent.allowedTools.includes(name)
        if (!allowed) {
          console.warn(
            `[AI Agents] loop:active_tools_filtered — tool "${name}" is not in agent "${agent.id}" allowedTools; dropping from activeTools.`,
          )
        }
        return allowed
      })
    }

    if (effectiveLoop.prepareStep) {
      let userOverride: PrepareStepResult<ToolSet> | undefined | null
      try {
        userOverride = await effectiveLoop.prepareStep(state)
      } catch (error) {
        console.error(
          `[AI Agents] User prepareStep threw for agent "${agent.id}"; ignoring user override:`,
          error,
        )
        return wrapperOverride
      }
      return mergeStepOverrides(wrapperOverride, userOverride, agent, wrappedTools)
    }

    return wrapperOverride
  }
}

/**
 * Validates that a loop config does not set any primitives that are
 * unsupported by the object-mode SDK path (`generateObject` / `streamObject`).
 *
 * Object mode accepts ONLY: `maxSteps`, `budget`, `onStepFinish`,
 * `onStepStart`, `allowRuntimeOverride`. The remaining fields
 * (`prepareStep`, `repairToolCall`, `stopWhen`, `activeTools`,
 * `toolChoice`) are chat-only and will never reach `generateObject`.
 *
 * Throws `AgentPolicyError` code `loop_unsupported_in_object_mode` if any
 * unsupported field is set. This provides an explicit, actionable error
 * rather than a silent no-op.
 *
 * Phase 0 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
 */
export function assertLoopObjectModeCompatible(loopConfig: Partial<AiAgentLoopConfig>): void {
  const unsupportedFields: string[] = []

  if (loopConfig.prepareStep !== undefined) unsupportedFields.push('prepareStep')
  if (loopConfig.repairToolCall !== undefined) unsupportedFields.push('repairToolCall')
  if (loopConfig.stopWhen !== undefined) unsupportedFields.push('stopWhen')
  if (loopConfig.activeTools !== undefined) unsupportedFields.push('activeTools')
  if (loopConfig.toolChoice !== undefined) unsupportedFields.push('toolChoice')

  if (unsupportedFields.length > 0) {
    throw new AgentPolicyError(
      'loop_unsupported_in_object_mode',
      `Object-mode agents do not support these loop primitives: ${unsupportedFields.join(', ')}. Use runAiAgentText for agents that require these loop controls.`,
    )
  }
}

interface ResolvedAgentModel {
  model: LanguageModel
  modelId: string
  providerId: string
}

function resolveAgentModel(
  agent: AiAgentDefinition,
  modelOverride: string | undefined,
  providerOverride: string | undefined,
  container: AwilixContainer | undefined,
  baseUrlOverride?: string,
  tenantOverride?: { providerId?: string | null; modelId?: string | null; baseURL?: string | null } | null,
  requestOverride?: { providerId?: string | null; modelId?: string | null; baseURL?: string | null } | null,
): ResolvedAgentModel {
  const effectiveContainer = container ?? createContainer()
  const allowRuntimeModelOverride = agent.allowRuntimeModelOverride !== false
  const resolution = createModelFactory(effectiveContainer).resolveModel({
    moduleId: agent.moduleId,
    agentDefaultModel: agent.defaultModel,
    agentDefaultProvider: agent.defaultProvider,
    agentDefaultBaseUrl: agent.defaultBaseUrl,
    callerOverride: modelOverride,
    providerOverride,
    baseUrlOverride,
    allowRuntimeModelOverride,
    tenantOverride: tenantOverride ?? undefined,
    requestOverride: requestOverride ?? undefined,
  })
  return {
    model: resolution.model as LanguageModel,
    modelId: resolution.modelId,
    providerId: resolution.providerId,
  }
}

/**
 * Composes the effective system prompt for a run. When the agent declares a
 * `resolvePageContext` callback AND the incoming request carries both
 * `entityType` and `recordId`, the callback is invoked and its return value
 * is appended to `agent.systemPrompt`. Throwing callbacks are caught and
 * logged without failing the request — the spec allows hydration to be
 * best-effort until Step 5.2 wires a stricter contract.
 */
export async function composeSystemPrompt(
  agent: AiAgentDefinition,
  pageContext: AgentRequestPageContext | undefined,
  container: AwilixContainer | undefined,
  tenantId: string | null,
  organizationId: string | null,
): Promise<string> {
  const baseFromOverride = await resolveBaseSystemPromptWithOverride(
    agent,
    container,
    tenantId,
    organizationId,
  )
  const resolve = agent.resolvePageContext
  if (!resolve) return baseFromOverride
  const entityType = pageContext?.entityType
  const recordId = pageContext?.recordId
  if (typeof entityType !== 'string' || entityType.length === 0) return baseFromOverride
  if (typeof recordId !== 'string' || recordId.length === 0) return baseFromOverride
  if (!container) {
    console.warn(
      `[AI Agents] Agent "${agent.id}" declares resolvePageContext but no container was passed to runAiAgentText; skipping hydration.`,
    )
    return baseFromOverride
  }
  const hydrationInput: AiAgentPageContextInput = {
    entityType,
    recordId,
    container,
    tenantId,
    organizationId,
  }
  try {
    const hydrated = await resolve(hydrationInput)
    if (typeof hydrated === 'string' && hydrated.trim().length > 0) {
      return `${baseFromOverride}\n\n${hydrated}`
    }
  } catch (error) {
    console.error(
      `[AI Agents] resolvePageContext for agent "${agent.id}" failed; continuing without hydration:`,
      error,
    )
  }
  return baseFromOverride
}

/**
 * Fetches the latest tenant-scoped prompt override for `agent` (if any) and
 * layers it onto the built-in `systemPrompt` via the additive merge helper.
 *
 * BC + fail-open: every failure mode — missing container, missing `em`
 * registration, repository throw, missing migration — is logged at `warn`
 * and falls back to `agent.systemPrompt`. A chat turn MUST never fail on
 * override lookup (per Step 5.3 spec: "If the repo call throws, log and
 * fall back to the built-in prompt — never fail the chat request").
 */
async function resolveBaseSystemPromptWithOverride(
  agent: AiAgentDefinition,
  container: AwilixContainer | undefined,
  tenantId: string | null,
  organizationId: string | null,
): Promise<string> {
  const base = agent.systemPrompt
  if (!tenantId || !container) return base
  let em: EntityManager | null = null
  try {
    em = container.resolve<EntityManager>('em')
  } catch {
    em = null
  }
  if (!em) return base
  try {
    const repo = new AiAgentPromptOverrideRepository(em)
    const latest = await repo.getLatest(agent.id, {
      tenantId,
      organizationId: organizationId ?? null,
    })
    if (!latest || !latest.sections || Object.keys(latest.sections).length === 0) {
      return base
    }
    return composeSystemPromptWithOverride(base, { sections: latest.sections })
  } catch (error) {
    console.warn(
      `[AI Agents] Prompt-override lookup failed for agent "${agent.id}"; falling back to built-in prompt.`,
      error,
    )
    return base
  }
}

/**
 * Looks up the tenant-scoped `mutationPolicy` override for `agentId` (Step
 * 5.4). Fails SAFE: any repo error, missing container, missing `em`
 * registration, or corrupt enum value returns `null`, which causes the
 * runtime to fall back to the agent's code-declared policy. A chat turn
 * MUST never fail on override lookup.
 */
async function resolveMutationPolicyOverride(
  agentId: string,
  container: AwilixContainer | undefined,
  tenantId: string | null,
  organizationId: string | null,
): Promise<AiAgentMutationPolicy | null> {
  if (!tenantId || !container) return null
  let em: EntityManager | null = null
  try {
    em = container.resolve<EntityManager>('em')
  } catch {
    em = null
  }
  if (!em) return null
  try {
    const repo = new AiAgentMutationPolicyOverrideRepository(em)
    const row = await repo.get(agentId, { tenantId, organizationId: organizationId ?? null })
    if (!row) return null
    const raw = row.mutationPolicy
    if (!isKnownMutationPolicy(raw)) {
      console.warn(
        `[AI Agents] Ignoring corrupt mutationPolicy override row for agent "${agentId}": "${raw}". Falling back to code-declared policy.`,
      )
      return null
    }
    return raw
  } catch (error) {
    console.warn(
      `[AI Agents] mutationPolicy override lookup failed for agent "${agentId}"; falling back to code-declared policy.`,
      error,
    )
    return null
  }
}

/**
 * Looks up the per-tenant AI runtime override (provider / model / baseURL) for
 * the given agent (Phase 4a of spec
 * `2026-04-27-ai-agents-provider-model-baseurl-overrides`).
 *
 * Mirrors the fail-open contract of {@link resolveMutationPolicyOverride}: any
 * error — missing container, missing `em`, repository throw, missing migration
 * — is logged at `warn` level and returns null so the model factory falls
 * through to lower-priority sources. A chat turn MUST never fail on override
 * lookup.
 */
async function resolveRuntimeModelOverride(
  agentId: string,
  container: AwilixContainer | undefined,
  tenantId: string | null,
  organizationId: string | null,
): Promise<{ providerId?: string | null; modelId?: string | null; baseURL?: string | null } | null> {
  if (!tenantId || !container) return null
  let em: EntityManager | null = null
  try {
    em = container.resolve<EntityManager>('em')
  } catch {
    em = null
  }
  if (!em) return null
  try {
    const repo = new AiAgentRuntimeOverrideRepository(em)
    const row = await repo.getDefault({
      tenantId,
      organizationId: organizationId ?? null,
      agentId,
    })
    if (!row) return null
    return {
      providerId: row.providerId ?? null,
      modelId: row.modelId ?? null,
      baseURL: row.baseUrl ?? null,
    }
  } catch (error) {
    console.warn(
      `[AI Agents] Runtime model override lookup failed for agent "${agentId}"; falling back to lower-priority sources.`,
      error,
    )
    return null
  }
}

/**
 * Normalizes simple `{ role, content }` chat messages into the AI SDK
 * `UIMessage` shape that `convertToModelMessages` requires. When the
 * incoming message already carries a `parts` array it is left untouched;
 * otherwise a single `TextUIPart` is synthesized from `content`.
 */
function ensureUiMessageShape(messages: UIMessage[]): UIMessage[] {
  return messages.map((message, index) => {
    const raw = message as unknown as { id?: string; role?: string; content?: string; parts?: unknown[] }
    if (Array.isArray(raw.parts) && raw.parts.length > 0) {
      // Already has parts — only ensure `id` is present
      return { ...message, id: raw.id ?? `msg-${index}` } as UIMessage
    }
    const textContent = typeof raw.content === 'string' ? raw.content : ''
    return {
      id: raw.id ?? `msg-${index}`,
      role: raw.role ?? 'user',
      parts: [{ type: 'text', text: textContent }],
    } as unknown as UIMessage
  })
}

/**
 * Appends AI SDK v6 `FileUIPart` entries to the last user message in the
 * request so resolved attachment bytes / signed URLs reach the model. Pure
 * helper so chat-mode and object-mode share identical behavior — any
 * divergence here breaks the Step 3.6 parity contract.
 */
function attachAttachmentsToMessages(
  messages: UIMessage[],
  parts: readonly AiResolvedAttachmentPart[],
): UIMessage[] {
  if (parts.length === 0) return messages
  const fileParts = attachmentPartsToUiFileParts(parts)
  if (fileParts.length === 0) return messages
  const next = messages.slice()
  let lastUserIndex = -1
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const candidate = next[index] as unknown as { role?: string }
    if (candidate?.role === 'user') {
      lastUserIndex = index
      break
    }
  }
  if (lastUserIndex === -1) {
    next.push({
      id: 'ai-runtime-attachments',
      role: 'user',
      parts: fileParts as unknown as UIMessage['parts'],
    } as unknown as UIMessage)
    return next
  }
  const source = next[lastUserIndex] as unknown as { parts?: unknown[] }
  const existingParts = Array.isArray(source.parts) ? source.parts : []
  next[lastUserIndex] = {
    ...(next[lastUserIndex] as object),
    parts: [...existingParts, ...fileParts],
  } as UIMessage
  return next
}

function appendAttachmentSummary(
  systemPrompt: string,
  parts: readonly AiResolvedAttachmentPart[],
): string {
  const summary = summarizeAttachmentPartsForPrompt(parts)
  if (!summary) return systemPrompt
  return `${systemPrompt}\n\n${summary}`
}

/**
 * Builds a runtime "MUTATION POLICY (RUNTIME)" block describing the
 * EFFECTIVE policy for this turn — what the model should expect when it
 * calls each whitelisted mutation tool. Generated dynamically because:
 *
 *   - the agent's static prompt cannot know which per-tenant override is
 *     in force (`destructive-confirm-required` flips most writes to
 *     run-direct) and would otherwise mislead the operator with stale
 *     "this requires approval" copy;
 *   - the per-tool `isDestructive` flag determines whether each
 *     whitelisted write goes through the approval card or runs inline.
 *
 * Without this block, the model parrots its hardcoded "always route
 * through the approval card" prompt language and tells the user "your
 * change is awaiting approval" when in fact the dispatcher already
 * applied the change directly. The injected block flips the model to
 * report results accurately ("applied", "pending your approval", or
 * "blocked because read-only") tool-by-tool.
 */
function buildRuntimeMutationPolicySection(
  agent: { id: string; mutationPolicy?: string | null; allowedTools: string[] },
  mutationPolicyOverride: string | null,
): string | null {
  const effective = resolveEffectiveMutationPolicy(
    (agent.mutationPolicy ?? null) as never,
    (mutationPolicyOverride ?? null) as never,
    agent.id,
  )
  const lines: string[] = []
  lines.push('MUTATION POLICY (RUNTIME)')
  lines.push(`Declared agent policy: ${agent.mutationPolicy ?? 'read-only'}.`)
  if (mutationPolicyOverride && mutationPolicyOverride !== agent.mutationPolicy) {
    lines.push(`Tenant override active: ${mutationPolicyOverride}.`)
  }
  lines.push(`Effective policy: ${effective}.`)

  // Bucket the agent's allowlisted tools into "gated" / "direct" / "conditional"
  // / "blocked" so the model can phrase outcomes correctly per tool.
  // `conditional` covers tools whose `isDestructive` is a predicate function:
  // their gate-vs-direct decision depends on the per-call input (e.g.
  // `customers.manage_deal_comment` gates only its delete branch under
  // `destructive-confirm-required`).
  const direct: string[] = []
  const gated: string[] = []
  const conditional: string[] = []
  const blocked: string[] = []
  for (const toolName of agent.allowedTools) {
    const tool = toolRegistry.getTool(toolName) as
      | { isMutation?: boolean; isDestructive?: boolean | ((input: unknown) => boolean) }
      | undefined
    if (!tool || tool.isMutation !== true) continue
    if (effective === 'read-only') {
      blocked.push(toolName)
      continue
    }
    if (effective === 'confirm-required') {
      gated.push(toolName)
      continue
    }
    // destructive-confirm-required
    if (typeof tool.isDestructive === 'function') {
      conditional.push(toolName)
    } else if (tool.isDestructive === true) {
      gated.push(toolName)
    } else {
      direct.push(toolName)
    }
  }

  if (
    direct.length === 0 &&
    gated.length === 0 &&
    conditional.length === 0 &&
    blocked.length === 0
  ) {
    // Read-only agent with no mutation tools — no runtime policy block needed.
    return null
  }
  if (direct.length > 0) {
    lines.push('')
    lines.push(
      `Tools that WILL RUN DIRECTLY (no approval card, no pending action) under the effective policy: ${direct.join(', ')}.`,
    )
    lines.push(
      'When you call any of these and the call returns successfully, the change has ALREADY BEEN APPLIED. Report it in the past tense ("Updated …", "Added …", "Created …"). Do NOT tell the operator the action is "pending your approval" or "awaiting confirmation" — that would be a false statement under the current policy.',
    )
  }
  if (gated.length > 0) {
    lines.push('')
    lines.push(
      `Tools that REQUIRE APPROVAL under the effective policy: ${gated.join(', ')}.`,
    )
    lines.push(
      'When you call any of these, the dispatcher returns an "awaiting confirmation" envelope and renders an inline approval card. Tell the operator the change is pending their confirmation; do NOT claim it has been applied.',
    )
  }
  if (conditional.length > 0) {
    lines.push('')
    lines.push(
      `Tools whose approval requirement DEPENDS ON THE INPUT under the effective policy: ${conditional.join(', ')}.`,
    )
    lines.push(
      'These multi-operation tools gate ONLY the destructive branches (typically `operation: "delete"` or similar). Read the tool result envelope: if it carries `status: "pending-confirmation"` then the change is pending — tell the operator it needs their approval. If it carries direct success data, the change has ALREADY BEEN APPLIED — report it in the past tense. Never assume one branch behaves like another.',
    )
  }
  if (blocked.length > 0) {
    lines.push('')
    lines.push(
      `Tools that are BLOCKED under the effective policy (read-only): ${blocked.join(', ')}.`,
    )
    lines.push(
      'Calls to these tools are refused before the handler runs. Do not attempt them; instead direct the operator to the matching backoffice page or to switch the tenant policy if they have permission.',
    )
  }
  lines.push('')
  lines.push(
    'This RUNTIME policy block always wins over any conflicting "approval card" language earlier in the prompt — the static prompt is written for the most restrictive case but real behavior depends on the per-call policy described here.',
  )
  return lines.join('\n')
}

function appendRuntimeMutationPolicy(
  systemPrompt: string,
  agent: { id: string; mutationPolicy?: string | null; allowedTools: string[] },
  mutationPolicyOverride: string | null,
): string {
  const block = buildRuntimeMutationPolicySection(agent, mutationPolicyOverride)
  if (!block) return systemPrompt
  return `${systemPrompt}\n\n${block}`
}

/**
 * Server-side helper that runs an Open Mercato agent in chat mode via the
 * Vercel AI SDK and returns a streaming `Response` ready to be emitted from a
 * route handler. Shares the same policy gate and tool resolution path as the
 * HTTP dispatcher — a caller using this helper can never bypass the agent's
 * `requiredFeatures`, `allowedTools`, `executionMode`, or `mutationPolicy`.
 *
 * Attachment-to-model conversion (Step 3.7): resolved
 * {@link AiResolvedAttachmentPart}s are materialized inline as AI SDK v6
 * `FileUIPart` entries on the last user message (images/PDFs) and as a
 * structured `[ATTACHMENTS]` block appended to the system prompt (text
 * extracts + metadata-only summaries). The existing `attachmentIds`
 * pass-through into `resolveAiAgentTools` is preserved — Step 3.6 parity
 * invariant #7 still holds.
 */
export async function runAiAgentText(input: RunAiAgentTextInput): Promise<Response> {
  const [mutationPolicyOverride, tenantRuntimeOverride] = await Promise.all([
    resolveMutationPolicyOverride(
      input.agentId,
      input.container,
      input.authContext.tenantId,
      input.authContext.organizationId,
    ),
    resolveRuntimeModelOverride(
      input.agentId,
      input.container,
      input.authContext.tenantId,
      input.authContext.organizationId,
    ),
  ])
  const { agent, tools } = await resolveAiAgentTools({
    agentId: input.agentId,
    authContext: input.authContext,
    pageContext: input.pageContext,
    attachmentIds: input.attachmentIds,
    mutationPolicyOverride,
    container: input.container,
    conversationId: input.conversationId ?? null,
  })

  const resolvedAttachments = await resolveAttachmentPartsForAgent({
    agent,
    attachmentIds: input.attachmentIds,
    authContext: input.authContext,
    container: input.container,
  })

  const baseSystemPrompt = await composeSystemPrompt(
    agent,
    input.pageContext,
    input.container,
    input.authContext.tenantId,
    input.authContext.organizationId,
  )
  const systemPrompt = appendRuntimeMutationPolicy(
    appendAttachmentSummary(baseSystemPrompt, resolvedAttachments),
    agent,
    mutationPolicyOverride,
  )

  const { model } = resolveAgentModel(
    agent,
    input.modelOverride,
    input.providerOverride,
    input.container,
    input.baseUrlOverride,
    tenantRuntimeOverride,
    input.requestOverride,
  )
  const normalizedMessages = ensureUiMessageShape(input.messages)
  const hydratedMessages = attachAttachmentsToMessages(normalizedMessages, resolvedAttachments)
  const modelMessages = await convertToModelMessages(hydratedMessages)

  const effectiveLoop = resolveEffectiveLoopConfig(agent, input.loop, WRAPPER_DEFAULT_LOOP_CHAT)
  const stopConditions = translateStopConditions(effectiveLoop)
  const wrapperPrepareStep = buildWrapperPrepareStep(agent, effectiveLoop, tools)

  // Phase 3 + Phase 4 — budget enforcement + LoopTrace collection.
  // Layer order (outer → inner):
  //   budgetEnforcer.wire(traceOnStepFinish) → traceOnStepFinish calls userOnStepFinish
  // The trace collector builds the per-turn LoopTrace; the budget enforcer
  // aborts via AbortController when any limit is exceeded.
  const turnId = `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const loopTraceCollector = buildLoopTraceCollector(agent.id, turnId, effectiveLoop.onStepFinish)
  const abortController = new AbortController()
  const budgetEnforcer = new BudgetEnforcer(effectiveLoop.budget, abortController)
  const wiredOnStepFinish = budgetEnforcer.wire(loopTraceCollector.onStepFinish)

  let wallClockTimer: ReturnType<typeof setTimeout> | undefined
  if (effectiveLoop.budget?.maxWallClockMs) {
    wallClockTimer = setTimeout(() => {
      budgetEnforcer.recordStep({ toolCalls: 0 })
    }, effectiveLoop.budget.maxWallClockMs)
  }

  const preparedOptions: PreparedAiSdkOptions = {
    model,
    tools,
    system: systemPrompt,
    messages: modelMessages,
    maxSteps: effectiveLoop.maxSteps ?? 10,
    stopWhen: stopConditions,
    prepareStep: wrapperPrepareStep,
    onStepFinish: wiredOnStepFinish,
    onStepStart: effectiveLoop.onStepStart,
    onToolCallStart: effectiveLoop.onToolCallStart,
    onToolCallFinish: effectiveLoop.onToolCallFinish,
    experimental_repairToolCall: effectiveLoop.repairToolCall,
    activeTools: effectiveLoop.activeTools,
    toolChoice: effectiveLoop.toolChoice,
    abortSignal: abortController.signal,
    finalizeLoopTrace: () => loopTraceCollector.finalize(budgetEnforcer.abortReason),
  }

  if (input.generateText) {
    try {
      const callbackResult = await input.generateText(preparedOptions)
      const baseResponse = (callbackResult as StreamTextResult<ToolSet>).toUIMessageStreamResponse({
        sendReasoning: true,
        headers: {
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        },
      })
      if (input.emitLoopTrace) {
        return appendLoopFinishToStream(baseResponse, preparedOptions.finalizeLoopTrace)
      }
      return baseResponse
    } finally {
      if (wallClockTimer !== undefined) clearTimeout(wallClockTimer)
    }
  }

  const result = streamText({
    model,
    system: systemPrompt,
    messages: modelMessages,
    tools,
    stopWhen: stopConditions,
    prepareStep: wrapperPrepareStep,
    onStepFinish: wiredOnStepFinish,
    onStepStart: effectiveLoop.onStepStart,
    experimental_onToolCallStart: effectiveLoop.onToolCallStart,
    experimental_onToolCallFinish: effectiveLoop.onToolCallFinish,
    experimental_repairToolCall: effectiveLoop.repairToolCall,
    ...(effectiveLoop.activeTools !== undefined ? { activeTools: effectiveLoop.activeTools } : {}),
    ...(effectiveLoop.toolChoice !== undefined ? { toolChoice: effectiveLoop.toolChoice } : {}),
    abortSignal: abortController.signal,
  })
  if (wallClockTimer !== undefined) {
    result.consumeStream().then(() => clearTimeout(wallClockTimer!)).catch(() => clearTimeout(wallClockTimer!))
  }
  const baseResponse = result.toUIMessageStreamResponse({
    sendReasoning: true,
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
  if (input.emitLoopTrace) {
    return appendLoopFinishToStream(baseResponse, preparedOptions.finalizeLoopTrace)
  }
  return baseResponse
}

/**
 * Runtime override for the structured-output schema used by {@link runAiAgentObject}.
 * When the agent itself declares no `output` block, the caller MUST supply this;
 * otherwise the helper rejects with {@link AgentPolicyError} code
 * `execution_mode_not_supported`.
 */
export interface RunAiAgentObjectOutputOverride<TSchema = ZodTypeAny> {
  schemaName: string
  schema: TSchema
  /**
   * `'generate'` (default) calls AI SDK `generateObject` and resolves to the
   * parsed object. `'stream'` calls `streamObject` and returns the SDK's
   * streaming handle so callers can consume partial objects / text deltas.
   */
  mode?: 'generate' | 'stream'
}

export interface RunAiAgentObjectInput<TSchema = ZodTypeAny> {
  agentId: string
  /**
   * Accepts either a bare user prompt (wrapped as `[{ role: 'user', content }]`)
   * or a prebuilt `UIMessage[]` array — matches the source spec's
   * `RunAiAgentObjectInput` contract (§1149–1160).
   */
  input: string | UIMessage[]
  attachmentIds?: string[]
  pageContext?: AgentRequestPageContext
  /**
   * Same Phase-1 shim as {@link RunAiAgentTextInput.authContext}. Required until
   * a global request-context resolver lands (Phase 4).
   */
  authContext: AiChatRequestContext
  modelOverride?: string
  /**
   * Optional request-time provider override. When non-empty, wins for the
   * provider axis at the same priority as `modelOverride` for the model axis.
   *
   * Phase 1 of spec `2026-04-27-ai-agents-provider-model-baseurl-overrides`.
   */
  providerOverride?: string
  /**
   * Optional per-call base URL override. Wins over every other source in the
   * baseURL resolution chain. Intended for programmatic callers only — the
   * HTTP query-param baseUrl and the AI_RUNTIME_BASEURL_ALLOWLIST arrive in
   * Phase 4a and MUST NOT be exposed here.
   *
   * Phase 2 of spec `2026-04-27-ai-agents-provider-model-baseurl-overrides`.
   */
  baseUrlOverride?: string
  /**
   * Per-request HTTP dispatcher override (query params `?provider=`, `?model=`,
   * `?baseUrl=`). Validated by the dispatcher route before being forwarded
   * here. Wins over tenantOverride and all lower-priority sources when
   * `agent.allowRuntimeModelOverride !== false`.
   *
   * Phase 4a of spec `2026-04-27-ai-agents-provider-model-baseurl-overrides`.
   */
  requestOverride?: {
    providerId?: string | null
    modelId?: string | null
    baseURL?: string | null
  }
  output?: RunAiAgentObjectOutputOverride<TSchema>
  debug?: boolean
  container?: AwilixContainer
  /**
   * Optional per-call loop config override for object mode. Only the
   * object-safe subset is accepted: `maxSteps`, `budget`, `onStepFinish`,
   * `onStepStart`, and `allowRuntimeOverride`. Providing any chat-only
   * field (`prepareStep`, `repairToolCall`, `stopWhen`, `activeTools`,
   * `toolChoice`) throws `AgentPolicyError` code
   * `loop_unsupported_in_object_mode`.
   *
   * Phase 1 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
   */
  loop?: Pick<AiAgentLoopConfig, 'maxSteps' | 'budget' | 'onStepFinish' | 'onStepStart' | 'allowRuntimeOverride'>
  /**
   * Optional escape-hatch callback receiving the fully prepared object-mode
   * options bag. When supplied the wrapper still enforces all policy guardrails
   * and then delegates the actual SDK call to this function. The callback MUST
   * return a value compatible with `GenerateObjectResult` or `StreamObjectResult`.
   *
   * Phase 2 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
   */
  generateObject?: (
    options: PreparedAiSdkObjectOptions,
  ) => Promise<GenerateObjectResult<unknown> | StreamObjectResult<unknown, unknown, unknown>>
}

export type RunAiAgentObjectGenerateResult<TSchema> = {
  mode: 'generate'
  object: TSchema
  finishReason?: string
  usage?: { inputTokens?: number; outputTokens?: number }
}

export type RunAiAgentObjectStreamResult<TSchema> = {
  mode: 'stream'
  /** Full parsed object once the stream completes. */
  object: Promise<TSchema>
  /** Async iterator of partial (progressively hydrated) objects. */
  partialObjectStream: AsyncIterable<Partial<TSchema>>
  /** Async iterator of the raw text deltas the model emitted. */
  textStream: AsyncIterable<string>
  finishReason?: Promise<string | undefined>
  usage?: Promise<{ inputTokens?: number; outputTokens?: number } | undefined>
}

export type RunAiAgentObjectResult<TSchema> =
  | RunAiAgentObjectGenerateResult<TSchema>
  | RunAiAgentObjectStreamResult<TSchema>

function normalizeObjectMessages(input: string | UIMessage[]): UIMessage[] {
  if (typeof input === 'string') {
    return [
      {
        id: 'user-input',
        role: 'user',
        parts: [{ type: 'text', text: input }],
      } as unknown as UIMessage,
    ]
  }
  return input
}

function resolveStructuredOutput<TSchema>(
  agent: AiAgentDefinition,
  override: RunAiAgentObjectOutputOverride<TSchema> | undefined,
): { schemaName: string; schema: unknown; mode: 'generate' | 'stream' } {
  if (override) {
    return {
      schemaName: override.schemaName,
      schema: override.schema as unknown,
      mode: override.mode ?? 'generate',
    }
  }
  const declared = agent.output as AiAgentStructuredOutput | undefined
  if (!declared) {
    throw new AgentPolicyError(
      'execution_mode_not_supported',
      `Agent "${agent.id}" does not declare a structured-output schema; pass runAiAgentObject({ output }) or declare agent.output.`,
    )
  }
  return {
    schemaName: declared.schemaName,
    schema: declared.schema as unknown,
    mode: declared.mode ?? 'generate',
  }
}

/**
 * Server-side helper that runs an Open Mercato agent in structured-output mode
 * via the Vercel AI SDK. Shares the same policy gate, tool resolution path,
 * system-prompt composition, and model resolution as {@link runAiAgentText} —
 * object-mode and chat-mode CANNOT diverge.
 *
 * Attachment-to-model conversion (Step 3.7): resolved
 * {@link AiResolvedAttachmentPart}s are materialized inline as AI SDK v6
 * `FileUIPart` entries on the last user message (images/PDFs) and as a
 * structured `[ATTACHMENTS]` block appended to the system prompt (text
 * extracts + metadata-only summaries). Matches {@link runAiAgentText} byte-
 * for-byte so the Step 3.6 parity contract is preserved.
 */
export async function runAiAgentObject<TSchema = unknown>(
  input: RunAiAgentObjectInput<TSchema>,
): Promise<RunAiAgentObjectResult<TSchema>> {
  const [mutationPolicyOverride, tenantRuntimeOverride] = await Promise.all([
    resolveMutationPolicyOverride(
      input.agentId,
      input.container,
      input.authContext.tenantId,
      input.authContext.organizationId,
    ),
    resolveRuntimeModelOverride(
      input.agentId,
      input.container,
      input.authContext.tenantId,
      input.authContext.organizationId,
    ),
  ])
  const { agent, tools } = await resolveAiAgentTools({
    agentId: input.agentId,
    authContext: input.authContext,
    pageContext: input.pageContext,
    attachmentIds: input.attachmentIds,
    requestedExecutionMode: 'object',
    mutationPolicyOverride,
    container: input.container,
  })

  const resolvedOutput = resolveStructuredOutput(agent, input.output)

  const resolvedAttachments = await resolveAttachmentPartsForAgent({
    agent,
    attachmentIds: input.attachmentIds,
    authContext: input.authContext,
    container: input.container,
  })

  const baseSystemPrompt = await composeSystemPrompt(
    agent,
    input.pageContext,
    input.container,
    input.authContext.tenantId,
    input.authContext.organizationId,
  )
  const systemPrompt = appendRuntimeMutationPolicy(
    appendAttachmentSummary(baseSystemPrompt, resolvedAttachments),
    agent,
    mutationPolicyOverride,
  )

  const { model } = resolveAgentModel(
    agent,
    input.modelOverride,
    input.providerOverride,
    input.container,
    input.baseUrlOverride,
    tenantRuntimeOverride,
    input.requestOverride,
  )
  const normalizedMessages = ensureUiMessageShape(normalizeObjectMessages(input.input))
  const hydratedMessages = attachAttachmentsToMessages(
    normalizedMessages,
    resolvedAttachments,
  )
  const modelMessages = await convertToModelMessages(hydratedMessages)
  void tools

  if (input.loop) {
    assertLoopObjectModeCompatible(input.loop)
  }
  const effectiveLoop = resolveEffectiveLoopConfig(agent, input.loop, WRAPPER_DEFAULT_LOOP_OBJECT)

  const abortController = new AbortController()

  const preparedObjectOptions: PreparedAiSdkObjectOptions = {
    model,
    system: systemPrompt,
    messages: modelMessages,
    schemaName: resolvedOutput.schemaName,
    schema: resolvedOutput.schema,
    maxSteps: effectiveLoop.maxSteps,
    onStepFinish: effectiveLoop.onStepFinish,
    onStepStart: effectiveLoop.onStepStart,
    abortSignal: abortController.signal,
  }

  if (input.generateObject) {
    const callbackResult = await input.generateObject(preparedObjectOptions)
    const typedResult = callbackResult as Record<string, unknown>
    if ('partialObjectStream' in typedResult) {
      const streamResult = typedResult as {
        object: Promise<TSchema>
        partialObjectStream: AsyncIterable<Partial<TSchema>>
        textStream: AsyncIterable<string>
        finishReason?: Promise<string | undefined>
        usage?: Promise<{ inputTokens?: number; outputTokens?: number } | undefined>
      }
      return {
        mode: 'stream',
        object: streamResult.object,
        partialObjectStream: streamResult.partialObjectStream,
        textStream: streamResult.textStream,
        finishReason: streamResult.finishReason,
        usage: streamResult.usage,
      }
    }
    const genResult = typedResult as { object: unknown; finishReason?: string; usage?: { inputTokens?: number; outputTokens?: number } }
    return {
      mode: 'generate',
      object: genResult.object as TSchema,
      finishReason: genResult.finishReason,
      usage: genResult.usage,
    }
  }

  if (resolvedOutput.mode === 'stream') {
    const streamArgs: Parameters<typeof streamObject>[0] = {
      model,
      system: systemPrompt,
      messages: modelMessages,
      schema: resolvedOutput.schema as never,
      schemaName: resolvedOutput.schemaName,
      ...(effectiveLoop.maxSteps !== undefined ? { maxSteps: effectiveLoop.maxSteps } : {}),
      onStepFinish: effectiveLoop.onStepFinish,
      onStepStart: effectiveLoop.onStepStart,
      abortSignal: abortController.signal,
    }
    const result = streamObject(streamArgs) as unknown as {
      object: Promise<TSchema>
      partialObjectStream: AsyncIterable<Partial<TSchema>>
      textStream: AsyncIterable<string>
      finishReason?: Promise<string | undefined>
      usage?: Promise<{ inputTokens?: number; outputTokens?: number } | undefined>
    }
    return {
      mode: 'stream',
      object: result.object,
      partialObjectStream: result.partialObjectStream,
      textStream: result.textStream,
      finishReason: result.finishReason,
      usage: result.usage,
    }
  }

  const generateArgs: Parameters<typeof generateObject>[0] = {
    model,
    system: systemPrompt,
    messages: modelMessages,
    schema: resolvedOutput.schema as never,
    schemaName: resolvedOutput.schemaName,
    ...(effectiveLoop.maxSteps !== undefined ? { maxSteps: effectiveLoop.maxSteps } : {}),
    onStepFinish: effectiveLoop.onStepFinish,
    onStepStart: effectiveLoop.onStepStart,
    abortSignal: abortController.signal,
  }

  const result = await generateObject(generateArgs)
  return {
    mode: 'generate',
    object: (result as { object: unknown }).object as TSchema,
    finishReason: (result as { finishReason?: string }).finishReason,
    usage: (result as { usage?: { inputTokens?: number; outputTokens?: number } }).usage,
  }
}

export { AgentPolicyError }
