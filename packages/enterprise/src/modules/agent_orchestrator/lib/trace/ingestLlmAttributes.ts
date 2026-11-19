import { canonicalJsonStringify } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-definition-hash'
import type { AiAgentCallSettings } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-call-contract'
import type {
  TraceLlmIngest,
  TraceLlmParamsIngest,
  TraceManifestIngest,
  TraceSpanIngest,
} from '../../data/validators'
import type {
  NativeModelCallContent,
  NativeModelCallContentOutcome,
} from '../runtime/nativeModelCallRecorder'
import { computeCostMicros } from '../runtime/modelPricing'
import {
  GEN_AI_ATTRIBUTES,
  GEN_AI_OPERATIONS,
  LEGACY_LLM_ATTRIBUTES,
  OM_LLM_ATTRIBUTES,
  STOP_SEQUENCES_MAX_COUNT,
  STOP_SEQUENCE_MAX_CHARS,
} from './genAiAttributes'
import {
  RUN_MANIFEST_SPAN_NAME,
  buildRunManifestAttributes,
  computeManifestSha256,
  runManifestExternalSpanId,
  type RunManifestCapture,
  type RunManifestCaptureLevel,
  type RunManifestInvoker,
} from './runManifest'

type SpanAttributes = Record<string, unknown>

export const INGEST_MANIFEST_INVOKER: RunManifestInvoker = {
  kind: 'integration',
  userId: null,
  apiKeyId: null,
  ownerUserId: null,
}

const SERVER_CONTENT_KEYS: readonly string[] = [
  OM_LLM_ATTRIBUTES.contentRequestKey,
  OM_LLM_ATTRIBUTES.contentResponseKey,
  OM_LLM_ATTRIBUTES.contentStatus,
  OM_LLM_ATTRIBUTES.contentRedactions,
]

const CONTENT_REFERENCE_KEYS: readonly string[] = [
  OM_LLM_ATTRIBUTES.contentRequestKey,
  OM_LLM_ATTRIBUTES.contentRequestSha256,
  OM_LLM_ATTRIBUTES.contentRequestBytes,
  OM_LLM_ATTRIBUTES.contentResponseKey,
  OM_LLM_ATTRIBUTES.contentResponseSha256,
  OM_LLM_ATTRIBUTES.contentResponseBytes,
  OM_LLM_ATTRIBUTES.contentStatus,
]

const LEGACY_KEYS: readonly string[] = Object.values(LEGACY_LLM_ATTRIBUTES)

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assign(target: SpanAttributes, key: string, value: unknown): void {
  if (value !== undefined && value !== null) target[key] = value
}

function hashBody(value: unknown): { sha256: string; bytes: number } {
  const serialized = canonicalJsonStringify(value)
  return { sha256: computeManifestSha256(serialized), bytes: Buffer.byteLength(serialized, 'utf8') }
}

function capStopSequences(values: readonly string[]): string[] {
  return values
    .filter((value) => value.length > 0)
    .slice(0, STOP_SEQUENCES_MAX_COUNT)
    .map((value) => value.slice(0, STOP_SEQUENCE_MAX_CHARS))
}

function buildParamAttributes(params: TraceLlmParamsIngest): SpanAttributes {
  const attributes: SpanAttributes = {}
  assign(attributes, GEN_AI_ATTRIBUTES.requestTemperature, params.temperature)
  assign(attributes, GEN_AI_ATTRIBUTES.requestTopP, params.topP)
  assign(attributes, GEN_AI_ATTRIBUTES.requestTopK, params.topK)
  assign(attributes, GEN_AI_ATTRIBUTES.requestMaxTokens, params.maxTokens)
  assign(attributes, GEN_AI_ATTRIBUTES.requestSeed, params.seed)
  assign(attributes, GEN_AI_ATTRIBUTES.requestPresencePenalty, params.presencePenalty)
  assign(attributes, GEN_AI_ATTRIBUTES.requestFrequencyPenalty, params.frequencyPenalty)
  const stopSequences = capStopSequences(params.stopSequences ?? [])
  if (stopSequences.length > 0) attributes[GEN_AI_ATTRIBUTES.requestStopSequences] = stopSequences
  if (Object.keys(attributes).length === 0) attributes[OM_LLM_ATTRIBUTES.paramsDefaults] = true
  return attributes
}

export function hasIngestLlmBody(llm: TraceLlmIngest): boolean {
  return llm.request !== undefined || llm.response !== undefined
}

/**
 * The `gen_ai.*` / `om.*` metadata keys of one ingested llm span. Bodies are
 * never copied onto the span; only their hash and size as sent are kept.
 */
export function buildIngestLlmMetadataAttributes(llm: TraceLlmIngest): SpanAttributes {
  const attributes: SpanAttributes = {
    [GEN_AI_ATTRIBUTES.operationName]: GEN_AI_OPERATIONS.chat,
    [OM_LLM_ATTRIBUTES.captureFidelity]: 'reported',
  }
  assign(attributes, GEN_AI_ATTRIBUTES.providerName, llm.provider)
  assign(attributes, GEN_AI_ATTRIBUTES.requestModel, llm.requestModel)
  assign(attributes, GEN_AI_ATTRIBUTES.responseModel, llm.responseModel)
  if (llm.params) Object.assign(attributes, buildParamAttributes(llm.params))
  const usage = llm.usage
  if (usage) {
    assign(attributes, GEN_AI_ATTRIBUTES.usageInputTokens, usage.inputTokens)
    assign(attributes, GEN_AI_ATTRIBUTES.usageOutputTokens, usage.outputTokens)
    assign(attributes, GEN_AI_ATTRIBUTES.usageCacheReadInputTokens, usage.cachedInputTokens)
    assign(attributes, GEN_AI_ATTRIBUTES.usageReasoningOutputTokens, usage.reasoningTokens)
    const cost = computeCostMicros(llm.responseModel ?? llm.requestModel, usage)
    if (cost) {
      attributes[OM_LLM_ATTRIBUTES.costMicros] = cost.micros
      attributes[OM_LLM_ATTRIBUTES.costCurrency] = cost.currency
      attributes[OM_LLM_ATTRIBUTES.costPricingSource] = cost.pricingSource
    } else {
      attributes[OM_LLM_ATTRIBUTES.costPricingSource] = 'unknown'
    }
  }
  const finishReason = llm.response?.finishReason
  if (finishReason) attributes[GEN_AI_ATTRIBUTES.responseFinishReasons] = [finishReason]
  if (llm.request !== undefined) {
    const request = hashBody(llm.request)
    attributes[OM_LLM_ATTRIBUTES.contentRequestSha256] = request.sha256
    attributes[OM_LLM_ATTRIBUTES.contentRequestBytes] = request.bytes
  }
  if (llm.response !== undefined) {
    const response = hashBody(llm.response)
    attributes[OM_LLM_ATTRIBUTES.contentResponseSha256] = response.sha256
    attributes[OM_LLM_ATTRIBUTES.contentResponseBytes] = response.bytes
  }
  return attributes
}

function toCallSettings(params: TraceLlmParamsIngest | undefined): AiAgentCallSettings | undefined {
  if (!params) return undefined
  const settings: AiAgentCallSettings = {}
  if (params.temperature !== undefined) settings.temperature = params.temperature
  if (params.topP !== undefined) settings.topP = params.topP
  if (params.topK !== undefined) settings.topK = params.topK
  if (params.maxTokens !== undefined) settings.maxOutputTokens = params.maxTokens
  if (params.seed !== undefined) settings.seed = params.seed
  if (params.stopSequences !== undefined) settings.stopSequences = params.stopSequences
  if (params.presencePenalty !== undefined) settings.presencePenalty = params.presencePenalty
  if (params.frequencyPenalty !== undefined) settings.frequencyPenalty = params.frequencyPenalty
  return settings
}

/** The request/response bodies of one ingested llm span in the content builders' input shape. */
export function buildIngestLlmContent(llm: TraceLlmIngest): NativeModelCallContent | null {
  if (!hasIngestLlmBody(llm)) return null
  const request = llm.request ?? {}
  const response = llm.response ?? {}
  return {
    request: {
      ...(request.reconstructed ? { reconstructed: true } : {}),
      provider: llm.provider ?? '',
      modelId: llm.requestModel ?? llm.responseModel ?? '',
      system: request.system,
      messages: request.messages ?? [],
      tools: request.tools,
      responseFormat: request.responseFormat,
      callSettings: toCallSettings(llm.params),
    },
    response: {
      finishReason: response.finishReason ?? 'unknown',
      content: response.content ?? [],
      ...(response.object !== undefined ? { object: response.object } : {}),
      usage: { ...(llm.usage ?? {}) },
      ...(response.providerMetadata !== undefined ? { providerMetadata: response.providerMetadata } : {}),
    },
  }
}

/**
 * The server-owned `om.content.*` keys: `disabled` below `full`; at `full` the
 * offload outcome, or `storage_unavailable` when nothing could be stored.
 * Nothing is written at `full` when the adapter sent no bodies.
 */
export function buildIngestContentAttributes(
  llm: TraceLlmIngest,
  level: RunManifestCaptureLevel,
  outcome: NativeModelCallContentOutcome | null,
): SpanAttributes {
  if (level !== 'full') return { [OM_LLM_ATTRIBUTES.contentStatus]: 'disabled' }
  if (!hasIngestLlmBody(llm)) return {}
  if (!outcome) return { [OM_LLM_ATTRIBUTES.contentStatus]: 'storage_unavailable' }
  const attributes: SpanAttributes = {}
  assign(attributes, OM_LLM_ATTRIBUTES.contentRequestKey, outcome.requestKey)
  assign(attributes, OM_LLM_ATTRIBUTES.contentResponseKey, outcome.responseKey)
  attributes[OM_LLM_ATTRIBUTES.contentStatus] = outcome.status
  if (outcome.redactions.length > 0) attributes[OM_LLM_ATTRIBUTES.contentRedactions] = outcome.redactions
  return attributes
}

function withoutKeys(attributes: SpanAttributes, keys: readonly string[]): SpanAttributes {
  return Object.fromEntries(Object.entries(attributes).filter(([key]) => !keys.includes(key)))
}

function pickKeys(attributes: SpanAttributes, keys: readonly string[]): SpanAttributes {
  return Object.fromEntries(Object.entries(attributes).filter(([key]) => keys.includes(key)))
}

/**
 * Drops the server-owned content keys from adapter-sent attributes on spans
 * that bypass the `llm` mapping, so an adapter cannot point any span at
 * stored content. Returns the input unchanged when it carries none.
 */
export function withoutServerContentKeys(attributes: unknown): unknown {
  if (!isPlainRecord(attributes)) return attributes
  if (!SERVER_CONTENT_KEYS.some((key) => key in attributes)) return attributes
  return withoutKeys(attributes, SERVER_CONTENT_KEYS)
}

/**
 * Combines the adapter's explicit attributes with the `llm`-derived metadata
 * (explicit keys win) and the server-owned content keys (always win; an
 * adapter cannot point a span at stored content).
 */
export function mergeIngestLlmAttributes(
  explicit: unknown,
  metadata: SpanAttributes,
  content: SpanAttributes,
): SpanAttributes {
  const explicitRecord = isPlainRecord(explicit) ? withoutKeys(explicit, SERVER_CONTENT_KEYS) : {}
  return { ...metadata, ...explicitRecord, ...content }
}

/**
 * Fits ingested llm span attributes into the inline cap: stop sequences go
 * first, then the redaction counts; past that only the legacy keys and the
 * content references survive, so the span never loses its pointer to stored
 * content.
 */
export function fitIngestLlmAttributes(attributes: SpanAttributes, limit: number): SpanAttributes {
  const fits = (candidate: SpanAttributes) => JSON.stringify(candidate).length <= limit
  if (fits(attributes)) return attributes
  const withoutStopSequences = withoutKeys(attributes, [GEN_AI_ATTRIBUTES.requestStopSequences])
  if (fits(withoutStopSequences)) return withoutStopSequences
  const withoutRedactions = withoutKeys(withoutStopSequences, [OM_LLM_ATTRIBUTES.contentRedactions])
  if (fits(withoutRedactions)) return withoutRedactions
  return pickKeys(withoutRedactions, [...LEGACY_KEYS, ...CONTENT_REFERENCE_KEYS])
}

export type IngestManifestSpanInput = {
  runId: string
  agentId: string
  manifest: TraceManifestIngest
  capture: RunManifestCapture | null
  sequence: number
  recordedAt: string
}

/**
 * The `run.manifest` system span for an ingested run. The invoker is always
 * the HMAC-verified integration; the capture comes from the resolved policy.
 * Facts the adapter did not report (definition hash, agent source) are left
 * out rather than invented.
 */
export function buildIngestManifestSpan(input: IngestManifestSpanInput): TraceSpanIngest {
  const { manifest } = input
  const knowledge = manifest.knowledge
    ? Object.fromEntries(Object.entries(manifest.knowledge).map(([key, version]) => [key, { version }]))
    : null
  const built = buildRunManifestAttributes({
    runtime: 'external',
    agentId: input.agentId,
    definitionHash: manifest.definitionHash ?? '',
    agentSource: manifest.agentSource ?? 'code',
    ctx: { userId: '' },
    promptOverride: manifest.promptOverride ?? null,
    systemPromptSha256: manifest.systemPromptSha256 ?? null,
    skills: manifest.skills ?? [],
    toolsSha256: manifest.toolsSha256 ?? null,
    toolNames: manifest.toolNames ?? [],
    modelDeclared: manifest.modelDeclared ?? null,
    modelResolved: manifest.modelResolved ?? null,
    provider: manifest.provider ?? null,
    observation: knowledge ? { knowledge } : null,
    invoker: INGEST_MANIFEST_INVOKER,
    correlationId: manifest.correlationId ?? null,
    traceparent: manifest.traceparent ?? null,
    capture: input.capture,
  })
  const {
    'om.agent.definition_hash': definitionHash,
    'om.agent.source': agentSource,
    ...rest
  } = built
  const attributes: SpanAttributes = { ...rest }
  if (manifest.definitionHash) attributes['om.agent.definition_hash'] = definitionHash
  if (manifest.agentSource) attributes['om.agent.source'] = agentSource
  return {
    externalSpanId: runManifestExternalSpanId(input.runId),
    sequence: input.sequence,
    name: RUN_MANIFEST_SPAN_NAME,
    kind: 'system',
    startedAt: input.recordedAt,
    endedAt: input.recordedAt,
    durationMs: 0,
    status: 'ok',
    attributes,
  }
}
