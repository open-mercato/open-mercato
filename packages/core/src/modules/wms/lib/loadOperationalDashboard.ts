import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  InventoryBalance,
  InventoryLot,
  InventoryMovement,
  InventoryReservation,
  ProductInventoryProfile,
  Warehouse,
} from '../data/entities'
import { evaluateLowStock } from './inventoryPolicy'
import { addUtcDays, EXPIRING_SOON_DAYS, startOfUtcDay } from './expiry'

const AGING_RESERVATION_DAYS = 7
const TREND_DAYS = 7
const MONTHLY_TREND_MONTHS = 6
const ACTIVITY_LIMIT = 10
const EXPIRY_CARD_LIMIT = 5

export type OperationalDashboardScope = {
  organizationId: string
  tenantId: string
  warehouseId?: string | null
}

export type OperationalDashboardKpiId =
  | 'lowStock'
  | 'reorderCritical'
  | 'expiringSoon'
  | 'pastDue'
  | 'agingReservations'
  | 'todaysMoves'

export type OperationalDashboardKpi = {
  id: OperationalDashboardKpiId
  count: number
  deltaSinceYesterday: number | null
  sparkline: number[]
}

export type OperationalDashboardTrendPoint = {
  month: string
  receive: number
  allocate: number
}

export type OperationalDashboardActivityRow = {
  id: string
  movementType: string
  quantity: number
  variantSku: string | null
  variantId: string
  referenceType: string | null
  referenceId: string | null
  reason: string | null
  locationLabel: string
  performedAt: string
}

export type OperationalDashboardExpiryLotRow = {
  id: string
  lotNumber: string
  sku: string
  catalogVariantId: string
  expiresAt: string
  availableQuantity: number
  status: string
  updatedAt: string | null
  category: 'expiringSoon' | 'pastDue'
}

export type OperationalDashboardPayload = {
  lastUpdatedAt: string
  warehouseId: string | null
  kpis: OperationalDashboardKpi[]
  expiryLots: OperationalDashboardExpiryLotRow[]
  monthlyTrends: OperationalDashboardTrendPoint[]
  recentActivity: OperationalDashboardActivityRow[]
}

export class OperationalDashboardWarehouseNotFoundError extends Error {
  readonly warehouseId: string

  constructor(warehouseId: string) {
    super(`Warehouse ${warehouseId} not found`)
    this.name = 'OperationalDashboardWarehouseNotFoundError'
    this.warehouseId = warehouseId
  }
}

type DecryptionScope = {
  tenantId: string
  organizationId: string
}

type DailyCountRow = {
  day: Date | string
  count: string | number
}

type MonthlyTrendRow = {
  month_start: Date | string
  type: string
  count: string | number
}

export function toOperationalDashboardNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim().length > 0) return Number(value)
  return 0
}

export { addUtcDays, startOfUtcDay } from './expiry'

function formatMonthKey(date: Date): string {
  return date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
}

export function buildDailyBuckets(days: number, now: Date): Date[] {
  const today = startOfUtcDay(now)
  const buckets: Date[] = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    buckets.push(addUtcDays(today, -offset))
  }
  return buckets
}

export function mapDailyCountsToSparkline(
  dayBuckets: Date[],
  rows: Array<{ day: Date | string; count: string | number }>,
): number[] {
  const counts = new Map<number, number>()
  for (const bucket of dayBuckets) {
    counts.set(bucket.getTime(), 0)
  }
  for (const row of rows) {
    const day = startOfUtcDay(row.day instanceof Date ? row.day : new Date(row.day)).getTime()
    if (counts.has(day)) {
      counts.set(day, toOperationalDashboardNumber(row.count))
    }
  }
  return dayBuckets.map((bucket) => counts.get(bucket.getTime()) ?? 0)
}

export function resolveLotAvailableQuantity(
  lotId: string,
  balances: InventoryBalance[],
  warehouseId?: string | null,
): number {
  let total = 0
  for (const balance of balances) {
    if (balance.lot?.id !== lotId) continue
    if (warehouseId && balance.warehouse.id !== warehouseId) continue
    const available =
      toOperationalDashboardNumber(balance.quantityOnHand)
      - toOperationalDashboardNumber(balance.quantityReserved)
      - toOperationalDashboardNumber(balance.quantityAllocated)
    if (available > 0) total += available
  }
  return total
}

export function buildExpiryLotRows(
  expiringSoonLots: InventoryLot[],
  pastDueLots: InventoryLot[],
  balances: InventoryBalance[],
  warehouseId?: string | null,
  limit = EXPIRY_CARD_LIMIT,
): OperationalDashboardExpiryLotRow[] {
  const expiringRows = expiringSoonLots
    .map((lot) => ({
      lot,
      availableQuantity: resolveLotAvailableQuantity(lot.id, balances, warehouseId),
    }))
    .filter(({ availableQuantity }) => availableQuantity > 0)
    .sort((left, right) => {
      const leftTime = left.lot.expiresAt?.getTime() ?? 0
      const rightTime = right.lot.expiresAt?.getTime() ?? 0
      return leftTime - rightTime
    })
    .slice(0, limit)
    .map(({ lot, availableQuantity }) => ({
      id: lot.id,
      lotNumber: lot.lotNumber,
      sku: lot.sku,
      catalogVariantId: lot.catalogVariantId,
      expiresAt: lot.expiresAt!.toISOString(),
      availableQuantity,
      status: lot.status,
      updatedAt: lot.updatedAt?.toISOString() ?? null,
      category: 'expiringSoon' as const,
    }))

  const pastDueRows = pastDueLots
    .map((lot) => ({
      lot,
      availableQuantity: resolveLotAvailableQuantity(lot.id, balances, warehouseId),
    }))
    .filter(({ availableQuantity }) => availableQuantity > 0)
    .sort((left, right) => {
      const leftTime = left.lot.expiresAt?.getTime() ?? 0
      const rightTime = right.lot.expiresAt?.getTime() ?? 0
      return leftTime - rightTime
    })
    .slice(0, limit)
    .map(({ lot, availableQuantity }) => ({
      id: lot.id,
      lotNumber: lot.lotNumber,
      sku: lot.sku,
      catalogVariantId: lot.catalogVariantId,
      expiresAt: lot.expiresAt!.toISOString(),
      availableQuantity,
      status: lot.status,
      updatedAt: lot.updatedAt?.toISOString() ?? null,
      category: 'pastDue' as const,
    }))

  return [...expiringRows, ...pastDueRows]
}

export function computeLowStockCounts(
  profiles: ProductInventoryProfile[],
  balances: InventoryBalance[],
  warehouseId?: string | null,
): { lowStockCount: number; reorderCriticalCount: number } {
  const availableByVariantWarehouse = new Map<string, number>()
  for (const balance of balances) {
    const onHand = toOperationalDashboardNumber(balance.quantityOnHand)
    const reserved = toOperationalDashboardNumber(balance.quantityReserved)
    const allocated = toOperationalDashboardNumber(balance.quantityAllocated)
    const available = onHand - reserved - allocated
    const key = `${balance.catalogVariantId}::${balance.warehouse.id}`
    availableByVariantWarehouse.set(key, (availableByVariantWarehouse.get(key) ?? 0) + available)
  }

  let lowStockCount = 0
  let reorderCriticalCount = 0
  const seenLowStockKeys = new Set<string>()

  for (const profile of profiles) {
    const variantId = profile.catalogVariantId
    if (!variantId) continue
    const reorderPoint = toOperationalDashboardNumber(profile.reorderPoint)
    const safetyStock = toOperationalDashboardNumber(profile.safetyStock)
    if (reorderPoint <= 0 && safetyStock <= 0) continue

    const warehouseIds = warehouseId
      ? [warehouseId]
      : Array.from(new Set(balances.map((balance) => balance.warehouse.id)))

    for (const scopedWarehouseId of warehouseIds) {
      const key = `${variantId}::${scopedWarehouseId}`
      const available = availableByVariantWarehouse.get(key) ?? 0
      const evaluation = evaluateLowStock(
        { reorderPoint: profile.reorderPoint, safetyStock: profile.safetyStock },
        available,
      )
      if (!evaluation) continue
      if (seenLowStockKeys.has(key)) continue
      seenLowStockKeys.add(key)
      lowStockCount += 1
      if (evaluation.state === 'below_safety_stock') {
        reorderCriticalCount += 1
      }
    }
  }

  return { lowStockCount, reorderCriticalCount }
}

function resolveWarehouseLabel(
  warehouse: Warehouse | undefined,
  warehouseId: string,
): string {
  return warehouse?.code?.trim() || warehouse?.name?.trim() || warehouseId
}

function resolveLocationLabel(
  warehouseLabel: string,
  fromCode?: string | null,
  toCode?: string | null,
): string {
  if (fromCode && toCode) return `${fromCode} → ${toCode}`
  if (toCode) return `${warehouseLabel} · ${toCode}`
  if (fromCode) return `${warehouseLabel} · ${fromCode}`
  return warehouseLabel
}

function resolveDecryptionScope(scope: OperationalDashboardScope): DecryptionScope {
  return {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  }
}

function appendWarehouseFilter(
  sql: string,
  params: unknown[],
  warehouseId?: string | null,
): string {
  if (!warehouseId) return sql
  params.push(warehouseId)
  return `${sql} and warehouse_id = ?`
}

async function loadVariantSkus(
  em: EntityManager,
  scope: OperationalDashboardScope,
  variantIds: string[],
): Promise<Map<string, string>> {
  if (variantIds.length === 0) return new Map()
  const rows = await em.getConnection().execute<Array<{ id: string; sku: string | null }>>(
    `select id, sku from catalog_product_variants
     where organization_id = ? and tenant_id = ? and id in (${variantIds.map(() => '?').join(', ')})
     and deleted_at is null`,
    [scope.organizationId, scope.tenantId, ...variantIds],
  )
  const map = new Map<string, string>()
  for (const row of rows) {
    if (row.id && row.sku) map.set(row.id, row.sku)
  }
  return map
}

async function countMovementsBetween(
  em: EntityManager,
  scope: OperationalDashboardScope,
  start: Date,
  end: Date,
  options?: { types?: string[]; quantitySign?: 'negative' },
): Promise<number> {
  const params: unknown[] = [scope.organizationId, scope.tenantId, start, end]
  let sql = `
    select count(*)::int as count
    from wms_inventory_movements
    where organization_id = ? and tenant_id = ? and deleted_at is null
      and performed_at >= ? and performed_at < ?
  `
  sql = appendWarehouseFilter(sql, params, scope.warehouseId)
  if (options?.types?.length) {
    sql += ` and type in (${options.types.map(() => '?').join(', ')})`
    params.push(...options.types)
  }
  if (options?.quantitySign === 'negative') {
    sql += ' and quantity < 0'
  }
  const rows = await em.getConnection().execute<Array<{ count: string | number }>>(sql, params)
  return toOperationalDashboardNumber(rows[0]?.count)
}

async function loadMovementDailyCounts(
  em: EntityManager,
  scope: OperationalDashboardScope,
  start: Date,
  options?: { types?: string[]; quantitySign?: 'negative' },
): Promise<DailyCountRow[]> {
  const params: unknown[] = [scope.organizationId, scope.tenantId, start]
  let sql = `
    select date_trunc('day', performed_at) as day, count(*)::int as count
    from wms_inventory_movements
    where organization_id = ? and tenant_id = ? and deleted_at is null
      and performed_at >= ?
  `
  sql = appendWarehouseFilter(sql, params, scope.warehouseId)
  if (options?.types?.length) {
    sql += ` and type in (${options.types.map(() => '?').join(', ')})`
    params.push(...options.types)
  }
  if (options?.quantitySign === 'negative') {
    sql += ' and quantity < 0'
  }
  sql += ' group by 1 order by 1'
  return em.getConnection().execute<DailyCountRow[]>(sql, params)
}

async function loadMonthlyMovementTrends(
  em: EntityManager,
  scope: OperationalDashboardScope,
  monthlyStart: Date,
  now: Date,
): Promise<OperationalDashboardTrendPoint[]> {
  const params: unknown[] = [scope.organizationId, scope.tenantId, monthlyStart]
  let sql = `
    select date_trunc('month', performed_at) as month_start, type, count(*)::int as count
    from wms_inventory_movements
    where organization_id = ? and tenant_id = ? and deleted_at is null
      and performed_at >= ?
  `
  sql = appendWarehouseFilter(sql, params, scope.warehouseId)
  sql += ' group by 1, 2 order by 1'

  const rows = await em.getConnection().execute<MonthlyTrendRow[]>(sql, params)
  const monthlyTrendMap = new Map<string, { receive: number; allocate: number }>()
  for (let index = 0; index < MONTHLY_TREND_MONTHS; index += 1) {
    const monthDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHLY_TREND_MONTHS - 1 - index), 1),
    )
    monthlyTrendMap.set(formatMonthKey(monthDate), { receive: 0, allocate: 0 })
  }

  for (const row of rows) {
    const monthDate = row.month_start instanceof Date ? row.month_start : new Date(row.month_start)
    const key = formatMonthKey(monthDate)
    const bucket = monthlyTrendMap.get(key)
    if (!bucket) continue
    if (row.type === 'receipt' || row.type === 'return_receive') {
      bucket.receive += toOperationalDashboardNumber(row.count)
    }
    if (row.type === 'pick' || row.type === 'pack') {
      bucket.allocate += toOperationalDashboardNumber(row.count)
    }
  }

  return Array.from(monthlyTrendMap.entries()).map(([month, values]) => ({
    month,
    receive: values.receive,
    allocate: values.allocate,
  }))
}

async function loadExpiringSoonDailyCounts(
  em: EntityManager,
  scope: OperationalDashboardScope,
  dayBuckets: Date[],
): Promise<DailyCountRow[]> {
  if (dayBuckets.length === 0) return []
  const trendStart = dayBuckets[0]!
  const trendEnd = dayBuckets[dayBuckets.length - 1]!
  const params: unknown[] = [
    trendStart,
    trendEnd,
    scope.organizationId,
    scope.tenantId,
  ]
  let sql = `
    select bucket.day as day, count(distinct l.id)::int as count
    from (
      select generate_series(?::timestamptz, ?::timestamptz, interval '1 day') as day
    ) bucket
    join wms_inventory_lots l
      on l.organization_id = ?
     and l.tenant_id = ?
     and l.deleted_at is null
     and l.status = 'available'
     and l.expires_at is not null
     and l.expires_at >= bucket.day
     and l.expires_at <= bucket.day + interval '${EXPIRING_SOON_DAYS} days'
  `
  if (scope.warehouseId) {
    sql += `
     join wms_inventory_balances b
       on b.lot_id = l.id
      and b.deleted_at is null
      and b.warehouse_id = ?
    `
    params.push(scope.warehouseId)
  }
  sql += ' group by bucket.day order by bucket.day'
  return em.getConnection().execute<DailyCountRow[]>(sql, params)
}

async function loadPastDueLotCount(
  em: EntityManager,
  scope: OperationalDashboardScope,
  todayStart: Date,
): Promise<number> {
  const params: unknown[] = [scope.organizationId, scope.tenantId, todayStart]
  let sql = `
    select count(distinct l.id)::int as count
    from wms_inventory_lots l
    join wms_inventory_balances b
      on b.lot_id = l.id
     and b.deleted_at is null
     and (
       coalesce(b.quantity_on_hand, 0)
       - coalesce(b.quantity_reserved, 0)
       - coalesce(b.quantity_allocated, 0)
     ) > 0
    where l.organization_id = ?
      and l.tenant_id = ?
      and l.deleted_at is null
      and l.status = 'available'
      and l.expires_at is not null
      and l.expires_at < ?
  `
  if (scope.warehouseId) {
    sql += ' and b.warehouse_id = ?'
    params.push(scope.warehouseId)
  }
  const rows = await em.getConnection().execute<Array<{ count: string | number }>>(sql, params)
  return toOperationalDashboardNumber(rows[0]?.count)
}

async function loadPastDueDailyCounts(
  em: EntityManager,
  scope: OperationalDashboardScope,
  dayBuckets: Date[],
): Promise<DailyCountRow[]> {
  if (dayBuckets.length === 0) return []
  const params: unknown[] = [
    dayBuckets[0]!,
    dayBuckets[dayBuckets.length - 1]!,
    scope.organizationId,
    scope.tenantId,
  ]
  let sql = `
    select bucket.day as day, count(distinct l.id)::int as count
    from (
      select generate_series(?::timestamptz, ?::timestamptz, interval '1 day') as day
    ) bucket
    join wms_inventory_lots l
      on l.organization_id = ?
     and l.tenant_id = ?
     and l.deleted_at is null
     and l.status = 'available'
     and l.expires_at is not null
     and l.expires_at < bucket.day
     join wms_inventory_balances b
       on b.lot_id = l.id
      and b.deleted_at is null
      and (
        coalesce(b.quantity_on_hand, 0)
        - coalesce(b.quantity_reserved, 0)
        - coalesce(b.quantity_allocated, 0)
      ) > 0
  `
  if (scope.warehouseId) {
    sql += ' and b.warehouse_id = ?'
    params.push(scope.warehouseId)
  }
  sql += ' group by bucket.day order by bucket.day'
  return em.getConnection().execute<DailyCountRow[]>(sql, params)
}

async function loadAgingReservationsDailyCounts(
  em: EntityManager,
  scope: OperationalDashboardScope,
  dayBuckets: Date[],
): Promise<DailyCountRow[]> {
  if (dayBuckets.length === 0) return []
  const params: unknown[] = [
    dayBuckets[0]!,
    dayBuckets[dayBuckets.length - 1]!,
    scope.organizationId,
    scope.tenantId,
    String(AGING_RESERVATION_DAYS),
  ]
  let sql = `
    select bucket.day as day, count(r.id)::int as count
    from (
      select generate_series(?::timestamptz, ?::timestamptz, interval '1 day') as day
    ) bucket
    join wms_inventory_reservations r
      on r.organization_id = ?
     and r.tenant_id = ?
     and r.deleted_at is null
     and r.status = 'active'
     and r.created_at <= bucket.day - (?::int * interval '1 day')
  `
  sql = appendWarehouseFilter(sql, params, scope.warehouseId)
  sql += ' group by bucket.day order by bucket.day'
  return em.getConnection().execute<DailyCountRow[]>(sql, params)
}

export async function loadOperationalDashboard(
  em: EntityManager,
  scope: OperationalDashboardScope,
): Promise<OperationalDashboardPayload> {
  const now = new Date()
  const todayStart = startOfUtcDay(now)
  const tomorrowStart = addUtcDays(todayStart, 1)
  const yesterdayStart = addUtcDays(todayStart, -1)
  const agingCutoff = addUtcDays(todayStart, -AGING_RESERVATION_DAYS)
  const expiringCutoff = addUtcDays(todayStart, EXPIRING_SOON_DAYS)
  const trendStart = addUtcDays(todayStart, -(TREND_DAYS - 1))
  const dayBuckets = buildDailyBuckets(TREND_DAYS, now)
  const decryptionScope = resolveDecryptionScope(scope)

  const baseScope = {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null as Date | null,
  }

  if (scope.warehouseId) {
    const warehouse = await findOneWithDecryption(
      em,
      Warehouse,
      { id: scope.warehouseId, ...baseScope },
      undefined,
      decryptionScope,
    )
    if (!warehouse) {
      throw new OperationalDashboardWarehouseNotFoundError(scope.warehouseId)
    }
  }

  const warehouseFilter = scope.warehouseId ? { warehouse: scope.warehouseId } : {}

  const [profiles, balances, expiringSoonLots, pastDueLots, reservations, activityMovements] = await Promise.all([
    findWithDecryption(em, ProductInventoryProfile, baseScope, undefined, decryptionScope),
    findWithDecryption(
      em,
      InventoryBalance,
      { ...baseScope, ...warehouseFilter },
      { populate: ['warehouse', 'location', 'lot'] },
      decryptionScope,
    ),
    findWithDecryption(
      em,
      InventoryLot,
      {
        ...baseScope,
        status: 'available',
        expiresAt: { $ne: null, $gte: todayStart, $lte: expiringCutoff },
      },
      { orderBy: { expiresAt: 'ASC' }, limit: 100 },
      decryptionScope,
    ),
    findWithDecryption(
      em,
      InventoryLot,
      {
        ...baseScope,
        status: 'available',
        expiresAt: { $ne: null, $lt: todayStart },
      },
      { orderBy: { expiresAt: 'ASC' }, limit: 100 },
      decryptionScope,
    ),
    findWithDecryption(
      em,
      InventoryReservation,
      {
        ...baseScope,
        ...warehouseFilter,
        status: 'active',
        createdAt: { $lte: agingCutoff },
      },
      undefined,
      decryptionScope,
    ),
    findWithDecryption(
      em,
      InventoryMovement,
      { ...baseScope, ...warehouseFilter },
      {
        populate: ['warehouse', 'locationFrom', 'locationTo'],
        orderBy: { performedAt: 'DESC' },
        limit: ACTIVITY_LIMIT,
      },
      decryptionScope,
    ),
  ])

  const { lowStockCount, reorderCriticalCount } = computeLowStockCounts(
    profiles,
    balances,
    scope.warehouseId,
  )

  const expiringSoonCount = expiringSoonLots.filter(
    (lot) => resolveLotAvailableQuantity(lot.id, balances, scope.warehouseId) > 0,
  ).length

  const agingReservationsCount = reservations.length

  const [
    todaysMoveCount,
    yesterdaysMoveCount,
    pastDueCount,
    lowStockSparklineRows,
    reorderCriticalSparklineRows,
    expiringSoonSparklineRows,
    pastDueSparklineRows,
    agingReservationsSparklineRows,
    todaysMovesSparklineRows,
    monthlyTrends,
  ] = await Promise.all([
    countMovementsBetween(em, scope, todayStart, tomorrowStart),
    countMovementsBetween(em, scope, yesterdayStart, todayStart),
    loadPastDueLotCount(em, scope, todayStart),
    loadMovementDailyCounts(em, scope, trendStart, { types: ['adjust'], quantitySign: 'negative' }),
    loadMovementDailyCounts(em, scope, trendStart, { types: ['adjust'], quantitySign: 'negative' }),
    loadExpiringSoonDailyCounts(em, scope, dayBuckets),
    loadPastDueDailyCounts(em, scope, dayBuckets),
    loadAgingReservationsDailyCounts(em, scope, dayBuckets),
    loadMovementDailyCounts(em, scope, trendStart),
    loadMonthlyMovementTrends(
      em,
      scope,
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHLY_TREND_MONTHS - 1), 1)),
      now,
    ),
  ])

  const kpis: OperationalDashboardKpi[] = [
    {
      id: 'lowStock',
      count: lowStockCount,
      deltaSinceYesterday: null,
      sparkline: mapDailyCountsToSparkline(dayBuckets, lowStockSparklineRows),
    },
    {
      id: 'reorderCritical',
      count: reorderCriticalCount,
      deltaSinceYesterday: null,
      sparkline: mapDailyCountsToSparkline(dayBuckets, reorderCriticalSparklineRows),
    },
    {
      id: 'expiringSoon',
      count: expiringSoonCount,
      deltaSinceYesterday: null,
      sparkline: mapDailyCountsToSparkline(dayBuckets, expiringSoonSparklineRows),
    },
    {
      id: 'pastDue',
      count: pastDueCount,
      deltaSinceYesterday: null,
      sparkline: mapDailyCountsToSparkline(dayBuckets, pastDueSparklineRows),
    },
    {
      id: 'agingReservations',
      count: agingReservationsCount,
      deltaSinceYesterday: null,
      sparkline: mapDailyCountsToSparkline(dayBuckets, agingReservationsSparklineRows),
    },
    {
      id: 'todaysMoves',
      count: todaysMoveCount,
      deltaSinceYesterday: todaysMoveCount - yesterdaysMoveCount,
      sparkline: mapDailyCountsToSparkline(dayBuckets, todaysMovesSparklineRows),
    },
  ]

  const variantIds = Array.from(new Set(activityMovements.map((movement) => movement.catalogVariantId)))
  const variantSkus = await loadVariantSkus(em, scope, variantIds)

  const recentActivity: OperationalDashboardActivityRow[] = activityMovements.map((movement) => {
    const warehouseLabel = resolveWarehouseLabel(movement.warehouse, movement.warehouse.id)
    return {
      id: movement.id,
      movementType: movement.type,
      quantity: toOperationalDashboardNumber(movement.quantity),
      variantSku: variantSkus.get(movement.catalogVariantId) ?? null,
      variantId: movement.catalogVariantId,
      referenceType: movement.referenceType ?? null,
      referenceId: movement.referenceId ?? null,
      reason: movement.reason ?? null,
      locationLabel: resolveLocationLabel(
        warehouseLabel,
        movement.locationFrom?.code,
        movement.locationTo?.code,
      ),
      performedAt: movement.performedAt.toISOString(),
    }
  })

  const expiryLots = buildExpiryLotRows(
    expiringSoonLots,
    pastDueLots,
    balances,
    scope.warehouseId,
  )

  return {
    lastUpdatedAt: now.toISOString(),
    warehouseId: scope.warehouseId ?? null,
    kpis,
    expiryLots,
    monthlyTrends,
    recentActivity,
  }
}
