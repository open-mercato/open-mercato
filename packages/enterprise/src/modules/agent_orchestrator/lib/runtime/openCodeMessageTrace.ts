import { z } from 'zod'
import {
  TRACE_INGEST_LLM_BODY_MAX_BYTES,
  type TraceLlmIngest,
  type TraceLlmRequestIngest,
  type TraceLlmResponseIngest,
  type TraceLlmUsageIngest,
  type TraceSpanIngest,
} from '../../data/validators'
import { GEN_AI_ATTRIBUTES, OM_LLM_ATTRIBUTES } from '../trace/genAiAttributes'
import { redactSecretStrings } from '../trace/redactStrings'

const REPORTED_COST_CURRENCY = 'USD'
const MICROS_PER_UNIT = 1_000_000
const LABEL_MAX_CHARS = 200

const tokenCount = z.number().finite().nonnegative().optional().catch(undefined)
const label = z.string().min(1).max(LABEL_MAX_CHARS).optional().catch(undefined)
const epochMs = z.number().finite().positive().optional().catch(undefined)

const reportedTokensSchema = z
  .object({
    input: tokenCount,
    output: tokenCount,
    reasoning: tokenCount,
    cache: z.object({ read: tokenCount, write: tokenCount }).passthrough().optional().catch(undefined),
  })
  .passthrough()

const messageInfoSchema = z
  .object({
    id: z.string().min(1),
    role: z.string().optional().catch(undefined),
    modelID: label,
    providerID: label,
    tokens: reportedTokensSchema.optional().catch(undefined),
    cost: tokenCount,
    time: z.object({ created: epochMs, completed: epochMs }).passthrough().optional().catch(undefined),
    error: z.unknown().optional(),
  })
  .passthrough()

const stepFinishPartSchema = z
  .object({
    type: z.literal('step-finish'),
    id: z.string().min(1).optional().catch(undefined),
    messageID: z.string().min(1),
    reason: label,
    cost: tokenCount,
    tokens: reportedTokensSchema.optional().catch(undefined),
  })
  .passthrough()

const textPartSchema = z
  .object({
    type: z.literal('text'),
    id: z.string().min(1),
    messageID: z.string().min(1),
    text: z.string(),
    synthetic: z.boolean().optional().catch(undefined),
  })
  .passthrough()

const partEnvelopeSchema = z.object({ part: z.unknown() }).passthrough()
const infoEnvelopeSchema = z.object({ info: z.unknown() }).passthrough()

type ReportedTokens = z.infer<typeof reportedTokensSchema>

type ObservedStep = { usage: TraceLlmUsageIngest | null; costUsd: number | null; reason: string | null }

type ObservedMessage = {
  id: string
  role: string | null
  modelId: string | null
  providerId: string | null
  infoUsage: TraceLlmUsageIngest | null
  infoCostUsd: number | null
  createdMs: number | null
  completedMs: number | null
  failed: boolean
  firstSeenMs: number
  lastSeenMs: number
  steps: Map<string, ObservedStep>
  textParts: Map<string, string>
}

export type OpenCodeAssistantMessage = {
  id: string
  modelId: string | null
  providerId: string | null
  usage: TraceLlmUsageIngest | null
  costUsd: number | null
  finishReason: string | null
  createdMs: number | null
  completedMs: number | null
  firstSeenMs: number
  lastSeenMs: number
  failed: boolean
  text: string | null
}

export type OpenCodeMessageCollector = {
  observe(type: string, properties: Record<string, unknown>): void
  assistantMessages(): OpenCodeAssistantMessage[]
}

function toUsage(tokens: ReportedTokens | undefined): TraceLlmUsageIngest | null {
  if (!tokens) return null
  const usage: TraceLlmUsageIngest = {}
  if (tokens.input !== undefined) usage.inputTokens = Math.round(tokens.input)
  if (tokens.output !== undefined) usage.outputTokens = Math.round(tokens.output)
  if (tokens.reasoning !== undefined) usage.reasoningTokens = Math.round(tokens.reasoning)
  if (tokens.cache?.read !== undefined) usage.cachedInputTokens = Math.round(tokens.cache.read)
  return Object.keys(usage).length > 0 ? usage : null
}

function sumUsage(entries: TraceLlmUsageIngest[]): TraceLlmUsageIngest | null {
  const total: TraceLlmUsageIngest = {}
  const fields = ['inputTokens', 'outputTokens', 'reasoningTokens', 'cachedInputTokens'] as const
  for (const entry of entries) {
    for (const field of fields) {
      const value = entry[field]
      if (value !== undefined) total[field] = (total[field] ?? 0) + value
    }
  }
  return Object.keys(total).length > 0 ? total : null
}

function sumCost(values: number[]): number | null {
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) : null
}

/**
 * Collects the assistant messages of one OpenCode session from its SSE stream:
 * `message.updated` (model, provider, tokens, timing) and the `step-finish`
 * and `text` parts of `message.part.updated`. Every event is parsed
 * defensively; anything that does not match is ignored.
 */
export function createOpenCodeMessageCollector(now: () => number = Date.now): OpenCodeMessageCollector {
  const messages = new Map<string, ObservedMessage>()

  const touch = (messageId: string): ObservedMessage => {
    const seenAt = now()
    const existing = messages.get(messageId)
    if (existing) {
      existing.lastSeenMs = seenAt
      return existing
    }
    const created: ObservedMessage = {
      id: messageId,
      role: null,
      modelId: null,
      providerId: null,
      infoUsage: null,
      infoCostUsd: null,
      createdMs: null,
      completedMs: null,
      failed: false,
      firstSeenMs: seenAt,
      lastSeenMs: seenAt,
      steps: new Map(),
      textParts: new Map(),
    }
    messages.set(messageId, created)
    return created
  }

  const observeInfo = (rawInfo: unknown) => {
    const parsed = messageInfoSchema.safeParse(rawInfo)
    if (!parsed.success) return
    const info = parsed.data
    const message = touch(info.id)
    if (info.role) message.role = info.role
    if (info.modelID) message.modelId = info.modelID
    if (info.providerID) message.providerId = info.providerID
    const usage = toUsage(info.tokens)
    if (usage) message.infoUsage = usage
    if (info.cost !== undefined) message.infoCostUsd = info.cost
    if (info.time?.created !== undefined) message.createdMs = info.time.created
    if (info.time?.completed !== undefined) message.completedMs = info.time.completed
    if (info.error !== undefined && info.error !== null) message.failed = true
  }

  const observePart = (rawPart: unknown) => {
    const step = stepFinishPartSchema.safeParse(rawPart)
    if (step.success) {
      const message = touch(step.data.messageID)
      const stepKey = step.data.id ?? `step-${message.steps.size}`
      message.steps.set(stepKey, {
        usage: toUsage(step.data.tokens),
        costUsd: step.data.cost ?? null,
        reason: step.data.reason ?? null,
      })
      return
    }
    const text = textPartSchema.safeParse(rawPart)
    if (text.success && !text.data.synthetic) {
      touch(text.data.messageID).textParts.set(text.data.id, text.data.text)
    }
  }

  return {
    observe(type, properties) {
      if (type === 'message.updated') {
        const envelope = infoEnvelopeSchema.safeParse(properties)
        if (envelope.success) observeInfo(envelope.data.info)
        return
      }
      if (type === 'message.part.updated') {
        const envelope = partEnvelopeSchema.safeParse(properties)
        if (envelope.success) observePart(envelope.data.part)
      }
    },
    assistantMessages() {
      return [...messages.values()]
        .filter((message) => message.role === 'assistant' || (message.role === null && message.steps.size > 0))
        .map((message) => {
          const steps = [...message.steps.values()]
          const stepUsage = sumUsage(steps.flatMap((step) => (step.usage ? [step.usage] : [])))
          const stepCost = sumCost(steps.flatMap((step) => (step.costUsd !== null ? [step.costUsd] : [])))
          const reasons = steps.flatMap((step) => (step.reason ? [step.reason] : []))
          const text = [...message.textParts.values()].filter((entry) => entry.length > 0).join('\n')
          return {
            id: message.id,
            modelId: message.modelId,
            providerId: message.providerId,
            usage: stepUsage ?? message.infoUsage,
            costUsd: stepCost ?? message.infoCostUsd,
            finishReason: reasons.length > 0 ? reasons[reasons.length - 1] : null,
            createdMs: message.createdMs,
            completedMs: message.completedMs,
            firstSeenMs: message.firstSeenMs,
            lastSeenMs: message.lastSeenMs,
            failed: message.failed,
            text: text.length > 0 ? text : null,
          }
        })
    },
  }
}

/** Run manifest model facts observed on the stream: the latest assistant message that reported them. */
export function resolveObservedModel(
  messages: readonly OpenCodeAssistantMessage[],
): { modelResolved: string | null; provider: string | null } | null {
  const latest = [...messages].reverse().find((message) => message.modelId || message.providerId)
  if (!latest) return null
  return { modelResolved: latest.modelId, provider: latest.providerId }
}

export type OpenCodeReconstructedRequest = {
  system: string | null
  message: string
}

/**
 * The request AO can reconstruct for an OpenCode run: the message it sent and
 * the rendered agent prompt. OpenCode composes its own system prompt around
 * it, so the result is marked `reconstructed`. The session token is redacted.
 */
export function buildReconstructedRequest(input: OpenCodeReconstructedRequest): TraceLlmRequestIngest {
  const system = input.system ? redactSecretStrings(input.system) : undefined
  return {
    reconstructed: true,
    ...(system ? { system } : {}),
    messages: [{ role: 'user', content: redactSecretStrings(input.message) }],
  }
}

function fitsIngestBody(value: unknown): boolean {
  return new TextEncoder().encode(JSON.stringify(value)).length <= TRACE_INGEST_LLM_BODY_MAX_BYTES
}

export function openCodeMessageSpanId(externalRunId: string, messageId: string): string {
  return `${externalRunId}:msg:${messageId}`
}

function buildMessageLlm(
  message: OpenCodeAssistantMessage,
  bodies: { request?: TraceLlmRequestIngest; includeResponse: boolean },
): TraceLlmIngest {
  const llm: TraceLlmIngest = {}
  if (message.providerId) llm.provider = message.providerId
  if (message.modelId) {
    llm.requestModel = message.modelId
    llm.responseModel = message.modelId
  }
  if (message.usage) llm.usage = message.usage
  if (bodies.request && fitsIngestBody(bodies.request)) llm.request = bodies.request
  if (bodies.includeResponse && message.text) {
    const response: TraceLlmResponseIngest = {
      ...(message.finishReason ? { finishReason: message.finishReason } : {}),
      content: [{ type: 'text', text: redactSecretStrings(message.text) }],
    }
    if (fitsIngestBody(response)) llm.response = response
  }
  return llm
}

function buildMessageAttributes(message: OpenCodeAssistantMessage): Record<string, unknown> {
  const attributes: Record<string, unknown> = {}
  if (message.costUsd !== null) {
    attributes[OM_LLM_ATTRIBUTES.costMicros] = Math.round(message.costUsd * MICROS_PER_UNIT)
    attributes[OM_LLM_ATTRIBUTES.costCurrency] = REPORTED_COST_CURRENCY
    attributes[OM_LLM_ATTRIBUTES.costPricingSource] = 'reported'
  }
  if (message.createdMs !== null && message.completedMs !== null && message.completedMs >= message.createdMs) {
    attributes[OM_LLM_ATTRIBUTES.latencyMs] = Math.round(message.completedMs - message.createdMs)
  }
  if (message.finishReason) attributes[GEN_AI_ATTRIBUTES.responseFinishReasons] = [message.finishReason]
  return attributes
}

export type OpenCodeMessageSpansInput = {
  externalRunId: string
  messages: readonly OpenCodeAssistantMessage[]
  /** Present only at capture level `full`; attached to the first assistant message. */
  request: TraceLlmRequestIngest | null
  includeResponses: boolean
}

/**
 * One `llm` span per assistant message, with the usage, model and cost the
 * OpenCode session reported (`om.capture.fidelity = reported`, cost in
 * `om.cost.micros` with `pricing_source = reported`). Sequences are assigned
 * by the caller once tool spans are merged in.
 */
export function buildOpenCodeMessageSpans(input: OpenCodeMessageSpansInput): TraceSpanIngest[] {
  return input.messages.map((message, index) => {
    const startedMs = message.createdMs ?? message.firstSeenMs
    const endedMs = Math.max(startedMs, message.completedMs ?? message.lastSeenMs)
    return {
      externalSpanId: openCodeMessageSpanId(input.externalRunId, message.id),
      sequence: index,
      name: 'llm',
      kind: 'llm',
      startedAt: new Date(startedMs).toISOString(),
      endedAt: new Date(endedMs).toISOString(),
      durationMs: Math.max(0, Math.round(endedMs - startedMs)),
      status: message.failed ? 'error' : 'ok',
      attributes: buildMessageAttributes(message),
      llm: buildMessageLlm(message, {
        ...(index === 0 && input.request ? { request: input.request } : {}),
        includeResponse: input.includeResponses,
      }),
    }
  })
}

/**
 * Interleaves message spans with tool spans by start time (messages first on a
 * tie), parents each tool span to the message that issued it when known, and
 * renumbers the sequences.
 */
export function mergeMessageAndToolSpans(
  messageSpans: TraceSpanIngest[],
  toolSpans: Array<{ span: TraceSpanIngest; messageId: string | null }>,
  externalRunId: string,
): TraceSpanIngest[] {
  const messageSpanIds = new Set(messageSpans.map((span) => span.externalSpanId))
  const parentedTools = toolSpans.map(({ span, messageId }) => {
    const parentId = messageId ? openCodeMessageSpanId(externalRunId, messageId) : null
    return parentId && messageSpanIds.has(parentId) ? { ...span, parentExternalSpanId: parentId } : span
  })
  const ordered = [
    ...messageSpans.map((span, order) => ({ span, order, rank: 0 })),
    ...parentedTools.map((span, order) => ({ span, order, rank: 1 })),
  ].sort((left, right) => {
    const byStart = Date.parse(left.span.startedAt) - Date.parse(right.span.startedAt)
    if (byStart !== 0) return byStart
    if (left.rank !== right.rank) return left.rank - right.rank
    return left.order - right.order
  })
  return ordered.map(({ span }, sequence) => ({ ...span, sequence }))
}
