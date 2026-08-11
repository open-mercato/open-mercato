import type { EntityManager } from '@mikro-orm/postgresql'
import { AgentProcessDefinition, AgentProcessRun } from '../data/entities'
import type { ProcessTrigger } from '../data/validators'

import handle from '../subscribers/task-event-trigger'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const TASK_ID = '44444444-4444-4444-8444-444444444444'

type Row = Record<string, unknown>

/**
 * Stand-in for the containment probe the real dispatcher runs against the GIN
 * index: the fake connection re-implements `triggers @> '[{...}]'` over the
 * seeded rows, so the test exercises the SAME candidate-pattern set the index
 * would be asked for (exact id plus every trailing-wildcard prefix).
 */
function createFakeEm() {
  const stores = new Map<unknown, Row[]>()
  function storeFor(entity: unknown): Row[] {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity)!
  }
  function matchesValue(actual: unknown, expected: unknown): boolean {
    if (expected && typeof expected === 'object' && '$gte' in (expected as Row)) {
      const bound = (expected as { $gte: Date }).$gte
      return actual instanceof Date && actual.getTime() >= bound.getTime()
    }
    if (expected && typeof expected === 'object' && '$in' in (expected as Row)) {
      return (expected as { $in: unknown[] }).$in.includes(actual)
    }
    return (actual ?? null) === expected
  }
  function matches(row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, value]) => matchesValue(row[key], value))
  }
  const executed: string[] = []
  const em = {
    fork() {
      return em
    },
    getConnection() {
      return {
        async execute(sql: string, params: unknown[]) {
          executed.push(sql)
          const [tenantId, organizationId, ...patternParams] = params as string[]
          const wanted = patternParams.map(
            (raw) => (JSON.parse(raw) as Array<{ eventPattern: string }>)[0].eventPattern,
          )
          return storeFor(AgentProcessDefinition)
            .filter(
              (row) =>
                row.tenantId === tenantId &&
                row.organizationId === organizationId &&
                row.enabled === true &&
                (row.deletedAt ?? null) === null &&
                ((row.triggers ?? []) as ProcessTrigger[]).some(
                  (trigger) => trigger.kind === 'event' && wanted.includes(trigger.eventPattern),
                ),
            )
            .map((row) => ({ id: row.id }))
        },
      }
    },
    async findOne(entity: unknown, where: Row) {
      return storeFor(entity).find((row) => matches(row, where)) ?? null
    },
    async find(entity: unknown, where: Row, opts?: { limit?: number }) {
      const rows = storeFor(entity).filter((row) => matches(row, where))
      return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows
    },
    async count(entity: unknown, where: Row) {
      return storeFor(entity).filter((row) => matches(row, where)).length
    },
  }
  return { em: em as unknown as EntityManager, storeFor, executed }
}

function seed(storeFor: (entity: unknown) => Row[], trigger: Partial<ProcessTrigger> = {}, definition: Row = {}) {
  storeFor(AgentProcessDefinition).push({
    id: TASK_ID,
    tenantId: TENANT,
    organizationId: ORG,
    enabled: true,
    deletedAt: null,
    createdAt: new Date(0),
    triggers: [
      {
        kind: 'event',
        eventPattern: 'claims.claim.reported',
        config: { contextMapping: [{ targetKey: 'claimId', sourceExpression: 'id' }] },
        priority: 0,
        enabled: true,
        ...trigger,
      },
      { kind: 'manual', requireFeatures: [] },
    ],
    ...definition,
  })
}

function makeCtx(em: EntityManager, executeMock: jest.Mock, eventName: string) {
  return {
    resolve: <T = unknown>(name: string): T => {
      if (name === 'em') return em as unknown as T
      if (name === 'commandBus') return { execute: executeMock } as unknown as T
      throw new Error(`unexpected resolve(${name})`)
    },
    eventName,
    tenantId: TENANT,
    organizationId: ORG,
  }
}

describe('task-event-trigger subscriber (declared triggers list)', () => {
  it('enqueues a run for a matching event with mapped input and event provenance', async () => {
    const { em, storeFor } = createFakeEm()
    seed(storeFor)
    const execute = jest.fn(async () => ({ result: { processRunId: 'x' } }))

    await handle({ id: 'claim-9', status: 'open' }, makeCtx(em, execute, 'claims.claim.reported'))

    expect(execute).toHaveBeenCalledWith(
      'agent_orchestrator.processes.enqueueRun',
      expect.objectContaining({
        input: expect.objectContaining({
          processDefinitionId: TASK_ID,
          input: { claimId: 'claim-9' },
          triggeredBy: { kind: 'event', ref: 'claims.claim.reported' },
        }),
      }),
    )
  })

  it('still matches a trailing-wildcard pattern (containment on the derived candidates)', async () => {
    const { em, storeFor, executed } = createFakeEm()
    seed(storeFor, { eventPattern: 'claims.*' })
    const execute = jest.fn(async () => ({ result: { processRunId: 'x' } }))

    await handle({ id: 'claim-9' }, makeCtx(em, execute, 'claims.claim.reported'))

    expect(execute).toHaveBeenCalledTimes(1)
    // Wildcards are served by the same indexed containment probe, not a scan.
    expect(executed[0]).toContain('"triggers" @> ?::jsonb')
  })

  it('never fires for excluded prefixes (incl. its own module → no recursion)', async () => {
    const { em, storeFor } = createFakeEm()
    seed(storeFor, { eventPattern: 'agent_orchestrator.process_run.started' })
    const execute = jest.fn()

    await handle({}, makeCtx(em, execute, 'agent_orchestrator.process_run.started'))
    await handle({}, makeCtx(em, execute, 'workflows.instance.completed'))
    await handle({}, makeCtx(em, execute, 'queue.job.enqueued'))

    expect(execute).not.toHaveBeenCalled()
  })

  it('skips a filtered-out payload and disabled definitions', async () => {
    const { em, storeFor } = createFakeEm()
    seed(storeFor, { config: { filterConditions: [{ field: 'status', operator: 'eq', value: 'open' }] } })
    const execute = jest.fn()

    await handle({ id: 'c', status: 'closed' }, makeCtx(em, execute, 'claims.claim.reported'))
    expect(execute).not.toHaveBeenCalled()

    storeFor(AgentProcessDefinition)[0].enabled = false
    await handle({ id: 'c', status: 'open' }, makeCtx(em, execute, 'claims.claim.reported'))
    expect(execute).not.toHaveBeenCalled()
  })

  it('skips a disabled event trigger on an otherwise live definition', async () => {
    const { em, storeFor } = createFakeEm()
    seed(storeFor, { enabled: false })
    const execute = jest.fn()

    await handle({ id: 'c' }, makeCtx(em, execute, 'claims.claim.reported'))
    expect(execute).not.toHaveBeenCalled()
  })

  it('respects maxConcurrentInstances against running ledger rows', async () => {
    const { em, storeFor } = createFakeEm()
    seed(storeFor, { config: { maxConcurrentInstances: 1 } })
    storeFor(AgentProcessRun).push({
      id: 'running-1',
      processDefinitionId: TASK_ID,
      organizationId: ORG,
      status: 'running',
    })
    const execute = jest.fn()

    await handle({ id: 'c' }, makeCtx(em, execute, 'claims.claim.reported'))
    expect(execute).not.toHaveBeenCalled()
  })

  it('debounces against a recent run carrying the same event provenance', async () => {
    const { em, storeFor } = createFakeEm()
    seed(storeFor, { config: { debounceMs: 60_000 } })
    storeFor(AgentProcessRun).push({
      id: 'recent-1',
      processDefinitionId: TASK_ID,
      organizationId: ORG,
      status: 'completed',
      createdAt: new Date(),
      triggeredBy: { kind: 'event', ref: 'claims.claim.reported' },
    })
    const execute = jest.fn()

    await handle({ id: 'c' }, makeCtx(em, execute, 'claims.claim.reported'))
    expect(execute).not.toHaveBeenCalled()
  })

  it('ignores events without emitter-attached tenant/org scope', async () => {
    const { em, storeFor } = createFakeEm()
    seed(storeFor)
    const execute = jest.fn()
    const ctx = { ...makeCtx(em, execute, 'claims.claim.reported'), organizationId: null }

    await handle({ id: 'c' }, ctx)
    expect(execute).not.toHaveBeenCalled()
  })
})
