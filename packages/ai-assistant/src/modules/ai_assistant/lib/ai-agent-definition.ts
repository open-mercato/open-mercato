import type { AwilixContainer } from 'awilix'
import type { ZodTypeAny } from 'zod'
import type {
  PrepareStepFunction,
  GenerateTextOnStepFinishCallback,
  GenerateTextOnStepStartCallback,
  GenerateTextOnToolCallStartCallback,
  GenerateTextOnToolCallFinishCallback,
  ToolCallRepairFunction,
  StopCondition,
  ToolChoice,
  ToolSet,
} from 'ai'

export type AiAgentExecutionMode = 'chat' | 'object'

/**
 * Selects the underlying Vercel AI SDK dispatch strategy for this agent.
 *
 * - `'stream-text'` (default): the runtime calls `streamText(...)` directly on
 *   every turn. All loop primitives are supported: `prepareStep`, `stopWhen`,
 *   `repairToolCall`, `activeTools`, `toolChoice`.
 *
 * - `'tool-loop-agent'`: the runtime constructs a `ToolLoopAgent`
 *   (`Experimental_Agent`) once and dispatches via `agent.generate(...)` /
 *   `agent.stream(...)` per turn. The wrapper-owned `prepareStep` (security-
 *   critical for mutation-approval) is supplied at construction via
 *   `settings.prepareStep`. `stopWhen` is similarly wired at construction.
 *   The `prepareCall` hook is used for per-turn narrowing of `model`, `tools`,
 *   `stopWhen`, `activeTools`, and `providerOptions`; `prepareStep` is NOT in
 *   its `Pick` list and MUST NOT be threaded through it.
 *
 *   Note: the current SDK version ships `experimental_repairToolCall` on
 *   `ToolLoopAgentSettings`, so `repairToolCall` is technically reachable via
 *   this engine. The `loop.repairToolCall` JSDoc retains a caveat reflecting
 *   the spec's documented limitation, which was written against an earlier SDK
 *   snapshot where the setting was absent — use with awareness that SDK
 *   behaviour may differ across versions.
 *
 * Phase 5 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
 */
export type AiAgentExecutionEngine = 'stream-text' | 'tool-loop-agent'

/**
 * A serializable stop condition for the agentic loop. The `kind` field
 * determines which Vercel AI SDK helper is used at runtime:
 * - `stepCount` → `stepCountIs(count)` — the loop stops after N steps.
 * - `hasToolCall` → `hasToolCall(toolName)` — the loop stops immediately
 *   after the model emits a tool call for the named tool.
 * - `custom` — a raw `StopCondition<ToolSet>` predicate supplied in code.
 *   NOT valid from JSON-only override sources (tenant DB overrides); only
 *   accepted when declared directly in `agent.loop` or a `runAiAgentText`
 *   caller override.
 *
 * Phase 0 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
 */
export type AiAgentLoopStopCondition =
  | { kind: 'stepCount'; count: number }
  | { kind: 'hasToolCall'; toolName: string }
  | { kind: 'custom'; stop: StopCondition<ToolSet> }

/**
 * Budget limits for the agentic loop turn. When any limit is exceeded the
 * wrapper's `prepareStep`/`onStepFinish` aborts the turn via the per-turn
 * `AbortController` and the loop terminates with a `loop_budget_exceeded`
 * finish condition.
 *
 * Budget enforcement is implemented in Phase 1782-3; for Phases 0–2 the
 * fields are accepted and forwarded to the prepared-options bag but are not
 * actively enforced.
 *
 * Phase 0 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
 */
export interface AiAgentLoopBudget {
  /** Hard cap on tool calls across all steps in this turn. */
  maxToolCalls?: number
  /** Wall-clock cap (ms) per turn; runtime aborts via AbortController. */
  maxWallClockMs?: number
  /** Input+output token cap; aggregated from step `usage` fields. */
  maxTokens?: number
}

/**
 * First-class loop configuration for an AI agent. Supersedes the flat
 * `maxSteps` alias on `AiAgentDefinition`.
 *
 * All fields are optional; the runtime falls back to the wrapper default
 * (`{ maxSteps: 10 }` for chat, `{ maxSteps: undefined }` for object) when
 * neither the agent nor the caller supplies any loop config.
 *
 * Phase 0 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
 */
export interface AiAgentLoopConfig {
  /** Maximum number of agentic steps before the loop is forced to stop. */
  maxSteps?: number
  /**
   * Additional stop conditions. The wrapper ALWAYS composes these with
   * `stepCountIs(maxSteps ?? 10)` so a misconfigured `hasToolCall` for a
   * non-existent tool can never cause an infinite loop (R3 mitigation).
   */
  stopWhen?: AiAgentLoopStopCondition | AiAgentLoopStopCondition[]
  /**
   * Per-step preparation hook. The wrapper composes this with its own
   * security-critical `prepareStep` that re-asserts the tool allowlist and
   * mutation-approval wrapping per step.
   *
   * Only valid for chat agents. Rejected with `loop_unsupported_in_object_mode`
   * for object-mode agents.
   */
  prepareStep?: PrepareStepFunction<ToolSet>
  /**
   * Callback fired when a step finishes. The wrapper chains its own
   * aggregation callback (LoopTrace builder) before invoking this one.
   * Exceptions thrown by this callback are caught and logged but do not
   * abort the turn (matching the SDK's own contract).
   */
  onStepFinish?: GenerateTextOnStepFinishCallback<ToolSet>
  /**
   * Callback fired when a step starts. Forwarded to the AI SDK as
   * `experimental_onStepStart`.
   */
  onStepStart?: GenerateTextOnStepStartCallback<ToolSet>
  /**
   * Callback fired when a tool call starts. Forwarded to the AI SDK as
   * `experimental_onToolCallStart`.
   */
  onToolCallStart?: GenerateTextOnToolCallStartCallback<ToolSet>
  /**
   * Callback fired when a tool call finishes. Forwarded to the AI SDK as
   * `experimental_onToolCallFinish`.
   */
  onToolCallFinish?: GenerateTextOnToolCallFinishCallback<ToolSet>
  /**
   * Tool-call repair function. Forwarded to the AI SDK as
   * `experimental_repairToolCall`.
   *
   * Only valid for chat agents. Rejected with `loop_unsupported_in_object_mode`
   * for object-mode agents.
   *
   * **Engine note**: this primitive is honored under `executionEngine: 'stream-text'`
   * (default). Agents on `'tool-loop-agent'` may not reliably support
   * `repairToolCall` across all SDK versions — if you require it, use the
   * default `stream-text` engine until support is confirmed stable on the
   * `ToolLoopAgent` class.
   *
   * Phase 5 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
   */
  repairToolCall?: ToolCallRepairFunction<ToolSet>
  /**
   * Narrow the active tool surface for each step. Names must be a subset of
   * `agent.allowedTools`; any names outside the allowlist are filtered out
   * with a `loop:active_tools_filtered` warning.
   *
   * Only valid for chat agents. Rejected with `loop_unsupported_in_object_mode`
   * for object-mode agents.
   */
  activeTools?: string[]
  /**
   * Tool choice strategy forwarded to the AI SDK on each step.
   *
   * Only valid for chat agents. Rejected with `loop_unsupported_in_object_mode`
   * for object-mode agents.
   */
  toolChoice?: ToolChoice<ToolSet>
  /** Budget caps for this loop turn. */
  budget?: AiAgentLoopBudget
  /**
   * When `false`, per-call `runAiAgentText({ loop })` / HTTP query-param
   * overrides are rejected with `AgentPolicyError` code
   * `loop_runtime_override_disabled`. Default is `true` (permissive).
   *
   * Agents that pin a loop policy for correctness reasons (e.g. a
   * `stopWhen: hasToolCall(...)` that must not be bypassed by callers)
   * should set this to `false`.
   */
  allowRuntimeOverride?: boolean
  /**
   * Kill switch — when `true`, the runtime forces `stopWhen: stepCountIs(1)` and
   * ignores all other loop config. Used by the per-tenant operator override to
   * collapse an agent to a single model call (no tool execution) without
   * disabling the agent entirely.
   *
   * Phase 3 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
   */
  disabled?: boolean
}

/**
 * Per-step record aggregated by the wrapper-owned `onStepFinish` hook into
 * `LoopTrace`. Each completed agentic step produces one record.
 *
 * Phase 4 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
 */
export interface LoopStepRecord {
  stepIndex: number
  /** Model id resolved for this step (relevant when prepareStep swaps models). */
  modelId: string
  toolCalls: Array<{
    toolName: string
    args: unknown
    result?: unknown
    error?: { code: string; message: string }
    repairAttempted: boolean
    durationMs: number
  }>
  /** Raw assistant text emitted in this step. */
  textDelta: string
  usage: { inputTokens: number; outputTokens: number }
  finishReason: 'stop' | 'tool-calls' | 'length' | 'content-filter' | 'error'
}

/**
 * Per-turn trace aggregated by the wrapper-owned `buildLoopTraceCollector`.
 * Not persisted — in-memory only; surfaced via the dispatcher SSE stream and
 * the playground/`<AiChat>` debug panel.
 *
 * Phase 4 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
 */
export interface LoopTrace {
  agentId: string
  /**
   * Stable per-conversation id that ties every turn together. Echoed back on
   * the SSE `loop-finish` event so clients can persist it for subsequent turns.
   *
   * Phase 6.2 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
   */
  sessionId: string
  turnId: string
  steps: LoopStepRecord[]
  stopReason:
    | 'step-count'
    | 'has-tool-call'
    | 'custom-stop'
    | 'budget-tokens'
    | 'budget-tool-calls'
    | 'budget-wall-clock'
    | 'tenant-disabled'
    | 'finish-reason'
    | 'abort'
  totalDurationMs: number
  totalUsage: { inputTokens: number; outputTokens: number }
}

export type AiAgentMutationPolicy =
  | 'read-only'
  | 'confirm-required'
  | 'destructive-confirm-required'

export type AiAgentAcceptedMediaType = 'image' | 'pdf' | 'file'

export type AiAgentDataOperation = 'read' | 'search' | 'aggregate'

export interface AiAgentPageContextInput {
  entityType: string
  recordId: string
  container: AwilixContainer
  tenantId: string | null
  organizationId: string | null
}

export interface AiAgentStructuredOutput<TSchema = ZodTypeAny> {
  schemaName: string
  schema: TSchema
  mode?: 'generate' | 'stream'
}

export interface AiAgentDataCapabilities {
  entities?: string[]
  operations?: AiAgentDataOperation[]
  searchableFields?: string[]
}

export interface AiAgentSuggestion {
  label: string
  prompt: string
}

export interface AiAgentDefinition {
  id: string
  moduleId: string
  label: string
  description: string
  systemPrompt: string
  allowedTools: string[]
  suggestions?: AiAgentSuggestion[]
  executionMode?: AiAgentExecutionMode
  /**
   * Selects the underlying Vercel AI SDK dispatch strategy for this agent.
   * Defaults to `'stream-text'` — the existing behavior and the only engine
   * with unconditional full primitive coverage (`repairToolCall`, all loop
   * controls).
   *
   * Set to `'tool-loop-agent'` to use the `ToolLoopAgent` (`Experimental_Agent`)
   * class, which is closer to a semantic agent abstraction and receives upcoming
   * SDK features (multi-agent handoff, streaming approval responses) first.
   *
   * **Note on `repairToolCall`**: the current SDK version ships
   * `experimental_repairToolCall` on `ToolLoopAgentSettings`, so the primitive
   * is technically available. However, SDK behaviour is not guaranteed to be
   * identical across versions — prefer `'stream-text'` when `repairToolCall`
   * correctness is critical.
   *
   * This field is opt-in: omitting it leaves the existing `stream-text` path
   * completely unchanged.
   *
   * Phase 5 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
   */
  executionEngine?: AiAgentExecutionEngine
  /**
   * Optional provider id this agent prefers (e.g. `'openai'`, `'anthropic'`).
   * Must match a registered `LlmProvider.id`. When the named provider is
   * registered but unconfigured at runtime the factory falls through
   * transparently to the next configured provider.
   *
   * Phase 1 of spec `2026-04-27-ai-agents-provider-model-baseurl-overrides`.
   */
  defaultProvider?: string
  /**
   * Optional model id fed through `createModelFactory` for this agent.
   * Accepts either a plain model id (`claude-haiku-4-5-20251001`) or a
   * slash-qualified `<provider>/<model>` shorthand (e.g. `openai/gpt-5-mini`).
   * When the slash form is used the prefix must match a registered provider id;
   * the registry-membership guard prevents mis-splitting model ids that already
   * contain slashes (DeepInfra: `meta-llama/Llama-3.3-70B-Instruct-Turbo`).
   *
   * A higher-priority provider source still wins over the slash hint, but a
   * lower-priority one cannot overwrite a slash-qualified model (cross-axis
   * tie-break rule from spec §Phase-1).
   *
   * Phase 0 and Phase 1 of spec `2026-04-27-ai-agents-provider-model-baseurl-overrides`.
   */
  defaultModel?: string
  /**
   * Optional base URL this agent prefers for its chosen provider.
   * Sits between the `<MODULE>_AI_BASE_URL` env (step 2 of the public 5-step
   * baseURL hierarchy) and the preset env override (`baseURLEnvKeys`, step 4).
   * Only honoured by adapters that support baseURL (Anthropic Messages-
   * protocol relays, all OpenAI-compatible adapters, Google via
   * @ai-sdk/google ≥3.0). See `packages/ai-assistant/AGENTS.md` →
   * "baseURL override hierarchy" for the full numbered chain.
   *
   * Phase 2 of spec `2026-04-27-ai-agents-provider-model-baseurl-overrides`.
   */
  defaultBaseUrl?: string
  /**
   * When false, per-request HTTP overrides (query params `provider`, `model`,
   * `baseUrl`, `loopBudget`) and the per-tenant settings override stored in
   * `ai_agent_runtime_overrides` are both suppressed. Steps 1 and 3 of the
   * model-factory resolution chain are skipped for this agent, and the
   * `loopBudget` query parameter is ignored by the chat dispatcher.
   *
   * Default is `true` (permissive). Agents that pin a specific model for
   * correctness reasons (e.g. a structured-output agent whose JSON-mode schema
   * only works with one provider) should set this to `false`.
   *
   * Phase 4a of spec `2026-04-27-ai-agents-provider-model-baseurl-overrides`.
   * Renamed from `allowRuntimeModelOverride` in Phase 4 of spec
   * `2026-04-28-ai-agents-agentic-loop-controls`.
   */
  allowRuntimeOverride?: boolean
  /**
   * @deprecated Use `allowRuntimeOverride` instead. This alias is kept for
   * one minor release and will be removed in a future version. The runtime
   * checks `allowRuntimeOverride` first; if absent it falls back to this field.
   *
   * Phase 4a of spec `2026-04-27-ai-agents-provider-model-baseurl-overrides`.
   */
  allowRuntimeModelOverride?: boolean
  acceptedMediaTypes?: AiAgentAcceptedMediaType[]
  requiredFeatures?: string[]
  uiParts?: string[]
  readOnly?: boolean
  mutationPolicy?: AiAgentMutationPolicy
  /**
   * @deprecated Use `loop.maxSteps` instead. Honored as alias when `loop` is
   * omitted. When both `maxSteps` and `loop.maxSteps` are specified, `loop.maxSteps`
   * wins. This field will be removed in a future minor release.
   *
   * Phase 0 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
   */
  maxSteps?: number
  /**
   * First-class agentic loop configuration. Supersedes the flat `maxSteps`
   * alias. The runtime walks a precedence chain (per-call override → tenant
   * DB override → this block → legacy `maxSteps` alias → wrapper default)
   * to resolve the effective loop config for each turn.
   *
   * Phase 0 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
   */
  loop?: AiAgentLoopConfig
  output?: AiAgentStructuredOutput
  resolvePageContext?: (ctx: AiAgentPageContextInput) => Promise<string | null>
  keywords?: string[]
  domain?: string
  dataCapabilities?: AiAgentDataCapabilities
}

export interface AiAgentExtension {
  targetAgentId: string
  replaceAllowedTools?: string[]
  deleteAllowedTools?: string[]
  appendAllowedTools?: string[]
  replaceSystemPrompt?: string
  appendSystemPrompt?: string
  replaceSuggestions?: AiAgentSuggestion[]
  deleteSuggestions?: string[]
  appendSuggestions?: AiAgentSuggestion[]
  /**
   * @deprecated Use `appendSuggestions` for new code. Preserved as the
   * original append-only field for backward compatibility.
   */
  suggestions?: AiAgentSuggestion[]
}

export function defineAiAgent(definition: AiAgentDefinition): AiAgentDefinition {
  return definition
}

export function defineAiAgentExtension(extension: AiAgentExtension): AiAgentExtension {
  return extension
}
