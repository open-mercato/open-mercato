/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  InventoryBalance,
  InventoryLot,
  InventoryMovement,
  InventoryReservation,
  ProductInventoryProfile,
  Warehouse,
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
const LOCATION_A = '66666666-6666-4666-8666-666666666661'
const LOCATION_B = '66666666-6666-4666-8666-666666666662'
const VARIANT_ID = '77777777-7777-4777-8777-777777777777'
const USER_ID = '99999999-9999-4999-8999-999999999999'
const ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const RESERVATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BALANCE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

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

function makeBalance(overrides: Record<string, unknown> = {}) {
  return {
    id: BALANCE_ID,
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
    quantity: '5',
    sourceType: 'order',
    sourceId: ORDER_ID,
    status: 'active',
    metadata: {
      allocatedBuckets: [
        { balanceId: BALANCE_ID, locationId: LOCATION_A, lotId: null, serialNumber: null, quantity: 5 },
      ],
      allocationState: 'reserved',
    },
    ...overrides,
  }
}

function makeReserveInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    tenantId: TENANT,
    warehouseId: WAREHOUSE_ID,
    catalogVariantId: VARIANT_ID,
    quantity: 5,
    sourceType: 'order',
    sourceId: ORDER_ID,
    performedBy: USER_ID,
    ...overrides,
  }
}

describe('wms inventory reserve command', () => {
  beforeAll(async () => {
    await import('../inventory-actions')
  })

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
  })

  it('reserves stock and returns a reservation id', async () => {
    const em = createEm()
    const balance = makeBalance()

    findOneWithDecryption.mockImplementation((_em: unknown, entity: unknown, where: Record<string, unknown>) => {
      if (entity === Warehouse) return { id: WAREHOUSE_ID, tenantId: TENANT, organizationId: ORG }
      if (entity === InventoryReservation) return null
      if (entity === ProductInventoryProfile) return null
      if (entity === InventoryBalance) {
        if (where?.id === BALANCE_ID || where?.location === LOCATION_A) return balance
      }
      return null
    })

    findWithDecryption.mockImplementation((_em: unknown, entity: unknown) => {
      if (entity === InventoryBalance) return [balance]
      if (entity === InventoryMovement) return []
      return []
    })

    const handler = commandRegistry.get('wms.inventory.reserve')
    const result = await handler!.execute!(makeReserveInput(), createCtx(em))

    expect(result).toMatchObject({ reservationId: expect.any(String) })
    expect(em.persist).toHaveBeenCalled()
    expect(em.flush).toHaveBeenCalled()
  })

  it('throws insufficient_stock when no available quantity exists', async () => {
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
      if (entity === InventoryMovement) return []
      return []
    })

    const handler = commandRegistry.get('wms.inventory.reserve')
    await expect(
      handler!.execute!(makeReserveInput({ quantity: 3 }), createCtx(em)),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'insufficient_stock' },
    } satisfies Partial<CrudHttpError>)
  })

  it('skips balances whose lot is on hold and uses only eligible lots', async () => {
    const em = createEm()

    const holdBalance = makeBalance({
      id: 'balance-hold',
      location: { id: LOCATION_A },
      lot: { id: 'lot-hold', status: 'hold', expiresAt: null } as unknown as InventoryLot,
      quantityOnHand: '20',
      quantityReserved: '0',
    })
    const eligibleBalance = makeBalance({
      id: 'balance-eligible',
      location: { id: LOCATION_B },
      lot: null,
      quantityOnHand: '10',
      quantityReserved: '0',
    })

    findOneWithDecryption.mockImplementation((_em: unknown, entity: unknown, where: Record<string, unknown>) => {
      if (entity === Warehouse) return { id: WAREHOUSE_ID, tenantId: TENANT, organizationId: ORG }
      if (entity === InventoryReservation) return null
      if (entity === ProductInventoryProfile) return null
      if (entity === InventoryBalance) {
        if (where?.location === LOCATION_B) return eligibleBalance
        if (where?.location === LOCATION_A) return holdBalance
      }
      return null
    })

    findWithDecryption.mockImplementation((_em: unknown, entity: unknown) => {
      if (entity === InventoryBalance) return [holdBalance, eligibleBalance]
      if (entity === InventoryMovement) return []
      return []
    })

    const handler = commandRegistry.get('wms.inventory.reserve')
    const result = await handler!.execute!(makeReserveInput({ quantity: 5 }), createCtx(em))

    expect(result).toMatchObject({ reservationId: expect.any(String) })
    expect(holdBalance.quantityReserved).toBe('0')
    expect(Number(eligibleBalance.quantityReserved)).toBe(5)
  })

  it('skips balances whose lot is expired and throws when no eligible stock remains', async () => {
    const em = createEm()
    const expiredBalance = makeBalance({
      lot: {
        id: 'lot-expired',
        status: 'available',
        expiresAt: new Date('2020-01-01'),
      } as unknown as InventoryLot,
      quantityOnHand: '20',
      quantityReserved: '0',
    })

    findOneWithDecryption.mockImplementation((_em: unknown, entity: unknown) => {
      if (entity === Warehouse) return { id: WAREHOUSE_ID, tenantId: TENANT, organizationId: ORG }
      if (entity === InventoryReservation) return null
      if (entity === ProductInventoryProfile) return null
      return null
    })

    findWithDecryption.mockImplementation((_em: unknown, entity: unknown) => {
      if (entity === InventoryBalance) return [expiredBalance]
      if (entity === InventoryMovement) return []
      return []
    })

    const handler = commandRegistry.get('wms.inventory.reserve')
    await expect(
      handler!.execute!(makeReserveInput({ quantity: 5 }), createCtx(em)),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'insufficient_stock' },
    } satisfies Partial<CrudHttpError>)

    expect(expiredBalance.quantityReserved).toBe('0')
  })

  it('returns the existing reservation without mutating balances on idempotent replay', async () => {
    const em = createEm()
    const existingReservation = makeReservation()

    findOneWithDecryption.mockImplementation((_em: unknown, entity: unknown) => {
      if (entity === Warehouse) return { id: WAREHOUSE_ID, tenantId: TENANT, organizationId: ORG }
      if (entity === InventoryReservation) return existingReservation
      return null
    })

    findWithDecryption.mockReturnValue([])

    const handler = commandRegistry.get('wms.inventory.reserve')
    const result = await handler!.execute!(makeReserveInput(), createCtx(em))

    expect(result).toMatchObject({ reservationId: RESERVATION_ID })
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })
})

describe('wms inventory allocate command', () => {
  beforeAll(async () => {
    await import('../inventory-actions')
  })

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
  })

  it('throws invalid_tracking_state when quantityReserved is less than the bucket quantity', async () => {
    const em = createEm()
    const reservation = makeReservation()
    const driftedBalance = makeBalance({ quantityReserved: '2' })

    findOneWithDecryption.mockImplementation((_em: unknown, entity: unknown, where: Record<string, unknown>) => {
      if (entity === InventoryReservation) return reservation
      if (entity === InventoryBalance) {
        if (where?.id === BALANCE_ID || where?.location === LOCATION_A) return driftedBalance
      }
      return null
    })

    const handler = commandRegistry.get('wms.inventory.allocate')
    await expect(
      handler!.execute!(
        {
          organizationId: ORG,
          tenantId: TENANT,
          reservationId: RESERVATION_ID,
          performedBy: USER_ID,
        },
        createCtx(em),
      ),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'invalid_tracking_state' },
    } satisfies Partial<CrudHttpError>)

    expect(driftedBalance.quantityReserved).toBe('2')
  })
})

describe('wms inventory release command', () => {
  beforeAll(async () => {
    await import('../inventory-actions')
  })

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
  })

  it('decrements quantityReserved and marks the reservation as released', async () => {
    const em = createEm()
    const reservation = makeReservation()
    const balance = makeBalance({ quantityReserved: '5' })

    findOneWithDecryption.mockImplementation((_em: unknown, entity: unknown, where: Record<string, unknown>) => {
      if (entity === InventoryReservation) return reservation
      if (entity === InventoryBalance) {
        if (where?.id === BALANCE_ID || where?.location === LOCATION_A) return balance
      }
      return null
    })

    const handler = commandRegistry.get('wms.inventory.release')
    const result = await handler!.execute!(
      {
        organizationId: ORG,
        tenantId: TENANT,
        reservationId: RESERVATION_ID,
        reason: 'manual_release',
        reasonCode: 'manual_release',
        performedBy: USER_ID,
      },
      createCtx(em),
    )

    expect(result).toMatchObject({ reservationId: RESERVATION_ID })
    expect(Number(balance.quantityReserved)).toBe(0)
    expect(reservation.status).toBe('released')
    expect(em.flush).toHaveBeenCalled()
  })

  it('throws balance_integrity_violation when quantityReserved is less than the bucket quantity (ledger drift)', async () => {
    const em = createEm()
    const reservation = makeReservation()
    const driftedBalance = makeBalance({ quantityReserved: '2' })

    findOneWithDecryption.mockImplementation((_em: unknown, entity: unknown, where: Record<string, unknown>) => {
      if (entity === InventoryReservation) return reservation
      if (entity === InventoryBalance) {
        if (where?.id === BALANCE_ID || where?.location === LOCATION_A) return driftedBalance
      }
      return null
    })

    const handler = commandRegistry.get('wms.inventory.release')
    await expect(
      handler!.execute!(
        {
          organizationId: ORG,
          tenantId: TENANT,
          reservationId: RESERVATION_ID,
          reason: 'manual_release',
          reasonCode: 'manual_release',
          performedBy: USER_ID,
        },
        createCtx(em),
      ),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'balance_integrity_violation' },
    } satisfies Partial<CrudHttpError>)

    expect(driftedBalance.quantityReserved).toBe('2')
    expect(reservation.status).toBe('active')
  })

  it('emits balance_drift event before throwing when drift is detected', async () => {
    const em = createEm()
    const { emitWmsEvent } = jest.requireMock('../../events') as { emitWmsEvent: jest.Mock }
    emitWmsEvent.mockClear()

    const reservation = makeReservation()
    const driftedBalance = makeBalance({ quantityReserved: '1' })

    findOneWithDecryption.mockImplementation((_em: unknown, entity: unknown, where: Record<string, unknown>) => {
      if (entity === InventoryReservation) return reservation
      if (entity === InventoryBalance) {
        if (where?.id === BALANCE_ID || where?.location === LOCATION_A) return driftedBalance
      }
      return null
    })

    const handler = commandRegistry.get('wms.inventory.release')
    await expect(
      handler!.execute!(
        {
          organizationId: ORG,
          tenantId: TENANT,
          reservationId: RESERVATION_ID,
          reason: 'manual_release',
          reasonCode: 'manual_release',
          performedBy: USER_ID,
        },
        createCtx(em),
      ),
    ).rejects.toMatchObject({ status: 409, body: { error: 'balance_integrity_violation' } })

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(emitWmsEvent).toHaveBeenCalledWith(
      'wms.inventory.balance_drift',
      expect.objectContaining({ balanceId: BALANCE_ID, field: 'quantityReserved' }),
    )
  })
})
