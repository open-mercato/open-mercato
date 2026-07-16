import type { EntityManager } from '@mikro-orm/postgresql'
import type { TraceIngest, TraceSpanIngest } from '../../data/validators'
import { ingestTrace } from '../trace/traceIngestionService'
import { createArtifactOffloader } from '../trace/artifactStore'

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

export type NativeStepToolCall = {
  toolName: string
  args: unknown
  result: unknown
  error?: { code: string; message: string }
  durationMs: number
}

export type NativeStepRecord = {
  modelId: string
  finishReason: string
  usage: { inputTokens: number; outputTokens: number }
  toolCalls: NativeStepToolCall[]
  /** Wall-clock ms when the step's onStepFinish fired. */
  endedAtMs: number
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

/**
 * Pure mapping from the runner's step records to the `ingestTrace` payload.
 * Spans-only at the run level (no status/output) per spec decision H2.
 */
export function buildNativeTracePayload(input: NativeTraceInput): TraceIngest {
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
      attributes: {
        inputTokens: step.usage.inputTokens,
        outputTokens: step.usage.outputTokens,
        finishReason: step.finishReason,
      },
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
    spans.push({
      externalSpanId: `${input.runId}:0`,
      sequence: 0,
      name: resolveModelId(input) ? `llm:${resolveModelId(input)}` : 'llm',
      kind: 'llm',
      startedAt: isoAt(input.startedAtMs),
      endedAt: isoAt(input.endedAtMs),
      durationMs: Math.max(0, input.endedAtMs - input.startedAtMs),
      status: 'ok',
      ...(input.fallbackUsage
        ? {
            attributes: {
              inputTokens: input.fallbackUsage.inputTokens ?? 0,
              outputTokens: input.fallbackUsage.outputTokens ?? 0,
            },
          }
        : {}),
    })
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
    await ingestTrace(em, scope, buildNativeTracePayload(input), {
      offloadArtifact: createArtifactOffloader(container, scope),
    })
  } catch (err) {
    console.warn(
      `[internal] agent_orchestrator: native trace capture failed for run "${input.runId}":`,
      err instanceof Error ? err.message : err,
    )
  }
}
