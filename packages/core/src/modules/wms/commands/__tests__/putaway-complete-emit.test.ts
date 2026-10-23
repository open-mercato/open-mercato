/** @jest-environment node */

import { LockMode } from '@mikro-orm/core'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { PutawayTask } from '../../data/entities'
import { emitWmsEvent } from '../../events'
import { buildPutawayCompleteReferenceId } from '../../lib/putaway'

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

const findPutawayCompleteMovementByReference = jest.fn()
const applyInventoryMoveInTransaction = jest.fn()
const emitInventoryMoveSideEffects = jest.fn(async () => undefined)

jest.mock('../inventory-actions', () => ({
  findPutawayCompleteMovementByReference: (...args: unknown[]) =>
    findPutawayCompleteMovementByReference(...args),
  applyInventoryMoveInTransaction: (...args: unknown[]) => applyInventoryMoveInTransaction(...args),
  emitInventoryMoveSideEffects: (...args: unknown[]) => emitInventoryMoveSideEffects(...args),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER_ID = '99999999-9999-4999-8999-999999999999'
const TARGET_LOC = '88888888-8888-4888-8888-888888888888'
const MOVEMENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

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

function createCtx(em: ReturnType<typeof createEm>, features: string[] = ['wms.manage_putaway']) {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return {}
        if (name === 'rbacService') {
          return {
            userHasAllFeatures: async (_userId: string, required: string[]) =>
              required.every((feature) => features.includes(feature) || features.includes('wms.*')),
          }
        }
        throw new Error(`Unexpected resolve: ${name}`)
      },
    },
    auth: { sub: USER_ID, tenantId: TENANT, orgId: ORG, features },
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
    assignedTo: USER_ID,
    priority: 5,
    putawayKey: 'wms:asn:attempt-1',
    metadata: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  }
}

describe('wms.putaway-tasks.complete event emit', () => {
  beforeAll(async () => {
    await import('../putaway')
  })

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
    findPutawayCompleteMovementByReference.mockReset()
    applyInventoryMoveInTransaction.mockReset()
    emitInventoryMoveSideEffects.mockClear()
    ;(emitWmsEvent as jest.Mock).mockClear()
  })

  it('does not emit wms.putaway.completed on move-succeeded status-finish retry', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const task = openTask({ status: 'in_progress' })
    const existingMovement = {
      id: MOVEMENT_ID,
      quantity: '5',
      catalogVariantId: task.catalogVariantId,
    }

    findOneWithDecryption.mockImplementation(async (_em, entity, _where, options) => {
      if (entity === PutawayTask) {
        expect(options).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
        return task
      }
      return null
    })
    findPutawayCompleteMovementByReference.mockResolvedValue(existingMovement)

    const handler = commandRegistry.get('wms.putaway-tasks.complete')
    const result = await handler!.execute(
      {
        organizationId: ORG,
        tenantId: TENANT,
        id: TASK_ID,
        targetLocationId: TARGET_LOC,
        confirmedQuantity: 5,
        performedBy: USER_ID,
      },
      ctx as never,
    )

    expect(result).toEqual({ taskId: TASK_ID, movementId: MOVEMENT_ID })
    expect(task.status).toBe('done')
    expect(applyInventoryMoveInTransaction).not.toHaveBeenCalled()
    expect(emitWmsEvent).not.toHaveBeenCalledWith(
      'wms.putaway.completed',
      expect.anything(),
    )
    expect(buildPutawayCompleteReferenceId(TASK_ID)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  })

  it('refuses operator complete when task is not assigned to them', async () => {
    const em = createEm()
    const ctx = createCtx(em, ['wms.adjust_inventory'])
    const task = openTask({
      assignedTo: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      status: 'open',
    })

    findOneWithDecryption.mockImplementation(async (_em, entity) => {
      if (entity === PutawayTask) return task
      return null
    })
    findPutawayCompleteMovementByReference.mockResolvedValue(null)

    const handler = commandRegistry.get('wms.putaway-tasks.complete')
    await expect(
      handler!.execute(
        {
          organizationId: ORG,
          tenantId: TENANT,
          id: TASK_ID,
          targetLocationId: TARGET_LOC,
          confirmedQuantity: 5,
          performedBy: USER_ID,
        },
        ctx as never,
      ),
    ).rejects.toMatchObject({ status: 403 })
  })
})
