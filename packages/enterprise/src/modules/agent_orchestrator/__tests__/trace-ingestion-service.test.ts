import type { EntityManager } from '@mikro-orm/postgresql'
import { ingestTrace } from '../lib/trace/traceIngestionService'
import { AgentRun, AgentSpan, AgentToolCall } from '../data/entities'
import {
  GEN_AI_ATTRIBUTES,
  OM_LLM_ATTRIBUTES,
  normalizeGenAiAttributes,
} from '../lib/trace/genAiAttributes'

/**
 * Minimal in-memory EntityManager fake covering the surface ingestTrace uses
 * (findOne/find/create/persist/flush). Idempotency, out-of-order parent linking,
 * and tool-call-once are properties of ingestTrace's own logic, so a fake EM
 * exercises them without a DB; the DB-backed E2E lives in the integration suite.
 */
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
  return { em: em as unknown as EntityManager, stores, storeFor }
}

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }

function basePayload() {
  return {
    runtime: 'in-process',
    externalRunId: 'run-ext-1',
    agentId: 'deals.health_check',
    status: 'ok' as const,
    output: { kind: 'research', data: { ok: true } },
    spans: [
      {
        externalSpanId: 'span-root',
        sequence: 0,
        name: 'root',
        kind: 'system' as const,
        startedAt: '2026-06-23T00:00:00.000Z',
        toolCalls: [{ toolName: 'load_skill', status: 'ok' as const }],
      },
      {
        externalSpanId: 'span-child',
        parentExternalSpanId: 'span-root',
        sequence: 1,
        name: 'llm-call',
        kind: 'llm' as const,
        startedAt: '2026-06-23T00:00:01.000Z',
      },
    ],
  }
}

describe('ingestTrace', () => {
  it('creates the run, spans, and tool-calls on first ingest', async () => {
    const { em, storeFor } = createFakeEm()
    const result = await ingestTrace(em, SCOPE, basePayload())

    expect(result.created).toBe(true)
    expect(result.spansAppended).toBe(2)
    expect(result.toolCallsAppended).toBe(1)
    expect(storeFor(AgentRun)).toHaveLength(1)
    expect(storeFor(AgentSpan)).toHaveLength(2)
    expect(storeFor(AgentToolCall)).toHaveLength(1)
  })

  it('defaults a created run input to {} when the payload omits it (agent_runs.input is NOT NULL)', async () => {
    const { em, storeFor } = createFakeEm()
    const payload = basePayload()
    expect('input' in payload).toBe(false)
    await ingestTrace(em, SCOPE, payload)

    const run = storeFor(AgentRun)[0]
    expect(run.input).not.toBeNull()
    expect(run.input).toEqual({})
  })

  it('is idempotent on (runtime, externalRunId): re-ingest appends nothing new', async () => {
    const { em, storeFor } = createFakeEm()
    await ingestTrace(em, SCOPE, basePayload())
    const second = await ingestTrace(em, SCOPE, basePayload())

    expect(second.created).toBe(false)
    expect(second.spansAppended).toBe(0)
    expect(second.toolCallsAppended).toBe(0)
    expect(storeFor(AgentRun)).toHaveLength(1)
    expect(storeFor(AgentSpan)).toHaveLength(2)
    expect(storeFor(AgentToolCall)).toHaveLength(1)
  })

  it('links a child span to its parent regardless of arrival order', async () => {
    const { em, storeFor } = createFakeEm()
    const payload = basePayload()
    // Child arrives before its parent in the array.
    payload.spans = [payload.spans[1], payload.spans[0]]
    await ingestTrace(em, SCOPE, payload)

    const spans = storeFor(AgentSpan)
    const root = spans.find((s) => s.externalSpanId === 'span-root')!
    const child = spans.find((s) => s.externalSpanId === 'span-child')!
    expect(child.parentSpanId).toBe(root.id)
    expect(root.parentSpanId == null).toBe(true)
  })

  it('appends a late span on re-ingest without duplicating existing spans', async () => {
    const { em, storeFor } = createFakeEm()
    await ingestTrace(em, SCOPE, basePayload())

    const withExtraSpan = basePayload()
    withExtraSpan.spans.push({
      externalSpanId: 'span-late',
      sequence: 2,
      name: 'late',
      kind: 'tool' as const,
      startedAt: '2026-06-23T00:00:02.000Z',
    })
    const result = await ingestTrace(em, SCOPE, withExtraSpan)

    expect(result.created).toBe(false)
    expect(result.spansAppended).toBe(1)
    expect(storeFor(AgentSpan)).toHaveLength(3)
  })
})

describe('ingestTrace — forensic completed_at (null-only)', () => {
  it('sets completed_at from the newest span end for a terminal run', async () => {
    const { em, storeFor } = createFakeEm()
    const payload = basePayload()
    payload.spans[0] = { ...payload.spans[0], endedAt: '2026-06-23T00:00:03.000Z' }
    payload.spans[1] = { ...payload.spans[1], endedAt: '2026-06-23T00:00:05.500Z' }
    await ingestTrace(em, SCOPE, payload)

    const run = storeFor(AgentRun)[0]
    expect(run.completedAt).toEqual(new Date('2026-06-23T00:00:05.500Z'))
  })

  it('never overwrites a non-null completed_at on re-ingest', async () => {
    const { em, storeFor } = createFakeEm()
    const payload = basePayload()
    payload.spans[1] = { ...payload.spans[1], endedAt: '2026-06-23T00:00:05.500Z' }
    await ingestTrace(em, SCOPE, payload)
    const run = storeFor(AgentRun)[0]
    const stamped = run.completedAt

    const later = basePayload()
    later.spans.push({
      externalSpanId: 'span-much-later',
      sequence: 2,
      name: 'late',
      kind: 'tool' as const,
      startedAt: '2026-06-24T00:00:00.000Z',
      endedAt: '2026-06-24T00:00:09.000Z',
    })
    await ingestTrace(em, SCOPE, later)
    expect(run.completedAt).toBe(stamped)
  })

  it('leaves completed_at null for a running run and when no span carries an end time', async () => {
    const { em, storeFor } = createFakeEm()
    const running = { ...basePayload(), status: 'running' as const }
    running.spans[1] = { ...running.spans[1], endedAt: '2026-06-23T00:00:05.500Z' }
    await ingestTrace(em, SCOPE, running)
    expect(storeFor(AgentRun)[0].completedAt ?? null).toBeNull()

    const noEnds = { ...basePayload(), externalRunId: 'run-ext-2' }
    await ingestTrace(em, SCOPE, noEnds)
    const second = storeFor(AgentRun).find((row) => row.externalRunId === 'run-ext-2')!
    expect(second.completedAt ?? null).toBeNull()
  })
})

describe('ingestTrace — artifact offload (F1)', () => {
  const bigOutput = { note: 'x'.repeat(5000) }

  it('offloads a large output and stamps the key + redacted inline summary', async () => {
    const { em, storeFor } = createFakeEm()
    const seen: Array<{ field: string; value: unknown }> = []
    const offloadArtifact = jest.fn(async (ref: { field: string }, value: unknown) => {
      seen.push({ field: ref.field, value })
      return 'artifact-key-1'
    })
    const payload = { ...basePayload(), output: bigOutput }

    await ingestTrace(em, SCOPE, payload, { offloadArtifact })

    const run = storeFor(AgentRun)[0]
    expect(run.outputArtifactKey).toBe('artifact-key-1')
    expect((run.output as { _truncated?: boolean })._truncated).toBe(true)
    expect((run.output as { offloaded?: boolean }).offloaded).toBe(true)
    expect(offloadArtifact).toHaveBeenCalledTimes(1)
    expect(seen[0].field).toBe('output')
    expect(seen[0].value).toEqual(bigOutput)
  })

  it('does not offload an output within the inline cap', async () => {
    const { em, storeFor } = createFakeEm()
    const offloadArtifact = jest.fn(async () => 'unused')

    await ingestTrace(em, SCOPE, basePayload(), { offloadArtifact })

    const run = storeFor(AgentRun)[0]
    expect(run.outputArtifactKey).toBeNull()
    expect(run.output).toEqual({ kind: 'research', data: { ok: true } })
    expect(offloadArtifact).not.toHaveBeenCalled()
  })

  it('degrades to inline-only and still succeeds when the offloader returns null', async () => {
    const { em, storeFor } = createFakeEm()
    const offloadArtifact = jest.fn(async () => null)
    const payload = { ...basePayload(), output: bigOutput }

    const result = await ingestTrace(em, SCOPE, payload, { offloadArtifact })

    const run = storeFor(AgentRun)[0]
    expect(result.created).toBe(true)
    expect(run.outputArtifactKey).toBeNull()
    expect((run.output as { _truncated?: boolean })._truncated).toBe(true)
    expect((run.output as { offloaded?: boolean }).offloaded).toBe(false)
  })

  it('offloads large tool-call request/response under their own encryption fields', async () => {
    const { em, storeFor } = createFakeEm()
    let seq = 0
    const offloadArtifact = jest.fn(async (ref: { field: string }) => `key-${ref.field}-${++seq}`)
    const payload = {
      ...basePayload(),
      spans: [
        {
          externalSpanId: 'span-tool',
          sequence: 0,
          name: 'search',
          kind: 'tool' as const,
          startedAt: '2026-06-23T00:00:00.000Z',
          toolCalls: [
            {
              toolName: 'search',
              status: 'ok' as const,
              requestSummary: { q: 'y'.repeat(5000) },
              responseSummary: { r: 'z'.repeat(5000) },
            },
          ],
        },
      ],
    }

    await ingestTrace(em, SCOPE, payload, { offloadArtifact })

    const toolCall = storeFor(AgentToolCall)[0]
    expect(toolCall.requestArtifactKey).toBe('key-request_summary-1')
    expect(toolCall.responseArtifactKey).toBe('key-response_summary-2')
    expect((toolCall.requestSummary as { _truncated?: boolean })._truncated).toBe(true)
  })

  it('offloads nothing when no offloader is supplied (back-compat path)', async () => {
    const { em, storeFor } = createFakeEm()
    const payload = { ...basePayload(), output: bigOutput }

    await ingestTrace(em, SCOPE, payload)

    const run = storeFor(AgentRun)[0]
    expect(run.outputArtifactKey).toBeNull()
    expect((run.output as { _truncated?: boolean })._truncated).toBe(true)
    expect((run.output as { offloaded?: boolean }).offloaded).toBe(false)
  })
})

describe('ingestTrace — estimated cost (null-only, data-honesty §3.2)', () => {
  it('computes cost from tokens + a priced model when cost is absent', async () => {
    const { em, storeFor } = createFakeEm()
    const payload = {
      ...basePayload(),
      model: 'gpt-5-mini',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    }
    await ingestTrace(em, SCOPE, payload)
    const run = storeFor(AgentRun)[0]
    // gpt-5-mini defaults: 0.25 + 2 USD per 1M → 225 cents.
    expect(run.costMinor).toBe(225)
    expect(run.currency).toBe('USD')
  })

  it('never overwrites a non-null cost (envelope-supplied or runner-stamped)', async () => {
    const { em, storeFor } = createFakeEm()
    const payload = {
      ...basePayload(),
      model: 'gpt-5-mini',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      costMinor: 999,
      currency: 'EUR',
    }
    await ingestTrace(em, SCOPE, payload)
    const run = storeFor(AgentRun)[0]
    expect(run.costMinor).toBe(999)
    expect(run.currency).toBe('EUR')

    // Re-ingest without cost fields: the stored cost must survive.
    await ingestTrace(em, SCOPE, {
      ...basePayload(),
      model: 'gpt-5-mini',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    })
    expect(run.costMinor).toBe(999)
    expect(run.currency).toBe('EUR')
  })

  it('leaves cost null for an unknown or absent model', async () => {
    const { em, storeFor } = createFakeEm()
    await ingestTrace(em, SCOPE, {
      ...basePayload(),
      model: 'mystery-model-9000',
      inputTokens: 500,
      outputTokens: 500,
    })
    const withUnknownModel = storeFor(AgentRun)[0]
    expect(withUnknownModel.costMinor ?? null).toBeNull()

    const second = createFakeEm()
    await ingestTrace(second.em, SCOPE, { ...basePayload(), inputTokens: 500, outputTokens: 500 })
    const withoutModel = second.storeFor(AgentRun)[0]
    expect(withoutModel.costMinor ?? null).toBeNull()
  })
})

describe('ingestTrace — gen_ai attribute normalization on llm spans', () => {
  function payloadWithSpan(kind: 'llm' | 'tool' | 'system', attributes: Record<string, unknown>) {
    return {
      runtime: 'external',
      externalRunId: `run-gen-ai-${kind}`,
      agentId: 'deals.health_check',
      status: 'ok' as const,
      spans: [
        {
          externalSpanId: 'span-1',
          sequence: 0,
          name: 'chat gpt-5-mini',
          kind,
          startedAt: '2026-06-23T00:00:00.000Z',
          attributes,
        },
      ],
    }
  }

  async function ingestSpanAttributes(kind: 'llm' | 'tool' | 'system', attributes: Record<string, unknown>) {
    const { em, storeFor } = createFakeEm()
    await ingestTrace(em, SCOPE, payloadWithSpan(kind, attributes))
    return storeFor(AgentSpan)[0].attributes as Record<string, unknown>
  }

  it('backfills legacy keys when an external adapter sends only gen_ai keys', async () => {
    const stored = await ingestSpanAttributes('llm', {
      [GEN_AI_ATTRIBUTES.requestModel]: 'gpt-5-mini',
      [GEN_AI_ATTRIBUTES.usageInputTokens]: 120,
      [GEN_AI_ATTRIBUTES.usageOutputTokens]: '45',
      [GEN_AI_ATTRIBUTES.responseFinishReasons]: ['stop'],
    })

    expect(stored).toEqual({
      [GEN_AI_ATTRIBUTES.requestModel]: 'gpt-5-mini',
      [GEN_AI_ATTRIBUTES.usageInputTokens]: 120,
      [GEN_AI_ATTRIBUTES.usageOutputTokens]: 45,
      [GEN_AI_ATTRIBUTES.responseFinishReasons]: ['stop'],
      inputTokens: 120,
      outputTokens: 45,
      finishReason: 'stop',
    })
  })

  it('drops a wrong-typed gen_ai value and keeps unknown keys', async () => {
    const stored = await ingestSpanAttributes('llm', {
      [GEN_AI_ATTRIBUTES.requestTemperature]: 'warm',
      [GEN_AI_ATTRIBUTES.usageInputTokens]: -3,
      [OM_LLM_ATTRIBUTES.captureFidelity]: 'guessed',
      [GEN_AI_ATTRIBUTES.providerName]: 'openai',
      'vendor.custom': { nested: true },
    })

    expect(stored).toEqual({
      [GEN_AI_ATTRIBUTES.providerName]: 'openai',
      'vendor.custom': { nested: true },
    })
  })

  it('stores a legacy-only llm span exactly as sent', async () => {
    const attributes = { inputTokens: 60, outputTokens: 30, finishReason: 'stop' }

    expect(await ingestSpanAttributes('llm', attributes)).toEqual(attributes)
  })

  it('leaves non-llm span attributes untouched', async () => {
    const attributes = {
      [GEN_AI_ATTRIBUTES.usageInputTokens]: 'not-a-number',
      [GEN_AI_ATTRIBUTES.responseFinishReasons]: ['stop'],
    }

    expect(await ingestSpanAttributes('tool', attributes)).toEqual(attributes)
    expect(await ingestSpanAttributes('system', attributes)).toEqual(attributes)
  })

  it('is a no-op on native-shaped attributes that are already normalized', async () => {
    const hash = `sha256:${'ab'.repeat(32)}`
    const nativeAttributes = {
      inputTokens: 100,
      outputTokens: 20,
      finishReason: 'tool-calls',
      [GEN_AI_ATTRIBUTES.operationName]: 'chat',
      [GEN_AI_ATTRIBUTES.outputType]: 'json',
      [GEN_AI_ATTRIBUTES.providerName]: 'openai',
      [GEN_AI_ATTRIBUTES.requestModel]: 'gpt-5-mini',
      [GEN_AI_ATTRIBUTES.responseModel]: 'gpt-5-mini',
      [GEN_AI_ATTRIBUTES.responseId]: 'resp_1',
      [GEN_AI_ATTRIBUTES.requestTemperature]: 0.2,
      [GEN_AI_ATTRIBUTES.requestMaxTokens]: 512,
      [GEN_AI_ATTRIBUTES.requestStopSequences]: ['END'],
      [GEN_AI_ATTRIBUTES.responseFinishReasons]: ['tool-calls'],
      [GEN_AI_ATTRIBUTES.usageInputTokens]: 100,
      [GEN_AI_ATTRIBUTES.usageOutputTokens]: 20,
      [GEN_AI_ATTRIBUTES.usageCacheReadInputTokens]: 40,
      [GEN_AI_ATTRIBUTES.usageReasoningOutputTokens]: 5,
      [OM_LLM_ATTRIBUTES.latencyMs]: 480,
      [OM_LLM_ATTRIBUTES.costMicros]: 65,
      [OM_LLM_ATTRIBUTES.costCurrency]: 'USD',
      [OM_LLM_ATTRIBUTES.costPricingSource]: 'default',
      [OM_LLM_ATTRIBUTES.promptSystemSha256]: hash,
      [OM_LLM_ATTRIBUTES.toolsSha256]: hash,
      [OM_LLM_ATTRIBUTES.toolsCount]: 3,
      [OM_LLM_ATTRIBUTES.messagesCount]: 2,
      [OM_LLM_ATTRIBUTES.contentRequestSha256]: hash,
      [OM_LLM_ATTRIBUTES.contentRequestBytes]: 2048,
      [OM_LLM_ATTRIBUTES.contentResponseSha256]: hash.slice('sha256:'.length),
      [OM_LLM_ATTRIBUTES.contentResponseBytes]: 256,
      [OM_LLM_ATTRIBUTES.contentStatus]: 'disabled',
      [OM_LLM_ATTRIBUTES.captureFidelity]: 'exact',
    }

    const stored = await ingestSpanAttributes('llm', nativeAttributes)

    expect(stored).toEqual(nativeAttributes)
    expect(normalizeGenAiAttributes(stored)).toEqual(stored)
  })
})
