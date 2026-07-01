/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  InventoryBalance,
  InventoryLot,
  InventoryMovement,
  InventoryReservation,
  ProductInventoryProfile,
  Warehouse,
} from '../../data/entities'
import {
  buildDailyBuckets,
  buildExpiryLotRows,
  computeLowStockCounts,
  loadOperationalDashboard,
  mapDailyCountsToSparkline,
  OperationalDashboardWarehouseNotFoundError,
  resolveLotAvailableQuantity,
  startOfUtcDay,
} from '../loadOperationalDashboard'

const findWithDecryptionMock = jest.mocked(findWithDecryption)
const findOneWithDecryptionMock = jest.mocked(findOneWithDecryption)

function makeProfile(overrides: Partial<ProductInventoryProfile> = {}): ProductInventoryProfile {
  return {
    catalogVariantId: '44444444-4444-4444-8444-444444444444',
    reorderPoint: '5',
    safetyStock: '2',
    ...overrides,
  } as ProductInventoryProfile
}

function makeBalance(overrides: Partial<InventoryBalance> & { warehouseId?: string } = {}): InventoryBalance {
  const warehouseId = overrides.warehouseId ?? '11111111-1111-4111-8111-111111111111'
  return {
    catalogVariantId: '44444444-4444-4444-8444-444444444444',
    quantityOnHand: '1',
    quantityReserved: '0',
    quantityAllocated: '0',
    warehouse: { id: warehouseId } as Warehouse,
    lot: null,
    ...overrides,
  } as InventoryBalance
}

describe('loadOperationalDashboard helpers', () => {
  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    findOneWithDecryptionMock.mockReset()
  })

  it('computeLowStockCounts counts variants below reorder and safety stock', () => {
    const profiles = [makeProfile()]
    const balances = [makeBalance()]

    expect(computeLowStockCounts(profiles, balances)).toEqual({
      lowStockCount: 1,
      reorderCriticalCount: 1,
    })
  })

  it('computeLowStockCounts scopes counts to a selected warehouse', () => {
    const profiles = [makeProfile()]
    const balances = [
      makeBalance({ warehouseId: '11111111-1111-4111-8111-111111111111' }),
      makeBalance({ warehouseId: '22222222-2222-4222-8222-222222222222' }),
    ]

    expect(
      computeLowStockCounts(profiles, balances, '11111111-1111-4111-8111-111111111111'),
    ).toEqual({
      lowStockCount: 1,
      reorderCriticalCount: 1,
    })
  })

  it('mapDailyCountsToSparkline aligns SQL buckets with the dashboard trend window', () => {
    const now = new Date('2026-05-28T15:00:00.000Z')
    const dayBuckets = buildDailyBuckets(3, now)

    expect(
      mapDailyCountsToSparkline(dayBuckets, [
        { day: dayBuckets[1]!, count: 4 },
        { day: dayBuckets[2]!, count: 2 },
      ]),
    ).toEqual([0, 4, 2])
  })

  it('buildExpiryLotRows returns expiring-soon and past-due rows with available quantities', () => {
    const warehouseId = '11111111-1111-4111-8111-111111111111'
    const expiringLot = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      lotNumber: 'LOT-EXP',
      sku: 'SKU-EXP',
      expiresAt: new Date('2026-06-15T00:00:00.000Z'),
    } as InventoryLot
    const pastDueLot = {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      lotNumber: 'LOT-PAST',
      sku: 'SKU-PAST',
      expiresAt: new Date('2026-05-01T00:00:00.000Z'),
    } as InventoryLot
    const balances = [
      makeBalance({
        warehouseId,
        lot: expiringLot,
        quantityOnHand: '4',
      }),
      makeBalance({
        warehouseId,
        lot: pastDueLot,
        quantityOnHand: '2',
      }),
    ]

    const rows = buildExpiryLotRows([expiringLot], [pastDueLot], balances, warehouseId)

    expect(rows).toEqual([
      expect.objectContaining({
        id: expiringLot.id,
        category: 'expiringSoon',
        availableQuantity: 4,
      }),
      expect.objectContaining({
        id: pastDueLot.id,
        category: 'pastDue',
        availableQuantity: 2,
      }),
    ])
    expect(resolveLotAvailableQuantity(expiringLot.id, balances, warehouseId)).toBe(4)
  })

  it('buildExpiryLotRows with warehouseId null aggregates available stock across warehouses', () => {
    const expiringLot = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      lotNumber: 'LOT-EXP',
      sku: 'SKU-EXP',
      expiresAt: new Date('2026-06-15T00:00:00.000Z'),
    } as InventoryLot
    const pastDueLot = {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      lotNumber: 'LOT-PAST',
      sku: 'SKU-PAST',
      expiresAt: new Date('2026-05-01T00:00:00.000Z'),
    } as InventoryLot
    const balances = [
      makeBalance({
        warehouseId: '11111111-1111-4111-8111-111111111111',
        lot: expiringLot,
        quantityOnHand: '3',
      }),
      makeBalance({
        warehouseId: '22222222-2222-4222-8222-222222222222',
        lot: expiringLot,
        quantityOnHand: '2',
      }),
      makeBalance({
        warehouseId: '11111111-1111-4111-8111-111111111111',
        lot: pastDueLot,
        quantityOnHand: '1',
      }),
    ]

    const rows = buildExpiryLotRows([expiringLot], [pastDueLot], balances, null)

    expect(rows).toEqual([
      expect.objectContaining({
        id: expiringLot.id,
        category: 'expiringSoon',
        availableQuantity: 5,
      }),
      expect.objectContaining({
        id: pastDueLot.id,
        category: 'pastDue',
        availableQuantity: 1,
      }),
    ])
  })

  it('buildExpiryLotRows excludes expiring-soon lots with zero available quantity', () => {
    const warehouseId = '11111111-1111-4111-8111-111111111111'
    const expiringLotWithStock = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      lotNumber: 'LOT-EXP',
      sku: 'SKU-EXP',
      expiresAt: new Date('2026-06-15T00:00:00.000Z'),
    } as InventoryLot
    const expiringLotWithoutStock = {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      lotNumber: 'LOT-EMPTY',
      sku: 'SKU-EMPTY',
      expiresAt: new Date('2026-06-20T00:00:00.000Z'),
    } as InventoryLot
    const balances = [
      makeBalance({
        warehouseId,
        lot: expiringLotWithStock,
        quantityOnHand: '4',
      }),
      makeBalance({
        warehouseId,
        lot: expiringLotWithoutStock,
        quantityOnHand: '0',
      }),
    ]

    const rows = buildExpiryLotRows(
      [expiringLotWithStock, expiringLotWithoutStock],
      [],
      balances,
      warehouseId,
    )

    expect(rows).toEqual([
      expect.objectContaining({
        id: expiringLotWithStock.id,
        category: 'expiringSoon',
        availableQuantity: 4,
      }),
    ])
  })

  it('loadOperationalDashboard rejects unknown warehouse ids in tenant scope', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)

    await expect(
      loadOperationalDashboard({ getConnection: jest.fn() } as never, {
        organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        warehouseId: '11111111-1111-4111-8111-111111111111',
      }),
    ).rejects.toBeInstanceOf(OperationalDashboardWarehouseNotFoundError)

    expect(findOneWithDecryptionMock).toHaveBeenCalledWith(
      expect.anything(),
      Warehouse,
      expect.objectContaining({ id: '11111111-1111-4111-8111-111111111111' }),
      undefined,
      expect.objectContaining({
        tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    )
  })

  it('loadOperationalDashboard returns KPI payload with null deltas except today moves', async () => {
    const now = new Date('2026-05-28T12:00:00.000Z')
    jest.useFakeTimers()
    jest.setSystemTime(now)

    const profile = makeProfile()
    const balance = makeBalance()
    const movement = {
      id: '99999999-9999-4999-8999-999999999999',
      type: 'receipt',
      quantity: '3',
      catalogVariantId: '44444444-4444-4444-8444-444444444444',
      referenceType: 'manual',
      referenceId: '88888888-8888-4888-8888-888888888888',
      reason: null,
      performedAt: now,
      warehouse: { id: '11111111-1111-4111-8111-111111111111', code: 'MAIN', name: 'Main' },
      locationFrom: null,
      locationTo: { code: 'A-01' },
    } as InventoryMovement

    findWithDecryptionMock.mockImplementation(async (_em, entity) => {
      if (entity === ProductInventoryProfile) return [profile]
      if (entity === InventoryBalance) return [balance]
      if (entity === InventoryReservation) return [] as InventoryReservation[]
      if (entity === InventoryMovement) return [movement]
      return []
    })

    const execute = jest
      .fn()
      .mockResolvedValueOnce([{ count: 2 }])
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([])

    const em = {
      getConnection: () => ({ execute }),
    } as never

    const payload = await loadOperationalDashboard(em, {
      organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    })

    expect(payload.kpis).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'lowStock', count: 1, deltaSinceYesterday: null }),
        expect.objectContaining({ id: 'pastDue', count: 0, deltaSinceYesterday: null }),
        expect.objectContaining({ id: 'todaysMoves', count: 2, deltaSinceYesterday: 1 }),
      ]),
    )
    expect(payload.recentActivity).toHaveLength(1)
    expect(payload.expiryLots).toEqual([])
    expect(findWithDecryptionMock).toHaveBeenCalledWith(
      expect.anything(),
      ProductInventoryProfile,
      expect.objectContaining({
        organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
      undefined,
      expect.objectContaining({
        organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
    )

    jest.useRealTimers()
  })

  it('startOfUtcDay normalizes timestamps to UTC midnight', () => {
    expect(startOfUtcDay(new Date('2026-05-28T23:59:59.000Z')).toISOString()).toBe(
      '2026-05-28T00:00:00.000Z',
    )
  })

  it('loadPastDueDailyCounts joins balances with available stock without warehouse scope', async () => {
    const now = new Date('2026-05-28T12:00:00.000Z')
    jest.useFakeTimers()
    jest.setSystemTime(now)

    findWithDecryptionMock.mockImplementation(async (_em, entity) => {
      if (entity === ProductInventoryProfile) return []
      if (entity === InventoryBalance) return []
      if (entity === InventoryReservation) return [] as InventoryReservation[]
      if (entity === InventoryMovement) return [] as InventoryMovement[]
      return []
    })

    const execute = jest.fn().mockResolvedValue([])
    const em = {
      getConnection: () => ({ execute }),
    } as never

    await loadOperationalDashboard(em, {
      organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    })

    const pastDueSparklineSql = execute.mock.calls
      .map((call) => String(call[0]))
      .find((sql) => sql.includes('expires_at < bucket.day') && sql.includes('generate_series'))

    expect(pastDueSparklineSql).toBeDefined()
    expect(pastDueSparklineSql).toContain('join wms_inventory_balances b')
    expect(pastDueSparklineSql).toContain('quantity_allocated')
    expect(pastDueSparklineSql).not.toContain('b.warehouse_id = ?')

    jest.useRealTimers()
  })
})
