import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob } from '@open-mercato/queue'
import { AgentPrincipal, AgentRun, AgentTaskDefinition, AgentTaskRun } from '../data/entities'

jest.mock('../events', () => ({
  emitAgentOrchestratorEvent: jest.fn(async () => {}),
}))

const containerHolder: { container: unknown } = { container: null }
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => containerHolder.container),
}))

import handle from '../workers/task-run-executor'
import { emitAgentOrchestratorEvent } from '../events'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const TASK_ID = '44444444-4444-4444-8444-444444444444'
const RUN_ID = '55555555-5555-4555-8555-555555555555'
const PRINCIPAL_ID = '66666666-6666-4666-8666-666666666666'
const PRINCIPAL_USER = '77777777-7777-4777-8777-777777777777'

function createFakeEm() {
  const stores = new Map<unknown, Array<Record<string, unknown>>>()
  const pending: Array<Record<string, unknown>> = []
  let idSeq = 0

  function storeFor(entity: unknown): Array<Record<string, unknown>> {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity)!
  }
  function matchesValue(actual: unknown, expected: unknown): boolean {
    if (expected && typeof expected === 'object' && '$gte' in (expected as Record<string, unknown>)) {
      const bound = (expected as { $gte: Date }).$gte
      return actual instanceof Date && bound instanceof Date && actual.getTime() >= bound.getTime()
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
        if (!row.id) row.id = `00000000-0000-4000-8000-00000000000${++idSeq}`
        const store = storeFor((row as { __entity?: unknown }).__entity)
        if (!store.includes(row)) store.push(row)
      }
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

type Registrations = Record<string, unknown>

function makeContainer(em: EntityManager, registrations: Registrations) {
  return {
    resolve(name: string) {
      if (name === 'em') return em
      if (name in registrations) return registrations[name]
      throw new Error(`[internal] unexpected resolve(${name})`)
    },
  }
}

function seed(storeFor: (entity: unknown) => Array<Record<string, unknown>>, runOverrides: Record<string, unknown> = {}) {
  storeFor(AgentTaskDefinition).push({
    id: TASK_ID,
    tenantId: TENANT,
    organizationId: ORG,
    targetType: 'agent',
    targetAgentId: 'deals.health_check',
    executionPrincipalId: PRINCIPAL_ID,
    enabled: true,
    deletedAt: null,
  })
  storeFor(AgentPrincipal).push({
    id: PRINCIPAL_ID,
    organizationId: ORG,
    tenantId: TENANT,
    userId: PRINCIPAL_USER,
    deletedAt: null,
  })
  storeFor(AgentTaskRun).push({
    id: RUN_ID,
    tenantId: TENANT,
    organizationId: ORG,
    taskDefinitionId: TASK_ID,
    targetType: 'agent',
    targetAgentId: 'deals.health_check',
    targetWorkflowId: null,
    status: 'running',
    agentRunId: null,
    workflowInstanceId: null,
    input: { dealId: 'deal-1' },
    triggeredBy: 'user:88888888-8888-4888-8888-888888888888',
    ...runOverrides,
  })
}

const job = (payload: Record<string, unknown>) =>
  ({ payload }) as unknown as QueuedJob<{ taskRunId?: string }>
const jobCtx = {} as JobContext

describe('task-run-executor worker', () => {
  beforeEach(() => {
    ;(emitAgentOrchestratorEvent as jest.Mock).mockClear()
  })

  it('agent target: runs under the execution principal, correlates the AgentRun, completes + emits', async () => {
    const { em, storeFor } = createFakeEm()
    seed(storeFor)
    const runMock = jest.fn(async () => {
      storeFor(AgentRun).push({
        id: 'agent-run-1',
        organizationId: ORG,
        agentId: 'deals.health_check',
        createdAt: new Date(),
      })
      return { kind: 'informative' }
    })
    containerHolder.container = makeContainer(em, { agentRuntime: { run: runMock } })

    await handle(job({ taskRunId: RUN_ID }), jobCtx)

    expect(runMock).toHaveBeenCalledWith(
      'deals.health_check',
      { dealId: 'deal-1' },
      expect.objectContaining({
        userId: PRINCIPAL_USER,
        runAs: {
          agentUserId: PRINCIPAL_USER,
          onBehalfOfUserId: '88888888-8888-4888-8888-888888888888',
        },
      }),
    )
    const row = storeFor(AgentTaskRun)[0]
    expect(row.status).toBe('completed')
    expect(row.agentRunId).toBe('agent-run-1')
    expect(emitAgentOrchestratorEvent).toHaveBeenCalledWith(
      'agent_orchestrator.task_run.completed',
      expect.objectContaining({ id: RUN_ID }),
      { persistent: true },
    )
  })

  it('agent target: a non-retryable runtime error fails the run with the reason', async () => {
    const { em, storeFor } = createFakeEm()
    seed(storeFor)
    containerHolder.container = makeContainer(em, {
      agentRuntime: { run: jest.fn(async () => { throw new Error('model exploded') }) },
    })

    await handle(job({ taskRunId: RUN_ID }), jobCtx)

    const row = storeFor(AgentTaskRun)[0]
    expect(row.status).toBe('failed')
    expect(row.failureReason).toBe('model exploded')
    expect(emitAgentOrchestratorEvent).toHaveBeenCalledWith(
      'agent_orchestrator.task_run.failed',
      expect.anything(),
      { persistent: true },
    )
  })

  it('agent target: a retryable capacity error rethrows for queue retry without finishing the run', async () => {
    const { em, storeFor } = createFakeEm()
    seed(storeFor)
    const capacityError = Object.assign(new Error('capacity'), { retryable: true })
    containerHolder.container = makeContainer(em, {
      agentRuntime: { run: jest.fn(async () => { throw capacityError }) },
    })

    await expect(handle(job({ taskRunId: RUN_ID }), jobCtx)).rejects.toBe(capacityError)
    expect(storeFor(AgentTaskRun)[0].status).toBe('running')
  })

  it('workflow target: starts the instance, stamps workflowInstanceId, leaves the ledger running', async () => {
    const { em, storeFor } = createFakeEm()
    seed(storeFor, { targetType: 'workflow', targetAgentId: null, targetWorkflowId: 'claims_resolution' })
    const startWorkflow = jest.fn(async () => ({ id: 'instance-1' }))
    const executeWorkflow = jest.fn(async () => ({}))
    containerHolder.container = makeContainer(em, {
      workflowExecutor: { startWorkflow, executeWorkflow },
    })

    await handle(job({ taskRunId: RUN_ID }), jobCtx)

    expect(startWorkflow).toHaveBeenCalledWith(
      em,
      expect.objectContaining({
        workflowId: 'claims_resolution',
        initialContext: { dealId: 'deal-1' },
        tenantId: TENANT,
        organizationId: ORG,
      }),
    )
    expect(executeWorkflow).toHaveBeenCalled()
    const row = storeFor(AgentTaskRun)[0]
    expect(row.workflowInstanceId).toBe('instance-1')
    expect(row.status).toBe('running')
    expect(emitAgentOrchestratorEvent).not.toHaveBeenCalled()
  })

  it('is idempotent: terminal rows and already-started workflow rows are skipped', async () => {
    const { em, storeFor } = createFakeEm()
    seed(storeFor, { status: 'completed' })
    const runMock = jest.fn()
    containerHolder.container = makeContainer(em, { agentRuntime: { run: runMock } })

    await handle(job({ taskRunId: RUN_ID }), jobCtx)
    expect(runMock).not.toHaveBeenCalled()

    storeFor(AgentTaskRun)[0].status = 'running'
    storeFor(AgentTaskRun)[0].workflowInstanceId = 'instance-1'
    await handle(job({ taskRunId: RUN_ID }), jobCtx)
    expect(runMock).not.toHaveBeenCalled()
  })
})
