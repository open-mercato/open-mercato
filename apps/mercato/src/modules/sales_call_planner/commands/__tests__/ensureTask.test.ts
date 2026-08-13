/**
 * The idempotency test is the reason task B3 exists: the customers module
 * refuses to declare a CREATE command workflow-safe because a retried
 * `UPDATE_ENTITY` would mint duplicate rows. These tests assert this command
 * converges instead.
 */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

import '../ensureTask'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { deriveEnsureTaskId, TASK_PRIORITY_SCORES } from '../shared'
import { taskPriorities } from '../../data/validators'

const COMMAND_ID = 'sales_call_planner.ensure_task'
const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const ENTITY_ID = '33333333-3333-4333-8333-333333333333'
const INSTANCE_ID = '44444444-4444-4444-8444-444444444444'
const OTHER_INSTANCE_ID = '55555555-5555-4555-8555-555555555555'
const DEAL_ID = '66666666-6666-4666-8666-666666666666'
const OWNER_USER_ID = '77777777-7777-4777-8777-777777777777'
const ACTOR_USER_ID = '88888888-8888-4888-8888-888888888888'
const STEP_ID = 'create_tasks'

type StoredRow = {
  id: string
  tenantId: string
  organizationId: string
  deletedAt: Date | null
}

type Harness = {
  ctx: CommandRuntimeContext
  execute: jest.Mock
  rows: Map<string, StoredRow>
  findOne: jest.Mock
}

function getCommand(): CommandHandler<unknown, unknown> {
  const handler = commandRegistry.get(COMMAND_ID)
  if (!handler) throw new Error(`Command ${COMMAND_ID} not registered`)
  return handler as CommandHandler<unknown, unknown>
}

/**
 * A fake command bus backed by a row map, so "did the second call create a
 * second row" is answerable by counting rows rather than by trusting a spy.
 */
function createHarness(options: { entityResolves?: boolean } = {}): Harness {
  const rows = new Map<string, StoredRow>()
  const entityResolves = options.entityResolves ?? true

  const execute = jest.fn(async (commandId: string, args: { input: Record<string, unknown> }) => {
    const id = String(args.input.id)
    if (commandId === 'customers.interactions.create') {
      if (rows.has(id)) {
        const duplicate = new Error('duplicate key value violates unique constraint') as Error & { code: string }
        duplicate.code = '23505'
        throw duplicate
      }
      rows.set(id, {
        id,
        tenantId: String(args.input.tenantId),
        organizationId: String(args.input.organizationId),
        deletedAt: null,
      })
      return { result: { interactionId: id }, logEntry: null }
    }
    if (commandId === 'customers.interactions.update') {
      if (!rows.has(id)) throw new Error('Interaction not found')
      return { result: { interactionId: id }, logEntry: null }
    }
    throw new Error(`Unexpected command: ${commandId}`)
  })

  const findOne = jest.fn(async (entityName: unknown, where: Record<string, unknown>) => {
    // `requireTimelineParentEntity` probes CustomerEntity first; the ensure loop
    // probes CustomerInteraction by the deterministic id.
    if (typeof where.kind === 'undefined' && typeof where.id === 'string' && rows.has(where.id)) {
      const row = rows.get(where.id)!
      if (row.tenantId !== where.tenantId || row.organizationId !== where.organizationId) return null
      return row
    }
    if (where.id === ENTITY_ID) {
      return entityResolves
        ? { id: ENTITY_ID, kind: 'company', tenantId: TENANT_ID, organizationId: ORG_ID }
        : null
    }
    return null
  })

  const em = {
    fork: () => em,
    findOne,
  } as unknown as EntityManager

  const ctx = {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return em
        if (token === 'commandBus') return { execute }
        throw new Error(`Unexpected dependency: ${token}`)
      },
    },
    auth: { sub: ACTOR_USER_ID, tenantId: TENANT_ID, orgId: ORG_ID, isSuperAdmin: false },
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  } as unknown as CommandRuntimeContext

  return { ctx, execute, rows, findOne }
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    workflowInstanceId: INSTANCE_ID,
    stepId: STEP_ID,
    entityId: ENTITY_ID,
    tasks: [
      { title: 'Call the CFO back', body: 'Confirm the renewal date', priority: 'high' as const },
      { title: 'Send the revised quote', dealId: DEAL_ID },
    ],
    ...overrides,
  }
}

type EnsureResult = {
  entityId: string
  taskIds: string[]
  createdIds: string[]
  updatedIds: string[]
  skippedIds: string[]
  ensured: number
  unresolvedOwnerHints: string[]
}

async function run(harness: Harness, input: Record<string, unknown>): Promise<EnsureResult> {
  return (await getCommand().execute(input, harness.ctx)) as EnsureResult
}

describe('sales_call_planner.ensure_task — idempotency', () => {
  it('rewrites the same rows on a replay instead of minting a second set', async () => {
    const harness = createHarness()

    const first = await run(harness, baseInput())
    expect(first.createdIds).toHaveLength(2)
    expect(first.updatedIds).toHaveLength(0)
    expect(harness.rows.size).toBe(2)

    const second = await run(harness, baseInput())

    // One row per task, not two.
    expect(harness.rows.size).toBe(2)
    expect(second.taskIds).toEqual(first.taskIds)
    // The second call created nothing.
    expect(second.createdIds).toEqual([])
    expect(second.updatedIds).toEqual(first.taskIds)
    expect(second.ensured).toBe(2)
    expect(
      harness.execute.mock.calls.filter(([commandId]) => commandId === 'customers.interactions.create'),
    ).toHaveLength(2)
  })

  it('gives each array position its own id', async () => {
    const harness = createHarness()
    const result = await run(harness, baseInput())

    expect(new Set(result.taskIds).size).toBe(2)
    expect(result.taskIds[0]).toBe(deriveEnsureTaskId(INSTANCE_ID, STEP_ID, 0))
    expect(result.taskIds[1]).toBe(deriveEnsureTaskId(INSTANCE_ID, STEP_ID, 1))
  })

  it('keys on the step id as well, so two nodes in one run never collide', async () => {
    const harness = createHarness()

    const fromFirstNode = await run(harness, baseInput())
    const fromSecondNode = await run(harness, baseInput({ stepId: 'create_followups' }))

    expect(fromSecondNode.taskIds).not.toEqual(fromFirstNode.taskIds)
    expect(fromSecondNode.createdIds).toHaveLength(2)
    expect(harness.rows.size).toBe(4)
  })

  it('keys on the instance id as well, so a second briefing is a second set of tasks', async () => {
    const harness = createHarness()

    const firstRun = await run(harness, baseInput())
    const secondRun = await run(harness, baseInput({ workflowInstanceId: OTHER_INSTANCE_ID }))

    expect(secondRun.taskIds).not.toEqual(firstRun.taskIds)
    expect(secondRun.createdIds).toHaveLength(2)
    expect(harness.rows.size).toBe(4)
  })

  it('derives ids from all three key halves and nothing else', () => {
    const id = deriveEnsureTaskId(INSTANCE_ID, STEP_ID, 0)
    expect(id).toBe(deriveEnsureTaskId(INSTANCE_ID, STEP_ID, 0))
    expect(id).not.toBe(deriveEnsureTaskId(OTHER_INSTANCE_ID, STEP_ID, 0))
    expect(id).not.toBe(deriveEnsureTaskId(INSTANCE_ID, 'other_step', 0))
    expect(id).not.toBe(deriveEnsureTaskId(INSTANCE_ID, STEP_ID, 1))
    // RFC 4122 v5 shape: version nibble 5, variant 10xx.
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('falls back to an update when a concurrent invocation won the create race', async () => {
    const harness = createHarness()
    const contendedId = deriveEnsureTaskId(INSTANCE_ID, STEP_ID, 0)

    // The row exists, but the read cannot see it yet (the racing transaction has
    // not committed for this reader). The create then hits the primary key.
    harness.rows.set(contendedId, { id: contendedId, tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null })
    harness.findOne.mockImplementationOnce(async () => ({
      id: ENTITY_ID,
      kind: 'company',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    }))
    harness.findOne.mockImplementationOnce(async () => null)

    const result = await run(harness, baseInput({ tasks: [{ title: 'Call the CFO back' }] }))

    expect(result.createdIds).toEqual([])
    expect(result.updatedIds).toEqual([contendedId])
    expect(harness.rows.size).toBe(1)
  })

  it('leaves a task a human deleted deleted', async () => {
    const harness = createHarness()
    const deletedId = deriveEnsureTaskId(INSTANCE_ID, STEP_ID, 0)
    harness.rows.set(deletedId, {
      id: deletedId,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      deletedAt: new Date('2026-08-13T09:00:00.000Z'),
    })

    const result = await run(harness, baseInput({ tasks: [{ title: 'Call the CFO back' }] }))

    expect(result.skippedIds).toEqual([deletedId])
    expect(result.ensured).toBe(0)
    expect(harness.execute).not.toHaveBeenCalled()
  })
})

describe('sales_call_planner.ensure_task — scope', () => {
  it('takes tenant and organization from ctx.auth, never from the input', async () => {
    const harness = createHarness()

    await run(
      harness,
      baseInput({
        tenantId: '99999999-9999-4999-8999-999999999999',
        organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    )

    for (const [, args] of harness.execute.mock.calls) {
      expect(args.input.tenantId).toBe(TENANT_ID)
      expect(args.input.organizationId).toBe(ORG_ID)
    }
  })

  it('refuses to write when the workflow instance carries no scope', async () => {
    const harness = createHarness()
    const unscopedCtx = {
      ...(harness.ctx as unknown as Record<string, unknown>),
      auth: { sub: ACTOR_USER_ID, tenantId: null, orgId: null },
      selectedOrganizationId: null,
    } as unknown as CommandRuntimeContext

    await expect(getCommand().execute(baseInput(), unscopedCtx)).rejects.toThrow(/tenant and organization/)
    expect(harness.execute).not.toHaveBeenCalled()
  })
})

describe('sales_call_planner.ensure_task — mapping', () => {
  it.each(taskPriorities.map((priority) => [priority, TASK_PRIORITY_SCORES[priority]] as const))(
    'maps priority %s onto %i',
    async (priority, expected) => {
      const harness = createHarness()

      await run(harness, baseInput({ tasks: [{ title: 'A task', priority }] }))

      const [, args] = harness.execute.mock.calls[0]
      expect(args.input.priority).toBe(expected)
    },
  )

  it('leaves an unstated priority null rather than inventing "low"', async () => {
    const harness = createHarness()

    await run(harness, baseInput({ tasks: [{ title: 'A task' }] }))

    const [, args] = harness.execute.mock.calls[0]
    expect(args.input.priority).toBeNull()
  })

  it('spreads the four levels across the 0-100 band, ascending', () => {
    const scores = taskPriorities.map((priority) => TASK_PRIORITY_SCORES[priority])
    expect(scores).toEqual([...scores].sort((a, b) => a - b))
    expect(Math.min(...scores)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...scores)).toBeLessThanOrEqual(100)
    expect(new Set(scores).size).toBe(scores.length)
  })

  it('writes the task shape the CRM expects and carries dueAt onto scheduledAt', async () => {
    const harness = createHarness()

    await run(
      harness,
      baseInput({
        ownerUserId: OWNER_USER_ID,
        tasks: [{ title: 'Call the CFO back', dueAt: '2026-08-20T09:00:00Z', dealId: DEAL_ID }],
      }),
    )

    const [commandId, args] = harness.execute.mock.calls[0]
    expect(commandId).toBe('customers.interactions.create')
    expect(args.input).toMatchObject({
      entityId: ENTITY_ID,
      interactionType: 'task',
      title: 'Call the CFO back',
      dealId: DEAL_ID,
      ownerUserId: OWNER_USER_ID,
      source: 'sales_call_planner.deal_brief',
    })
    expect((args.input.scheduledAt as Date).toISOString()).toBe('2026-08-20T09:00:00.000Z')
  })

  it('reports owner hints nothing resolved instead of writing prose into the row', async () => {
    const harness = createHarness()

    const result = await run(
      harness,
      baseInput({ tasks: [{ title: 'Call the CFO back', ownerHint: 'Ana' }] }),
    )

    expect(result.unresolvedOwnerHints).toEqual(['Ana'])
    const [, args] = harness.execute.mock.calls[0]
    expect(args.input.ownerUserId).toBeNull()
    expect(args.input.body).toBeNull()
  })

  it('rejects an unparseable dueAt before writing anything', async () => {
    const harness = createHarness()

    await expect(
      run(harness, baseInput({ tasks: [{ title: 'A task', dueAt: 'next Tuesday' }] })),
    ).rejects.toThrow(/unparseable dueAt/)
    expect(harness.rows.size).toBe(0)
  })

  it('accepts an empty batch as a legitimate outcome', async () => {
    const harness = createHarness()

    const result = await run(harness, baseInput({ tasks: [] }))

    expect(result).toMatchObject({ ensured: 0, taskIds: [], createdIds: [] })
    expect(harness.execute).not.toHaveBeenCalled()
  })
})

describe('sales_call_planner.ensure_task — parent resolution', () => {
  it('fails with a message naming the entity rather than creating an orphan', async () => {
    const harness = createHarness({ entityResolves: false })

    await expect(run(harness, baseInput())).rejects.toThrow(
      /could not resolve the company entity .* customer_entities\.id/s,
    )
    expect(harness.execute).not.toHaveBeenCalled()
    expect(harness.rows.size).toBe(0)
  })
})

describe('sales_call_planner.ensure_task — registration', () => {
  it('declares an output schema so the workflows ledger can type its envelope', () => {
    expect(commandRegistry.outputSchemaOf(COMMAND_ID)).not.toBeNull()
  })
})
