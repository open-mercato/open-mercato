import type { EntityManager } from '@mikro-orm/postgresql'
import {
  extractStepMeta,
  extractStepToolCalls,
  type ExtractedToolCall,
  type RawStepEvent,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/loop-step-extraction'
import type { TraceIngest, TraceSpanIngest } from '../../data/validators'
import { ingestTrace, SUMMARY_CHAR_LIMIT } from '../trace/traceIngestionService'
import { createArtifactOffloader } from '../trace/artifactStore'
import { evaluateRun } from '../eval/evalRuntimeService'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { invalidateAgentRunCache } from '../crudCache'
import { withRuntimeAuditWrite } from '../identity/agentWriteScope'
import type { RunManifestCaptureLevel, RunManifestInput } from '../trace/runManifest'
import { buildRunManifestSpan } from '../trace/runManifestEntry'
import {
  GEN_AI_ATTRIBUTES,
  GEN_AI_OPERATIONS,
  GEN_AI_OUTPUT_TYPES,
  LEGACY_LLM_ATTRIBUTES,
  OM_LLM_ATTRIBUTES,
  STOP_SEQUENCES_MAX_COUNT,
  STOP_SEQUENCE_MAX_CHARS,
} from '../trace/genAiAttributes'
import { computeCostMicros } from './modelPricing'
import type { NativeModelCallRecord } from './nativeModelCallRecorder'

const logger = createLogger('agent_orchestrator').child({ component: 'native-trace-capture' })

/**
 * Always-on per-step trace capture for the native runtime (lightweight-agent-
 * runtime spec Phase 1). The runner records one {@link NativeStepRecord} per
 * AI SDK step through the (newly forwarded) object-mode `loop.onStepFinish`
 * hook, then — post-run, best-effort — maps them to `AgentSpan`/`AgentToolCall`
 * rows via the existing idempotent `ingestTrace` service:
 *
 * - each step → one `llm` span (`externalSpanId = <runId>:<seq>`, token usage
 *   + finish reason in `attributes`);
 * - each tool call within a step → one child `tool` span
 *   (`externalSpanId = <runId>:<seq>:<toolIdx>`) carrying its `AgentToolCall`
 *   row (capped/offloaded request/response summaries);
 * - a toolless run (plain `generateObject`, no step callbacks) → one synthetic
 *   `llm` span covering the whole model call, so every native run has a trace.
 *
 * Deterministic span ids keyed off the run id make re-ingest attempts
 * idempotent, and the payload carries NO run-level `status`/`output` fields —
 * the found-run update path can never regress the completed run's state.
 */

export type NativeStepToolCall = Pick<ExtractedToolCall, 'toolName' | 'args' | 'result' | 'error'> & {
  durationMs: number
}

export type NativeStepRecord = {
  modelId: string
  finishReason: string
  usage: { inputTokens: number; outputTokens: number }
  toolCalls: NativeStepToolCall[]
  /** Wall-clock ms when the step's onStepFinish fired. */
  endedAtMs: number
  call?: NativeModelCallRecord
}

export type NativeTraceInput = {
  runId: string
  agentId: string
  steps: NativeStepRecord[]
  /** Wall-clock ms when the model execution started. */
  startedAtMs: number
  /** Wall-clock ms when the model execution settled. */
  endedAtMs: number
  /** Run-level usage fallback for toolless runs (no step callbacks). */
  fallbackUsage?: { inputTokens?: number; outputTokens?: number } | null
  /** Declared model id fallback when no step reported one. */
  fallbackModel?: string | null
  fallbackCall?: NativeModelCallRecord | null
  /** Run manifest facts; when present the payload carries one `run.manifest` system span. */
  manifest?: RunManifestInput | null
  /** Per-step metadata level; `off` keeps the legacy llm span attributes only. Defaults to `metadata`. */
  captureLevel?: RunManifestCaptureLevel
}

/**
 * Maps one AI SDK `onStepFinish` event to a {@link NativeStepRecord} through the
 * shared ai-assistant extraction helper, so AI SDK 7 tool inputs
 * (`toolCalls[].input`), outputs (`toolResults[].output`) and `tool-error`
 * content parts land on the trace (legacy `args` / `result` still accepted).
 * A tool call without a measured duration records `0`.
 */
export function buildNativeStepRecord(
  event: unknown,
  endedAtMs: number,
): NativeStepRecord {
  const raw = (event && typeof event === 'object' ? event : {}) as RawStepEvent
  const meta = extractStepMeta(raw)
  return {
    modelId: meta.modelId,
    finishReason: meta.finishReason,
    usage: { inputTokens: meta.usage.inputTokens, outputTokens: meta.usage.outputTokens },
    toolCalls: extractStepToolCalls(raw).map((toolCall) => ({
      toolName: toolCall.toolName,
      args: toolCall.args,
      result: toolCall.result,
      ...(toolCall.error ? { error: toolCall.error } : {}),
      durationMs: toolCall.durationMs ?? 0,
    })),
    endedAtMs,
  }
}

/** Escape hatch: `OM_AGENT_TRACE_CAPTURE=off` disables native span capture. */
export function isNativeTraceCaptureEnabled(): boolean {
  return (process.env.OM_AGENT_TRACE_CAPTURE ?? 'on').toLowerCase() !== 'off'
}

function isoAt(ms: number): string {
  return new Date(ms).toISOString()
}

function resolveModelId(input: NativeTraceInput): string | null {
  const fromSteps = input.steps.find((step) => step.modelId && step.modelId !== 'unknown')?.modelId
  return fromSteps ?? input.fallbackModel ?? null
}

type SpanAttributes = Record<string, unknown>

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function assignNumber(target: SpanAttributes, key: string, value: unknown): void {
  if (isFiniteNumber(value)) target[key] = value
}

function assignText(target: SpanAttributes, key: string, value: string | null | undefined): void {
  if (typeof value === 'string' && value.length > 0) target[key] = value
}

function capStopSequences(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return values
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .slice(0, STOP_SEQUENCES_MAX_COUNT)
    .map((value) => value.slice(0, STOP_SEQUENCE_MAX_CHARS))
}

function buildRequestParameterAttributes(call: NativeModelCallRecord): SpanAttributes {
  const settings = call.callSettings
  const params: SpanAttributes = {}
  assignNumber(params, GEN_AI_ATTRIBUTES.requestTemperature, settings.temperature)
  assignNumber(params, GEN_AI_ATTRIBUTES.requestTopP, settings.topP)
  assignNumber(params, GEN_AI_ATTRIBUTES.requestTopK, settings.topK)
  assignNumber(params, GEN_AI_ATTRIBUTES.requestMaxTokens, settings.maxOutputTokens)
  assignNumber(params, GEN_AI_ATTRIBUTES.requestSeed, settings.seed)
  assignNumber(params, GEN_AI_ATTRIBUTES.requestPresencePenalty, settings.presencePenalty)
  assignNumber(params, GEN_AI_ATTRIBUTES.requestFrequencyPenalty, settings.frequencyPenalty)
  const stopSequences = capStopSequences(settings.stopSequences)
  if (stopSequences.length > 0) params[GEN_AI_ATTRIBUTES.requestStopSequences] = stopSequences
  if (Object.keys(params).length === 0) params[OM_LLM_ATTRIBUTES.paramsDefaults] = true
  return params
}

function buildCallMetadataAttributes(
  call: NativeModelCallRecord,
  fallbackUsage: { inputTokens?: number; outputTokens?: number } | null | undefined,
): SpanAttributes {
  const attributes: SpanAttributes = {
    [GEN_AI_ATTRIBUTES.operationName]: GEN_AI_OPERATIONS.chat,
    [GEN_AI_ATTRIBUTES.outputType]: GEN_AI_OUTPUT_TYPES.json,
  }
  assignText(attributes, GEN_AI_ATTRIBUTES.providerName, call.provider)
  assignText(attributes, GEN_AI_ATTRIBUTES.requestModel, call.requestModel)
  assignText(attributes, GEN_AI_ATTRIBUTES.responseModel, call.responseModel)
  assignText(attributes, GEN_AI_ATTRIBUTES.responseId, call.responseId)
  Object.assign(attributes, buildRequestParameterAttributes(call))
  const inputTokens = isFiniteNumber(call.usage.inputTokens) ? call.usage.inputTokens : fallbackUsage?.inputTokens
  const outputTokens = isFiniteNumber(call.usage.outputTokens) ? call.usage.outputTokens : fallbackUsage?.outputTokens
  assignNumber(attributes, GEN_AI_ATTRIBUTES.usageInputTokens, inputTokens)
  assignNumber(attributes, GEN_AI_ATTRIBUTES.usageOutputTokens, outputTokens)
  assignNumber(attributes, GEN_AI_ATTRIBUTES.usageCacheReadInputTokens, call.usage.cachedInputTokens)
  assignNumber(attributes, GEN_AI_ATTRIBUTES.usageReasoningOutputTokens, call.usage.reasoningTokens)
  if (call.finishReason) attributes[GEN_AI_ATTRIBUTES.responseFinishReasons] = [call.finishReason]
  assignNumber(attributes, OM_LLM_ATTRIBUTES.latencyMs, call.latencyMs)
  const cost = computeCostMicros(call.responseModel ?? call.requestModel, { inputTokens, outputTokens })
  if (cost) {
    attributes[OM_LLM_ATTRIBUTES.costMicros] = cost.micros
    attributes[OM_LLM_ATTRIBUTES.costCurrency] = cost.currency
    attributes[OM_LLM_ATTRIBUTES.costPricingSource] = cost.pricingSource
  } else {
    attributes[OM_LLM_ATTRIBUTES.costPricingSource] = 'unknown'
  }
  assignText(attributes, OM_LLM_ATTRIBUTES.promptSystemSha256, call.systemSha256)
  assignText(attributes, OM_LLM_ATTRIBUTES.toolsSha256, call.toolsSha256)
  assignNumber(attributes, OM_LLM_ATTRIBUTES.toolsCount, call.toolCount)
  assignNumber(attributes, OM_LLM_ATTRIBUTES.messagesCount, call.messageCount)
  assignText(attributes, OM_LLM_ATTRIBUTES.contentRequestSha256, call.requestSha256)
  assignNumber(attributes, OM_LLM_ATTRIBUTES.contentRequestBytes, call.requestBytes)
  assignText(attributes, OM_LLM_ATTRIBUTES.contentResponseSha256, call.responseSha256)
  assignNumber(attributes, OM_LLM_ATTRIBUTES.contentResponseBytes, call.responseBytes)
  attributes[OM_LLM_ATTRIBUTES.contentStatus] = 'disabled'
  attributes[OM_LLM_ATTRIBUTES.captureFidelity] = call.fidelity
  return attributes
}

function fitsSpanAttributeCap(attributes: SpanAttributes): boolean {
  return JSON.stringify(attributes).length <= SUMMARY_CHAR_LIMIT
}

/**
 * Llm span attributes for one model call: the legacy keys always, plus the
 * gen_ai / om metadata keys when a call record exists and the capture level is
 * not `off`. The result always fits the ingest attribute cap — stop sequences
 * are dropped first, then the metadata keys, so the span is never truncated.
 */
function buildLlmSpanAttributes(
  legacy: SpanAttributes | null,
  call: NativeModelCallRecord | null | undefined,
  captureLevel: RunManifestCaptureLevel,
  fallbackUsage?: { inputTokens?: number; outputTokens?: number } | null,
): SpanAttributes | null {
  if (captureLevel === 'off' || !call) return legacy
  const metadata = buildCallMetadataAttributes(call, fallbackUsage)
  const combined = { ...(legacy ?? {}), ...metadata }
  if (fitsSpanAttributeCap(combined)) return combined
  const withoutStopSequences = Object.fromEntries(
    Object.entries(combined).filter(([key]) => key !== GEN_AI_ATTRIBUTES.requestStopSequences),
  )
  if (fitsSpanAttributeCap(withoutStopSequences)) return withoutStopSequences
  return legacy
}

/**
 * Pure mapping from the runner's step records to the `ingestTrace` payload.
 * Spans-only at the run level (no status/output) per spec decision H2.
 */
export function buildNativeTracePayload(input: NativeTraceInput): TraceIngest {
  const captureLevel = input.captureLevel ?? 'metadata'
  const spans: TraceSpanIngest[] = []
  let sequence = 0
  let cursorMs = input.startedAtMs

  for (let stepIndex = 0; stepIndex < input.steps.length; stepIndex += 1) {
    const step = input.steps[stepIndex]
    const stepSpanId = `${input.runId}:${stepIndex}`
    const stepStartMs = Math.min(cursorMs, step.endedAtMs)
    spans.push({
      externalSpanId: stepSpanId,
      sequence: sequence++,
      name: step.modelId && step.modelId !== 'unknown' ? `llm:${step.modelId}` : 'llm',
      kind: 'llm',
      startedAt: isoAt(stepStartMs),
      endedAt: isoAt(step.endedAtMs),
      durationMs: Math.max(0, step.endedAtMs - stepStartMs),
      status: 'ok',
      attributes: buildLlmSpanAttributes(
        {
          [LEGACY_LLM_ATTRIBUTES.inputTokens]: step.usage.inputTokens,
          [LEGACY_LLM_ATTRIBUTES.outputTokens]: step.usage.outputTokens,
          [LEGACY_LLM_ATTRIBUTES.finishReason]: step.finishReason,
        },
        step.call,
        captureLevel,
        step.usage,
      ),
    })
    for (let toolIndex = 0; toolIndex < step.toolCalls.length; toolIndex += 1) {
      const toolCall = step.toolCalls[toolIndex]
      const toolDurationMs = Math.max(0, toolCall.durationMs)
      const toolEndMs = Math.min(step.endedAtMs, stepStartMs + toolDurationMs)
      spans.push({
        externalSpanId: `${stepSpanId}:${toolIndex}`,
        parentExternalSpanId: stepSpanId,
        sequence: sequence++,
        name: toolCall.toolName,
        kind: 'tool',
        startedAt: isoAt(stepStartMs),
        endedAt: isoAt(toolEndMs),
        durationMs: toolDurationMs,
        status: toolCall.error ? 'error' : 'ok',
        toolCalls: [
          {
            toolName: toolCall.toolName,
            requestSummary: toolCall.args,
            responseSummary: toolCall.result,
            status: toolCall.error ? 'error' : 'ok',
            latencyMs: toolDurationMs,
            ...(toolCall.error ? { errorMessage: toolCall.error.message } : {}),
          },
        ],
      })
    }
    cursorMs = step.endedAtMs
  }

  if (spans.length === 0) {
    const syntheticAttributes = buildLlmSpanAttributes(
      input.fallbackUsage
        ? {
            [LEGACY_LLM_ATTRIBUTES.inputTokens]: input.fallbackUsage.inputTokens ?? 0,
            [LEGACY_LLM_ATTRIBUTES.outputTokens]: input.fallbackUsage.outputTokens ?? 0,
          }
        : null,
      input.fallbackCall,
      captureLevel,
      input.fallbackUsage,
    )
    spans.push({
      externalSpanId: `${input.runId}:0`,
      sequence: 0,
      name: resolveModelId(input) ? `llm:${resolveModelId(input)}` : 'llm',
      kind: 'llm',
      startedAt: isoAt(input.startedAtMs),
      endedAt: isoAt(input.endedAtMs),
      durationMs: Math.max(0, input.endedAtMs - input.startedAtMs),
      status: 'ok',
      ...(syntheticAttributes ? { attributes: syntheticAttributes } : {}),
    })
  }

  if (input.manifest) {
    spans.push(
      buildRunManifestSpan({
        runId: input.runId,
        manifest: input.manifest,
        sequence: spans.length,
        recordedAtMs: input.startedAtMs,
      }),
    )
  }

  const stepUsage = input.steps.reduce(
    (acc, step) => ({
      inputTokens: acc.inputTokens + step.usage.inputTokens,
      outputTokens: acc.outputTokens + step.usage.outputTokens,
    }),
    { inputTokens: 0, outputTokens: 0 },
  )
  const inputTokens =
    input.steps.length > 0 ? stepUsage.inputTokens : (input.fallbackUsage?.inputTokens ?? null)
  const outputTokens =
    input.steps.length > 0 ? stepUsage.outputTokens : (input.fallbackUsage?.outputTokens ?? null)
  const modelId = resolveModelId(input)

  return {
    runtime: 'native',
    externalRunId: input.runId,
    agentId: input.agentId,
    ...(modelId ? { model: modelId } : {}),
    ...(inputTokens != null ? { inputTokens } : {}),
    ...(outputTokens != null ? { outputTokens } : {}),
    latencyMs: Math.max(0, input.endedAtMs - input.startedAtMs),
    spans,
  }
}

type MinimalContainer = {
  resolve<T = unknown>(name: string): T
  hasRegistration?: (name: string) => boolean
}

/**
 * Post-run, best-effort persistence of a native run's trace. Never throws —
 * a capture failure logs and the run outcome is unaffected (the run row was
 * already settled through the audited Command path).
 */
export async function captureNativeRunTrace(
  container: MinimalContainer,
  scope: { tenantId: string; organizationId: string },
  input: NativeTraceInput,
): Promise<void> {
  if (!isNativeTraceCaptureEnabled()) return
  try {
    const em = (container.resolve('em') as EntityManager).fork()
    const result = await withRuntimeAuditWrite(() =>
      ingestTrace(em, scope, buildNativeTracePayload(input), {
        offloadArtifact: createArtifactOffloader(container, scope),
      }),
    )
    await invalidateAgentRunCache(
      container as Parameters<typeof invalidateAgentRunCache>[0],
      { id: result.runId, tenantId: scope.tenantId, organizationId: scope.organizationId },
      'agent_orchestrator.trace.capture',
    )
    // Parity with the `trace.ingest` command (used by the OpenCode/HMAC path):
    // score the run online (deterministic assertions + the golden-match plane) on
    // the same EM. Without this, native runs never get an eval verdict or a golden
    // comparison — only OpenCode runs did. The async llm_judge tier stays on the
    // command path. Best-effort: wrapped by the outer try so it never fails the run.
    await withRuntimeAuditWrite(() => evaluateRun(em, scope, result.runId))
  } catch (err) {
    logger.warn('native trace capture failed for run', {
      runId: input.runId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
