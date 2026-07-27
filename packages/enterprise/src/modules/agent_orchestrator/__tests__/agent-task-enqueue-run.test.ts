import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { AgentTaskDefinition, AgentTaskRun } from '../data/entities'

jest.mock('../events', () => ({
  emitAgentOrchestratorEvent: jest.fn(async () => {}),
}))

const enqueueMock = jest.fn(async () => {})
jest.mock('../lib/queue', () => {
  const actual = jest.requireActual('../lib/queue')
  return {
    ...actual,
    getAgentOrchestratorQueue: jest.fn(() => ({ enqueue: enqueueMock })),
  }
})

import { enqueueTaskRunCommand, resolveTaskRunInput } from '../commands/tasks'
import { emitAgentOrchestratorEvent } from '../events'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG = '99999999-9999-4999-8999-999999999999'
const TASK_ID = '44444444-4444-4444-8444-444444444444'

function createFakeEm() {
  const stores = new Map<unknown, Array<Record<string, unknown>>>()
  const pending: Array<Record<string, unknown>> = []
  let idSeq = 0

  function storeFor(entity: unknown): Array<Record<string, unknown>> {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity)!
  }
  function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => (row[key] ?? null) === value)
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
        const entity = (row as { __entity?: unknown }).__entity
        const store = storeFor(entity)
        if (!store.includes(row)) store.push(row)
      }
    },
    async findOne(entity: unknown, where: Record<string, unknown>) {
      return storeFor(entity).find((row) => matches(row, where)) ?? null
    },
    async find(entity: unknown, where: Record<string, unknown>) {
      return storeFor(entity).filter((row) => matches(row, where))
    },
  }
  return { em: em as unknown as EntityManager, storeFor }
}

function makeCtx(em: EntityManager): CommandRuntimeContext {
  return {
    container: {
      resolve(name: string) {
        if (name === 'em') return em
        throw new Error(`[internal] unexpected resolve(${name})`)
      },
    } as unknown as CommandRuntimeContext['container'],
    auth: null,
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  }
}

function seedDefinition(storeFor: (entity: unknown) => Array<Record<string, unknown>>, overrides: Record<string, unknown> = {}) {
  storeFor(AgentTaskDefinition).push({
    id: TASK_ID,
    tenantId: TENANT,
    organizationId: ORG,
    name: 'Health check',
    targetType: 'agent',
    targetAgentId: 'deals.health_check',
    targetWorkflowId: null,
    inputDefaults: { threshold: 5 },
    inputSchema: null,
    executionPrincipalId: '55555555-5555-4555-8555-555555555555',
    enabled: true,
    deletedAt: null,
    ...overrides,
  })
}

describe('agent_orchestrator.tasks.enqueueRun', () => {
  beforeEach(() => {
    enqueueMock.mockClear()
    ;(emitAgentOrchestratorEvent as jest.Mock).mockClear()
  })

  const baseInput = {
    tenantId: TENANT,
    organizationId: ORG,
    taskDefinitionId: TASK_ID,
    triggeredBy: 'user:66666666-6666-4666-8666-666666666666',
  }

  it('creates a running task run, merges input defaults, emits started, and enqueues', async () => {
    const { em, storeFor } = createFakeEm()
    seedDefinition(storeFor)

    const result = await enqueueTaskRunCommand.execute(
      { ...baseInput, input: { dealId: 'deal-1' } },
      makeCtx(em),
    )

    expect(result.deduplicated).toBe(false)
    const runs = storeFor(AgentTaskRun)
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('running')
    expect(runs[0].input).toEqual({ threshold: 5, dealId: 'deal-1' })
    expect(runs[0].triggeredBy).toBe(baseInput.triggeredBy)
    expect(enqueueMock).toHaveBeenCalledWith({ taskRunId: result.taskRunId })
    expect(emitAgentOrchestratorEvent).toHaveBeenCalledWith(
      'agent_orchestrator.task_run.started',
      expect.objectContaining({ taskDefinitionId: TASK_ID, organizationId: ORG }),
      { persistent: true },
    )
  })

  it('dedupes on the idempotency key without a second run or enqueue', async () => {
    const { em, storeFor } = createFakeEm()
    seedDefinition(storeFor)

    const first = await enqueueTaskRunCommand.execute(
      { ...baseInput, idempotencyKey: 'retry-safe-1' },
      makeCtx(em),
    )
    const second = await enqueueTaskRunCommand.execute(
      { ...baseInput, idempotencyKey: 'retry-safe-1' },
      makeCtx(em),
    )

    expect(second.taskRunId).toBe(first.taskRunId)
    expect(second.deduplicated).toBe(true)
    expect(storeFor(AgentTaskRun)).toHaveLength(1)
    expect(enqueueMock).toHaveBeenCalledTimes(1)
  })

  it('404s a cross-org task id without creating anything', async () => {
    const { em, storeFor } = createFakeEm()
    seedDefinition(storeFor, { organizationId: OTHER_ORG })

    await expect(enqueueTaskRunCommand.execute(baseInput, makeCtx(em))).rejects.toMatchObject({
      status: 404,
    })
    expect(storeFor(AgentTaskRun)).toHaveLength(0)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('409s a disabled task', async () => {
    const { em, storeFor } = createFakeEm()
    seedDefinition(storeFor, { enabled: false })

    await expect(enqueueTaskRunCommand.execute(baseInput, makeCtx(em))).rejects.toMatchObject({
      status: 409,
    })
  })

  it('rejects input failing the definition inputSchema with field errors and creates no run', async () => {
    const { em, storeFor } = createFakeEm()
    seedDefinition(storeFor, {
      inputDefaults: null,
      inputSchema: {
        type: 'object',
        properties: { claimId: { type: 'string' } },
        required: ['claimId'],
      },
    })

    let caught: unknown
    try {
      await enqueueTaskRunCommand.execute({ ...baseInput, input: { claimId: 42 } }, makeCtx(em))
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(CrudHttpError)
    expect((caught as CrudHttpError).status).toBe(400)
    expect(storeFor(AgentTaskRun)).toHaveLength(0)

    await expect(
      enqueueTaskRunCommand.execute({ ...baseInput, input: { claimId: 'CLM-9' } }, makeCtx(em)),
    ).resolves.toMatchObject({ status: 'running' })
  })
})

describe('resolveTaskRunInput', () => {
  it('merges run input over defaults (input wins per key)', () => {
    const definition = { inputDefaults: { a: 1, b: 2 } } as unknown as AgentTaskDefinition
    expect(resolveTaskRunInput(definition, { b: 3 })).toEqual({ a: 1, b: 3 })
    expect(resolveTaskRunInput({ inputDefaults: null } as unknown as AgentTaskDefinition, undefined)).toEqual({})
  })
})
