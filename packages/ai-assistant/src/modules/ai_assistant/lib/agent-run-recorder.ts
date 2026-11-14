import { createHash } from 'node:crypto'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { AiAgentRun, AiAgentRunStep, AiAgentRunToolCall } from '../data/entities'
import { emitAiAssistantEvent, type AiAgentRunCompletedPayload } from '../events'
import type {
  AiAgentCallObserver,
  AiAgentCallSettings,
  AiAgentModelCallUsage,
  AiAgentPromptResolvedEvent,
  AiAgentRunChannel,
} from './agent-call-contract'
import { cloneForObserver, markLightweightCallObserver } from './agent-call-observer'
import { capJsonPayload, measureUtf8Bytes, serializeForStorage, truncateTextToBytes } from './truncate'

const logger = createLogger('ai_assistant').child({ component: 'agent-run-recorder' })

export const DEFAULT_AGENT_RUN_MAX_PAYLOAD_BYTES = 16384

export const SYSTEM_PROMPT_HASH_PREFIX = 'sha256:'

export type AgentRunCaptureLevel = 'full' | 'metadata' | 'off'

export type AgentRunCaptureConfig = {
  level: AgentRunCaptureLevel
  maxPayloadBytes: number
  capturePrompt: boolean
}

export type AgentRunStatus = 'completed' | 'failed' | 'aborted'

export type AgentRunModelSource = 'request' | 'runtime-override' | 'agent' | 'default'

export type AgentRunError = { code: string; message: string }

export type AgentRunRecordStep = {
  stepIndex: number
  modelId: string
  finishReason: string
  inputTokens: number
  outputTokens: number
  text: string | null
  endedAt: Date
  durationMs: number
}

export type AgentRunRecordToolCall = {
  stepIndex: number
  callIndex: number
  toolCallId: string | null
  toolName: string
  isMutation: boolean
  pendingActionId: string | null
  args: unknown
  result: unknown
  error: AgentRunError | null
  durationMs: number
}

export type AgentRunRecordPayload = {
  runId: string
  tenantId: string
  organizationId: string | null
  userId: string | null
  apiKeyId: string | null
  agentId: string
  moduleId: string
  agentVersion: string | null
  agentDefinitionHash: string
  promptOverride: { id: string; version: number } | null
  executionMode: 'chat' | 'object'
  effectiveMutationPolicy: string
  toolNames: string[]
  channel: AiAgentRunChannel
  conversationId: string | null
  turnId: string
  correlationId: string | null
  providerId: string
  modelId: string
  baseUrlHost: string | null
  modelParams: Record<string, unknown>
  status: AgentRunStatus
  stopReason: string | null
  finishReason: string | null
  usage: {
    inputTokens: number
    outputTokens: number
    cachedInputTokens: number | null
    reasoningTokens: number | null
  }
  startedAt: Date
  completedAt: Date
  durationMs?: number
  inputText: string | null
  outputText: string | null
  systemPrompt: string
  citations: unknown[] | null
  error: AgentRunError | null
  steps: AgentRunRecordStep[]
  toolCalls: AgentRunRecordToolCall[]
}

export type AgentRunLoopParams = {
  maxSteps?: number | null
  toolChoice?: unknown
  budget?: unknown
  activeTools?: string[] | null
  stopWhenKinds?: string[]
  allowRuntimeOverride?: boolean | null
  modelSource?: AgentRunModelSource | null
}

export type AgentRunRecorderModelCall = {
  callId: string
  stepNumber: number
  provider: string
  modelId: string
  startedAtMs: number
  endedAtMs: number | null
  finishReason: string | null
  usage: AiAgentModelCallUsage | null
}

export type AgentRunRecorderSnapshot = {
  firstCallSettings: AiAgentCallSettings | null
  promptResolved: AiAgentPromptResolvedEvent | null
  modelCalls: AgentRunRecorderModelCall[]
}

export type AgentRunRecorderObserver = {
  observer: AiAgentCallObserver
  snapshot(): AgentRunRecorderSnapshot
}

const CAPTURE_LEVELS: readonly AgentRunCaptureLevel[] = ['full', 'metadata', 'off']

const GEN_AI_REQUEST_KEYS: ReadonlyArray<[keyof AiAgentCallSettings, string]> = [
  ['temperature', 'gen_ai.request.temperature'],
  ['topP', 'gen_ai.request.top_p'],
  ['topK', 'gen_ai.request.top_k'],
  ['maxOutputTokens', 'gen_ai.request.max_tokens'],
  ['seed', 'gen_ai.request.seed'],
  ['stopSequences', 'gen_ai.request.stop_sequences'],
  ['presencePenalty', 'gen_ai.request.presence_penalty'],
  ['frequencyPenalty', 'gen_ai.request.frequency_penalty'],
]

function isCaptureLevel(value: string): value is AgentRunCaptureLevel {
  return (CAPTURE_LEVELS as readonly string[]).includes(value)
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const parsed = Number.parseInt(raw.trim(), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function resolveAgentRunCaptureConfig(
  env: Record<string, string | undefined> = process.env,
): AgentRunCaptureConfig {
  const rawLevel = (env.OM_AI_RUN_TRACE_CAPTURE ?? '').trim().toLowerCase()
  return {
    level: isCaptureLevel(rawLevel) ? rawLevel : 'full',
    maxPayloadBytes: parsePositiveInteger(env.OM_AI_RUN_TRACE_MAX_PAYLOAD_BYTES, DEFAULT_AGENT_RUN_MAX_PAYLOAD_BYTES),
    capturePrompt: parseBooleanToken(env.OM_AI_RUN_TRACE_CAPTURE_PROMPT) === true,
  }
}

export function hashSystemPrompt(systemPrompt: string): string {
  return `${SYSTEM_PROMPT_HASH_PREFIX}${createHash('sha256').update(systemPrompt, 'utf8').digest('hex')}`
}

export function buildAgentRunModelParams(
  loop: AgentRunLoopParams,
  firstCallSettings: AiAgentCallSettings | null | undefined,
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    maxSteps: loop.maxSteps ?? null,
    toolChoice: loop.toolChoice === undefined ? null : cloneForObserver(loop.toolChoice),
    budget: loop.budget === undefined ? null : cloneForObserver(loop.budget),
    activeTools: loop.activeTools ? [...loop.activeTools] : null,
    stopWhen: loop.stopWhenKinds ? [...loop.stopWhenKinds] : [],
    allowRuntimeOverride: loop.allowRuntimeOverride ?? null,
    modelSource: loop.modelSource ?? null,
  }
  if (!firstCallSettings) return params
  for (const [settingKey, attributeKey] of GEN_AI_REQUEST_KEYS) {
    const value = firstCallSettings[settingKey]
    if (value !== undefined) params[attributeKey] = cloneForObserver(value)
  }
  return params
}

export function createAgentRunRecorderObserver(): AgentRunRecorderObserver {
  let firstCallSettings: AiAgentCallSettings | null = null
  let promptResolved: AiAgentPromptResolvedEvent | null = null
  const modelCalls: AgentRunRecorderModelCall[] = []
  const observer: AiAgentCallObserver = {
    onPromptResolved(event) {
      if (promptResolved === null) promptResolved = cloneForObserver(event)
    },
    onModelCallStart(event) {
      if (firstCallSettings === null) firstCallSettings = cloneForObserver(event.callSettings)
      modelCalls.push({
        callId: event.callId,
        stepNumber: event.stepNumber,
        provider: event.provider,
        modelId: event.modelId,
        startedAtMs: event.startedAtMs,
        endedAtMs: null,
        finishReason: null,
        usage: null,
      })
    },
    onModelCallEnd(event) {
      const call = modelCalls.find((candidate) => candidate.callId === event.callId)
      if (!call) return
      call.endedAtMs = event.endedAtMs
      call.finishReason = event.finishReason
      call.usage = { ...event.usage }
    },
  }
  return {
    observer: markLightweightCallObserver(observer),
    snapshot: () => ({
      firstCallSettings: firstCallSettings ? cloneForObserver(firstCallSettings) : null,
      promptResolved: promptResolved ? cloneForObserver(promptResolved) : null,
      modelCalls: modelCalls.map((call) => ({ ...call, usage: call.usage ? { ...call.usage } : null })),
    }),
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function capText(text: string | null, maxBytes: number): { value: string | null; truncated: boolean } {
  if (text === null) return { value: null, truncated: false }
  const capped = truncateTextToBytes(text, maxBytes)
  return { value: capped.value, truncated: capped.truncated }
}

function measureResultBytes(result: unknown): number {
  const serialized = serializeForStorage(result)
  return serialized === null ? 0 : measureUtf8Bytes(serialized)
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

function buildRunRow(payload: AgentRunRecordPayload, config: AgentRunCaptureConfig): Record<string, unknown> {
  const captureContent = config.level === 'full'
  const inputText = captureContent ? capText(payload.inputText, config.maxPayloadBytes) : { value: null, truncated: false }
  const outputText = captureContent ? capText(payload.outputText, config.maxPayloadBytes) : { value: null, truncated: false }
  const errorMessage =
    captureContent && payload.error ? capText(payload.error.message, config.maxPayloadBytes).value : null
  const durationMs = payload.durationMs ?? payload.completedAt.getTime() - payload.startedAt.getTime()
  return {
    id: payload.runId,
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
    userId: payload.userId,
    apiKeyId: payload.apiKeyId,
    agentId: payload.agentId,
    moduleId: payload.moduleId,
    agentVersion: payload.agentVersion,
    agentDefinitionHash: payload.agentDefinitionHash,
    promptOverrideId: payload.promptOverride?.id ?? null,
    promptOverrideVersion: payload.promptOverride?.version ?? null,
    executionMode: payload.executionMode,
    channel: payload.channel,
    conversationId: payload.conversationId,
    turnId: payload.turnId,
    correlationId: payload.correlationId,
    providerId: payload.providerId,
    modelId: payload.modelId,
    baseUrlHost: payload.baseUrlHost,
    modelParams: payload.modelParams,
    effectiveMutationPolicy: payload.effectiveMutationPolicy,
    toolNames: [...payload.toolNames],
    status: payload.status,
    stopReason: payload.stopReason,
    finishReason: payload.finishReason,
    inputTokens: nonNegativeInteger(payload.usage.inputTokens),
    outputTokens: nonNegativeInteger(payload.usage.outputTokens),
    cachedInputTokens: payload.usage.cachedInputTokens,
    reasoningTokens: payload.usage.reasoningTokens,
    stepCount: payload.steps.length,
    toolCallCount: payload.toolCalls.length,
    durationMs: nonNegativeInteger(durationMs),
    startedAt: payload.startedAt,
    completedAt: payload.completedAt,
    inputText: inputText.value,
    outputText: outputText.value,
    contentTruncated: inputText.truncated || outputText.truncated,
    systemPromptHash: hashSystemPrompt(payload.systemPrompt),
    systemPrompt:
      captureContent && config.capturePrompt ? payload.systemPrompt : null,
    citations: captureContent ? payload.citations : null,
    errorCode: payload.error?.code ?? null,
    errorMessage,
    captureLevel: captureContent ? 'full' : 'metadata',
  }
}

function buildStepRow(
  step: AgentRunRecordStep,
  payload: AgentRunRecordPayload,
  config: AgentRunCaptureConfig,
): Record<string, unknown> {
  const text = config.level === 'full' ? capText(step.text, config.maxPayloadBytes) : { value: null, truncated: false }
  return {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
    runId: payload.runId,
    stepIndex: step.stepIndex,
    modelId: step.modelId,
    finishReason: step.finishReason,
    inputTokens: nonNegativeInteger(step.inputTokens),
    outputTokens: nonNegativeInteger(step.outputTokens),
    text: text.value,
    textTruncated: text.truncated,
    endedAt: step.endedAt,
    durationMs: nonNegativeInteger(step.durationMs),
  }
}

function buildToolCallRow(
  toolCall: AgentRunRecordToolCall,
  payload: AgentRunRecordPayload,
  config: AgentRunCaptureConfig,
): Record<string, unknown> {
  const captureContent = config.level === 'full'
  const args = captureContent ? capJsonPayload(toolCall.args, config.maxPayloadBytes) : null
  const result = captureContent ? capJsonPayload(toolCall.result, config.maxPayloadBytes) : null
  const errorMessage =
    captureContent && toolCall.error ? capText(toolCall.error.message, config.maxPayloadBytes).value : null
  return {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
    runId: payload.runId,
    stepIndex: toolCall.stepIndex,
    callIndex: toolCall.callIndex,
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    isMutation: toolCall.isMutation,
    pendingActionId: toolCall.pendingActionId,
    argKeys: isPlainRecord(toolCall.args) ? Object.keys(toolCall.args) : [],
    args: args?.value ?? null,
    result: result?.value ?? null,
    argsTruncated: args?.truncated ?? false,
    resultTruncated: result?.truncated ?? false,
    resultBytes: measureResultBytes(toolCall.result),
    errorCode: toolCall.error?.code ?? null,
    errorMessage,
    durationMs: nonNegativeInteger(toolCall.durationMs),
  }
}

function reportRecorderError(
  error: unknown,
  payload: AgentRunRecordPayload,
  code = 'ai_assistant.agent_run_record_failed',
): void {
  try {
    getTelemetryRuntime()?.reportError(error, {
      module: 'ai_assistant',
      code,
      attributes: { agentId: payload.agentId, channel: payload.channel, status: payload.status },
    })
  } catch {
    return
  }
}

export const AGENT_RUN_COMPLETED_EVENT_ID = 'ai_assistant.agent_run.completed' as const

export function buildAgentRunCompletedPayload(payload: AgentRunRecordPayload): AiAgentRunCompletedPayload {
  return {
    runId: payload.runId,
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
    agentId: payload.agentId,
    channel: payload.channel,
    status: payload.status,
    conversationId: payload.conversationId,
  }
}

async function emitAgentRunCompleted(payload: AgentRunRecordPayload): Promise<void> {
  try {
    await emitAiAssistantEvent(AGENT_RUN_COMPLETED_EVENT_ID, { ...buildAgentRunCompletedPayload(payload) }, {
      persistent: true,
    })
  } catch (error) {
    logger.warn('agent_run.completed emit failed (run persisted)', {
      agentId: payload.agentId,
      channel: payload.channel,
      status: payload.status,
      err: error,
    })
    reportRecorderError(error, payload, 'ai_assistant.agent_run_completed_emit_failed')
  }
}

/**
 * Best-effort, write-once persistence of one agent run (run + steps + tool
 * calls) in a single transaction on a forked EM. MUST NEVER throw: failures
 * are logged and reported, and the agent turn continues unaffected. Rows are
 * created through the EM so the encryption subscriber protects every column
 * declared in `encryption.ts`. After the transaction commits it emits
 * `ai_assistant.agent_run.completed` (ids only, best-effort). Returns true
 * when the run was written.
 */
export async function recordAgentRun(
  container: Pick<AwilixContainer, 'resolve'>,
  payload: AgentRunRecordPayload,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  try {
    const config = resolveAgentRunCaptureConfig(env)
    if (config.level === 'off') return false
    const runRow = buildRunRow(payload, config)
    const stepRows = payload.steps.map((step) => buildStepRow(step, payload, config))
    const toolCallRows = payload.toolCalls.map((toolCall) => buildToolCallRow(toolCall, payload, config))
    const em = container.resolve<EntityManager>('em').fork()
    await em.transactional(async (tx) => {
      tx.persist(tx.create(AiAgentRun, runRow as unknown as AiAgentRun))
      for (const stepRow of stepRows) {
        tx.persist(tx.create(AiAgentRunStep, stepRow as unknown as AiAgentRunStep))
      }
      for (const toolCallRow of toolCallRows) {
        tx.persist(tx.create(AiAgentRunToolCall, toolCallRow as unknown as AiAgentRunToolCall))
      }
      await tx.flush()
    })
  } catch (error) {
    logger.warn('recordAgentRun failed (turn continues unaffected)', {
      agentId: payload.agentId,
      channel: payload.channel,
      status: payload.status,
      err: error,
    })
    reportRecorderError(error, payload)
    return false
  }
  await emitAgentRunCompleted(payload)
  return true
}
