import {
  GEN_AI_ATTRIBUTES,
  GEN_AI_SEMCONV_VERSION,
  LEGACY_LLM_ATTRIBUTES,
  OM_LLM_ATTRIBUTES,
  STOP_SEQUENCES_MAX_COUNT,
  STOP_SEQUENCE_MAX_CHARS,
  hasGenAiVocabularyKey,
  normalizeGenAiAttributes,
  readLlmSpanMetadata,
} from '../lib/trace/genAiAttributes'

const systemHash = 'a'.repeat(64)
const toolsHash = 'b'.repeat(64)

function fullAttributes(): Record<string, unknown> {
  return {
    [LEGACY_LLM_ATTRIBUTES.inputTokens]: 120,
    [LEGACY_LLM_ATTRIBUTES.outputTokens]: 30,
    [LEGACY_LLM_ATTRIBUTES.finishReason]: 'stop',
    [GEN_AI_ATTRIBUTES.operationName]: 'chat',
    [GEN_AI_ATTRIBUTES.providerName]: 'openai',
    [GEN_AI_ATTRIBUTES.requestModel]: 'gpt-4o-mini',
    [GEN_AI_ATTRIBUTES.responseModel]: 'gpt-4o-mini-2024-07-18',
    [GEN_AI_ATTRIBUTES.responseId]: 'resp_1',
    [GEN_AI_ATTRIBUTES.requestTemperature]: 0.2,
    [GEN_AI_ATTRIBUTES.requestTopP]: 0.9,
    [GEN_AI_ATTRIBUTES.requestTopK]: 40,
    [GEN_AI_ATTRIBUTES.requestMaxTokens]: 512,
    [GEN_AI_ATTRIBUTES.requestSeed]: -7,
    [GEN_AI_ATTRIBUTES.requestStopSequences]: ['END'],
    [GEN_AI_ATTRIBUTES.requestPresencePenalty]: 0.1,
    [GEN_AI_ATTRIBUTES.requestFrequencyPenalty]: 0.3,
    [GEN_AI_ATTRIBUTES.usageInputTokens]: 120,
    [GEN_AI_ATTRIBUTES.usageOutputTokens]: 30,
    [GEN_AI_ATTRIBUTES.usageCacheReadInputTokens]: 64,
    [GEN_AI_ATTRIBUTES.usageReasoningOutputTokens]: 12,
    [GEN_AI_ATTRIBUTES.responseFinishReasons]: ['stop'],
    [GEN_AI_ATTRIBUTES.outputType]: 'json',
    [OM_LLM_ATTRIBUTES.latencyMs]: 812,
    [OM_LLM_ATTRIBUTES.costMicros]: 1500,
    [OM_LLM_ATTRIBUTES.costCurrency]: 'USD',
    [OM_LLM_ATTRIBUTES.costPricingSource]: 'default',
    [OM_LLM_ATTRIBUTES.promptSystemSha256]: systemHash,
    [OM_LLM_ATTRIBUTES.toolsSha256]: toolsHash,
    [OM_LLM_ATTRIBUTES.toolsCount]: 3,
    [OM_LLM_ATTRIBUTES.messagesCount]: 4,
    [OM_LLM_ATTRIBUTES.contentRequestSha256]: systemHash,
    [OM_LLM_ATTRIBUTES.contentRequestBytes]: 2048,
    [OM_LLM_ATTRIBUTES.contentResponseSha256]: toolsHash,
    [OM_LLM_ATTRIBUTES.contentResponseBytes]: 256,
    [OM_LLM_ATTRIBUTES.contentStatus]: 'disabled',
    [OM_LLM_ATTRIBUTES.captureFidelity]: 'exact',
  }
}

describe('gen_ai attribute vocabulary', () => {
  it('pins the semantic-conventions version and the spec key spellings', () => {
    expect(GEN_AI_SEMCONV_VERSION).toBe('1.43')
    expect(GEN_AI_ATTRIBUTES.usageCacheReadInputTokens).toBe('gen_ai.usage.cache_read.input_tokens')
    expect(GEN_AI_ATTRIBUTES.usageReasoningOutputTokens).toBe('gen_ai.usage.reasoning.output_tokens')
    expect(GEN_AI_ATTRIBUTES.responseFinishReasons).toBe('gen_ai.response.finish_reasons')
    expect(OM_LLM_ATTRIBUTES.costPricingSource).toBe('om.cost.pricing_source')
    expect(OM_LLM_ATTRIBUTES.captureFidelity).toBe('om.capture.fidelity')
    expect(OM_LLM_ATTRIBUTES.paramsDefaults).toBe('om.params.defaults')
  })

  it('keeps every gen_ai key in the gen_ai namespace and every om key in the om namespace', () => {
    for (const key of Object.values(GEN_AI_ATTRIBUTES)) expect(key.startsWith('gen_ai.')).toBe(true)
    for (const key of Object.values(OM_LLM_ATTRIBUTES)) expect(key.startsWith('om.')).toBe(true)
  })
})

describe('readLlmSpanMetadata', () => {
  it('reads a fully recorded llm span', () => {
    const metadata = readLlmSpanMetadata(fullAttributes())
    expect(metadata).toEqual({
      source: 'gen_ai',
      operationName: 'chat',
      providerName: 'openai',
      requestModel: 'gpt-4o-mini',
      responseModel: 'gpt-4o-mini-2024-07-18',
      responseId: 'resp_1',
      outputType: 'json',
      params: {
        temperature: 0.2,
        topP: 0.9,
        topK: 40,
        maxTokens: 512,
        seed: -7,
        stopSequences: ['END'],
        presencePenalty: 0.1,
        frequencyPenalty: 0.3,
      },
      usage: { inputTokens: 120, outputTokens: 30, cachedInputTokens: 64, reasoningTokens: 12 },
      finishReasons: ['stop'],
      latencyMs: 812,
      costMicros: 1500,
      costCurrency: 'USD',
      pricingSource: 'default',
      promptSystemSha256: systemHash,
      toolsSha256: toolsHash,
      toolsCount: 3,
      messagesCount: 4,
      contentRequestSha256: systemHash,
      contentRequestBytes: 2048,
      contentResponseSha256: toolsHash,
      contentResponseBytes: 256,
      contentStatus: 'disabled',
      fidelity: 'exact',
    })
  })

  it('tolerates legacy-only spans', () => {
    const metadata = readLlmSpanMetadata({ inputTokens: 10, outputTokens: 5, finishReason: 'tool-calls' })
    expect(metadata).toEqual({
      source: 'legacy',
      params: {},
      usage: { inputTokens: 10, outputTokens: 5 },
      finishReasons: ['tool-calls'],
    })
  })

  it('reports no metadata for non-record or empty input', () => {
    const empty = { source: 'none', params: {}, usage: {} }
    expect(readLlmSpanMetadata(null)).toEqual(empty)
    expect(readLlmSpanMetadata(undefined)).toEqual(empty)
    expect(readLlmSpanMetadata('chat')).toEqual(empty)
    expect(readLlmSpanMetadata([1, 2])).toEqual(empty)
    expect(readLlmSpanMetadata({ unrelated: true })).toEqual(empty)
  })

  it('coerces numeric strings and drops wrongly typed values', () => {
    const metadata = readLlmSpanMetadata({
      [GEN_AI_ATTRIBUTES.usageInputTokens]: '42',
      [GEN_AI_ATTRIBUTES.usageOutputTokens]: -1,
      [GEN_AI_ATTRIBUTES.requestTemperature]: 'warm',
      [GEN_AI_ATTRIBUTES.requestMaxTokens]: 1.5,
      [GEN_AI_ATTRIBUTES.responseFinishReasons]: 'length',
      [OM_LLM_ATTRIBUTES.captureFidelity]: 'guessed',
      [OM_LLM_ATTRIBUTES.costPricingSource]: 'env_override',
      [OM_LLM_ATTRIBUTES.promptSystemSha256]: 'not-a-hash',
      [OM_LLM_ATTRIBUTES.paramsDefaults]: 'true',
    })
    expect(metadata.source).toBe('gen_ai')
    expect(metadata.usage).toEqual({ inputTokens: 42 })
    expect(metadata.params).toEqual({})
    expect(metadata.finishReasons).toEqual(['length'])
    expect(metadata.fidelity).toBeUndefined()
    expect(metadata.pricingSource).toBe('env_override')
    expect(metadata.promptSystemSha256).toBeUndefined()
    expect(metadata.paramsDefaults).toBe(true)
  })

  it('accepts sha256 values with or without the sha256: prefix used by the run manifest', () => {
    const prefixed = `sha256:${systemHash}`
    const metadata = readLlmSpanMetadata({
      [OM_LLM_ATTRIBUTES.promptSystemSha256]: prefixed,
      [OM_LLM_ATTRIBUTES.toolsSha256]: toolsHash,
      [OM_LLM_ATTRIBUTES.contentRequestSha256]: `sha256:${'c'.repeat(63)}`,
    })
    expect(metadata.promptSystemSha256).toBe(prefixed)
    expect(metadata.toolsSha256).toBe(toolsHash)
    expect(metadata.contentRequestSha256).toBeUndefined()
  })

  it('prefers gen_ai usage over legacy keys and ignores unknown keys', () => {
    const metadata = readLlmSpanMetadata({
      inputTokens: 1,
      [GEN_AI_ATTRIBUTES.usageInputTokens]: 2,
      'gen_ai.something.new': 'x',
    })
    expect(metadata.usage.inputTokens).toBe(2)
    expect(metadata).not.toHaveProperty('gen_ai.something.new')
  })
})

describe('normalizeGenAiAttributes', () => {
  it('returns non-record input unchanged', () => {
    expect(normalizeGenAiAttributes(undefined)).toBeUndefined()
    expect(normalizeGenAiAttributes('text')).toBe('text')
    const list = [1]
    expect(normalizeGenAiAttributes(list)).toBe(list)
  })

  it('keeps a valid fully recorded span unchanged', () => {
    expect(normalizeGenAiAttributes(fullAttributes())).toEqual(fullAttributes())
  })

  it('drops wrongly typed vocabulary values and keeps unknown keys untouched', () => {
    const normalized = normalizeGenAiAttributes({
      [GEN_AI_ATTRIBUTES.requestTemperature]: 'hot',
      [GEN_AI_ATTRIBUTES.providerName]: 42,
      [OM_LLM_ATTRIBUTES.contentStatus]: 'unknown_status',
      [GEN_AI_ATTRIBUTES.requestMaxTokens]: '256',
      'gen_ai.vendor.extra': { nested: true },
      customKey: 'kept',
    })
    expect(normalized).toEqual({
      [GEN_AI_ATTRIBUTES.requestMaxTokens]: 256,
      'gen_ai.vendor.extra': { nested: true },
      customKey: 'kept',
    })
  })

  it('backfills legacy keys from gen_ai usage and finish reasons', () => {
    const normalized = normalizeGenAiAttributes({
      [GEN_AI_ATTRIBUTES.usageInputTokens]: 9,
      [GEN_AI_ATTRIBUTES.usageOutputTokens]: 4,
      [GEN_AI_ATTRIBUTES.responseFinishReasons]: ['stop', 'length'],
    })
    expect(normalized).toMatchObject({ inputTokens: 9, outputTokens: 4, finishReason: 'stop' })
  })

  it('backfills gen_ai keys from legacy keys', () => {
    const normalized = normalizeGenAiAttributes({ inputTokens: 7, outputTokens: 3, finishReason: 'stop' })
    expect(normalized).toEqual({
      inputTokens: 7,
      outputTokens: 3,
      finishReason: 'stop',
      [GEN_AI_ATTRIBUTES.usageInputTokens]: 7,
      [GEN_AI_ATTRIBUTES.usageOutputTokens]: 3,
      [GEN_AI_ATTRIBUTES.responseFinishReasons]: ['stop'],
    })
  })

  it('does not overwrite present legacy keys', () => {
    const normalized = normalizeGenAiAttributes({ inputTokens: 1, [GEN_AI_ATTRIBUTES.usageInputTokens]: 2 })
    expect(normalized).toEqual({ inputTokens: 1, [GEN_AI_ATTRIBUTES.usageInputTokens]: 2 })
  })

  it('wraps a single finish reason string and caps stop sequences', () => {
    const longSequences = Array.from({ length: 15 }, (_, index) => `${index}`.padEnd(250, 'x'))
    const normalized = normalizeGenAiAttributes({
      [GEN_AI_ATTRIBUTES.responseFinishReasons]: 'stop',
      [GEN_AI_ATTRIBUTES.requestStopSequences]: longSequences,
    })
    expect(normalized[GEN_AI_ATTRIBUTES.responseFinishReasons]).toEqual(['stop'])
    const stopSequences = normalized[GEN_AI_ATTRIBUTES.requestStopSequences] as string[]
    expect(stopSequences).toHaveLength(STOP_SEQUENCES_MAX_COUNT)
    expect(stopSequences.every((sequence) => sequence.length === STOP_SEQUENCE_MAX_CHARS)).toBe(true)
  })

  it('never throws on hostile input', () => {
    const hostile = {}
    Object.defineProperty(hostile, GEN_AI_ATTRIBUTES.usageInputTokens, {
      enumerable: true,
      get() {
        throw new Error('[internal] boom')
      },
    })
    expect(() => normalizeGenAiAttributes(hostile)).not.toThrow()
    expect(() => readLlmSpanMetadata(hostile)).not.toThrow()
    expect(readLlmSpanMetadata(hostile).source).toBe('none')
  })
})

describe('hasGenAiVocabularyKey', () => {
  it('detects any typed gen_ai or om key, valid or not', () => {
    expect(hasGenAiVocabularyKey({ [GEN_AI_ATTRIBUTES.usageInputTokens]: 'bad' })).toBe(true)
    expect(hasGenAiVocabularyKey({ [OM_LLM_ATTRIBUTES.captureFidelity]: 'exact' })).toBe(true)
  })

  it('is false for legacy-only, unknown-key and non-record attributes', () => {
    expect(hasGenAiVocabularyKey({ inputTokens: 1, finishReason: 'stop', 'vendor.key': 1 })).toBe(false)
    expect(hasGenAiVocabularyKey(null)).toBe(false)
    expect(hasGenAiVocabularyKey(['gen_ai.request.model'])).toBe(false)
  })
})
