import { z } from 'zod'

export const GEN_AI_SEMCONV_VERSION = '1.43'

export const GEN_AI_ATTRIBUTES = {
  operationName: 'gen_ai.operation.name',
  providerName: 'gen_ai.provider.name',
  requestModel: 'gen_ai.request.model',
  requestTemperature: 'gen_ai.request.temperature',
  requestTopP: 'gen_ai.request.top_p',
  requestTopK: 'gen_ai.request.top_k',
  requestMaxTokens: 'gen_ai.request.max_tokens',
  requestSeed: 'gen_ai.request.seed',
  requestStopSequences: 'gen_ai.request.stop_sequences',
  requestPresencePenalty: 'gen_ai.request.presence_penalty',
  requestFrequencyPenalty: 'gen_ai.request.frequency_penalty',
  responseModel: 'gen_ai.response.model',
  responseId: 'gen_ai.response.id',
  responseFinishReasons: 'gen_ai.response.finish_reasons',
  usageInputTokens: 'gen_ai.usage.input_tokens',
  usageOutputTokens: 'gen_ai.usage.output_tokens',
  usageCacheReadInputTokens: 'gen_ai.usage.cache_read.input_tokens',
  usageReasoningOutputTokens: 'gen_ai.usage.reasoning.output_tokens',
  agentId: 'gen_ai.agent.id',
  agentName: 'gen_ai.agent.name',
  agentVersion: 'gen_ai.agent.version',
  toolName: 'gen_ai.tool.name',
  toolType: 'gen_ai.tool.type',
  toolCallId: 'gen_ai.tool.call.id',
  toolCallArguments: 'gen_ai.tool.call.arguments',
  toolCallResult: 'gen_ai.tool.call.result',
  workflowName: 'gen_ai.workflow.name',
  evaluationName: 'gen_ai.evaluation.name',
  evaluationScoreValue: 'gen_ai.evaluation.score.value',
  evaluationScoreLabel: 'gen_ai.evaluation.score.label',
  outputType: 'gen_ai.output.type',
} as const

export const GEN_AI_EVENTS = {
  evaluationResult: 'gen_ai.evaluation.result',
  inferenceOperationDetails: 'gen_ai.client.inference.operation.details',
} as const

export const GEN_AI_OPERATIONS = {
  chat: 'chat',
  invokeAgent: 'invoke_agent',
  invokeWorkflow: 'invoke_workflow',
  executeTool: 'execute_tool',
} as const

export const GEN_AI_OUTPUT_TYPES = {
  json: 'json',
  text: 'text',
} as const

export const OM_LLM_ATTRIBUTES = {
  costMicros: 'om.cost.micros',
  costCurrency: 'om.cost.currency',
  costPricingSource: 'om.cost.pricing_source',
  latencyMs: 'om.latency.ms',
  promptSystemSha256: 'om.prompt.system.sha256',
  toolsSha256: 'om.tools.sha256',
  toolsCount: 'om.tools.count',
  messagesCount: 'om.messages.count',
  contentRequestKey: 'om.content.request.key',
  contentRequestSha256: 'om.content.request.sha256',
  contentRequestBytes: 'om.content.request.bytes',
  contentResponseKey: 'om.content.response.key',
  contentResponseSha256: 'om.content.response.sha256',
  contentResponseBytes: 'om.content.response.bytes',
  contentStatus: 'om.content.status',
  contentRedactions: 'om.content.redactions',
  captureFidelity: 'om.capture.fidelity',
  paramsDefaults: 'om.params.defaults',
} as const

export const LEGACY_LLM_ATTRIBUTES = {
  inputTokens: 'inputTokens',
  outputTokens: 'outputTokens',
  finishReason: 'finishReason',
} as const

export const CAPTURE_FIDELITIES = ['exact', 'reconstructed', 'reported'] as const
export type CaptureFidelity = (typeof CAPTURE_FIDELITIES)[number]

export const CONTENT_STATUSES = ['stored', 'storage_unavailable', 'disabled', 'over_cap_truncated'] as const
export type ContentStatus = (typeof CONTENT_STATUSES)[number]

export const PRICING_SOURCES = ['default', 'env_override', 'unknown'] as const
export type PricingSource = (typeof PRICING_SOURCES)[number]

export const STOP_SEQUENCES_MAX_COUNT = 10
export const STOP_SEQUENCE_MAX_CHARS = 100

function coerceNumeric(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return value
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : value
}

function toStringList(value: unknown): unknown {
  if (typeof value === 'string') return [value]
  if (!Array.isArray(value)) return value
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
}

function coerceBoolean(value: unknown): unknown {
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}

const textSchema = z.string().min(1)
const finiteNumberSchema = z.preprocess(coerceNumeric, z.number().finite())
const integerSchema = z.preprocess(coerceNumeric, z.number().int())
const countSchema = z.preprocess(coerceNumeric, z.number().int().nonnegative())
const nonNegativeNumberSchema = z.preprocess(coerceNumeric, z.number().finite().nonnegative())
const stringListSchema = z.preprocess(toStringList, z.array(z.string()).min(1))
const booleanSchema = z.preprocess(coerceBoolean, z.boolean())
const sha256Schema = z.string().regex(/^(sha256:)?[0-9a-f]{64}$/)

const TYPED_ATTRIBUTE_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  [GEN_AI_ATTRIBUTES.operationName]: textSchema,
  [GEN_AI_ATTRIBUTES.providerName]: textSchema,
  [GEN_AI_ATTRIBUTES.requestModel]: textSchema,
  [GEN_AI_ATTRIBUTES.requestTemperature]: finiteNumberSchema,
  [GEN_AI_ATTRIBUTES.requestTopP]: finiteNumberSchema,
  [GEN_AI_ATTRIBUTES.requestTopK]: countSchema,
  [GEN_AI_ATTRIBUTES.requestMaxTokens]: countSchema,
  [GEN_AI_ATTRIBUTES.requestSeed]: integerSchema,
  [GEN_AI_ATTRIBUTES.requestStopSequences]: stringListSchema,
  [GEN_AI_ATTRIBUTES.requestPresencePenalty]: finiteNumberSchema,
  [GEN_AI_ATTRIBUTES.requestFrequencyPenalty]: finiteNumberSchema,
  [GEN_AI_ATTRIBUTES.responseModel]: textSchema,
  [GEN_AI_ATTRIBUTES.responseId]: textSchema,
  [GEN_AI_ATTRIBUTES.responseFinishReasons]: stringListSchema,
  [GEN_AI_ATTRIBUTES.usageInputTokens]: countSchema,
  [GEN_AI_ATTRIBUTES.usageOutputTokens]: countSchema,
  [GEN_AI_ATTRIBUTES.usageCacheReadInputTokens]: countSchema,
  [GEN_AI_ATTRIBUTES.usageReasoningOutputTokens]: countSchema,
  [GEN_AI_ATTRIBUTES.agentId]: textSchema,
  [GEN_AI_ATTRIBUTES.agentName]: textSchema,
  [GEN_AI_ATTRIBUTES.agentVersion]: textSchema,
  [GEN_AI_ATTRIBUTES.toolName]: textSchema,
  [GEN_AI_ATTRIBUTES.toolType]: textSchema,
  [GEN_AI_ATTRIBUTES.toolCallId]: textSchema,
  [GEN_AI_ATTRIBUTES.workflowName]: textSchema,
  [GEN_AI_ATTRIBUTES.evaluationName]: textSchema,
  [GEN_AI_ATTRIBUTES.evaluationScoreValue]: finiteNumberSchema,
  [GEN_AI_ATTRIBUTES.evaluationScoreLabel]: textSchema,
  [GEN_AI_ATTRIBUTES.outputType]: textSchema,
  [OM_LLM_ATTRIBUTES.costMicros]: countSchema,
  [OM_LLM_ATTRIBUTES.costCurrency]: textSchema,
  [OM_LLM_ATTRIBUTES.costPricingSource]: z.enum(PRICING_SOURCES),
  [OM_LLM_ATTRIBUTES.latencyMs]: nonNegativeNumberSchema,
  [OM_LLM_ATTRIBUTES.promptSystemSha256]: sha256Schema,
  [OM_LLM_ATTRIBUTES.toolsSha256]: sha256Schema,
  [OM_LLM_ATTRIBUTES.toolsCount]: countSchema,
  [OM_LLM_ATTRIBUTES.messagesCount]: countSchema,
  [OM_LLM_ATTRIBUTES.contentRequestKey]: textSchema,
  [OM_LLM_ATTRIBUTES.contentRequestSha256]: sha256Schema,
  [OM_LLM_ATTRIBUTES.contentRequestBytes]: countSchema,
  [OM_LLM_ATTRIBUTES.contentResponseKey]: textSchema,
  [OM_LLM_ATTRIBUTES.contentResponseSha256]: sha256Schema,
  [OM_LLM_ATTRIBUTES.contentResponseBytes]: countSchema,
  [OM_LLM_ATTRIBUTES.contentStatus]: z.enum(CONTENT_STATUSES),
  [OM_LLM_ATTRIBUTES.captureFidelity]: z.enum(CAPTURE_FIDELITIES),
  [OM_LLM_ATTRIBUTES.paramsDefaults]: booleanSchema,
}

const LEGACY_COUNT_SCHEMA = countSchema
const LEGACY_FINISH_REASON_SCHEMA = textSchema

export type LlmRequestParameters = {
  temperature?: number
  topP?: number
  topK?: number
  maxTokens?: number
  seed?: number
  stopSequences?: string[]
  presencePenalty?: number
  frequencyPenalty?: number
}

export type LlmUsage = {
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  reasoningTokens?: number
}

export type LlmSpanMetadataSource = 'gen_ai' | 'legacy' | 'none'

export type LlmSpanMetadata = {
  source: LlmSpanMetadataSource
  operationName?: string
  providerName?: string
  requestModel?: string
  responseModel?: string
  responseId?: string
  outputType?: string
  params: LlmRequestParameters
  paramsDefaults?: boolean
  usage: LlmUsage
  finishReasons?: string[]
  latencyMs?: number
  costMicros?: number
  costCurrency?: string
  pricingSource?: PricingSource
  promptSystemSha256?: string
  toolsSha256?: string
  toolsCount?: number
  messagesCount?: number
  contentRequestKey?: string
  contentRequestSha256?: string
  contentRequestBytes?: number
  contentResponseKey?: string
  contentResponseSha256?: string
  contentResponseBytes?: number
  contentStatus?: ContentStatus
  fidelity?: CaptureFidelity
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseWith<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  if (value === undefined || value === null) return undefined
  const parsed = schema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

function readTyped<T>(attributes: Record<string, unknown>, key: string): T | undefined {
  const schema = TYPED_ATTRIBUTE_SCHEMAS[key] as z.ZodType<T> | undefined
  if (!schema) return undefined
  return parseWith(schema, attributes[key])
}

function readTypedNumber(attributes: Record<string, unknown>, key: string): number | undefined {
  return readTyped<number>(attributes, key)
}

function readTypedString(attributes: Record<string, unknown>, key: string): string | undefined {
  return readTyped<string>(attributes, key)
}

function readTypedStringList(attributes: Record<string, unknown>, key: string): string[] | undefined {
  return readTyped<string[]>(attributes, key)
}

function compact<T extends Record<string, unknown>>(record: T): T {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) result[key] = value
  }
  return result as T
}

function hasTypedVocabularyValue(attributes: Record<string, unknown>): boolean {
  return Object.keys(TYPED_ATTRIBUTE_SCHEMAS).some((key) => readTyped<unknown>(attributes, key) !== undefined)
}

function readLegacyCount(attributes: Record<string, unknown>, key: string): number | undefined {
  return parseWith(LEGACY_COUNT_SCHEMA, attributes[key])
}

function readLegacyFinishReason(attributes: Record<string, unknown>): string | undefined {
  return parseWith(LEGACY_FINISH_REASON_SCHEMA, attributes[LEGACY_LLM_ATTRIBUTES.finishReason])
}

function emptyMetadata(): LlmSpanMetadata {
  return { source: 'none', params: {}, usage: {} }
}

export function readLlmSpanMetadata(attributes: unknown): LlmSpanMetadata {
  if (!isPlainRecord(attributes)) return emptyMetadata()
  try {
    const legacyInput = readLegacyCount(attributes, LEGACY_LLM_ATTRIBUTES.inputTokens)
    const legacyOutput = readLegacyCount(attributes, LEGACY_LLM_ATTRIBUTES.outputTokens)
    const legacyFinishReason = readLegacyFinishReason(attributes)
    const hasGenAi = hasTypedVocabularyValue(attributes)
    const hasLegacy = legacyInput !== undefined || legacyOutput !== undefined || legacyFinishReason !== undefined
    const finishReasons =
      readTypedStringList(attributes, GEN_AI_ATTRIBUTES.responseFinishReasons) ??
      (legacyFinishReason !== undefined ? [legacyFinishReason] : undefined)
    const metadata: LlmSpanMetadata = {
      source: hasGenAi ? 'gen_ai' : hasLegacy ? 'legacy' : 'none',
      operationName: readTypedString(attributes, GEN_AI_ATTRIBUTES.operationName),
      providerName: readTypedString(attributes, GEN_AI_ATTRIBUTES.providerName),
      requestModel: readTypedString(attributes, GEN_AI_ATTRIBUTES.requestModel),
      responseModel: readTypedString(attributes, GEN_AI_ATTRIBUTES.responseModel),
      responseId: readTypedString(attributes, GEN_AI_ATTRIBUTES.responseId),
      outputType: readTypedString(attributes, GEN_AI_ATTRIBUTES.outputType),
      params: compact({
        temperature: readTypedNumber(attributes, GEN_AI_ATTRIBUTES.requestTemperature),
        topP: readTypedNumber(attributes, GEN_AI_ATTRIBUTES.requestTopP),
        topK: readTypedNumber(attributes, GEN_AI_ATTRIBUTES.requestTopK),
        maxTokens: readTypedNumber(attributes, GEN_AI_ATTRIBUTES.requestMaxTokens),
        seed: readTypedNumber(attributes, GEN_AI_ATTRIBUTES.requestSeed),
        stopSequences: readTypedStringList(attributes, GEN_AI_ATTRIBUTES.requestStopSequences),
        presencePenalty: readTypedNumber(attributes, GEN_AI_ATTRIBUTES.requestPresencePenalty),
        frequencyPenalty: readTypedNumber(attributes, GEN_AI_ATTRIBUTES.requestFrequencyPenalty),
      }),
      paramsDefaults: readTyped<boolean>(attributes, OM_LLM_ATTRIBUTES.paramsDefaults),
      usage: compact({
        inputTokens: readTypedNumber(attributes, GEN_AI_ATTRIBUTES.usageInputTokens) ?? legacyInput,
        outputTokens: readTypedNumber(attributes, GEN_AI_ATTRIBUTES.usageOutputTokens) ?? legacyOutput,
        cachedInputTokens: readTypedNumber(attributes, GEN_AI_ATTRIBUTES.usageCacheReadInputTokens),
        reasoningTokens: readTypedNumber(attributes, GEN_AI_ATTRIBUTES.usageReasoningOutputTokens),
      }),
      finishReasons,
      latencyMs: readTypedNumber(attributes, OM_LLM_ATTRIBUTES.latencyMs),
      costMicros: readTypedNumber(attributes, OM_LLM_ATTRIBUTES.costMicros),
      costCurrency: readTypedString(attributes, OM_LLM_ATTRIBUTES.costCurrency),
      pricingSource: readTyped<PricingSource>(attributes, OM_LLM_ATTRIBUTES.costPricingSource),
      promptSystemSha256: readTypedString(attributes, OM_LLM_ATTRIBUTES.promptSystemSha256),
      toolsSha256: readTypedString(attributes, OM_LLM_ATTRIBUTES.toolsSha256),
      toolsCount: readTypedNumber(attributes, OM_LLM_ATTRIBUTES.toolsCount),
      messagesCount: readTypedNumber(attributes, OM_LLM_ATTRIBUTES.messagesCount),
      contentRequestKey: readTypedString(attributes, OM_LLM_ATTRIBUTES.contentRequestKey),
      contentRequestSha256: readTypedString(attributes, OM_LLM_ATTRIBUTES.contentRequestSha256),
      contentRequestBytes: readTypedNumber(attributes, OM_LLM_ATTRIBUTES.contentRequestBytes),
      contentResponseKey: readTypedString(attributes, OM_LLM_ATTRIBUTES.contentResponseKey),
      contentResponseSha256: readTypedString(attributes, OM_LLM_ATTRIBUTES.contentResponseSha256),
      contentResponseBytes: readTypedNumber(attributes, OM_LLM_ATTRIBUTES.contentResponseBytes),
      contentStatus: readTyped<ContentStatus>(attributes, OM_LLM_ATTRIBUTES.contentStatus),
      fidelity: readTyped<CaptureFidelity>(attributes, OM_LLM_ATTRIBUTES.captureFidelity),
    }
    return compact(metadata)
  } catch {
    return emptyMetadata()
  }
}

function backfillCount(
  normalized: Record<string, unknown>,
  genAiKey: string,
  legacyKey: string,
): void {
  const genAiValue = readTypedNumber(normalized, genAiKey)
  const legacyValue = readLegacyCount(normalized, legacyKey)
  if (genAiValue !== undefined && legacyValue === undefined) normalized[legacyKey] = genAiValue
  if (genAiValue === undefined && legacyValue !== undefined) normalized[genAiKey] = legacyValue
}

function backfillFinishReason(normalized: Record<string, unknown>): void {
  const finishReasons = readTypedStringList(normalized, GEN_AI_ATTRIBUTES.responseFinishReasons)
  const legacyValue = readLegacyFinishReason(normalized)
  if (finishReasons !== undefined && legacyValue === undefined) {
    normalized[LEGACY_LLM_ATTRIBUTES.finishReason] = finishReasons[0]
  }
  if (finishReasons === undefined && legacyValue !== undefined) {
    normalized[GEN_AI_ATTRIBUTES.responseFinishReasons] = [legacyValue]
  }
}

function capStopSequences(values: string[]): string[] {
  return values.slice(0, STOP_SEQUENCES_MAX_COUNT).map((value) => value.slice(0, STOP_SEQUENCE_MAX_CHARS))
}

export function hasGenAiVocabularyKey(attributes: unknown): boolean {
  if (!isPlainRecord(attributes)) return false
  return Object.keys(attributes).some((key) => Object.prototype.hasOwnProperty.call(TYPED_ATTRIBUTE_SCHEMAS, key))
}

export function normalizeGenAiAttributes(attributes: Record<string, unknown>): Record<string, unknown>
export function normalizeGenAiAttributes(attributes: unknown): unknown
export function normalizeGenAiAttributes(attributes: unknown): unknown {
  if (!isPlainRecord(attributes)) return attributes
  try {
    const normalized: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(attributes)) {
      const schema = TYPED_ATTRIBUTE_SCHEMAS[key]
      if (!schema) {
        normalized[key] = value
        continue
      }
      const parsed = parseWith(schema, value)
      if (parsed === undefined) continue
      normalized[key] = key === GEN_AI_ATTRIBUTES.requestStopSequences ? capStopSequences(parsed as string[]) : parsed
    }
    backfillCount(normalized, GEN_AI_ATTRIBUTES.usageInputTokens, LEGACY_LLM_ATTRIBUTES.inputTokens)
    backfillCount(normalized, GEN_AI_ATTRIBUTES.usageOutputTokens, LEGACY_LLM_ATTRIBUTES.outputTokens)
    backfillFinishReason(normalized)
    return normalized
  } catch {
    return attributes
  }
}
