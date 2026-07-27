import type { EntityManager } from '@mikro-orm/postgresql'
import {
  buildNativeTracePayload,
  captureNativeRunTrace,
  isNativeTraceCaptureEnabled,
  type NativeStepRecord,
} from '../lib/runtime/nativeTraceCapture'
import { ingestTrace } from '../lib/trace/traceIngestionService'
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
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const container = {
        resolve: () => {
          throw new Error('[internal] no em')
        },
      }
      await expect(
        captureNativeRunTrace(container, { tenantId: 't1', organizationId: 'o1' }, baseInput()),
      ).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
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
