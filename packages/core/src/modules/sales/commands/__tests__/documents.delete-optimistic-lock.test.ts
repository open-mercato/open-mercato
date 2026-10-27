import { LockMode } from '@mikro-orm/core'
import { asValue, createContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { SalesOrder } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string) => key }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/helpers'),
  emitCrudSideEffects: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(async () => ({})),
}))

type FindOptions = { lockMode?: LockMode; refresh?: boolean }
type LookupEm = { findOne: (entity: unknown, where: unknown, options?: FindOptions) => Promise<unknown> }

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
  findOneWithDecryption: async (em: LookupEm, entity: unknown, where: unknown, options?: FindOptions) =>
    em.findOne(entity, where, options),
}))

const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORG_ID = '33333333-3333-4333-8333-333333333333'
const VALIDATED_VERSION = '2026-07-17T09:30:00.500Z'
const EDITED_VERSION = '2026-07-17T09:31:00.000Z'

function setup(expectedVersion: string | null, editBeforeTransaction = false) {
  const order = { id: ORDER_ID, tenantId: TENANT_ID, organizationId: ORG_ID, updatedAt: new Date(VALIDATED_VERSION) }
  let inTransaction = false
  let persistedVersion = VALIDATED_VERSION
  const em = {
    findOne: jest.fn(async (entity: unknown, _where: unknown, options?: FindOptions) => {
      if (entity !== SalesOrder) return null
      if (options?.lockMode === LockMode.PESSIMISTIC_WRITE) {
        expect(inTransaction).toBe(true)
        expect(options.refresh).toBe(true)
        order.updatedAt = new Date(persistedVersion)
      }
      return order
    }),
    find: jest.fn(async () => []),
    nativeDelete: jest.fn(async () => 0),
    remove: jest.fn(),
    flush: jest.fn(async () => undefined),
    begin: jest.fn(async () => {
      inTransaction = true
      if (editBeforeTransaction) persistedVersion = EDITED_VERSION
    }),
    commit: jest.fn(async () => { inTransaction = false }),
    rollback: jest.fn(async () => { inTransaction = false }),
    fork() { return this },
  }
  const container = createContainer()
  container.register({ em: asValue(em), dataEngine: asValue({}) })
  const headers = expectedVersion ? { [OPTIMISTIC_LOCK_HEADER_NAME]: expectedVersion } : undefined
  const ctx = {
    container,
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
    request: new Request('https://example.test/api/sales/orders', { method: 'DELETE', headers }),
  } as CommandRuntimeContext
  const handler = commandRegistry.get('sales.orders.delete')!
  return { em, order, run: () => handler.execute({ id: ORDER_ID }, ctx) }
}

describe('sales.orders.delete optimistic locking', () => {
  beforeAll(async () => { await import('../documents') })
  beforeEach(() => { jest.clearAllMocks() })

  it('refuses an order edited between version validation and the deletion transaction', async () => {
    const { em, order, run } = setup(VALIDATED_VERSION, true)

    await expect(run()).rejects.toMatchObject({
      status: 409,
      body: { code: 'optimistic_lock_conflict', expectedUpdatedAt: VALIDATED_VERSION, currentUpdatedAt: EDITED_VERSION },
    })

    expect(order.updatedAt.toISOString()).toBe(EDITED_VERSION)
    expect(em.findOne).toHaveBeenLastCalledWith(SalesOrder,
      { id: ORDER_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true })
    expect(em.nativeDelete).not.toHaveBeenCalled()
    expect(em.remove).not.toHaveBeenCalled()
    expect(em.commit).not.toHaveBeenCalled()
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(emitCrudSideEffects).not.toHaveBeenCalled()
  })

  it.each([VALIDATED_VERSION, null])('deletes with expected version %s', async (expectedVersion) => {
    const { em, order, run } = setup(expectedVersion)

    await expect(run()).resolves.toEqual({ orderId: ORDER_ID })

    expect(em.remove).toHaveBeenCalledWith(order)
    expect(em.commit).toHaveBeenCalledTimes(1)
    expect(em.rollback).not.toHaveBeenCalled()
    expect(emitCrudSideEffects).toHaveBeenCalledTimes(1)
  })
})
