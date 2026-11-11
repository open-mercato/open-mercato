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
  } as any
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

  it('writes in a clear savepoint and replays the winning row when the insert loses the active idempotency key', async () => {
    const service = new WmsReservationService()
    const em = createEm()
    const savepointEm = createEm({ transactional: false })
    savepointEm.flush = jest.fn(async () => {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
    })
    em.transactional = jest.fn(async (cb: (trx: unknown) => Promise<unknown>, options?: { clear?: boolean }) =>
      cb(options?.clear ? savepointEm : em),
    )
    const outerBalance = makeBalance({ quantityOnHand: '10' })
    const savepointBalance = makeBalance({ quantityOnHand: '10' })
    const winner = makeReservation({ quantity: '8' })
    let keyLookups = 0

    findOneWithDecryption.mockImplementation((lookupEm: unknown, entity: unknown, where: Record<string, unknown>) => {
      if (entity === Warehouse) return { id: WAREHOUSE_ID, tenantId: TENANT, organizationId: ORG }
      if (entity === InventoryReservation && where?.idempotencyKey) {
        keyLookups += 1
        return keyLookups === 1 ? null : winner
      }
      if (entity === InventoryBalance) return lookupEm === savepointEm ? savepointBalance : outerBalance
      return null
    })
    findWithDecryption.mockImplementation((_em: unknown, entity: unknown) => (entity === InventoryBalance ? [outerBalance] : []))

    const result = await service.reserveInTransaction(em, createCtx(em), makeReserveInput({ quantity: 8 }))

    expect(result).toMatchObject({ idempotentReplay: true, reservationId: RESERVATION_ID, touchedBalances: [] })
    expect(em.transactional).toHaveBeenCalledWith(expect.any(Function), { clear: true })
    expect(savepointEm.persist).toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
    expect(Number(outerBalance.quantityReserved)).toBe(0)
    expect(keyLookups).toBe(2)
  })

  it('rethrows a non-unique write failure from the savepoint without a replay read', async () => {
    const service = new WmsReservationService()
    const em = createEm()
    em.flush = jest.fn(async () => {
      throw new Error('connection reset')
    })
    let keyLookups = 0
    findOneWithDecryption.mockImplementation((_em: unknown, entity: unknown, where: Record<string, unknown>) => {
      if (entity === Warehouse) return { id: WAREHOUSE_ID, tenantId: TENANT, organizationId: ORG }
      if (entity === InventoryReservation && where?.idempotencyKey) {
        keyLookups += 1
        return null
      }
      if (entity === InventoryBalance) return makeBalance()
      return null
    })
    findWithDecryption.mockImplementation((_em: unknown, entity: unknown) => (entity === InventoryBalance ? [makeBalance()] : []))

    await expect(service.reserveInTransaction(em, createCtx(em), makeReserveInput({ quantity: 2 }))).rejects.toThrow('connection reset')
    expect(keyLookups).toBe(1)
  })

  it('joins an already-open ambient transaction instead of starting a new one when the caller em has no .transactional', async () => {
    // Simulates the composed-caller shape the A1 extraction exists for
    // (`availability`'s future reserve, Phase 2): an EntityManager that is
    // already mid-transaction and therefore has no `.transactional` of its
    // own to call — `runInTransaction`'s documented fallback runs the
    // operation directly on that same `em` rather than opening a second
    // transaction.
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

describe('WmsReservationService.convertInTransaction', () => {
  // Step 2.2 (A1/A5/§4.4): `availability.commit` is this method's first real caller —
  // converts a checkout hold into an `order` hold in place, rebuilding the wms
  // idempotency key (which is derived from sourceType|sourceId|variant|warehouse|quantity
  // and goes stale the moment sourceType/sourceId change) and clearing `expires_at`.
  it('rewrites sourceType/sourceId, rebuilds the idempotency key, and clears expiresAt', async () => {
    const service = new WmsReservationService()
    const em = createEm()
    const reservation = makeReservation({ sourceType: 'checkout', sourceId: 'checkout-session-1', expiresAt: new Date('2024-01-01') })
    findWithDecryption.mockReset()
    findWithDecryption.mockReturnValue([])

    findOneWithDecryption.mockImplementation((_em: unknown, entity: unknown) => {
      if (entity === InventoryReservation) return reservation
      return null
    })

    const result = await service.convertInTransaction(em, createCtx(em), {
      reservationId: RESERVATION_ID,
      tenantId: TENANT,
      organizationId: ORG,
      sourceType: 'order',
      sourceId: ORDER_ID,
    })

    expect(result.reservationId).toBe(RESERVATION_ID)
    expect(reservation.sourceType).toBe('order')
    expect(reservation.sourceId).toBe(ORDER_ID)
    expect(reservation.expiresAt).toBeNull()
    expect(reservation.idempotencyKey).toBe(
      `reservation|order|${ORDER_ID}|${VARIANT_ID}|${WAREHOUSE_ID}|8`,
    )
    expect(em.flush).toHaveBeenCalled()
  })

  const convertInput = {
    reservationId: RESERVATION_ID,
    tenantId: TENANT,
    organizationId: ORG,
    sourceType: 'order' as const,
    sourceId: ORDER_ID,
  }

  function mockReservationLookup(reservation: Record<string, unknown> | null, keyOwner: Record<string, unknown> | null = null) {
    findOneWithDecryption.mockImplementation((_em: unknown, entity: unknown, where: Record<string, unknown>) => {
      if (entity === InventoryReservation) return where?.idempotencyKey ? keyOwner : reservation
      return null
    })
  }

  it('does not convert a released checkout row and leaves it untouched', async () => {
    const service = new WmsReservationService()
    const em = createEm()
    const reservation = makeReservation({ sourceType: 'checkout', sourceId: 'checkout-session-1', status: 'released' })
    mockReservationLookup(reservation)
    findWithDecryption.mockReturnValue([])

    const result = await service.convertInTransaction(em, createCtx(em), convertInput)

    expect(result.outcome).toBe('not_convertible')
    expect(result.reason).toBe('not_active')
    expect(reservation.sourceType).toBe('checkout')
    expect(reservation.sourceId).toBe('checkout-session-1')
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('reports a missing row as not convertible', async () => {
    const service = new WmsReservationService()
    const em = createEm()
    mockReservationLookup(null)

    const result = await service.convertInTransaction(em, createCtx(em), convertInput)

    expect(result).toMatchObject({ outcome: 'not_convertible', reason: 'missing', reservationEntity: null })
  })

  it('does not convert a row owned by another source or another hold', async () => {
    const service = new WmsReservationService()
    const em = createEm()
    const foreignType = makeReservation({ sourceType: 'manual', sourceId: 'x' })
    mockReservationLookup(foreignType)
    expect((await service.convertInTransaction(em, createCtx(em), convertInput)).reason).toBe('not_checkout')

    const foreignOwner = makeReservation({ sourceType: 'checkout', sourceId: 'other-session' })
    mockReservationLookup(foreignOwner)
    const result = await service.convertInTransaction(em, createCtx(em), {
      ...convertInput,
      expectedSourceId: 'checkout-session-1',
    })
    expect(result.reason).toBe('source_mismatch')
    expect(foreignOwner.sourceType).toBe('checkout')
  })

  it('is an idempotent no-op for a row already converted to the same order', async () => {
    const service = new WmsReservationService()
    const em = createEm()
    mockReservationLookup(makeReservation({ sourceType: 'order', sourceId: ORDER_ID }))

    const result = await service.convertInTransaction(em, createCtx(em), convertInput)

    expect(result.outcome).toBe('already_converted')
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('releases the checkout row when an active order reservation already covers the whole quantity', async () => {
    const service = new WmsReservationService()
    const em = createEm()
    const reservation = makeReservation({ sourceType: 'checkout', sourceId: 'checkout-session-1' })
    const covering = makeReservation({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', sourceType: 'order', sourceId: ORDER_ID, quantity: '8' })
    const balanceA = makeBalance({ id: BALANCE_ID_A, location: { id: LOCATION_A }, quantityReserved: '5' })
    const balanceB = makeBalance({ id: BALANCE_ID_B, location: { id: LOCATION_B }, quantityReserved: '3' })
    findOneWithDecryption.mockImplementation((_em: unknown, entity: unknown, where: Record<string, unknown>) => {
      if (entity === InventoryReservation) return reservation
      if (entity === InventoryBalance) return where?.id === BALANCE_ID_A ? balanceA : balanceB
      return null
    })
    findWithDecryption.mockImplementation((_em: unknown, entity: unknown) => (entity === InventoryReservation ? [covering] : []))

    const result = await service.convertInTransaction(em, createCtx(em), convertInput)

    expect(result.outcome).toBe('covered_released')
    expect(reservation.status).toBe('released')
    expect(reservation.sourceType).toBe('checkout')
    expect(Number(balanceA.quantityReserved)).toBe(0)
    expect(Number(balanceB.quantityReserved)).toBe(0)
  })

  it('shrinks the checkout row to the uncovered quantity and avoids the active idempotency-key collision', async () => {
    const service = new WmsReservationService()
    const em = createEm()
    const reservation = makeReservation({ sourceType: 'checkout', sourceId: 'checkout-session-1' })
    const covering = makeReservation({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', sourceType: 'order', sourceId: ORDER_ID, quantity: '3' })
    const balanceA = makeBalance({ id: BALANCE_ID_A, location: { id: LOCATION_A }, quantityReserved: '5' })
    const balanceB = makeBalance({ id: BALANCE_ID_B, location: { id: LOCATION_B }, quantityReserved: '3' })
    findOneWithDecryption.mockImplementation((_em: unknown, entity: unknown, where: Record<string, unknown>) => {
      if (entity === InventoryReservation) {
        return where?.idempotencyKey ? { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' } : reservation
      }
      if (entity === InventoryBalance) return where?.id === BALANCE_ID_A ? balanceA : balanceB
      return null
    })
    findWithDecryption.mockImplementation((_em: unknown, entity: unknown) => (entity === InventoryReservation ? [covering] : []))

    const result = await service.convertInTransaction(em, createCtx(em), convertInput)

    expect(result.outcome).toBe('converted')
    expect(reservation.quantity).toBe('5')
    expect(Number(balanceB.quantityReserved)).toBe(0)
    expect(Number(balanceA.quantityReserved)).toBe(5)
    expect((reservation.metadata as { allocatedBuckets: unknown[] }).allocatedBuckets).toHaveLength(1)
    expect(reservation.sourceType).toBe('order')
    expect(reservation.idempotencyKey).toBe(
      `reservation|order|${ORDER_ID}|${VARIANT_ID}|${WAREHOUSE_ID}|5|converted|${RESERVATION_ID}`,
    )
  })

  it('counts an order row held in another warehouse as covering and queries across warehouses', async () => {
    const service = new WmsReservationService()
    const em = createEm()
    const reservation = makeReservation({ sourceType: 'checkout', sourceId: 'checkout-session-1' })
    const covering = makeReservation({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      warehouse: { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
      sourceType: 'order',
      sourceId: ORDER_ID,
      quantity: '3',
    })
    const balanceA = makeBalance({ id: BALANCE_ID_A, location: { id: LOCATION_A }, quantityReserved: '5' })
    const balanceB = makeBalance({ id: BALANCE_ID_B, location: { id: LOCATION_B }, quantityReserved: '3' })
    findOneWithDecryption.mockImplementation((_em: unknown, entity: unknown, where: Record<string, unknown>) => {
      if (entity === InventoryReservation) return where?.idempotencyKey ? null : reservation
      if (entity === InventoryBalance) return where?.id === BALANCE_ID_A ? balanceA : balanceB
      return null
    })
    findWithDecryption.mockImplementation((_em: unknown, entity: unknown) => (entity === InventoryReservation ? [covering] : []))

    const result = await service.convertInTransaction(em, createCtx(em), convertInput)

    const coveringCall = findWithDecryption.mock.calls.find((call) => call[1] === InventoryReservation)
    expect(coveringCall?.[2]).not.toHaveProperty('warehouse')
    expect(result.outcome).toBe('converted')
    expect(reservation.quantity).toBe('5')
    expect(Number(balanceB.quantityReserved)).toBe(0)
  })

  it('does not treat a sibling row already converted from the same checkout as covering', async () => {
    const service = new WmsReservationService()
    const em = createEm()
    const reservation = makeReservation({ sourceType: 'checkout', sourceId: 'checkout-session-1' })
    const sibling = makeReservation({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      sourceType: 'order',
      sourceId: ORDER_ID,
      quantity: '8',
      metadata: { allocatedBuckets: [], convertedFromCheckout: true },
    })
    findOneWithDecryption.mockImplementation((_em: unknown, entity: unknown) =>
      entity === InventoryReservation ? reservation : null,
    )
    findWithDecryption.mockImplementation((_em: unknown, entity: unknown) => (entity === InventoryReservation ? [sibling] : []))

    const result = await service.convertInTransaction(em, createCtx(em), convertInput)

    expect(result.outcome).toBe('converted')
    expect(reservation.quantity).toBe('8')
    expect((reservation.metadata as { convertedFromCheckout?: boolean }).convertedFromCheckout).toBe(true)
  })
})

describe('WmsReservationService.reserveLinesForCheckout product-level safety-stock pool', () => {
  const PRODUCT_ID = '88888888-8888-4888-8888-888888888888'
  const VARIANT_TWO = '77777777-7777-4777-8777-777777777778'

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
  })

  function mockPool(options: { balances: Array<Record<string, unknown>>; poolSafetyStock: string }) {
    findWithDecryption.mockImplementation((_em: unknown, entity: unknown, where: Record<string, unknown>) => {
      if (entity === ProductInventoryProfile) {
        if (where?.catalogVariantId === null) {
          return [{ catalogProductId: PRODUCT_ID, catalogVariantId: null, safetyStock: options.poolSafetyStock, reorderPoint: '0' }]
        }
        return []
      }
      if (entity === InventoryBalance) return options.balances
      return []
    })
  }

  it('locks every active variant of a pooled product and enforces the shared budget across variants', async () => {
    const service = new WmsReservationService()
    const em = createEm() as unknown as Record<string, unknown>
    em.execute = jest.fn(async () => [
      { id: VARIANT_ID, product_id: PRODUCT_ID },
      { id: VARIANT_TWO, product_id: PRODUCT_ID },
    ])
    mockPool({
      poolSafetyStock: '4',
      balances: [
        makeBalance({ id: BALANCE_ID_A, catalogVariantId: VARIANT_ID, quantityOnHand: '5' }),
        makeBalance({ id: BALANCE_ID_B, catalogVariantId: VARIANT_TWO, quantityOnHand: '5' }),
      ],
    })

    const result = await service.reserveLinesForCheckout(em as never, createCtx(em as never), {
      scope: { tenantId: TENANT, organizationId: ORG },
      sourceType: 'checkout',
      sourceId: 'checkout-session-1',
      expiresAt: null,
      lines: [
        { key: 'a', catalogProductId: PRODUCT_ID, catalogVariantId: VARIANT_ID, quantity: 4, mode: 'exact' },
        { key: 'b', catalogProductId: PRODUCT_ID, catalogVariantId: VARIANT_TWO, quantity: 4, mode: 'exact' },
      ],
    })

    expect(result).toEqual({ ok: false, lines: [{ key: 'b', requested: 4, sellable: 2 }] })
  })

  it('locks sibling variants that are not part of the request', async () => {
    const service = new WmsReservationService()
    const em = createEm() as unknown as Record<string, unknown>
    em.execute = jest.fn(async () => [
      { id: VARIANT_ID, product_id: PRODUCT_ID },
      { id: VARIANT_TWO, product_id: PRODUCT_ID },
    ])
    mockPool({
      poolSafetyStock: '4',
      balances: [
        makeBalance({ id: BALANCE_ID_A, catalogVariantId: VARIANT_ID, quantityOnHand: '5' }),
        makeBalance({ id: BALANCE_ID_B, catalogVariantId: VARIANT_TWO, quantityOnHand: '1' }),
      ],
    })

    const result = await service.reserveLinesForCheckout(em as never, createCtx(em as never), {
      scope: { tenantId: TENANT, organizationId: ORG },
      sourceType: 'checkout',
      sourceId: 'checkout-session-1',
      expiresAt: null,
      lines: [{ key: 'a', catalogProductId: PRODUCT_ID, catalogVariantId: VARIANT_ID, quantity: 5, mode: 'exact' }],
    })

    const balanceLock = findWithDecryption.mock.calls.find(([, entity]) => entity === InventoryBalance)
    expect(balanceLock?.[2].catalogVariantId.$in).toEqual([VARIANT_ID, VARIANT_TWO].sort())
    expect(balanceLock?.[3]).toMatchObject({ lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'asc' } })
    expect(result).toEqual({ ok: false, lines: [{ key: 'a', requested: 5, sellable: 2 }] })
  })
})
