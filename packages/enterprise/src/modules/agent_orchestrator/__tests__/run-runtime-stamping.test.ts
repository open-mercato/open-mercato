import type { EntityManager } from '@mikro-orm/postgresql'
import { ingestTrace } from '../lib/trace/traceIngestionService'
import { AgentRun } from '../data/entities'

/**
 * F8 acceptance: the runners stamp `runtime`/`externalRunId` on the AgentRun at
 * creation, so a later trace ingest for the SAME `(runtime, externalRunId)`
 * upserts THAT row instead of creating a duplicate. The runners create the run
 * via the `agent_orchestrator.runs.create` command; here we model that command's
 * persisted effect (the `em.create(AgentRun, {...})` with the stamped key) and
 * then assert `ingestTrace` correlates to it.
 *
 * Reuses the same in-memory EntityManager fake shape as
 * `trace-ingestion-service.test.ts` so the test stays deterministic without DB
 * infra; correlation on `(runtime, externalRunId)` is a property of
 * `ingestTrace`'s own findOne, which the fake faithfully exercises.
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

/** Models what `agent_orchestrator.runs.create` persists for an opencode run. */
function stampRunAtCreation(
  storeFor: (entity: unknown) => Array<Record<string, unknown>>,
  fields: { runtime: string; externalRunId: string; agentId: string },
): string {
  const id = `run-${storeFor(AgentRun).length + 1}`
  storeFor(AgentRun).push({
    id,
    tenantId: SCOPE.tenantId,
    organizationId: SCOPE.organizationId,
    agentId: fields.agentId,
    status: 'running',
    input: { dealId: 'deal-1' },
    parentRunId: null,
    runtime: fields.runtime,
    externalRunId: fields.externalRunId,
    __entity: AgentRun,
  })
  return id
}

function tracePayload(runtime: string, externalRunId: string) {
  return {
    runtime,
    externalRunId,
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
      },
    ],
  }
}

describe('run runtime stamping → trace ingest correlation (F8)', () => {
  it('upserts the SAME run a runner stamped with (opencode, externalRunId) — no duplicate', async () => {
    const { em, storeFor } = createFakeEm()

    // The OpenCode runner stamps runtime='opencode' + the session id at creation.
    const externalRunId = 'ses_fake_1'
    const createdRunId = stampRunAtCreation(storeFor, {
      runtime: 'opencode',
      externalRunId,
      agentId: 'deals.health_check',
    })
    expect(storeFor(AgentRun)).toHaveLength(1)

    // A later trace POST for the SAME (runtime, externalRunId) must upsert it.
    const result = await ingestTrace(em, SCOPE, tracePayload('opencode', externalRunId))

    expect(result.created).toBe(false)
    expect(result.runId).toBe(createdRunId)
    expect(storeFor(AgentRun)).toHaveLength(1)

    const run = storeFor(AgentRun)[0]
    expect(run.runtime).toBe('opencode')
    expect(run.externalRunId).toBe(externalRunId)
    // Run-level fields from the trace were applied to the existing row.
    expect(run.status).toBe('ok')
  })

  it('creates a fresh run only when the (runtime, externalRunId) key does not match', async () => {
    const { em, storeFor } = createFakeEm()
    stampRunAtCreation(storeFor, {
      runtime: 'opencode',
      externalRunId: 'ses_one',
      agentId: 'deals.health_check',
    })

    const result = await ingestTrace(em, SCOPE, tracePayload('opencode', 'ses_two'))

    expect(result.created).toBe(true)
    expect(storeFor(AgentRun)).toHaveLength(2)
  })
})
