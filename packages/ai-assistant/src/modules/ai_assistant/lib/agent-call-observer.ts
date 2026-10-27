import { randomUUID } from 'node:crypto'
import type {
  LanguageModel,
  LanguageModelCallEndEvent,
  LanguageModelCallStartEvent,
  OnLanguageModelCallStartCallback,
  ToolSet,
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
import { reportAiAssistantError } from './report-ai-assistant-error'

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
  onLanguageModelCallEnd: <TOOLS extends ToolSet>(event: LanguageModelCallEndEvent<TOOLS>) => Promise<void>
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

const lightweightCallObservers = new WeakSet<AiAgentCallObserver>()

export function markLightweightCallObserver<TObserver extends AiAgentCallObserver>(observer: TObserver): TObserver {
  lightweightCallObservers.add(observer)
  return observer
}

export function isLightweightCallObserver(observer: AiAgentCallObserver | null | undefined): boolean {
  return Boolean(observer && lightweightCallObservers.has(observer))
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
  context: {
    stepNumber: number
    startedAtMs: number
    providerOptions?: Record<string, unknown>
    responseFormat?: unknown
    lightweight?: boolean
  },
): AiAgentModelCallStartEvent {
  const callSettings = extractObservedCallSettings(event as unknown as Record<string, unknown>, context.providerOptions)
  if (context.lightweight) {
    return {
      callId: event.callId,
      stepNumber: context.stepNumber,
      provider: event.provider,
      modelId: event.modelId,
      system: undefined,
      messages: [],
      tools: undefined,
      responseFormat: undefined,
      callSettings,
      startedAtMs: context.startedAtMs,
    }
  }
  return {
    callId: event.callId,
    stepNumber: context.stepNumber,
    provider: event.provider,
    modelId: event.modelId,
    system: instructionsToSystem(event.instructions),
    messages: cloneForObserver([...event.messages]),
    tools: event.tools === undefined ? undefined : cloneForObserver(event.tools.map((definition) => ({ ...definition }))),
    responseFormat: context.responseFormat === undefined ? undefined : cloneForObserver(context.responseFormat),
    callSettings,
    startedAtMs: context.startedAtMs,
  }
}

export function toModelCallEndEvent<TOOLS extends ToolSet>(
  event: LanguageModelCallEndEvent<TOOLS>,
  context: { endedAtMs: number; lightweight?: boolean },
): AiAgentModelCallEndEvent {
  const responseTimeMs = readNumber(event.performance, 'responseTimeMs') ?? 0
  if (context.lightweight) {
    return {
      callId: event.callId,
      finishReason: String(event.finishReason),
      responseId: typeof event.responseId === 'string' ? event.responseId : null,
      responseModelId: typeof event.modelId === 'string' ? event.modelId : null,
      usage: normalizeModelCallUsage(event.usage),
      content: [],
      responseTimeMs,
      endedAtMs: context.endedAtMs,
    }
  }
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
    responseTimeMs,
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
    reportAiAssistantError(err, 'ai_assistant.model_call_observer_failed', { hook })
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
  const lightweight = isLightweightCallObserver(observe)
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
              lightweight,
            }),
          ),
        { agentId: context.agentId, callId: event.callId },
      )
    },
    onLanguageModelCallEnd: async <TOOLS extends ToolSet>(event: LanguageModelCallEndEvent<TOOLS>) => {
      const handler = observe.onModelCallEnd
      if (!handler) return
      await notifyModelCallObserver(
        'onModelCallEnd',
        () => handler.call(observe, toModelCallEndEvent(event, { endedAtMs: now(), lightweight })),
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
  const lightweight = isLightweightCallObserver(observe)
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
            system: lightweight ? undefined : context.system,
            messages: lightweight ? [] : cloneForObserver([...context.messages]),
            tools: undefined,
            responseFormat: lightweight ? undefined : cloneForObserver(context.responseFormat),
            callSettings: cloneForObserver(context.callSettings),
            startedAtMs,
            synthesized: true,
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
              lightweight || result.object === undefined
                ? []
                : [{ type: 'text', text: JSON.stringify(result.object) ?? '' }],
            ...(!lightweight && result.providerMetadata !== undefined
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

type ObserverHookName = 'onPromptResolved' | 'onModelCallStart' | 'onModelCallEnd'

function toLightweightStartEvent(event: AiAgentModelCallStartEvent): AiAgentModelCallStartEvent {
  return {
    callId: event.callId,
    stepNumber: event.stepNumber,
    provider: event.provider,
    modelId: event.modelId,
    system: undefined,
    messages: [],
    tools: undefined,
    responseFormat: undefined,
    callSettings: cloneForObserver(event.callSettings),
    startedAtMs: event.startedAtMs,
    ...(event.synthesized ? { synthesized: true } : {}),
  }
}

function toLightweightEndEvent(event: AiAgentModelCallEndEvent): AiAgentModelCallEndEvent {
  return {
    callId: event.callId,
    finishReason: event.finishReason,
    responseId: event.responseId,
    responseModelId: event.responseModelId,
    usage: { ...event.usage },
    content: [],
    responseTimeMs: event.responseTimeMs,
    endedAtMs: event.endedAtMs,
  }
}

async function invokeEachObserver<TEvent>(
  observers: AiAgentCallObserver[],
  hook: ObserverHookName,
  event: TEvent,
  logContext: { agentId?: string; callId?: string },
  toLightweight?: (event: TEvent) => TEvent,
): Promise<void> {
  for (const observer of observers) {
    const handler = observer[hook] as ((payload: TEvent) => void | Promise<void>) | undefined
    if (!handler) continue
    try {
      const payload =
        toLightweight && isLightweightCallObserver(observer) ? toLightweight(event) : cloneForObserver(event)
      await handler.call(observer, payload)
    } catch (err) {
      logger.error('Composed model-call observer threw; continuing with the next observer', {
        hook,
        ...logContext,
        err,
      })
      reportAiAssistantError(err, 'ai_assistant.model_call_observer_failed', { hook })
    }
  }
}

export function composeCallObservers(
  ...candidates: Array<AiAgentCallObserver | null | undefined>
): AiAgentCallObserver | undefined {
  const observers = candidates.filter((candidate): candidate is AiAgentCallObserver => Boolean(candidate))
  if (observers.length === 0) return undefined
  if (observers.length === 1) return observers[0]
  const composed: AiAgentCallObserver = {}
  if (observers.some((observer) => observer.onPromptResolved)) {
    composed.onPromptResolved = (event) =>
      invokeEachObserver(observers, 'onPromptResolved', event, { agentId: event.agentId })
  }
  if (observers.some((observer) => observer.onModelCallStart)) {
    composed.onModelCallStart = (event) =>
      invokeEachObserver(observers, 'onModelCallStart', event, { callId: event.callId }, toLightweightStartEvent)
  }
  if (observers.some((observer) => observer.onModelCallEnd)) {
    composed.onModelCallEnd = (event) =>
      invokeEachObserver(observers, 'onModelCallEnd', event, { callId: event.callId }, toLightweightEndEvent)
  }
  if (observers.every((observer) => isLightweightCallObserver(observer))) {
    markLightweightCallObserver(composed)
  }
  return composed
}
