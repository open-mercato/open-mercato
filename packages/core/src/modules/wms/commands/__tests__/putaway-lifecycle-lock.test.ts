/** @jest-environment node */

import { LockMode } from '@mikro-orm/core'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { PutawayTask } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn(async () => undefined),
}))

jest.mock('../../events', () => ({
  emitWmsEvent: jest.fn(async () => undefined),
}))

const findOneWithDecryption = jest.fn()
const findWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER_ID = '99999999-9999-4999-8999-999999999999'
const ASSIGNEE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function createEm() {
  const em = {
    findOne: jest.fn(),
    create: jest.fn((_entity: unknown, payload: Record<string, unknown>) => ({
      id: 'generated-id',
      ...payload,
    })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
    fork: jest.fn(),
    transactional: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  em.transactional.mockImplementation(
    async (cb: (trx: typeof em) => Promise<unknown>) => cb(em),
  )
  return em
}

function createCtx(em: ReturnType<typeof createEm>) {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return {}
        throw new Error(`Unexpected resolve: ${name}`)
      },
    },
    auth: { sub: USER_ID, tenantId: TENANT, orgId: ORG },
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  }
}

function openTask(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    tenantId: TENANT,
    organizationId: ORG,
    warehouse: { id: '55555555-5555-4555-8555-555555555555' },
    sourceLocationId: '66666666-6666-4666-8666-666666666666',
    targetLocationId: null,
    catalogVariantId: '77777777-7777-4777-8777-777777777777',
    lotId: null,
    quantity: '5',
    status: 'open',
    assignedTo: null,
    priority: 5,
    putawayKey: 'wms:asn:attempt-1',
    metadata: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  }
}

describe('putaway lifecycle commands — pessimistic lock', () => {
  beforeAll(async () => {
    await import('../putaway')
  })

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
  })

  it.each([
    ['wms.putaway-tasks.cancel', { organizationId: ORG, tenantId: TENANT, id: TASK_ID }],
    ['wms.putaway-tasks.start', { organizationId: ORG, tenantId: TENANT, id: TASK_ID }],
    [
      'wms.putaway-tasks.assign',
      { organizationId: ORG, tenantId: TENANT, id: TASK_ID, assignedTo: ASSIGNEE },
    ],
  ] as const)('%s loads task with PESSIMISTIC_WRITE inside a transaction', async (commandId, input) => {
    const em = createEm()
    const ctx = createCtx(em)
    const task = openTask()

    findOneWithDecryption.mockImplementation(async (_em, entity, _where, options) => {
      if (entity === PutawayTask) {
        expect(options).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
        return task
      }
      return null
    })

    const handler = commandRegistry.get(commandId)
    await handler!.execute(input, ctx as never)

    expect(em.transactional).toHaveBeenCalled()
    expect(findOneWithDecryption).toHaveBeenCalledWith(
      em,
      PutawayTask,
      { id: TASK_ID, deletedAt: null },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
      expect.objectContaining({ tenantId: TENANT, organizationId: ORG }),
    )
  })

  it('delete loads cancelled task with PESSIMISTIC_WRITE inside a transaction', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const task = openTask({ status: 'cancelled', putawayKey: null })

    findOneWithDecryption.mockImplementation(async (_em, entity, _where, options) => {
      if (entity === PutawayTask) {
        expect(options).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
        return task
      }
      return null
    })

    const handler = commandRegistry.get('wms.putaway-tasks.delete')
    await handler!.execute({ id: TASK_ID }, ctx as never)

    expect(em.transactional).toHaveBeenCalled()
    expect(findOneWithDecryption).toHaveBeenCalledWith(
      em,
      PutawayTask,
      { id: TASK_ID, deletedAt: null },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
      expect.objectContaining({ tenantId: TENANT, organizationId: ORG }),
    )
  })

  it('cancel refuses done status after lock (complete race)', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const task = openTask({ status: 'done', putawayKey: 'wms:asn:attempt-1' })

    findOneWithDecryption.mockImplementation(async (_em, entity) => {
      if (entity === PutawayTask) return task
      return null
    })

    const handler = commandRegistry.get('wms.putaway-tasks.cancel')
    await expect(
      handler!.execute({ organizationId: ORG, tenantId: TENANT, id: TASK_ID }, ctx as never),
    ).rejects.toMatchObject({ status: 409 } satisfies Partial<CrudHttpError>)

    expect(task.status).toBe('done')
    expect(task.putawayKey).toBe('wms:asn:attempt-1')
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('cancel clears putawayKey only when still cancellable under lock', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const task = openTask({ status: 'in_progress', putawayKey: 'wms:asn:attempt-1' })

    findOneWithDecryption.mockImplementation(async (_em, entity) => {
      if (entity === PutawayTask) return task
      return null
    })

    const handler = commandRegistry.get('wms.putaway-tasks.cancel')
    const result = await handler!.execute(
      { organizationId: ORG, tenantId: TENANT, id: TASK_ID },
      ctx as never,
    )

    expect(result).toEqual({ taskId: TASK_ID })
    expect(task.status).toBe('cancelled')
    expect(task.putawayKey).toBeNull()
    expect(em.flush).toHaveBeenCalled()
  })

  it('delete refuses open/in_progress so soft-delete cannot free putaway_key early', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const task = openTask({ status: 'open', putawayKey: 'wms:asn:attempt-1' })

    findOneWithDecryption.mockImplementation(async (_em, entity) => {
      if (entity === PutawayTask) return task
      return null
    })

    const handler = commandRegistry.get('wms.putaway-tasks.delete')
    await expect(handler!.execute({ id: TASK_ID }, ctx as never)).rejects.toMatchObject({
      status: 409,
      body: { error: 'putaway_delete_requires_terminal_status' },
    } satisfies Partial<CrudHttpError>)

    expect(task.deletedAt).toBeNull()
    expect(task.putawayKey).toBe('wms:asn:attempt-1')
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('delete refuses done so soft-delete cannot free putaway_key for already-moved stock', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const task = openTask({ status: 'done', putawayKey: 'wms:asn:attempt-1' })

    findOneWithDecryption.mockImplementation(async (_em, entity) => {
      if (entity === PutawayTask) return task
      return null
    })

    const handler = commandRegistry.get('wms.putaway-tasks.delete')
    await expect(handler!.execute({ id: TASK_ID }, ctx as never)).rejects.toMatchObject({
      status: 409,
      body: { error: 'putaway_delete_done_forbidden' },
    } satisfies Partial<CrudHttpError>)

    expect(task.deletedAt).toBeNull()
    expect(task.putawayKey).toBe('wms:asn:attempt-1')
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('delete allows cancelled tasks after lock', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const task = openTask({ status: 'cancelled', putawayKey: null })

    findOneWithDecryption.mockImplementation(async (_em, entity) => {
      if (entity === PutawayTask) return task
      return null
    })

    const handler = commandRegistry.get('wms.putaway-tasks.delete')
    const result = await handler!.execute({ id: TASK_ID }, ctx as never)

    expect(result).toEqual({ taskId: TASK_ID })
    expect(task.deletedAt).toBeInstanceOf(Date)
    expect(em.flush).toHaveBeenCalled()
  })

  it('delete undo restores soft-deleted cancelled task under PESSIMISTIC_WRITE', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const task = openTask({
      status: 'cancelled',
      putawayKey: null,
      deletedAt: new Date('2026-08-26T12:00:00.000Z'),
    })

    findOneWithDecryption.mockImplementation(async (_em, entity, _where, options) => {
      if (entity === PutawayTask) {
        expect(options).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
        return task
      }
      return null
    })

    const handler = commandRegistry.get('wms.putaway-tasks.delete')
    await handler!.undo!({
      logEntry: {
        commandPayload: {
          undo: {
            before: {
              id: TASK_ID,
              organizationId: ORG,
              tenantId: TENANT,
              warehouseId: '55555555-5555-4555-8555-555555555555',
              sourceLocationId: '66666666-6666-4666-8666-666666666661',
              targetLocationId: null,
              catalogVariantId: '77777777-7777-4777-8777-777777777777',
              lotId: null,
              quantity: '5',
              status: 'cancelled',
              assignedTo: null,
              priority: 5,
              putawayKey: null,
              metadata: null,
              createdAt: new Date('2026-08-01T00:00:00.000Z'),
              updatedAt: new Date('2026-08-01T00:00:00.000Z'),
              deletedAt: new Date('2026-08-26T12:00:00.000Z'),
            },
          },
        },
      } as never,
      ctx: ctx as never,
    })

    expect(task.deletedAt).toBeNull()
    expect(em.transactional).toHaveBeenCalled()
    expect(em.flush).toHaveBeenCalled()
  })

  it('delete undo refuses when task status is no longer cancelled', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const task = openTask({
      status: 'open',
      putawayKey: null,
      deletedAt: new Date('2026-08-26T12:00:00.000Z'),
    })

    findOneWithDecryption.mockImplementation(async (_em, entity) => {
      if (entity === PutawayTask) return task
      return null
    })

    const handler = commandRegistry.get('wms.putaway-tasks.delete')
    await expect(
      handler!.undo!({
        logEntry: {
          commandPayload: {
            undo: {
              before: {
                id: TASK_ID,
                organizationId: ORG,
                tenantId: TENANT,
                warehouseId: '55555555-5555-4555-8555-555555555555',
                sourceLocationId: '66666666-6666-4666-8666-666666666661',
                targetLocationId: null,
                catalogVariantId: '77777777-7777-4777-8777-777777777777',
                lotId: null,
                quantity: '5',
                status: 'cancelled',
                assignedTo: null,
                priority: 5,
                putawayKey: null,
                metadata: null,
                createdAt: new Date('2026-08-01T00:00:00.000Z'),
                updatedAt: new Date('2026-08-01T00:00:00.000Z'),
                deletedAt: new Date('2026-08-26T12:00:00.000Z'),
              },
            },
          },
        } as never,
        ctx: ctx as never,
      }),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'invalid_putaway_state' },
    } satisfies Partial<CrudHttpError>)

    expect(task.deletedAt).toBeInstanceOf(Date)
    expect(em.flush).not.toHaveBeenCalled()
  })
})

describe('wms.putaway-tasks.update execute lock', () => {
  beforeAll(async () => {
    await import('../putaway')
  })

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
  })

  it('update loads task with PESSIMISTIC_WRITE inside a transaction', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const task = openTask()

    findOneWithDecryption.mockImplementation(async (_em, entity, _where, options) => {
      if (entity === PutawayTask) {
        expect(options).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
        return task
      }
      return null
    })
    findWithDecryption.mockResolvedValue([])

    const handler = commandRegistry.get('wms.putaway-tasks.update')
    const result = await handler!.execute(
      { id: TASK_ID, priority: 3 },
      ctx as never,
    )

    expect(result).toEqual({ taskId: TASK_ID })
    expect(task.priority).toBe(3)
    expect(task.assignedTo).toBeNull()
    expect(em.transactional).toHaveBeenCalled()
    expect(findOneWithDecryption).toHaveBeenCalledWith(
      em,
      PutawayTask,
      { id: TASK_ID, deletedAt: null },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
      expect.objectContaining({ tenantId: TENANT, organizationId: ORG }),
    )
  })

  it('update refuses assignedTo (use POST .../assign)', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const task = openTask()

    findOneWithDecryption.mockImplementation(async (_em, entity) => {
      if (entity === PutawayTask) return task
      return null
    })

    const handler = commandRegistry.get('wms.putaway-tasks.update')
    await expect(
      handler!.execute({ id: TASK_ID, assignedTo: ASSIGNEE }, ctx as never),
    ).rejects.toMatchObject({
      status: 422,
      body: { error: 'lifecycle_field_forbidden' },
    } satisfies Partial<CrudHttpError>)

    expect(task.assignedTo).toBeNull()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('update refuses done status after lock (complete race)', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const task = openTask({ status: 'done', quantity: '5' })

    findOneWithDecryption.mockImplementation(async (_em, entity) => {
      if (entity === PutawayTask) return task
      return null
    })

    const handler = commandRegistry.get('wms.putaway-tasks.update')
    await expect(
      handler!.execute({ id: TASK_ID, quantity: 99 }, ctx as never),
    ).rejects.toMatchObject({ status: 409 } satisfies Partial<CrudHttpError>)

    expect(task.quantity).toBe('5')
    expect(em.flush).not.toHaveBeenCalled()
  })
})

describe('wms.putaway-tasks.update undo', () => {
  beforeAll(async () => {
    await import('../putaway')
  })

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
  })

  function beforeSnapshot(overrides: Record<string, unknown> = {}) {
    return {
      id: TASK_ID,
      organizationId: ORG,
      tenantId: TENANT,
      warehouseId: '55555555-5555-4555-8555-555555555555',
      sourceLocationId: '66666666-6666-4666-8666-666666666666',
      targetLocationId: null,
      catalogVariantId: '77777777-7777-4777-8777-777777777777',
      lotId: null,
      quantity: '5',
      status: 'open',
      assignedTo: null,
      priority: 5,
      metadata: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      ...overrides,
    }
  }

  it('undo restores prior snapshot under lock when task is still open', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const task = openTask({
      quantity: '9',
      priority: 1,
      assignedTo: ASSIGNEE,
    })

    findOneWithDecryption.mockImplementation(async (_em, entity, _where, options) => {
      if (entity === PutawayTask) {
        expect(options).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
        return task
      }
      return null
    })

    const handler = commandRegistry.get('wms.putaway-tasks.update')
    await handler!.undo!({
      logEntry: {
        commandPayload: {
          undo: { before: beforeSnapshot() },
        },
      } as never,
      ctx: ctx as never,
    })

    expect(task.quantity).toBe('5')
    expect(task.priority).toBe(5)
    expect(task.assignedTo).toBeNull()
    expect(task.status).toBe('open')
    expect(em.transactional).toHaveBeenCalled()
    expect(em.flush).toHaveBeenCalled()
  })

  it.each(['done', 'cancelled'] as const)(
    'refuses undo when current status is %s (would reopen terminal task)',
    async (status) => {
      const em = createEm()
      const ctx = createCtx(em)
      const task = openTask({ status, putawayKey: status === 'done' ? 'wms:asn:attempt-1' : null })

      findOneWithDecryption.mockImplementation(async (_em, entity) => {
        if (entity === PutawayTask) return task
        return null
      })

      const handler = commandRegistry.get('wms.putaway-tasks.update')
      await expect(
        handler!.undo!({
          logEntry: {
            commandPayload: {
              undo: { before: beforeSnapshot({ status: 'open' }) },
            },
          } as never,
          ctx: ctx as never,
        }),
      ).rejects.toMatchObject({
        status: 409,
        body: { error: 'invalid_putaway_state' },
      } satisfies Partial<CrudHttpError>)

      expect(task.status).toBe(status)
      expect(em.flush).not.toHaveBeenCalled()
    },
  )
})

describe('wms.putaway-tasks.create staging availability', () => {
  beforeAll(async () => {
    await import('../putaway')
  })

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
  })

  it('refuses create when staging balance is insufficient', async () => {
    const em = createEm()
    em.persist.mockImplementation(() => em)
    const ctx = createCtx(em)

    findOneWithDecryption.mockResolvedValue(null)
    findWithDecryption.mockResolvedValue([])

    const handler = commandRegistry.get('wms.putaway-tasks.create')
    await expect(
      handler!.execute(
        {
          organizationId: ORG,
          tenantId: TENANT,
          warehouseId: '55555555-5555-4555-8555-555555555555',
          sourceLocationId: '66666666-6666-4666-8666-666666666666',
          catalogVariantId: '77777777-7777-4777-8777-777777777777',
          quantity: 5,
        },
        ctx as never,
      ),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'insufficient_stock' },
    } satisfies Partial<CrudHttpError>)

    expect(em.transactional).toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
  })
})

describe('wms.putaway-tasks.create undo', () => {
  beforeAll(async () => {
    await import('../putaway')
  })

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
  })

  it('undo soft-deletes open task under lock', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const task = openTask()

    findOneWithDecryption.mockImplementation(async (_em, entity) => {
      if (entity === PutawayTask) return task
      return null
    })

    const handler = commandRegistry.get('wms.putaway-tasks.create')
    await handler!.undo!({
      logEntry: {
        commandPayload: {
          undo: {
            after: {
              id: TASK_ID,
              organizationId: ORG,
              tenantId: TENANT,
              warehouseId: '55555555-5555-4555-8555-555555555555',
              sourceLocationId: '66666666-6666-4666-8666-666666666666',
              targetLocationId: null,
              catalogVariantId: '77777777-7777-4777-8777-777777777777',
              lotId: null,
              quantity: '5',
              status: 'open',
              assignedTo: null,
              priority: 5,
              metadata: null,
              createdAt: '2026-08-01T00:00:00.000Z',
              updatedAt: '2026-08-01T00:00:00.000Z',
            },
          },
        },
      } as never,
      ctx: ctx as never,
    })

    expect(task.deletedAt).toBeInstanceOf(Date)
    expect(em.transactional).toHaveBeenCalled()
    expect(em.flush).toHaveBeenCalled()
  })

  it('refuses undo when task is already done', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const task = openTask({ status: 'done', putawayKey: 'wms:asn:attempt-1' })

    findOneWithDecryption.mockImplementation(async (_em, entity) => {
      if (entity === PutawayTask) return task
      return null
    })

    const handler = commandRegistry.get('wms.putaway-tasks.create')
    await expect(
      handler!.undo!({
        logEntry: {
          commandPayload: {
            undo: {
              after: {
                id: TASK_ID,
                organizationId: ORG,
                tenantId: TENANT,
                warehouseId: '55555555-5555-4555-8555-555555555555',
                sourceLocationId: '66666666-6666-4666-8666-666666666666',
                targetLocationId: null,
                catalogVariantId: '77777777-7777-4777-8777-777777777777',
                lotId: null,
                quantity: '5',
                status: 'open',
                assignedTo: null,
                priority: 5,
                metadata: null,
                createdAt: '2026-08-01T00:00:00.000Z',
                updatedAt: '2026-08-01T00:00:00.000Z',
              },
            },
          },
        } as never,
        ctx: ctx as never,
      }),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'invalid_putaway_state' },
    } satisfies Partial<CrudHttpError>)

    expect(task.deletedAt).toBeNull()
    expect(em.flush).not.toHaveBeenCalled()
  })
})
