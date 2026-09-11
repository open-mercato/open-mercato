import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ProcessDefinition, ProcessInstance } from '../data/entities'

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

import { startProcessExecutionCommand, resolveProcessInput } from '../commands/processes'
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
  storeFor(ProcessDefinition).push({
    id: TASK_ID,
    tenantId: TENANT,
    organizationId: ORG,
    name: 'Health check',
    workflowId: 'process_deals_health_check',
    inputDefaults: { threshold: 5 },
    inputSchema: null,
    triggers: [{ kind: 'manual', requireFeatures: [] }],
    enabled: true,
    deletedAt: null,
    ...overrides,
  })
}

describe('agent_orchestrator.processes.startExecution', () => {
  beforeEach(() => {
    enqueueMock.mockClear()
    ;(emitAgentOrchestratorEvent as jest.Mock).mockClear()
  })

  const baseInput = {
    tenantId: TENANT,
    organizationId: ORG,
    processDefinitionId: TASK_ID,
    triggeredBy: { kind: 'manual' as const, ref: '66666666-6666-4666-8666-666666666666' },
  }

  it('records the execution, merges input defaults, emits started, and enqueues', async () => {
    const { em, storeFor } = createFakeEm()
    seedDefinition(storeFor)

    const result = await startProcessExecutionCommand.execute(
      { ...baseInput, input: { dealId: 'deal-1' } },
      makeCtx(em),
    )

    expect(result.deduplicated).toBe(false)
    const executions = storeFor(ProcessInstance)
    expect(executions).toHaveLength(1)
    expect(executions[0].status).toBe('running')
    expect(executions[0].input).toEqual({ threshold: 5, dealId: 'deal-1' })
    expect(executions[0].triggeredBy).toEqual(baseInput.triggeredBy)
    // The workflow is not started HERE — the row claims the idempotency key
    // first, and the worker starts the one durable execution.
    expect(executions[0].workflowInstanceId).toBeUndefined()
    expect(enqueueMock).toHaveBeenCalledWith({ executionId: result.executionId })
    expect(emitAgentOrchestratorEvent).toHaveBeenCalledWith(
      'agent_orchestrator.process.execution.started',
      expect.objectContaining({ processDefinitionId: TASK_ID, organizationId: ORG }),
      { persistent: true },
    )
  })

  it('one idempotency key produces ONE execution, and therefore one workflow instance', async () => {
    const { em, storeFor } = createFakeEm()
    seedDefinition(storeFor)

    const first = await startProcessExecutionCommand.execute(
      { ...baseInput, idempotencyKey: 'retry-safe-1' },
      makeCtx(em),
    )
    const second = await startProcessExecutionCommand.execute(
      { ...baseInput, idempotencyKey: 'retry-safe-1' },
      makeCtx(em),
    )

    expect(second.executionId).toBe(first.executionId)
    expect(second.deduplicated).toBe(true)
    expect(storeFor(ProcessInstance)).toHaveLength(1)
    // The enqueue is what would start a workflow, so a second one is a second
    // instance — the exact thing the key exists to prevent.
    expect(enqueueMock).toHaveBeenCalledTimes(1)
  })

  it('scopes the key to its definition — the same key on another process is another execution', async () => {
    const { em, storeFor } = createFakeEm()
    const OTHER_DEFINITION = '77777777-7777-4777-8777-777777777777'
    seedDefinition(storeFor)
    seedDefinition(storeFor, { id: OTHER_DEFINITION, name: 'Other' })

    const first = await startProcessExecutionCommand.execute(
      { ...baseInput, idempotencyKey: 'shared-key' },
      makeCtx(em),
    )
    const second = await startProcessExecutionCommand.execute(
      { ...baseInput, processDefinitionId: OTHER_DEFINITION, idempotencyKey: 'shared-key' },
      makeCtx(em),
    )

    expect(second.executionId).not.toBe(first.executionId)
    expect(storeFor(ProcessInstance)).toHaveLength(2)
  })

  it('404s a cross-org definition id without creating anything', async () => {
    const { em, storeFor } = createFakeEm()
    seedDefinition(storeFor, { organizationId: OTHER_ORG })

    await expect(startProcessExecutionCommand.execute(baseInput, makeCtx(em))).rejects.toMatchObject({
      status: 404,
    })
    expect(storeFor(ProcessInstance)).toHaveLength(0)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('403s a manual entry when the definition declares no manual trigger', async () => {
    const { em, storeFor } = createFakeEm()
    seedDefinition(storeFor, { triggers: [{ kind: 'schedule', cron: '0 7 * * *', timezone: 'UTC', enabled: true }] })

    await expect(startProcessExecutionCommand.execute(baseInput, makeCtx(em))).rejects.toMatchObject({
      status: 403,
    })
    expect(storeFor(ProcessInstance)).toHaveLength(0)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('lets a schedule entry through a definition with no manual trigger', async () => {
    const { em, storeFor } = createFakeEm()
    seedDefinition(storeFor, { triggers: [{ kind: 'schedule', cron: '0 7 * * *', timezone: 'UTC', enabled: true }] })

    const result = await startProcessExecutionCommand.execute(
      { ...baseInput, triggeredBy: { kind: 'schedule' as const } },
      makeCtx(em),
    )
    expect(result.deduplicated).toBe(false)
    expect(storeFor(ProcessInstance)[0].triggeredBy).toEqual({ kind: 'schedule' })
  })

  it('409s a disabled definition', async () => {
    const { em, storeFor } = createFakeEm()
    seedDefinition(storeFor, { enabled: false })

    await expect(startProcessExecutionCommand.execute(baseInput, makeCtx(em))).rejects.toMatchObject({
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
      await startProcessExecutionCommand.execute({ ...baseInput, input: { claimId: 42 } }, makeCtx(em))
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(CrudHttpError)
    expect((caught as CrudHttpError).status).toBe(400)
    expect(storeFor(ProcessInstance)).toHaveLength(0)

    await expect(
      startProcessExecutionCommand.execute({ ...baseInput, input: { claimId: 'CLM-9' } }, makeCtx(em)),
    ).resolves.toMatchObject({ deduplicated: false })
  })
})

describe('resolveProcessInput', () => {
  it('merges start input over defaults (input wins per key)', () => {
    const definition = { inputDefaults: { a: 1, b: 2 } } as unknown as ProcessDefinition
    expect(resolveProcessInput(definition, { b: 3 })).toEqual({ a: 1, b: 3 })
    expect(resolveProcessInput({ inputDefaults: null } as unknown as ProcessDefinition, undefined)).toEqual({})
  })
})
