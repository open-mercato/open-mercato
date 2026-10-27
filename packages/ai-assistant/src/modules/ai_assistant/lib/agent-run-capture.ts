import type { AwilixContainer } from 'awilix'
import type { AiAgentCallObserver, AiAgentRunTraceOptions } from './agent-call-contract'
import type { AiAgentDefinition, AiAgentLoopStopCondition, LoopStepRecord } from './ai-agent-definition'
import type { AiChatRequestContext } from './attachment-bridge-types'
import { getAgentDefinitionHash } from './agent-registry'
import { reportAiAssistantError } from './report-ai-assistant-error'
import { computeAgentDefinitionHash } from './agent-definition-hash'
import { extractStepMeta, normalizeToolError } from './loop-step-extraction'
import type { RawStepEvent } from './loop-step-extraction'
import {
  buildAgentRunModelParams,
  createAgentRunRecorderObserver,
  recordAgentRun,
  resolveAgentRunCaptureConfig,
} from './agent-run-recorder'
import type {
  AgentRunError,
  AgentRunLoopParams,
  AgentRunRecordStep,
  AgentRunRecordToolCall,
  AgentRunStatus,
} from './agent-run-recorder'

export const AGENT_RUN_CORRELATION_ID_MAX_LENGTH = 128

export type AgentRunCaptureInput = {
  container: AwilixContainer | undefined
  trace: AiAgentRunTraceOptions | undefined
  runId: string
  agent: AiAgentDefinition
  authContext: AiChatRequestContext
  executionMode: 'chat' | 'object'
  effectiveMutationPolicy: string
  toolNames: string[]
  mutationToolNames: ReadonlySet<string>
  conversationId: string | null
  turnId: string
  apiKeyId: string | null
  fallbackCorrelationId?: string | null
  providerId: string
  modelId: string
  baseUrl: string | undefined
  systemPrompt: string
  promptOverride: { id: string; version: number } | null
  env?: Record<string, string | undefined>
}

export type AgentRunSettleInput = {
  status: AgentRunStatus
  loopParams: AgentRunLoopParams
  inputText: string | null
  steps: LoopStepRecord[]
  stopReason?: string | null
  finishReason?: string | null
  outputText?: string | null
  usage?: { inputTokens?: number; outputTokens?: number } | null
  error?: unknown
}

type StepTiming = {
  endedAt: Date
  durationMs: number
  cachedInputTokens: number | null
  reasoningTokens: number | null
}

export type AgentRunCapture = {
  runId: string
  observer: AiAgentCallObserver
  recordStep(event: unknown): void
  settle(input: AgentRunSettleInput): Promise<boolean>
}

export function normalizeCorrelationId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  return trimmed.slice(0, AGENT_RUN_CORRELATION_ID_MAX_LENGTH)
}

export function readBaseUrlHost(baseUrl: string | undefined): string | null {
  if (!baseUrl) return null
  try {
    const host = new URL(baseUrl).host
    return host.length > 0 ? host : null
  } catch {
    return null
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function readPendingActionId(result: unknown, isMutation: boolean): string | null {
  if (!isMutation) return null
  let candidate: unknown = result
  if (typeof result === 'string') {
    if (!result.includes('pendingActionId')) return null
    try {
      candidate = JSON.parse(result)
    } catch {
      return null
    }
  }
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    const value = (candidate as Record<string, unknown>).pendingActionId
    return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null
  }
  return null
}

const pendingSettles = new Set<Promise<boolean>>()

/**
 * Resolves once every in-flight run settle (started fire-and-forget on the
 * request path) has finished. Intended for tests and graceful shutdown.
 */
export async function flushPendingAgentRunSettles(): Promise<void> {
  while (pendingSettles.size > 0) {
    await Promise.allSettled([...pendingSettles])
  }
}

function trackSettle(pending: Promise<boolean>): Promise<boolean> {
  pendingSettles.add(pending)
  void pending.then(() => {
    pendingSettles.delete(pending)
  })
  return pending
}

function sumNullable(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => typeof value === 'number')
  if (present.length === 0) return null
  return present.reduce((total, value) => total + value, 0)
}

export function toAgentRunError(error: unknown): AgentRunError {
  const normalized = normalizeToolError(error)
  return { code: normalized.code, message: normalized.message }
}

/**
 * Builds the per-run capture used by the agent runtime to persist one
 * `ai_agent_runs` row once the turn settles. Returns `null` (no observer, no
 * write) when the caller opted out with `trace.persist === false`, when the
 * capture level is `off`, or when no container / tenant is available.
 */
export function createAgentRunCapture(input: AgentRunCaptureInput): AgentRunCapture | null {
  if (input.trace?.persist === false) return null
  if (!input.container) return null
  const scopedTenantId = input.authContext.tenantId
  if (!scopedTenantId) return null
  const tenantId: string = scopedTenantId
  const env = input.env ?? process.env
  if (resolveAgentRunCaptureConfig(env).level === 'off') return null

  const container = input.container
  const recorderObserver = createAgentRunRecorderObserver()
  const startedAt = new Date()
  const stepTimings: StepTiming[] = []
  let lastStepEndMs = startedAt.getTime()
  let settled = false

  function recordStep(event: unknown): void {
    const nowMs = Date.now()
    const meta = extractStepMeta((event ?? {}) as RawStepEvent)
    stepTimings.push({
      endedAt: new Date(nowMs),
      durationMs: Math.max(0, nowMs - lastStepEndMs),
      cachedInputTokens: meta.usage.cachedInputTokens,
      reasoningTokens: meta.usage.reasoningTokens,
    })
    lastStepEndMs = nowMs
  }

  function settle(settleInput: AgentRunSettleInput): Promise<boolean> {
    if (settled) return Promise.resolve(false)
    settled = true
    return trackSettle(
      persistSettledRun(settleInput).catch((error: unknown) => {
        reportAiAssistantError(error, 'ai_assistant.agent_run_capture_failed')
        return false
      }),
    )
  }

  async function persistSettledRun(settleInput: AgentRunSettleInput): Promise<boolean> {
    const completedAt = new Date()
    const steps: AgentRunRecordStep[] = settleInput.steps.map((step, index) => {
      const timing = stepTimings[index]
      return {
        stepIndex: step.stepIndex,
        modelId: step.modelId || input.modelId,
        finishReason: step.finishReason,
        inputTokens: step.usage.inputTokens,
        outputTokens: step.usage.outputTokens,
        text: step.textDelta && step.textDelta.length > 0 ? step.textDelta : null,
        endedAt: timing?.endedAt ?? completedAt,
        durationMs: timing?.durationMs ?? 0,
      }
    })
    const toolCalls: AgentRunRecordToolCall[] = settleInput.steps.flatMap((step) =>
      step.toolCalls.map((toolCall, callIndex) => ({
        stepIndex: step.stepIndex,
        callIndex,
        toolCallId: toolCall.toolCallId ?? null,
        toolName: toolCall.toolName,
        isMutation: input.mutationToolNames.has(toolCall.toolName),
        pendingActionId: readPendingActionId(toolCall.result, input.mutationToolNames.has(toolCall.toolName)),
        args: toolCall.args,
        result: toolCall.result ?? null,
        error: toolCall.error ?? null,
        durationMs: toolCall.durationMs,
      })),
    )
    const stepUsage = settleInput.steps.reduce(
      (total, step) => ({
        inputTokens: total.inputTokens + step.usage.inputTokens,
        outputTokens: total.outputTokens + step.usage.outputTokens,
      }),
      { inputTokens: 0, outputTokens: 0 },
    )
    const usage =
      settleInput.steps.length > 0 || !settleInput.usage
        ? stepUsage
        : {
            inputTokens: settleInput.usage.inputTokens ?? 0,
            outputTokens: settleInput.usage.outputTokens ?? 0,
          }
    const lastStep = settleInput.steps[settleInput.steps.length - 1]
    const snapshot = recorderObserver.snapshot()
    try {
      return await recordAgentRun(
        container,
        {
          runId: input.runId,
          tenantId,
          organizationId: input.authContext.organizationId ?? null,
          userId: input.authContext.userId ?? null,
          apiKeyId: input.apiKeyId,
          agentId: input.agent.id,
          moduleId: input.agent.moduleId,
          agentVersion: input.agent.version ?? null,
          agentDefinitionHash: getAgentDefinitionHash(input.agent.id) ?? computeAgentDefinitionHash(input.agent),
          promptOverride: input.promptOverride,
          executionMode: input.executionMode,
          effectiveMutationPolicy: input.effectiveMutationPolicy,
          toolNames: [...input.toolNames],
          channel: input.trace?.channel ?? 'internal',
          conversationId: input.conversationId,
          turnId: input.turnId,
          correlationId: normalizeCorrelationId(input.trace?.correlationId ?? input.fallbackCorrelationId ?? null),
          providerId: input.providerId,
          modelId: input.modelId,
          baseUrlHost: readBaseUrlHost(input.baseUrl),
          modelParams: buildAgentRunModelParams(settleInput.loopParams, snapshot.firstCallSettings),
          status: settleInput.status,
          stopReason: settleInput.stopReason ?? null,
          finishReason: settleInput.finishReason ?? lastStep?.finishReason ?? null,
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cachedInputTokens: sumNullable(stepTimings.map((timing) => timing.cachedInputTokens)),
            reasoningTokens: sumNullable(stepTimings.map((timing) => timing.reasoningTokens)),
          },
          startedAt,
          completedAt,
          inputText: settleInput.inputText,
          outputText: settleInput.outputText ?? null,
          systemPrompt: input.systemPrompt,
          citations: null,
          error: settleInput.error === undefined ? null : toAgentRunError(settleInput.error),
          steps,
          toolCalls,
        },
        env,
      )
    } catch {
      return false
    }
  }

  return { runId: input.runId, observer: recorderObserver.observer, recordStep, settle }
}

export function stopWhenKinds(
  stopWhen: AiAgentLoopStopCondition | AiAgentLoopStopCondition[] | undefined,
): string[] {
  if (!stopWhen) return []
  const conditions = Array.isArray(stopWhen) ? stopWhen : [stopWhen]
  return conditions.map((condition) => condition.kind)
}
