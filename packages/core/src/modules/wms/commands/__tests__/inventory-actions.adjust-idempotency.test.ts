/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import {
  beginTransactionLifetime,
  completeTransactionLifetime,
} from '@open-mercato/shared/lib/commands/transaction-lifetime'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { emitWmsEvent } from '../../events'
import {
  InventoryBalance,
  InventoryMovement,
  Warehouse,
  WarehouseLocation,
} from '../../data/entities'

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
const WAREHOUSE_ID = '55555555-5555-4555-8555-555555555555'
const LOCATION_ID = '66666666-6666-4666-8666-666666666666'
const VARIANT_ID = '77777777-7777-4777-8777-777777777777'
const USER_ID = '99999999-9999-4999-8999-999999999999'
const REFERENCE_ID = '88888888-8888-4888-8888-888888888888'
const MOVEMENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

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
        if (name === 'rbacService') return { userHasAllFeatures: async () => true }
        throw new Error(`Unexpected resolve: ${name}`)
      },
    },
    auth: { sub: USER_ID, tenantId: TENANT, orgId: ORG },
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  }
}

function baseFixtures(balanceOnHand: string) {
  const balance = {
    id: 'balance-1',
    tenantId: TENANT,
    organizationId: ORG,
    warehouse: { id: WAREHOUSE_ID },
    location: { id: LOCATION_ID },
    catalogVariantId: VARIANT_ID,
    lot: null,
    serialNumber: null,
    quantityOnHand: balanceOnHand,
    quantityReserved: '0',
    quantityAllocated: '0',
  }
  const existingMovement = {
    id: MOVEMENT_ID,
    tenantId: TENANT,
    organizationId: ORG,
    lot: null,
    quantity: '3',
  }
  return { balance, existingMovement }
}

function mockWarehouseLocationBalance(
  balance: ReturnType<typeof baseFixtures>['balance'],
  onMovement: (where: Record<string, unknown> | undefined) => unknown,
) {
  findOneWithDecryption.mockImplementation(async (_em, entity, where) => {
    if (entity === Warehouse) {
      return { id: WAREHOUSE_ID, tenantId: TENANT, organizationId: ORG, deletedAt: null }
    }
    if (entity === WarehouseLocation) {
      return {
        id: LOCATION_ID,
        tenantId: TENANT,
        organizationId: ORG,
        warehouse: { id: WAREHOUSE_ID },
        deletedAt: null,
        isActive: true,
      }
    }
    if (entity === InventoryBalance) return balance
    if (entity === InventoryMovement) {
      return onMovement(where as Record<string, unknown> | undefined)
    }
    return null
  })
}

describe('wms inventory adjust / cycle-count idempotent replay', () => {
  beforeAll(async () => {
    await import('../inventory-actions')
  })

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
  })

  it('adjust does not skew balance when unique-constraint race returns existing movement', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const { balance, existingMovement } = baseFixtures('10')
    let idempotencyLookups = 0

    mockWarehouseLocationBalance(balance, (where) => {
      if (where && 'idempotencyKey' in where) {
        idempotencyLookups += 1
        // 1: adjust early find — miss
        // 2: persistMovement early find — miss
        // 3+: unique-race recovery find — hit
        if (idempotencyLookups <= 2) return null
        return existingMovement
      }
      return null
    })

    em.create.mockImplementation(() => {
      throw Object.assign(new Error('unique'), {
        code: '23505',
        name: 'UniqueConstraintViolationException',
      })
    })

    const handler = commandRegistry.get('wms.inventory.adjust')
    const result = await handler!.execute(
      {
        organizationId: ORG,
        tenantId: TENANT,
        warehouseId: WAREHOUSE_ID,
        locationId: LOCATION_ID,
        catalogVariantId: VARIANT_ID,
        delta: 3,
        reason: 'correction',
        referenceType: 'manual',
        referenceId: REFERENCE_ID,
        performedBy: USER_ID,
      },
      ctx as never,
    )

    expect(result).toEqual({ movementId: MOVEMENT_ID })
    expect(balance.quantityOnHand).toBe('10')
  })

  // A caller that already holds a transaction (e.g. the CSV import row lock) passes it as
  // ctx.transactionalEm so this command reuses it instead of forking its own connection —
  // a holder of a blocking lock that also needs a connection of its own can starve the pool.
  it('reuses ctx.transactionalEm instead of forking its own connection when the caller supplies one', async () => {
    const containerEm = createEm()
    const lockEm = createEm()
    const ctx = { ...createCtx(containerEm), transactionalEm: lockEm }
    const { balance } = baseFixtures('10')
    mockWarehouseLocationBalance(balance, () => null)

    const handler = commandRegistry.get('wms.inventory.adjust')
    const result = await handler!.execute(
      {
        organizationId: ORG,
        tenantId: TENANT,
        warehouseId: WAREHOUSE_ID,
        locationId: LOCATION_ID,
        catalogVariantId: VARIANT_ID,
        delta: 3,
        reason: 'correction',
        referenceType: 'manual',
        referenceId: REFERENCE_ID,
        performedBy: USER_ID,
      },
      ctx as never,
    )

    expect(result).toEqual({ movementId: 'generated-id' })
    // The write itself must run on the caller's transaction, not a second one opened
    // off the container's own em (the low-stock check below is an unrelated, deliberately
    // separate fire-and-forget read, so it is left out of this assertion).
    expect(containerEm.transactional).not.toHaveBeenCalled()
    expect(lockEm.transactional).toHaveBeenCalled()
  })

  // ctx.transactionalEm's write above only ran inside a SAVEPOINT: the caller that owns the
  // real transaction (e.g. the CSV import row lock) has not committed yet when execute()
  // returns. Publishing the movement event / cache invalidation at that point would let an
  // observer see a row it cannot read yet, or one that is later rolled back entirely.
  it('defers adjust side effects until the ambient transaction lifetime actually commits', async () => {
    const containerEm = createEm()
    const lockEm = createEm()
    const ctx = { ...createCtx(containerEm), transactionalEm: lockEm }
    const { balance } = baseFixtures('10')
    mockWarehouseLocationBalance(balance, () => null)
    ;(emitWmsEvent as jest.Mock).mockClear()
    ;(emitCrudSideEffects as jest.Mock).mockClear()

    const lifetime = beginTransactionLifetime(lockEm as never)
    const handler = commandRegistry.get('wms.inventory.adjust')
    const result = await handler!.execute(
      {
        organizationId: ORG,
        tenantId: TENANT,
        warehouseId: WAREHOUSE_ID,
        locationId: LOCATION_ID,
        catalogVariantId: VARIANT_ID,
        delta: 3,
        reason: 'correction',
        referenceType: 'manual',
        referenceId: REFERENCE_ID,
        performedBy: USER_ID,
      },
      ctx as never,
    )

    expect(result).toEqual({ movementId: 'generated-id' })
    expect(emitWmsEvent).not.toHaveBeenCalled()
    expect(emitCrudSideEffects).not.toHaveBeenCalled()

    await completeTransactionLifetime(lockEm as never, lifetime, 'committed')

    expect(emitCrudSideEffects).toHaveBeenCalled()
    expect(emitWmsEvent).toHaveBeenCalledWith(
      'wms.inventory.adjusted',
      expect.objectContaining({ movementId: 'generated-id' }),
    )
  })

  it('drops adjust side effects when the ambient transaction lifetime rolls back', async () => {
    const containerEm = createEm()
    const lockEm = createEm()
    const ctx = { ...createCtx(containerEm), transactionalEm: lockEm }
    const { balance } = baseFixtures('10')
    mockWarehouseLocationBalance(balance, () => null)
    ;(emitWmsEvent as jest.Mock).mockClear()
    ;(emitCrudSideEffects as jest.Mock).mockClear()

    const lifetime = beginTransactionLifetime(lockEm as never)
    const handler = commandRegistry.get('wms.inventory.adjust')
    await handler!.execute(
      {
        organizationId: ORG,
        tenantId: TENANT,
        warehouseId: WAREHOUSE_ID,
        locationId: LOCATION_ID,
        catalogVariantId: VARIANT_ID,
        delta: 3,
        reason: 'correction',
        referenceType: 'manual',
        referenceId: REFERENCE_ID,
        performedBy: USER_ID,
      },
      ctx as never,
    )

    await completeTransactionLifetime(lockEm as never, lifetime, 'rolled_back')

    expect(emitCrudSideEffects).not.toHaveBeenCalled()
    expect(emitWmsEvent).not.toHaveBeenCalled()
  })

  it('cycle-count does not skew balance when unique-constraint race returns existing movement', async () => {
    const em = createEm()
    const ctx = createCtx(em)
    const { balance, existingMovement } = baseFixtures('10')
    let idempotencyLookups = 0

    mockWarehouseLocationBalance(balance, (where) => {
      if (where && 'idempotencyKey' in where) {
        idempotencyLookups += 1
        if (idempotencyLookups <= 2) return null
        return existingMovement
      }
      // resolveReceivedAtForBalance — no prior movement
      return null
    })

    em.create.mockImplementation(() => {
      throw Object.assign(new Error('unique'), {
        code: '23505',
        name: 'UniqueConstraintViolationException',
      })
    })

    const handler = commandRegistry.get('wms.inventory.cycleCount')
    const result = await handler!.execute(
      {
        organizationId: ORG,
        tenantId: TENANT,
        warehouseId: WAREHOUSE_ID,
        locationId: LOCATION_ID,
        catalogVariantId: VARIANT_ID,
        countedQuantity: 13,
        autoAdjust: true,
        reason: 'cycle count',
        referenceId: REFERENCE_ID,
        performedBy: USER_ID,
      },
      ctx as never,
    )

    expect(result).toEqual({ adjustmentDelta: '3', movementId: MOVEMENT_ID })
    expect(balance.quantityOnHand).toBe('10')
  })
})
