import { randomUUID } from 'node:crypto'
import type {
  LanguageModel,
  LanguageModelCallEndEvent,
  LanguageModelCallStartEvent,
  OnLanguageModelCallEndCallback,
  OnLanguageModelCallStartCallback,
} from 'ai'
import { z } from 'zod'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type {
  AiAgentCallObserver,
  AiAgentCallSettings,
  AiAgentModelCallEndEvent,
  AiAgentModelCallStartEvent,
  AiAgentModelCallUsage,
  AiAgentPromptResolvedEvent,
} from './agent-call-contract'

const logger = createLogger('ai_assistant').child({ component: 'agent-call-observer' })

const forwardedCallSettingKeys = [
  'temperature',
  'topP',
  'topK',
  'maxOutputTokens',
  'seed',
  'stopSequences',
  'presencePenalty',
  'frequencyPenalty',
] as const

export type ModelCallObserverHooks = {
  onLanguageModelCallStart: OnLanguageModelCallStartCallback
  onLanguageModelCallEnd: OnLanguageModelCallEndCallback
}

export type ModelCallObserverContext = {
  agentId: string
  providerOptions?: Record<string, unknown>
  responseFormat?: unknown
  now?: () => number
}

export type SynthesizedModelCallResult = {
  finishReason?: string | null
  usage?: unknown
  object?: unknown
  responseId?: string | null
  responseModelId?: string | null
  providerMetadata?: Record<string, unknown>
}

export type SynthesizedModelCall = {
  start(): Promise<void>
  end(result: SynthesizedModelCallResult): Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNumber(source: unknown, key: string): number | undefined {
  if (!isRecord(source)) return undefined
  const value = source[key]
  return typeof value === 'number' ? value : undefined
}

export function cloneForObserver<TValue>(value: TValue): TValue {
  try {
    return structuredClone(value)
  } catch {
    try {
      return JSON.parse(JSON.stringify(value)) as TValue
    } catch {
      return value
    }
  }
}

export function instructionsToSystem(instructions: unknown): string | undefined {
  if (instructions === undefined || instructions === null) return undefined
  if (typeof instructions === 'string') return instructions
  const entries = Array.isArray(instructions) ? instructions : [instructions]
  const parts = entries
    .map((entry) => (isRecord(entry) && typeof entry.content === 'string' ? entry.content : null))
    .filter((content): content is string => content !== null)
  return parts.length > 0 ? parts.join('\n\n') : undefined
}

export function extractObservedCallSettings(
  source: Record<string, unknown>,
  fallbackProviderOptions?: Record<string, unknown>,
): AiAgentCallSettings {
  const settings: Record<string, unknown> = {}
  for (const key of forwardedCallSettingKeys) {
    if (source[key] !== undefined) settings[key] = cloneForObserver(source[key])
  }
  const providerOptions = isRecord(source.providerOptions) ? source.providerOptions : fallbackProviderOptions
  if (providerOptions !== undefined) settings.providerOptions = cloneForObserver(providerOptions)
  return settings as AiAgentCallSettings
}

export function normalizeModelCallUsage(usage: unknown): AiAgentModelCallUsage {
  if (!isRecord(usage)) return {}
  const normalized: AiAgentModelCallUsage = {}
  const inputTokens = readNumber(usage, 'inputTokens')
  const outputTokens = readNumber(usage, 'outputTokens')
  const cachedInputTokens =
    readNumber(usage.inputTokenDetails, 'cacheReadTokens') ?? readNumber(usage, 'cachedInputTokens')
  const reasoningTokens =
    readNumber(usage.outputTokenDetails, 'reasoningTokens') ?? readNumber(usage, 'reasoningTokens')
  if (inputTokens !== undefined) normalized.inputTokens = inputTokens
  if (outputTokens !== undefined) normalized.outputTokens = outputTokens
  if (cachedInputTokens !== undefined) normalized.cachedInputTokens = cachedInputTokens
  if (reasoningTokens !== undefined) normalized.reasoningTokens = reasoningTokens
  return normalized
}

export function toModelCallStartEvent(
  event: LanguageModelCallStartEvent,
  context: { stepNumber: number; startedAtMs: number; providerOptions?: Record<string, unknown>; responseFormat?: unknown },
): AiAgentModelCallStartEvent {
  return {
    callId: event.callId,
    stepNumber: context.stepNumber,
    provider: event.provider,
    modelId: event.modelId,
    system: instructionsToSystem(event.instructions),
    messages: cloneForObserver([...event.messages]),
    tools: event.tools === undefined ? undefined : cloneForObserver(event.tools.map((definition) => ({ ...definition }))),
    responseFormat: context.responseFormat === undefined ? undefined : cloneForObserver(context.responseFormat),
    callSettings: extractObservedCallSettings(event as unknown as Record<string, unknown>, context.providerOptions),
    startedAtMs: context.startedAtMs,
  }
}

export function toModelCallEndEvent(
  event: LanguageModelCallEndEvent,
  context: { endedAtMs: number },
): AiAgentModelCallEndEvent {
  return {
    callId: event.callId,
    finishReason: String(event.finishReason),
    responseId: typeof event.responseId === 'string' ? event.responseId : null,
    responseModelId: typeof event.modelId === 'string' ? event.modelId : null,
    usage: normalizeModelCallUsage(event.usage),
    content: cloneForObserver([...event.content]),
    ...(event.providerMetadata !== undefined
      ? { providerMetadata: cloneForObserver(event.providerMetadata) as Record<string, unknown> }
      : {}),
    responseTimeMs: readNumber(event.performance, 'responseTimeMs') ?? 0,
    endedAtMs: context.endedAtMs,
  }
}

export async function notifyModelCallObserver(
  hook: 'onPromptResolved' | 'onModelCallStart' | 'onModelCallEnd',
  invoke: () => void | Promise<void>,
  logContext: { agentId: string; callId?: string },
): Promise<void> {
  try {
    await invoke()
  } catch (err) {
    logger.error('Model-call observer threw; ignoring', { hook, ...logContext, err })
  }
}

export async function notifyPromptResolved(
  observe: AiAgentCallObserver | undefined,
  event: AiAgentPromptResolvedEvent,
): Promise<void> {
  const handler = observe?.onPromptResolved
  if (!observe || !handler) return
  await notifyModelCallObserver(
    'onPromptResolved',
    () => handler.call(observe, cloneForObserver(event)),
    { agentId: event.agentId },
  )
}

function hasModelCallHooks(observe: AiAgentCallObserver | undefined): observe is AiAgentCallObserver {
  return Boolean(observe && (observe.onModelCallStart || observe.onModelCallEnd))
}

export function createModelCallObserverHooks(
  observe: AiAgentCallObserver | undefined,
  context: ModelCallObserverContext,
): ModelCallObserverHooks | undefined {
  if (!hasModelCallHooks(observe)) return undefined
  const now = context.now ?? Date.now
  let nextStepNumber = 0
  return {
    onLanguageModelCallStart: async (event) => {
      const stepNumber = nextStepNumber
      nextStepNumber += 1
      const handler = observe.onModelCallStart
      if (!handler) return
      await notifyModelCallObserver(
        'onModelCallStart',
        () =>
          handler.call(
            observe,
            toModelCallStartEvent(event, {
              stepNumber,
              startedAtMs: now(),
              providerOptions: context.providerOptions,
              responseFormat: context.responseFormat,
            }),
          ),
        { agentId: context.agentId, callId: event.callId },
      )
    },
    onLanguageModelCallEnd: async (event) => {
      const handler = observe.onModelCallEnd
      if (!handler) return
      await notifyModelCallObserver(
        'onModelCallEnd',
        () => handler.call(observe, toModelCallEndEvent(event, { endedAtMs: now() })),
        { agentId: context.agentId, callId: event.callId },
      )
    },
  }
}

export function describeLanguageModel(
  model: LanguageModel,
  fallback: { provider: string; modelId: string },
): { provider: string; modelId: string } {
  if (isRecord(model) && typeof model.provider === 'string' && typeof model.modelId === 'string') {
    return { provider: model.provider, modelId: model.modelId }
  }
  return fallback
}

export function buildObjectResponseFormat(schemaName: string, schema: unknown): Record<string, unknown> {
  let jsonSchema: unknown = undefined
  if (schema instanceof z.ZodType) {
    try {
      jsonSchema = z.toJSONSchema(schema)
    } catch {
      jsonSchema = undefined
    }
  } else if (isRecord(schema)) {
    jsonSchema = schema
  }
  return { type: 'json', name: schemaName, ...(jsonSchema !== undefined ? { schema: jsonSchema } : {}) }
}

export function createSynthesizedModelCall(
  observe: AiAgentCallObserver | undefined,
  context: {
    agentId: string
    provider: string
    modelId: string
    system: string | undefined
    messages: unknown[]
    responseFormat: unknown
    callSettings: AiAgentCallSettings
    now?: () => number
  },
): SynthesizedModelCall | undefined {
  if (!hasModelCallHooks(observe)) return undefined
  const now = context.now ?? Date.now
  const callId = randomUUID()
  let startedAtMs = now()
  return {
    async start() {
      startedAtMs = now()
      const handler = observe.onModelCallStart
      if (!handler) return
      await notifyModelCallObserver(
        'onModelCallStart',
        () =>
          handler.call(observe, {
            callId,
            stepNumber: 0,
            provider: context.provider,
            modelId: context.modelId,
            system: context.system,
            messages: cloneForObserver([...context.messages]),
            tools: undefined,
            responseFormat: cloneForObserver(context.responseFormat),
            callSettings: cloneForObserver(context.callSettings),
            startedAtMs,
          }),
        { agentId: context.agentId, callId },
      )
    },
    async end(result) {
      const handler = observe.onModelCallEnd
      if (!handler) return
      const endedAtMs = now()
      await notifyModelCallObserver(
        'onModelCallEnd',
        () =>
          handler.call(observe, {
            callId,
            finishReason: typeof result.finishReason === 'string' ? result.finishReason : 'unknown',
            responseId: result.responseId ?? null,
            responseModelId: result.responseModelId ?? null,
            usage: normalizeModelCallUsage(result.usage),
            content:
              result.object === undefined ? [] : [{ type: 'text', text: JSON.stringify(result.object) ?? '' }],
            ...(result.providerMetadata !== undefined
              ? { providerMetadata: cloneForObserver(result.providerMetadata) }
              : {}),
            responseTimeMs: Math.max(0, endedAtMs - startedAtMs),
            endedAtMs,
          }),
        { agentId: context.agentId, callId },
      )
    },
  }
}

export function readSynthesizedResultMetadata(result: unknown): SynthesizedModelCallResult {
  if (!isRecord(result)) return {}
  const response = isRecord(result.response) ? result.response : undefined
  return {
    finishReason: typeof result.finishReason === 'string' ? result.finishReason : null,
    usage: result.usage,
    object: result.object,
    responseId: response && typeof response.id === 'string' ? response.id : null,
    responseModelId: response && typeof response.modelId === 'string' ? response.modelId : null,
    ...(isRecord(result.providerMetadata) ? { providerMetadata: result.providerMetadata } : {}),
  }
}

export function observeStreamedObjectEnd(
  synthesized: SynthesizedModelCall | undefined,
  streamed: { object?: PromiseLike<unknown>; finishReason?: PromiseLike<unknown>; usage?: PromiseLike<unknown> },
): void {
  if (!synthesized) return
  void Promise.allSettled([streamed.object, streamed.finishReason, streamed.usage]).then(
    ([objectOutcome, finishOutcome, usageOutcome]) =>
      synthesized.end({
        object: objectOutcome.status === 'fulfilled' ? objectOutcome.value : undefined,
        finishReason:
          finishOutcome.status === 'fulfilled' && typeof finishOutcome.value === 'string'
            ? finishOutcome.value
            : objectOutcome.status === 'rejected'
              ? 'error'
              : null,
        usage: usageOutcome.status === 'fulfilled' ? usageOutcome.value : undefined,
      }),
  )
}
