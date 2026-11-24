/** @jest-environment node */

// A1 extraction (`.ai/specs/analysis/ANALYSIS-2026-10-26-availability-release-5.md`):
// exercises `WmsReservationService.reserveInTransaction`/`.releaseInTransaction`
// DIRECTLY — not through the `wms.inventory.reserve`/`.release` commands — to
// prove the extraction preserves the pre-extraction behavior (FOR UPDATE lock
// ordering, allocation, idempotent replay) independent of the thin command
// wrapper. `inventory-actions.reserve-release.test.ts` is the existing
// regression net for the commands themselves; this file is the new regression
// net for the service a future in-process caller (`availability`, Phase 2)
// will call directly with its own transactional `EntityManager`.
import { LockMode } from '@mikro-orm/core'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { WmsReservationService } from '../wmsReservationService'
import {
  InventoryBalance,
  InventoryReservation,
  ProductInventoryProfile,
  Warehouse,
} from '../../data/entities'
import {
  inventoryReservationCreateSchema,
  inventoryReservationReleaseSchema,
} from '../../data/validators'

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
const LOCATION_A = '66666666-6666-4666-8666-666666666661'
const LOCATION_B = '66666666-6666-4666-8666-666666666662'
const VARIANT_ID = '77777777-7777-4777-8777-777777777777'
const USER_ID = '99999999-9999-4999-8999-999999999999'
const ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const RESERVATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BALANCE_ID_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const BALANCE_ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'

type FakeEm = ReturnType<typeof createEm>

function createEm(opts: { transactional?: boolean } = {}) {
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
    execute: jest.fn(async () => [{ acquired: true }]),
  } as Record<string, unknown>
  em.fork = jest.fn(() => em)
  if (opts.transactional !== false) {
    em.transactional = jest.fn(async (cb: (trx: unknown) => Promise<unknown>) => cb(em))
  }
  return em as unknown as FakeEm & { transactional?: jest.Mock }
}

function createCtx(em: FakeEm) {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        throw new Error(`Unexpected resolve: ${name}`)
      },
    },
    auth: { sub: USER_ID, tenantId: TENANT, orgId: ORG },
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  } as unknown as CommandRuntimeContext
}

function makeBalance(overrides: Record<string, unknown> = {}) {
  return {
    id: BALANCE_ID_A,
    tenantId: TENANT,
    organizationId: ORG,
    warehouse: { id: WAREHOUSE_ID },
    location: { id: LOCATION_A },
    catalogVariantId: VARIANT_ID,
    lot: null,
    serialNumber: null,
    quantityOnHand: '10',
    quantityReserved: '0',
    quantityAllocated: '0',
    createdAt: new Date('2024-01-01'),
    ...overrides,
  }
}

function makeReservation(overrides: Record<string, unknown> = {}) {
  return {
    id: RESERVATION_ID,
    tenantId: TENANT,
    organizationId: ORG,
    warehouse: { id: WAREHOUSE_ID },
    catalogVariantId: VARIANT_ID,
    lot: null,
    serialNumber: null,
    quantity: '8',
    sourceType: 'order',
    sourceId: ORDER_ID,
    status: 'active',
    metadata: {
      allocatedBuckets: [
        { balanceId: BALANCE_ID_A, locationId: LOCATION_A, lotId: null, serialNumber: null, quantity: 5 },
        { balanceId: BALANCE_ID_B, locationId: LOCATION_B, lotId: null, serialNumber: null, quantity: 3 },
      ],
      allocationState: 'reserved',
    },
    ...overrides,
  }
}

function makeReserveInput(overrides: Record<string, unknown> = {}) {
  return inventoryReservationCreateSchema.parse({
    organizationId: ORG,
    tenantId: TENANT,
    warehouseId: WAREHOUSE_ID,
    catalogVariantId: VARIANT_ID,
    quantity: 8,
    sourceType: 'order',
    sourceId: ORDER_ID,
    performedBy: USER_ID,
    ...overrides,
  })
}

function makeReleaseInput(overrides: Record<string, unknown> = {}) {
  return inventoryReservationReleaseSchema.parse({
    organizationId: ORG,
    tenantId: TENANT,
    reservationId: RESERVATION_ID,
    reason: 'manual_release',
    performedBy: USER_ID,
    ...overrides,
  })
}

describe('WmsReservationService.reserveInTransaction', () => {
  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
  })

  it('locks candidate balances with PESSIMISTIC_WRITE ordered by createdAt/id, splits allocation across two warehouse buckets, and persists the reservation', async () => {
    const service = new WmsReservationService()
    const em = createEm()
    const balanceA = makeBalance({ id: BALANCE_ID_A, location: { id: LOCATION_A }, quantityOnHand: '5', createdAt: new Date('2024-01-01') })
    const balanceB = makeBalance({ id: BALANCE_ID_B, location: { id: LOCATION_B }, quantityOnHand: '5', createdAt: new Date('2024-01-02') })

    findOneWithDecryption.mockImplementation((_em: unknown, entity: unknown, where: Record<string, unknown>) => {
      if (entity === Warehouse) return { id: WAREHOUSE_ID, tenantId: TENANT, organizationId: ORG }
      if (entity === InventoryReservation) return null
      if (entity === ProductInventoryProfile) return null
      if (entity === InventoryBalance) {
        if (where?.location === LOCATION_A) return balanceA
        if (where?.location === LOCATION_B) return balanceB
      }
      return null
    })

    findWithDecryption.mockImplementation((_em: unknown, entity: unknown) => {
      if (entity === InventoryBalance) return [balanceA, balanceB]
      return []
    })

    const result = await service.reserveInTransaction(em, createCtx(em), makeReserveInput({ quantity: 8 }))

    expect(result.idempotentReplay).toBe(false)
    expect(result.reservationId).toBe('generated-id')
    expect(result.touchedBalances).toHaveLength(2)
    expect(Number(balanceA.quantityReserved)).toBe(5)
    expect(Number(balanceB.quantityReserved)).toBe(3)
    expect(em.persist).toHaveBeenCalled()
    expect(em.flush).toHaveBeenCalled()

    const balanceLockCall = findWithDecryption.mock.calls.find(([, entity]) => entity === InventoryBalance)
    expect(balanceLockCall?.[3]).toMatchObject({
      lockMode: LockMode.PESSIMISTIC_WRITE,
      orderBy: { createdAt: 'asc', id: 'asc' },
    })
  })

  it('returns the existing reservation without mutating balances on idempotent replay', async () => {
    const service = new WmsReservationService()
    const em = createEm()
    const existingReservation = makeReservation()

    findOneWithDecryption.mockImplementation((_em: unknown, entity: unknown) => {
      if (entity === Warehouse) return { id: WAREHOUSE_ID, tenantId: TENANT, organizationId: ORG }
      if (entity === InventoryReservation) return existingReservation
      return null
    })
    findWithDecryption.mockReturnValue([])

    const result = await service.reserveInTransaction(em, createCtx(em), makeReserveInput({ quantity: 8 }))

    expect(result.idempotentReplay).toBe(true)
    expect(result.reservationId).toBe(RESERVATION_ID)
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('runs the operation directly on the caller em when it exposes no .transactional', async () => {
    // A limited fake EntityManager with no `.transactional` exercises
    // `runInTransaction`'s fallback branch. A real MikroORM manager that is
    // already mid-transaction keeps `.transactional` and opens a savepoint;
    // that path is covered by wmsReservationService.integration.test.ts.
    const service = new WmsReservationService()
    const em = createEm({ transactional: false })
    const existingReservation = makeReservation()

    findOneWithDecryption.mockImplementation((_em: unknown, entity: unknown) => {
      if (entity === Warehouse) return { id: WAREHOUSE_ID, tenantId: TENANT, organizationId: ORG }
      if (entity === InventoryReservation) return existingReservation
      return null
    })
    findWithDecryption.mockReturnValue([])

    const result = await service.reserveInTransaction(em, createCtx(em), makeReserveInput({ quantity: 8 }))

    expect(result.idempotentReplay).toBe(true)
    expect(result.reservationId).toBe(RESERVATION_ID)
  })

  it('throws insufficient_stock when no available quantity exists', async () => {
    const service = new WmsReservationService()
    const em = createEm()
    const balance = makeBalance({ quantityOnHand: '5', quantityReserved: '5' })

    findOneWithDecryption.mockImplementation((_em: unknown, entity: unknown) => {
      if (entity === Warehouse) return { id: WAREHOUSE_ID, tenantId: TENANT, organizationId: ORG }
      if (entity === InventoryReservation) return null
      if (entity === ProductInventoryProfile) return null
      return null
    })
    findWithDecryption.mockImplementation((_em: unknown, entity: unknown) => {
      if (entity === InventoryBalance) return [balance]
      return []
    })

    await expect(
      service.reserveInTransaction(em, createCtx(em), makeReserveInput({ quantity: 3 })),
    ).rejects.toMatchObject({ status: 409, body: { error: 'insufficient_stock' } })
  })
})

describe('WmsReservationService.releaseInTransaction', () => {
  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
  })

  it('decrements quantityReserved across every allocated bucket and marks the reservation released', async () => {
    const service = new WmsReservationService()
    const em = createEm()
    const reservation = makeReservation()
    const balanceA = makeBalance({ id: BALANCE_ID_A, location: { id: LOCATION_A }, quantityReserved: '5' })
    const balanceB = makeBalance({ id: BALANCE_ID_B, location: { id: LOCATION_B }, quantityReserved: '3' })

    findOneWithDecryption.mockImplementation((_em: unknown, entity: unknown, where: Record<string, unknown>) => {
      if (entity === InventoryReservation) return reservation
      if (entity === InventoryBalance) {
        if (where?.id === BALANCE_ID_A) return balanceA
        if (where?.id === BALANCE_ID_B) return balanceB
      }
      return null
    })

    const result = await service.releaseInTransaction(em, createCtx(em), makeReleaseInput())

    expect(result.reservationId).toBe(RESERVATION_ID)
    expect(Number(balanceA.quantityReserved)).toBe(0)
    expect(Number(balanceB.quantityReserved)).toBe(0)
    expect(reservation.status).toBe('released')
    expect(em.flush).toHaveBeenCalled()
  })

  it('throws balance_integrity_violation when a bucket would go negative (ledger drift)', async () => {
    const service = new WmsReservationService()
    const em = createEm()
    const reservation = makeReservation()
    const driftedBalanceA = makeBalance({ id: BALANCE_ID_A, location: { id: LOCATION_A }, quantityReserved: '2' })

    findOneWithDecryption.mockImplementation((_em: unknown, entity: unknown, where: Record<string, unknown>) => {
      if (entity === InventoryReservation) return reservation
      if (entity === InventoryBalance) {
        if (where?.id === BALANCE_ID_A) return driftedBalanceA
      }
      return null
    })

    await expect(
      service.releaseInTransaction(em, createCtx(em), makeReleaseInput()),
    ).rejects.toMatchObject({ status: 409, body: { error: 'balance_integrity_violation' } })
  })
})

describe('WmsReservationService scope enforcement', () => {
  const OTHER_ORG = '33333333-3333-4333-8333-333333333333'

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
  })

  it('rejects a reserve for an organization outside the actor scope before any lookup or write', async () => {
    const service = new WmsReservationService()
    const em = createEm()

    await expect(
      service.reserveInTransaction(em, createCtx(em), makeReserveInput({ organizationId: OTHER_ORG })),
    ).rejects.toMatchObject({ status: 403 })
    expect(findOneWithDecryption).not.toHaveBeenCalled()
    expect(findWithDecryption).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('rejects a release for an organization outside the actor scope before locking the reservation', async () => {
    const service = new WmsReservationService()
    const em = createEm()

    await expect(
      service.releaseInTransaction(em, createCtx(em), makeReleaseInput({ organizationId: OTHER_ORG })),
    ).rejects.toMatchObject({ status: 403 })
    expect(findOneWithDecryption).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('puts the authorized tenant and organization into every warehouse, balance and reservation predicate', async () => {
    const service = new WmsReservationService()
    const em = createEm()
    const balance = makeBalance({ quantityOnHand: '10' })

    findOneWithDecryption.mockImplementation((_em: unknown, entity: unknown) => {
      if (entity === Warehouse) return { id: WAREHOUSE_ID, tenantId: TENANT, organizationId: ORG }
      if (entity === InventoryBalance) return balance
      return null
    })
    findWithDecryption.mockImplementation((_em: unknown, entity: unknown) => {
      if (entity === InventoryBalance) return [balance]
      return []
    })

    await service.reserveInTransaction(em, createCtx(em), makeReserveInput({ quantity: 4 }))

    const scopedEntities = [Warehouse, InventoryBalance, InventoryReservation]
    const scopedCalls = [...findOneWithDecryption.mock.calls, ...findWithDecryption.mock.calls].filter(
      (call) => scopedEntities.includes(call[1]),
    )
    expect(scopedCalls.length).toBeGreaterThanOrEqual(4)
    for (const call of scopedCalls) {
      expect(call[2]).toMatchObject({ tenantId: TENANT, organizationId: ORG })
    }
  })
})

describe('WmsReservationService descendant-org release (M1)', () => {
  const PARENT_ORG = '44444444-4444-4444-8444-444444444444'

  function createParentScopeCtx(em: FakeEm) {
    return {
      ...createCtx(em),
      auth: { sub: USER_ID, tenantId: TENANT, orgId: PARENT_ORG },
      organizationScope: {
        selectedId: PARENT_ORG,
        filterIds: [PARENT_ORG, ORG],
        allowedIds: [PARENT_ORG, ORG],
        tenantId: TENANT,
      },
      selectedOrganizationId: PARENT_ORG,
      organizationIds: [PARENT_ORG, ORG],
    } as unknown as CommandRuntimeContext
  }

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
  })

  it('releases a reservation owned by a descendant org (ORG) when the actor has the parent org selected', async () => {
    const service = new WmsReservationService()
    const em = createEm()
    const reservation = makeReservation() // organizationId: ORG — a descendant of PARENT_ORG
    const balanceA = makeBalance({ id: BALANCE_ID_A, location: { id: LOCATION_A }, quantityReserved: '5' })
    const balanceB = makeBalance({ id: BALANCE_ID_B, location: { id: LOCATION_B }, quantityReserved: '3' })
    let reservationLookupWhere: Record<string, unknown> | undefined
    const balanceLookupWheres: Record<string, unknown>[] = []

    findOneWithDecryption.mockImplementation((_em: unknown, entity: unknown, where: Record<string, unknown>) => {
      if (entity === InventoryReservation) {
        reservationLookupWhere = where
        return reservation
      }
      if (entity === InventoryBalance) {
        balanceLookupWheres.push(where)
        if (where?.id === BALANCE_ID_A) return balanceA
        if (where?.id === BALANCE_ID_B) return balanceB
      }
      return null
    })

    const result = await service.releaseInTransaction(
      em,
      createParentScopeCtx(em),
      makeReleaseInput({ organizationId: PARENT_ORG }),
    )

    expect(result.reservationId).toBe(RESERVATION_ID)
    // The lookup widens to the parent's descendant-expanded scope instead of
    // requiring an exact match on the caller's (parent) organizationId.
    expect(reservationLookupWhere).toMatchObject({ organizationId: { $in: [PARENT_ORG, ORG] } })
    // Balances are scoped to the reservation's OWN org (ORG), never the
    // caller's input org (PARENT_ORG) — otherwise the balance lookup would
    // miss and the release would silently no-op the ledger.
    expect(balanceLookupWheres.length).toBeGreaterThan(0)
    for (const where of balanceLookupWheres) {
      expect(where.organizationId).toBe(ORG)
    }
    expect(Number(balanceA.quantityReserved)).toBe(0)
    expect(Number(balanceB.quantityReserved)).toBe(0)
    expect(reservation.status).toBe('released')
  })
})
