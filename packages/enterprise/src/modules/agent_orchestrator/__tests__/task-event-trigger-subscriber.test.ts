import type { EntityManager } from '@mikro-orm/postgresql'
import { AgentTaskDefinition, AgentTaskEventTrigger, AgentTaskRun } from '../data/entities'

import handle from '../subscribers/task-event-trigger'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const TASK_ID = '44444444-4444-4444-8444-444444444444'

function createFakeEm() {
  const stores = new Map<unknown, Array<Record<string, unknown>>>()
  function storeFor(entity: unknown): Array<Record<string, unknown>> {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity)!
  }
  function matchesValue(actual: unknown, expected: unknown): boolean {
    if (expected && typeof expected === 'object' && '$gte' in (expected as Record<string, unknown>)) {
      const bound = (expected as { $gte: Date }).$gte
      return actual instanceof Date && actual.getTime() >= bound.getTime()
    }
    return (actual ?? null) === expected
  }
  function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => matchesValue(row[key], value))
  }
  const em = {
    fork() {
      return em
    },
    async findOne(entity: unknown, where: Record<string, unknown>) {
      return storeFor(entity).find((row) => matches(row, where)) ?? null
    },
    async find(entity: unknown, where: Record<string, unknown>, opts?: { limit?: number }) {
      const rows = storeFor(entity).filter((row) => matches(row, where))
      return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows
    },
    async count(entity: unknown, where: Record<string, unknown>) {
      return storeFor(entity).filter((row) => matches(row, where)).length
    },
  }
  return { em: em as unknown as EntityManager, storeFor }
}

function seed(storeFor: (entity: unknown) => Array<Record<string, unknown>>, triggerOverrides: Record<string, unknown> = {}) {
  storeFor(AgentTaskDefinition).push({
    id: TASK_ID,
    tenantId: TENANT,
    organizationId: ORG,
    enabled: true,
    deletedAt: null,
  })
  storeFor(AgentTaskEventTrigger).push({
    id: 'trigger-1',
    tenantId: TENANT,
    organizationId: ORG,
    taskDefinitionId: TASK_ID,
    eventPattern: 'claims.claim.reported',
    config: {
      contextMapping: [{ targetKey: 'claimId', sourceExpression: 'id' }],
    },
    enabled: true,
    priority: 0,
    deletedAt: null,
    ...triggerOverrides,
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

describe('task-event-trigger subscriber', () => {
  it('enqueues a run for a matching event with mapped input and event provenance', async () => {
    const { em, storeFor } = createFakeEm()
    seed(storeFor)
    const execute = jest.fn(async () => ({ result: { taskRunId: 'x' } }))

    await handle({ id: 'claim-9', status: 'open' }, makeCtx(em, execute, 'claims.claim.reported'))

    expect(execute).toHaveBeenCalledWith(
      'agent_orchestrator.tasks.enqueueRun',
      expect.objectContaining({
        input: expect.objectContaining({
          taskDefinitionId: TASK_ID,
          input: { claimId: 'claim-9' },
          triggeredBy: 'event:claims.claim.reported',
        }),
      }),
    )
  })

  it('never fires for excluded prefixes (incl. its own module → no recursion)', async () => {
    const { em, storeFor } = createFakeEm()
    seed(storeFor, { eventPattern: 'agent_orchestrator.task_run.started' })
    const execute = jest.fn()

    await handle({}, makeCtx(em, execute, 'agent_orchestrator.task_run.started'))
    await handle({}, makeCtx(em, execute, 'workflows.instance.completed'))
    await handle({}, makeCtx(em, execute, 'queue.job.enqueued'))

    expect(execute).not.toHaveBeenCalled()
  })

  it('skips non-matching filter conditions and disabled definitions', async () => {
    const { em, storeFor } = createFakeEm()
    seed(storeFor, {
      config: { filterConditions: [{ field: 'status', operator: 'eq', value: 'open' }] },
    })
    const execute = jest.fn()

    await handle({ id: 'c', status: 'closed' }, makeCtx(em, execute, 'claims.claim.reported'))
    expect(execute).not.toHaveBeenCalled()

    storeFor(AgentTaskDefinition)[0].enabled = false
    await handle({ id: 'c', status: 'open' }, makeCtx(em, execute, 'claims.claim.reported'))
    expect(execute).not.toHaveBeenCalled()
  })

  it('respects maxConcurrentInstances against running ledger rows', async () => {
    const { em, storeFor } = createFakeEm()
    seed(storeFor, { config: { maxConcurrentInstances: 1 } })
    storeFor(AgentTaskRun).push({
      id: 'running-1',
      taskDefinitionId: TASK_ID,
      organizationId: ORG,
      status: 'running',
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
