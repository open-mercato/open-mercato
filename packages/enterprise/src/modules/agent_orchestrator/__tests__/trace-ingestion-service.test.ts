import type { EntityManager } from '@mikro-orm/postgresql'
import { ingestTrace } from '../lib/trace/traceIngestionService'
import { AgentRun, AgentSpan, AgentToolCall } from '../data/entities'

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
    output: { kind: 'informative', data: { ok: true } },
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
    expect(run.output).toEqual({ kind: 'informative', data: { ok: true } })
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
