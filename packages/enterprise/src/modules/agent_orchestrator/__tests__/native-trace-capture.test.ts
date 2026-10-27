import type { EntityManager } from '@mikro-orm/postgresql'
import {
  buildNativeStepRecord,
  buildNativeTracePayload,
  captureNativeRunTrace,
  isNativeTraceCaptureEnabled,
  type NativeStepRecord,
} from '../lib/runtime/nativeTraceCapture'
import { ingestTrace } from '../lib/trace/traceIngestionService'
import type { NativeModelCallRecord } from '../lib/runtime/nativeModelCallRecorder'
import {
  GEN_AI_ATTRIBUTES,
  OM_LLM_ATTRIBUTES,
  STOP_SEQUENCES_MAX_COUNT,
  STOP_SEQUENCE_MAX_CHARS,
  readLlmSpanMetadata,
} from '../lib/trace/genAiAttributes'
import { computeManifestSha256 } from '../lib/trace/runManifest'
import { captureLogs } from './support/captureLogs'
import { AgentRun, AgentSpan, AgentToolCall } from '../data/entities'

/** Same in-memory EM fake as trace-ingestion-service.test.ts — deterministic, no DB. */
function createFakeEm() {
  const stores = new Map<unknown, Array<Record<string, unknown>>>()
  const pending: Array<Record<string, unknown>> = []
  let idSeq = 0

  function storeFor(entity: unknown): Array<Record<string, unknown>> {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity)!
  }
  function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => row[key] === value)
  }

  const em = {
    create(entity: unknown, data: Record<string, unknown>) {
      const row: Record<string, unknown> = { ...data }
      ;(row as { __entity?: unknown }).__entity = entity
      return row
    },
    persist(row: Record<string, unknown>) {
      pending.push(row)
      return em
    },
    async flush() {
      for (const row of pending.splice(0)) {
        if (!row.id) row.id = `id-${++idSeq}`
        const entity = (row as { __entity?: unknown }).__entity
        const store = storeFor(entity)
        if (!store.includes(row)) store.push(row)
      }
    },
    async findOne(entity: unknown, where: Record<string, unknown>) {
      return storeFor(entity).find((row) => matches(row, where)) ?? null
    },
    async find(entity: unknown, where: Record<string, unknown>, _opts?: unknown) {
      return storeFor(entity).filter((row) => matches(row, where))
    },
  }
  return { em: em as unknown as EntityManager, storeFor }
}

const RUN_ID = '018f6f2a-0000-4000-8000-000000000001'
const T0 = Date.parse('2026-07-12T10:00:00.000Z')

const TWO_STEPS: NativeStepRecord[] = [
  {
    modelId: 'gpt-5-mini',
    finishReason: 'tool-calls',
    usage: { inputTokens: 100, outputTokens: 20 },
    toolCalls: [
      { toolName: 'customers.get_deal', args: { id: 'd1' }, result: { ok: true }, durationMs: 40 },
    ],
    endedAtMs: T0 + 500,
  },
  {
    modelId: 'gpt-5-mini',
    finishReason: 'stop',
    usage: { inputTokens: 60, outputTokens: 30 },
    toolCalls: [],
    endedAtMs: T0 + 900,
  },
]

function baseInput() {
  return {
    runId: RUN_ID,
    agentId: 'deals.health_check',
    steps: TWO_STEPS,
    startedAtMs: T0,
    endedAtMs: T0 + 950,
  }
}

afterEach(() => {
  delete process.env.OM_AGENT_TRACE_CAPTURE
  delete process.env.OM_AGENT_MODEL_PRICING
})

function buildCall(overrides: Partial<NativeModelCallRecord> = {}): NativeModelCallRecord {
  return {
    callId: 'call-0',
    stepNumber: 0,
    provider: 'openai',
    requestModel: 'gpt-5-mini',
    responseModel: 'gpt-5-mini',
    responseId: 'resp_1',
    finishReason: 'tool-calls',
    usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 40, reasoningTokens: 5 },
    callSettings: { temperature: 0.2, maxOutputTokens: 512, stopSequences: ['END'] },
    hasProviderOptions: true,
    latencyMs: 480,
    startedAtMs: T0,
    endedAtMs: T0 + 480,
    fidelity: 'exact',
    requestSha256: computeManifestSha256('request'),
    requestBytes: 2048,
    responseSha256: computeManifestSha256('response'),
    responseBytes: 256,
    systemSha256: computeManifestSha256('system'),
    toolsSha256: computeManifestSha256('tools'),
    toolCount: 3,
    messageCount: 2,
    ...overrides,
  }
}

function stepsWithCall(call: NativeModelCallRecord): NativeStepRecord[] {
  return [{ ...TWO_STEPS[0], call }, TWO_STEPS[1]]
}

describe('buildNativeTracePayload llm span metadata', () => {
  it('writes legacy, gen_ai and om keys for a step with a call record and reads them back', () => {
    const call = buildCall()
    const payload = buildNativeTracePayload({ ...baseInput(), steps: stepsWithCall(call) })
    const [stepSpan, , secondStep] = payload.spans ?? []
    const attributes = stepSpan.attributes as Record<string, unknown>

    expect(attributes).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
      finishReason: 'tool-calls',
      [GEN_AI_ATTRIBUTES.operationName]: 'chat',
      [GEN_AI_ATTRIBUTES.outputType]: 'json',
      [GEN_AI_ATTRIBUTES.providerName]: 'openai',
      [GEN_AI_ATTRIBUTES.requestTemperature]: 0.2,
      [GEN_AI_ATTRIBUTES.requestMaxTokens]: 512,
      [GEN_AI_ATTRIBUTES.requestStopSequences]: ['END'],
      [GEN_AI_ATTRIBUTES.responseFinishReasons]: ['tool-calls'],
      [OM_LLM_ATTRIBUTES.costMicros]: 65,
      [OM_LLM_ATTRIBUTES.costCurrency]: 'USD',
      [OM_LLM_ATTRIBUTES.costPricingSource]: 'default',
      [OM_LLM_ATTRIBUTES.contentStatus]: 'disabled',
      [OM_LLM_ATTRIBUTES.captureFidelity]: 'exact',
    })
    expect(attributes[GEN_AI_ATTRIBUTES.requestTopP]).toBeUndefined()
    expect(attributes[OM_LLM_ATTRIBUTES.paramsDefaults]).toBeUndefined()
    expect(JSON.stringify(attributes)).not.toContain('providerOptions')

    expect(readLlmSpanMetadata(attributes)).toEqual({
      source: 'gen_ai',
      operationName: 'chat',
      providerName: 'openai',
      requestModel: 'gpt-5-mini',
      responseModel: 'gpt-5-mini',
      responseId: 'resp_1',
      outputType: 'json',
      params: { temperature: 0.2, maxTokens: 512, stopSequences: ['END'] },
      usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 40, reasoningTokens: 5 },
      finishReasons: ['tool-calls'],
      latencyMs: 480,
      costMicros: 65,
      costCurrency: 'USD',
      pricingSource: 'default',
      promptSystemSha256: call.systemSha256,
      toolsSha256: call.toolsSha256,
      toolsCount: 3,
      messagesCount: 2,
      contentRequestSha256: call.requestSha256,
      contentRequestBytes: 2048,
      contentResponseSha256: call.responseSha256,
      contentResponseBytes: 256,
      contentStatus: 'disabled',
      fidelity: 'exact',
    })

    expect(secondStep.attributes).toEqual({ inputTokens: 60, outputTokens: 30, finishReason: 'stop' })
  })

  it('marks provider defaults and an unknown price when no params were sent and the model has no price', () => {
    const payload = buildNativeTracePayload({
      ...baseInput(),
      steps: stepsWithCall(
        buildCall({ callSettings: {}, requestModel: 'local-model', responseModel: null, responseId: null }),
      ),
    })
    const attributes = (payload.spans ?? [])[0].attributes as Record<string, unknown>
    expect(attributes[OM_LLM_ATTRIBUTES.paramsDefaults]).toBe(true)
    expect(attributes[OM_LLM_ATTRIBUTES.costPricingSource]).toBe('unknown')
    expect(attributes[OM_LLM_ATTRIBUTES.costMicros]).toBeUndefined()
    expect(attributes[GEN_AI_ATTRIBUTES.responseModel]).toBeUndefined()
    expect(attributes[GEN_AI_ATTRIBUTES.responseId]).toBeUndefined()
    expect(attributes[GEN_AI_ATTRIBUTES.requestModel]).toBe('local-model')
  })

  it('keeps exactly the legacy attributes when the capture level is off', () => {
    const payload = buildNativeTracePayload({
      ...baseInput(),
      steps: stepsWithCall(buildCall()),
      captureLevel: 'off',
    })
    expect((payload.spans ?? [])[0].attributes).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      finishReason: 'tool-calls',
    })
  })

  it('treats full as metadata with content disabled in this release', () => {
    const payload = buildNativeTracePayload({
      ...baseInput(),
      steps: stepsWithCall(buildCall()),
      captureLevel: 'full',
    })
    const attributes = (payload.spans ?? [])[0].attributes as Record<string, unknown>
    expect(attributes[OM_LLM_ATTRIBUTES.contentStatus]).toBe('disabled')
    expect(attributes[OM_LLM_ATTRIBUTES.contentRequestKey]).toBeUndefined()
  })

  it('writes the fallback call onto the synthetic span of a toolless run', () => {
    const payload = buildNativeTracePayload({
      ...baseInput(),
      steps: [],
      fallbackUsage: { inputTokens: 42, outputTokens: 7 },
      fallbackModel: 'claude-haiku-4-5',
      fallbackCall: buildCall({
        requestModel: 'claude-haiku-4-5',
        responseModel: null,
        provider: 'anthropic',
        finishReason: 'stop',
        usage: { inputTokens: 42, outputTokens: 7 },
        fidelity: 'reconstructed',
      }),
    })
    const spans = payload.spans ?? []
    expect(spans).toHaveLength(1)
    expect(spans[0].attributes).toMatchObject({
      inputTokens: 42,
      outputTokens: 7,
      [GEN_AI_ATTRIBUTES.providerName]: 'anthropic',
      [GEN_AI_ATTRIBUTES.responseFinishReasons]: ['stop'],
      [OM_LLM_ATTRIBUTES.costMicros]: 77,
      [OM_LLM_ATTRIBUTES.captureFidelity]: 'reconstructed',
    })
  })

  it('caps stop sequences and keeps the span attributes under the ingest cap', () => {
    const longStops = Array.from({ length: 40 }, (_, index) => `${index}`.padEnd(500, 'x'))
    const payload = buildNativeTracePayload({
      ...baseInput(),
      steps: stepsWithCall(buildCall({ callSettings: { stopSequences: longStops } })),
    })
    const attributes = (payload.spans ?? [])[0].attributes as Record<string, unknown>
    const stops = attributes[GEN_AI_ATTRIBUTES.requestStopSequences] as string[]
    expect(stops).toHaveLength(STOP_SEQUENCES_MAX_COUNT)
    expect(stops.every((stop) => stop.length === STOP_SEQUENCE_MAX_CHARS)).toBe(true)
    expect(JSON.stringify(attributes).length).toBeLessThanOrEqual(4000)
  })

  it('drops metadata rather than exceeding the ingest cap', () => {
    const payload = buildNativeTracePayload({
      ...baseInput(),
      steps: stepsWithCall(buildCall({ responseId: 'r'.repeat(5000) })),
    })
    expect((payload.spans ?? [])[0].attributes).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      finishReason: 'tool-calls',
    })
  })
})

describe('buildNativeTracePayload', () => {
  it('maps steps to llm spans and tool calls to child tool spans with deterministic ids', () => {
    const payload = buildNativeTracePayload(baseInput())

    expect(payload.runtime).toBe('native')
    expect(payload.externalRunId).toBe(RUN_ID)
    expect(payload.agentId).toBe('deals.health_check')
    expect(payload.model).toBe('gpt-5-mini')
    expect(payload.inputTokens).toBe(160)
    expect(payload.outputTokens).toBe(50)
    expect(payload.latencyMs).toBe(950)
    // Spans-only envelope: never regress the settled run's state (spec H2).
    expect(payload.status).toBeUndefined()
    expect(payload.output).toBeUndefined()

    const spans = payload.spans ?? []
    expect(spans).toHaveLength(3)
    expect(spans.map((span) => span.externalSpanId)).toEqual([
      `${RUN_ID}:0`,
      `${RUN_ID}:0:0`,
      `${RUN_ID}:1`,
    ])
    expect(spans.map((span) => span.sequence)).toEqual([0, 1, 2])

    const [stepSpan, toolSpan, secondStep] = spans
    expect(stepSpan.kind).toBe('llm')
    expect(stepSpan.name).toBe('llm:gpt-5-mini')
    expect(stepSpan.attributes).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      finishReason: 'tool-calls',
    })
    expect(stepSpan.durationMs).toBe(500)

    expect(toolSpan.kind).toBe('tool')
    expect(toolSpan.parentExternalSpanId).toBe(`${RUN_ID}:0`)
    expect(toolSpan.toolCalls).toEqual([
      {
        toolName: 'customers.get_deal',
        requestSummary: { id: 'd1' },
        responseSummary: { ok: true },
        status: 'ok',
        latencyMs: 40,
      },
    ])

    expect(secondStep.attributes).toEqual({
      inputTokens: 60,
      outputTokens: 30,
      finishReason: 'stop',
    })
  })

  it('marks failed tool calls as error spans with the error message', () => {
    const payload = buildNativeTracePayload({
      ...baseInput(),
      steps: [
        {
          ...TWO_STEPS[0],
          toolCalls: [
            {
              toolName: 'customers.get_deal',
              args: {},
              result: undefined,
              error: { code: 'boom', message: 'tool exploded' },
              durationMs: 10,
            },
          ],
        },
      ],
    })
    const toolSpan = (payload.spans ?? [])[1]
    expect(toolSpan.status).toBe('error')
    expect(toolSpan.toolCalls?.[0]).toMatchObject({ status: 'error', errorMessage: 'tool exploded' })
  })

  it('synthesizes one llm span for a toolless run (no step callbacks)', () => {
    const payload = buildNativeTracePayload({
      ...baseInput(),
      steps: [],
      fallbackUsage: { inputTokens: 42, outputTokens: 7 },
      fallbackModel: 'claude-haiku-4-5',
    })
    expect(payload.inputTokens).toBe(42)
    expect(payload.outputTokens).toBe(7)
    expect(payload.model).toBe('claude-haiku-4-5')
    const spans = payload.spans ?? []
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({
      externalSpanId: `${RUN_ID}:0`,
      kind: 'llm',
      durationMs: 950,
      attributes: { inputTokens: 42, outputTokens: 7 },
    })
  })
})

describe('buildNativeStepRecord', () => {
  const SDK7_STEP = {
    toolCalls: [
      { type: 'tool-call', toolCallId: 'call-1', toolName: 'customers.get_deal', input: { id: 'd1' } },
      { type: 'tool-call', toolCallId: 'call-2', toolName: 'customers.list_people', input: { query: 'acme' } },
    ],
    toolResults: [
      { type: 'tool-result', toolCallId: 'call-1', toolName: 'customers.get_deal', input: { id: 'd1' }, output: { title: 'Big deal' } },
    ],
    content: [
      {
        type: 'tool-error',
        toolCallId: 'call-2',
        toolName: 'customers.list_people',
        input: { query: 'acme' },
        error: { name: 'ToolExecutionError', message: 'search backend down' },
      },
    ],
    finishReason: 'tool-calls',
    usage: { inputTokens: 11, outputTokens: 3 },
    response: { modelId: 'gpt-5-mini' },
  }

  it('reads AI SDK 7 tool inputs, outputs and tool-error parts', () => {
    const record = buildNativeStepRecord(SDK7_STEP, T0 + 100)
    expect(record).toMatchObject({
      modelId: 'gpt-5-mini',
      finishReason: 'tool-calls',
      usage: { inputTokens: 11, outputTokens: 3 },
      endedAtMs: T0 + 100,
    })
    expect(record.toolCalls).toEqual([
      { toolName: 'customers.get_deal', args: { id: 'd1' }, result: { title: 'Big deal' }, durationMs: 0 },
      {
        toolName: 'customers.list_people',
        args: { query: 'acme' },
        result: undefined,
        error: { code: 'ToolExecutionError', message: 'search backend down' },
        durationMs: 0,
      },
    ])
  })

  it('persists non-empty request/response summaries and the tool error in the trace payload', () => {
    const payload = buildNativeTracePayload({
      ...baseInput(),
      steps: [buildNativeStepRecord(SDK7_STEP, T0 + 100)],
    })
    const toolSpans = (payload.spans ?? []).filter((span) => span.kind === 'tool')
    expect(toolSpans).toHaveLength(2)
    expect(toolSpans[0].status).toBe('ok')
    expect(toolSpans[0].toolCalls?.[0]).toMatchObject({
      toolName: 'customers.get_deal',
      requestSummary: { id: 'd1' },
      responseSummary: { title: 'Big deal' },
      status: 'ok',
    })
    expect(toolSpans[1].status).toBe('error')
    expect(toolSpans[1].toolCalls?.[0]).toMatchObject({
      toolName: 'customers.list_people',
      requestSummary: { query: 'acme' },
      status: 'error',
      errorMessage: 'search backend down',
    })
  })

  it('keeps the legacy args/result/experimental_toToolResultError shape working', () => {
    const record = buildNativeStepRecord(
      {
        toolCalls: [
          {
            toolName: 'customers.get_deal',
            args: { id: 'd2' },
            result: { ok: false },
            experimental_toToolResultError: { code: 'denied', message: 'no access' },
            startTime: 1000,
            endTime: 1040,
          },
        ],
        finishReason: 'tool-calls',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      T0,
    )
    expect(record.modelId).toBe('unknown')
    expect(record.toolCalls).toEqual([
      {
        toolName: 'customers.get_deal',
        args: { id: 'd2' },
        result: { ok: false },
        error: { code: 'denied', message: 'no access' },
        durationMs: 40,
      },
    ])
  })
})

describe('ingest integration (idempotent upsert onto the stamped run)', () => {
  it('appends spans to the runner-created row and re-ingest appends nothing', async () => {
    const { em, storeFor } = createFakeEm()
    // The native runner creates the run with (runtime='native', externalRunId=id).
    storeFor(AgentRun).push({
      id: RUN_ID,
      tenantId: 't1',
      organizationId: 'o1',
      agentId: 'deals.health_check',
      status: 'ok',
      input: {},
      runtime: 'native',
      externalRunId: RUN_ID,
      __entity: AgentRun,
    })

    const payload = buildNativeTracePayload(baseInput())
    const scope = { tenantId: 't1', organizationId: 'o1' }

    const first = await ingestTrace(em, scope, payload)
    expect(first.created).toBe(false)
    expect(first.runId).toBe(RUN_ID)
    expect(first.spansAppended).toBe(3)
    expect(first.toolCallsAppended).toBe(1)
    // Run status untouched by the spans-only envelope.
    expect(storeFor(AgentRun)[0].status).toBe('ok')
    expect(storeFor(AgentRun)[0].inputTokens).toBe(160)

    const again = await ingestTrace(em, scope, payload)
    expect(again.created).toBe(false)
    expect(again.spansAppended).toBe(0)
    expect(again.toolCallsAppended).toBe(0)
    expect(storeFor(AgentSpan)).toHaveLength(3)
    expect(storeFor(AgentToolCall)).toHaveLength(1)
  })
})

describe('captureNativeRunTrace', () => {
  it('never throws when the EM explodes (best-effort)', async () => {
    const logs = captureLogs()
    try {
      const container = {
        resolve: () => {
          throw new Error('[internal] no em')
        },
      }
      await expect(
        captureNativeRunTrace(container, { tenantId: 't1', organizationId: 'o1' }, baseInput()),
      ).resolves.toBeUndefined()
      expect(logs.at('warn').map((record) => record.message)).toContain(
        'native trace capture failed for run',
      )
    } finally {
      logs.restore()
    }
  })

  it('OM_AGENT_TRACE_CAPTURE=off disables capture', async () => {
    process.env.OM_AGENT_TRACE_CAPTURE = 'off'
    expect(isNativeTraceCaptureEnabled()).toBe(false)
    const resolve = jest.fn()
    await captureNativeRunTrace(
      { resolve },
      { tenantId: 't1', organizationId: 'o1' },
      baseInput(),
    )
    expect(resolve).not.toHaveBeenCalled()
  })
})
