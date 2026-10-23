/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
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
const LOCATION_ID = 'aaaaaaaa-6666-4666-8666-66666666abcd'
const TARGET_LOCATION_ID = 'cccccccc-6767-4767-8767-67676767abcd'
const VARIANT_ID = 'bbbbbbbb-7777-4777-8777-77777777abcd'
const USER_ID = '99999999-9999-4999-8999-999999999999'
const REFERENCE_ID = '88888888-8888-4888-8888-888888888888'

const LOCK_SQL = 'select pg_advisory_xact_lock(hashtextextended(?, 0))'

type BalanceRow = {
  id: string
  tenantId: string
  organizationId: string
  warehouse: { id: string }
  location: { id: string }
  catalogVariantId: string
  lot: null
  serialNumber: null
  quantityOnHand: string
  quantityReserved: string
  quantityAllocated: string
}

function buildBalance(id: string, locationId: string, onHand: string): BalanceRow {
  return {
    id,
    tenantId: TENANT,
    organizationId: ORG,
    warehouse: { id: WAREHOUSE_ID },
    location: { id: locationId },
    catalogVariantId: VARIANT_ID,
    lot: null,
    serialNumber: null,
    quantityOnHand: onHand,
    quantityReserved: '0',
    quantityAllocated: '0',
  }
}

function bucketKey(locationId: string): string {
  return ['wms:inventory-balance-bucket', WAREHOUSE_ID, locationId, VARIANT_ID, '', ''].join(':')
}

function createTrx(calls: string[]) {
  return {
    create: jest.fn((entity: unknown, payload: Record<string, unknown>) => {
      if (entity === InventoryBalance) calls.push('create-balance')
      return { id: entity === InventoryBalance ? 'new-balance' : 'new-movement', ...payload }
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    execute: jest.fn(async (_sql: string, params: unknown[]) => {
      calls.push(`lock:${String(params[0])}`)
      return [{ pg_advisory_xact_lock: '' }]
    }),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
    getConnection: jest.fn(() => ({ execute: jest.fn(async () => []) })),
  }
}

function createEm(calls: string[]) {
  const trx = createTrx(calls)
  const em = {
    trx,
    execute: jest.fn(async () => {
      throw new Error('advisory lock must run on the transactional EntityManager')
    }),
    getConnection: jest.fn(() => ({ execute: jest.fn(async () => []) })),
    fork: jest.fn(),
    transactional: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  em.transactional.mockImplementation(async (cb: (tx: typeof trx) => Promise<unknown>) => cb(trx))
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

function mockLookups(calls: string[], balanceLookups: Array<BalanceRow | null>) {
  const queue = [...balanceLookups]
  findOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
    if (entity === Warehouse) return { id: WAREHOUSE_ID, tenantId: TENANT, organizationId: ORG }
    if (entity === WarehouseLocation) {
      return { id: where.id, tenantId: TENANT, organizationId: ORG, warehouse: { id: WAREHOUSE_ID } }
    }
    if (entity === InventoryBalance) {
      calls.push(`find-balance:${String(where.location)}`)
      return queue.length > 0 ? queue.shift() ?? null : null
    }
    if (entity === InventoryMovement) return null
    return null
  })
}

function receiveInput(quantity: number) {
  return {
    organizationId: ORG,
    tenantId: TENANT,
    warehouseId: WAREHOUSE_ID,
    locationId: LOCATION_ID,
    catalogVariantId: VARIANT_ID,
    quantity,
    reason: 'Receipt',
    referenceType: 'manual' as const,
    referenceId: REFERENCE_ID,
    performedBy: USER_ID,
  }
}

function moveInput(quantity: number) {
  return {
    organizationId: ORG,
    tenantId: TENANT,
    warehouseId: WAREHOUSE_ID,
    fromLocationId: LOCATION_ID,
    toLocationId: TARGET_LOCATION_ID,
    catalogVariantId: VARIANT_ID,
    quantity,
    reason: 'Move',
    referenceType: 'manual' as const,
    referenceId: REFERENCE_ID,
    performedBy: USER_ID,
  }
}

describe('wms inventory balance bucket creation', () => {
  beforeAll(async () => {
    await import('../inventory-actions')
  })

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
    findWithDecryption.mockResolvedValue([])
  })

  it('takes a bucket-scoped transaction lock and re-reads before creating a new bucket', async () => {
    const calls: string[] = []
    const em = createEm(calls)
    mockLookups(calls, [null, null])

    await commandRegistry.get('wms.inventory.receive')!.execute!(receiveInput(5), createCtx(em) as never)

    expect(calls).toEqual([
      `find-balance:${LOCATION_ID}`,
      `lock:${bucketKey(LOCATION_ID)}`,
      `find-balance:${LOCATION_ID}`,
      'create-balance',
    ])
    expect(em.execute).not.toHaveBeenCalled()
    expect(em.trx.execute).toHaveBeenCalledWith(LOCK_SQL, [bucketKey(LOCATION_ID)])
  })

  it('derives the same lock key regardless of uuid letter case', async () => {
    const calls: string[] = []
    const em = createEm(calls)
    mockLookups(calls, [null, null])
    const input = {
      ...receiveInput(5),
      locationId: LOCATION_ID.toUpperCase(),
      catalogVariantId: VARIANT_ID.toUpperCase(),
    }

    await commandRegistry.get('wms.inventory.receive')!.execute!(input, createCtx(em) as never)

    expect(em.trx.execute).toHaveBeenCalledWith(LOCK_SQL, [bucketKey(LOCATION_ID)])
  })

  it('adds to the bucket another transaction created while this one waited for the lock', async () => {
    const calls: string[] = []
    const em = createEm(calls)
    const committedByOther = buildBalance('balance-other', LOCATION_ID, '5')
    mockLookups(calls, [null, committedByOther])

    await commandRegistry.get('wms.inventory.receive')!.execute!(receiveInput(3), createCtx(em) as never)

    expect(calls).not.toContain('create-balance')
    expect(committedByOther.quantityOnHand).toBe('8')
  })

  it('does not lock when the bucket already exists', async () => {
    const calls: string[] = []
    const em = createEm(calls)
    const existing = buildBalance('balance-existing', LOCATION_ID, '2')
    mockLookups(calls, [existing])

    await commandRegistry.get('wms.inventory.receive')!.execute!(receiveInput(4), createCtx(em) as never)

    expect(em.trx.execute).not.toHaveBeenCalled()
    expect(calls).toEqual([`find-balance:${LOCATION_ID}`])
    expect(existing.quantityOnHand).toBe('6')
  })

  it('rejects a move from a bucket that does not exist without creating it', async () => {
    const calls: string[] = []
    const em = createEm(calls)
    mockLookups(calls, [null])

    await expect(
      commandRegistry.get('wms.inventory.move')!.execute!(moveInput(1), createCtx(em) as never),
    ).rejects.toMatchObject({ status: 409, body: { error: 'insufficient_stock' } })

    expect(em.trx.execute).not.toHaveBeenCalled()
    expect(calls).toEqual([`find-balance:${LOCATION_ID}`])
  })

  it('locks only the new target bucket when moving into an empty location', async () => {
    const calls: string[] = []
    const em = createEm(calls)
    const source = buildBalance('balance-source', LOCATION_ID, '10')
    mockLookups(calls, [source, null, null])

    await commandRegistry.get('wms.inventory.move')!.execute!(moveInput(4), createCtx(em) as never)

    expect(calls).toEqual([
      `find-balance:${LOCATION_ID}`,
      `find-balance:${TARGET_LOCATION_ID}`,
      `lock:${bucketKey(TARGET_LOCATION_ID)}`,
      `find-balance:${TARGET_LOCATION_ID}`,
      'create-balance',
    ])
    expect(source.quantityOnHand).toBe('6')
  })
})
