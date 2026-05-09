// =============================================================================
// WMS Inventory Mutation Commands — Undo Policy
// =============================================================================
//
// All inventory-mutation commands in this file are deliberately registered
// with `isUndoable: false` and therefore opt out of the generic command-bus
// undo flow. WMS inventory is modeled as an append-only ledger
// (`inventory_movements`) that drives live balances; subsequent reservations
// and movements may be made on top of any prior state, so a per-record
// "undo" cannot safely re-derive a point-in-time balance without a
// stop-the-world replay.
//
// Reversal is therefore exposed as an explicit, auditable counter-action in
// the domain model rather than as a generic undo verb:
//   - reserve         ↔ release
//   - allocate        ↔ release (cancels the allocation)
//   - adjust(+N)      ↔ adjust(-N)
//   - receive         ↔ adjust / RMA flow
//   - move(A → B)     ↔ move(B → A)
//   - cycle count     ↔ cycle count (re-recount)
//
// The audit log still captures the full before/after via `buildLog`, so any
// reversing counter-action is fully traceable.
// =============================================================================
import { LockMode } from '@mikro-orm/core'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitWmsEvent } from '../events'
import {
  InventoryBalance,
  InventoryLot,
  InventoryMovement,
  InventoryReservation,
  ProductInventoryProfile,
  Warehouse,
  WarehouseLocation,
  type InventoryStrategy,
} from '../data/entities'
import {
  inventoryAdjustSchema,
  inventoryCycleCountSchema,
  inventoryMoveSchema,
  inventoryReceiveSchema,
  inventoryReservationAllocateSchema,
  inventoryReservationCreateSchema,
  inventoryReservationReleaseSchema,
  type InventoryAdjustInput,
  type InventoryCycleCountInput,
  type InventoryMoveInput,
  type InventoryReceiveInput,
  type InventoryReservationAllocateInput,
  type InventoryReservationCreateInput,
  type InventoryReservationReleaseInput,
} from '../data/validators'
import {
  evaluateLowStock,
  resolveReservationStrategyFromProfile,
  sortBucketsForStrategy,
  type InventoryStrategyBucket,
} from '../lib/inventoryPolicy'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  inventoryBalanceCrudEvents,
  inventoryBalanceCrudIndexer,
  inventoryMovementCrudEvents,
  inventoryMovementCrudIndexer,
  inventoryReservationCrudEvents,
  inventoryReservationCrudIndexer,
  requireId,
  toNumericString,
  WMS_INVENTORY_BALANCE_RESOURCE,
  WMS_INVENTORY_MOVEMENT_RESOURCE,
  WMS_INVENTORY_RESERVATION_RESOURCE,
} from './shared'

type Scope = { tenantId: string; organizationId: string }
type AllocationBucket = {
  balanceId: string
  locationId: string
  lotId: string | null
  serialNumber: string | null
  quantity: number
}

type ReservationMetadata = {
  allocatedBuckets?: AllocationBucket[]
  allocationState?: 'reserved' | 'allocated'
  strategy?: InventoryStrategy
  releasedReason?: string
  releasedAt?: string
  allocatedAt?: string
  [key: string]: unknown
}

type ReservationCommandResult = {
  reservationId: string
  allocatedBuckets: Array<{ locationId: string; lotId: string | null; quantity: string }>
}

type MutationLogInput = {
  actionKey: string
  fallbackLabel: string
  resourceKind: string
  resourceId: string | null
  parentResourceId?: string | null
  tenantId: string | null
  organizationId: string | null
  cacheAliases?: string[]
}

type AffectedReservation = { entity: InventoryReservation; action: 'created' | 'updated' | 'deleted' }
type AffectedMovement = { entity: InventoryMovement; action: 'created' | 'updated' | 'deleted' }
type AffectedBalance = { entity: InventoryBalance; action: 'created' | 'updated' | 'deleted' }

type AffectedSideEffects = {
  reservations?: AffectedReservation[]
  movements?: AffectedMovement[]
  balances?: AffectedBalance[]
}

async function emitInventorySideEffects(
  ctx: CommandRuntimeContext,
  affected: AffectedSideEffects,
): Promise<void> {
  let de: DataEngine | null = null
  try {
    de = ctx.container.resolve('dataEngine') as DataEngine
  } catch {
    de = null
  }
  if (!de) return

  for (const { entity, action } of affected.reservations ?? []) {
    await emitCrudSideEffects({
      dataEngine: de,
      action,
      entity,
      identifiers: {
        id: entity.id,
        organizationId: entity.organizationId,
        tenantId: entity.tenantId,
      },
      indexer: inventoryReservationCrudIndexer,
      events: inventoryReservationCrudEvents,
    })
  }
  for (const { entity, action } of affected.movements ?? []) {
    await emitCrudSideEffects({
      dataEngine: de,
      action,
      entity,
      identifiers: {
        id: entity.id,
        organizationId: entity.organizationId,
        tenantId: entity.tenantId,
      },
      indexer: inventoryMovementCrudIndexer,
      events: inventoryMovementCrudEvents,
    })
  }
  for (const { entity, action } of affected.balances ?? []) {
    await emitCrudSideEffects({
      dataEngine: de,
      action,
      entity,
      identifiers: {
        id: entity.id,
        organizationId: entity.organizationId,
        tenantId: entity.tenantId,
      },
      indexer: inventoryBalanceCrudIndexer,
      events: inventoryBalanceCrudEvents,
    })
  }
}

function resolveScope(ctx: CommandRuntimeContext, fallback?: { tenantId?: string | null; organizationId?: string | null }): Scope {
  const tenantId = fallback?.tenantId ?? ctx.auth?.tenantId ?? null
  const organizationId = fallback?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, { error: 'Tenant and organization scope are required.' })
  }
  return { tenantId, organizationId }
}

function resolveEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

async function runInTransaction<TResult>(
  em: EntityManager,
  operation: (trx: EntityManager) => Promise<TResult>,
): Promise<TResult> {
  const transactionalEm = em as EntityManager & {
    transactional?: (callback: (trx: EntityManager) => Promise<TResult>) => Promise<TResult>
  }
  if (typeof transactionalEm.transactional === 'function') {
    return transactionalEm.transactional((trx) => operation(trx))
  }
  return operation(em)
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function setNumeric(target: { [key: string]: unknown }, key: string, value: number) {
  target[key] = toNumericString(value)
}

function getAvailableQuantity(balance: InventoryBalance): number {
  return toNumber(balance.quantityOnHand) - toNumber(balance.quantityReserved) - toNumber(balance.quantityAllocated)
}

function extractReservationMetadata(reservation: InventoryReservation): ReservationMetadata {
  if (!reservation.metadata || typeof reservation.metadata !== 'object' || Array.isArray(reservation.metadata)) {
    return {}
  }
  return { ...(reservation.metadata as Record<string, unknown>) }
}

function buildBucketKey(input: {
  warehouseId: string
  locationId: string
  catalogVariantId: string
  lotId: string | null
  serialNumber: string | null
}): string {
  return [
    input.warehouseId,
    input.locationId,
    input.catalogVariantId,
    input.lotId ?? '',
    input.serialNumber ?? '',
  ].join('::')
}

function serializeAllocationBuckets(buckets: AllocationBucket[]): Array<{ locationId: string; lotId: string | null; quantity: string }> {
  return buckets.map((bucket) => ({
    locationId: bucket.locationId,
    lotId: bucket.lotId,
    quantity: toNumericString(bucket.quantity),
  }))
}

async function buildMutationLog(input: MutationLogInput) {
  const { translate } = await resolveTranslations()
  const aliases = Array.from(
    new Set((input.cacheAliases ?? []).filter((alias) => typeof alias === 'string' && alias.length > 0)),
  )
  return {
    actionLabel: translate(input.actionKey, input.fallbackLabel),
    resourceKind: input.resourceKind,
    resourceId: input.resourceId,
    parentResourceKind: input.parentResourceId ? 'wms.inventory' : null,
    parentResourceId: input.parentResourceId ?? null,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    ...(aliases.length ? { context: { cacheAliases: aliases } } : {}),
  }
}

async function requireWarehouse(em: EntityManager, ctx: CommandRuntimeContext, warehouseId: string, scope?: Scope) {
  const resolvedScope = scope ?? resolveScope(ctx)
  const warehouse = await findOneWithDecryption(
    em,
    Warehouse,
    { id: warehouseId, deletedAt: null },
    undefined,
    resolvedScope,
  )
  if (!warehouse) throw new CrudHttpError(404, { error: 'Warehouse not found.' })
  ensureTenantScope(ctx, warehouse.tenantId)
  ensureOrganizationScope(ctx, warehouse.organizationId)
  return warehouse
}

async function requireLocation(em: EntityManager, ctx: CommandRuntimeContext, locationId: string, scope?: Scope) {
  const resolvedScope = scope ?? resolveScope(ctx)
  const location = await findOneWithDecryption(
    em,
    WarehouseLocation,
    { id: locationId, deletedAt: null },
    undefined,
    resolvedScope,
  )
  if (!location) throw new CrudHttpError(404, { error: 'Warehouse location not found.' })
  ensureTenantScope(ctx, location.tenantId)
  ensureOrganizationScope(ctx, location.organizationId)
  return location
}

async function requireReservation(em: EntityManager, ctx: CommandRuntimeContext, reservationId: string, scope?: Scope, lock = false) {
  const resolvedScope = scope ?? resolveScope(ctx)
  const reservation = await findOneWithDecryption(
    em,
    InventoryReservation,
    { id: reservationId, deletedAt: null },
    lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : undefined,
    resolvedScope,
  )
  if (!reservation) throw new CrudHttpError(404, { error: 'Inventory reservation not found.' })
  ensureTenantScope(ctx, reservation.tenantId)
  ensureOrganizationScope(ctx, reservation.organizationId)
  return reservation
}

async function loadProfileForVariant(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  catalogVariantId: string,
  scope?: Scope,
) {
  const resolvedScope = scope ?? resolveScope(ctx)
  const profile = await findOneWithDecryption(
    em,
    ProductInventoryProfile,
    { catalogVariantId, deletedAt: null },
    undefined,
    resolvedScope,
  )
  if (!profile) return null
  ensureTenantScope(ctx, profile.tenantId)
  ensureOrganizationScope(ctx, profile.organizationId)
  return profile
}

async function listCandidateBalances(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  input: {
    warehouseId: string
    catalogVariantId: string
    lotId?: string
    serialNumber?: string
  },
  scope: Scope,
) {
  const where: Record<string, unknown> = {
    warehouse: input.warehouseId,
    catalogVariantId: input.catalogVariantId,
    deletedAt: null,
  }
  if (input.lotId) where.lot = input.lotId
  if (input.serialNumber) where.serialNumber = input.serialNumber
  const balances = await findWithDecryption(
    em,
    InventoryBalance,
    where,
    {
      populate: ['lot', 'location'],
      lockMode: LockMode.PESSIMISTIC_WRITE,
      orderBy: { createdAt: 'asc', id: 'asc' },
    },
    scope,
  )
  for (const balance of balances) {
    ensureTenantScope(ctx, balance.tenantId)
    ensureOrganizationScope(ctx, balance.organizationId)
  }
  return balances
}

async function listBalancesForVariant(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  catalogVariantId: string,
  scope: Scope,
) {
  const balances = await findWithDecryption(
    em,
    InventoryBalance,
    {
      catalogVariantId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
  for (const balance of balances) {
    ensureTenantScope(ctx, balance.tenantId)
    ensureOrganizationScope(ctx, balance.organizationId)
  }
  return balances
}

async function emitLowStockEventIfNeeded(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  scope: Scope,
  catalogVariantId: string,
) {
  const profile = await loadProfileForVariant(em, ctx, catalogVariantId, scope)
  if (!profile) return

  const balances = await listBalancesForVariant(em, ctx, catalogVariantId, scope)
  const availableQuantity = balances.reduce((total, balance) => total + getAvailableQuantity(balance), 0)
  const lowStock = evaluateLowStock(profile, availableQuantity)
  if (!lowStock) return

  await emitWmsEvent('wms.inventory.low_stock', {
    id: catalogVariantId,
    catalogVariantId,
    availableQuantity: lowStock.availableQuantity,
    reorderPoint: lowStock.reorderPoint,
    safetyStock: lowStock.safetyStock,
    state: lowStock.state,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
}

async function loadReceivedAtByBucket(
  em: EntityManager,
  balances: InventoryBalance[],
  scope: Scope,
): Promise<Map<string, Date>> {
  if (balances.length === 0) return new Map()
  const locationIds = Array.from(
    new Set(
      balances.map((balance) => (typeof balance.location === 'string' ? balance.location : balance.location.id)),
    ),
  )
  const warehouseId = typeof balances[0].warehouse === 'string' ? balances[0].warehouse : balances[0].warehouse.id
  const catalogVariantId = balances[0].catalogVariantId
  const movements = await findWithDecryption(
    em,
    InventoryMovement,
    {
      warehouse: warehouseId,
      catalogVariantId,
      deletedAt: null,
      $or: [
        { locationFrom: { $in: locationIds } },
        { locationTo: { $in: locationIds } },
      ],
    },
    {
      orderBy: { receivedAt: 'asc' },
    },
    scope,
  )
  const map = new Map<string, Date>()
  for (const movement of movements) {
    const locationIdRaw = movement.locationTo ?? movement.locationFrom ?? null
    const locationId =
      typeof locationIdRaw === 'string'
        ? locationIdRaw
        : locationIdRaw?.id ?? null
    if (!locationId) continue
    const lotIdRaw = movement.lot ?? null
    const lotId = typeof lotIdRaw === 'string' ? lotIdRaw : lotIdRaw?.id ?? null
    const key = buildBucketKey({
      warehouseId,
      locationId,
      catalogVariantId: movement.catalogVariantId,
      lotId,
      serialNumber: movement.serialNumber ?? null,
    })
    if (!map.has(key)) {
      map.set(key, movement.receivedAt)
    }
  }
  return map
}

type BalanceSortRow = InventoryStrategyBucket & { balance: InventoryBalance }

function sortBalancesForStrategy(
  balances: InventoryBalance[],
  strategy: InventoryStrategy,
  receiptMap: Map<string, Date>,
): InventoryBalance[] {
  const rows: BalanceSortRow[] = balances.map((balance) => {
    const warehouseId = typeof balance.warehouse === 'string' ? balance.warehouse : balance.warehouse.id
    const locationId = typeof balance.location === 'string' ? balance.location : balance.location.id
    const lotIdRaw = balance.lot ?? null
    const lotId = typeof lotIdRaw === 'string' ? lotIdRaw : lotIdRaw?.id ?? null
    const lot = typeof balance.lot === 'string' ? null : balance.lot
    return {
      balance,
      warehouseId,
      locationId,
      catalogVariantId: balance.catalogVariantId,
      createdAt: balance.createdAt,
      lotId,
      lotExpiresAt: lot?.expiresAt ?? null,
      serialNumber: balance.serialNumber ?? null,
    }
  })
  const sorted = sortBucketsForStrategy(rows, strategy, receiptMap)
  return sorted.map((row) => row.balance)
}

async function resolveReservationStrategy(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  input: InventoryReservationCreateInput,
  scope: Scope,
): Promise<InventoryStrategy> {
  const profile = await loadProfileForVariant(em, ctx, input.catalogVariantId, scope)
  return resolveReservationStrategyFromProfile(profile, input.strategy)
}

function requireSufficientAvailability(remaining: number) {
  if (remaining > 0.000001) {
    throw new CrudHttpError(409, { error: 'insufficient_stock' })
  }
}

async function findExactBalanceForUpdate(
  em: EntityManager,
  scope: Scope,
  input: {
    warehouseId: string
    locationId: string
    catalogVariantId: string
    lotId?: string
    serialNumber?: string
  },
) {
  return findOneWithDecryption(
    em,
    InventoryBalance,
    {
      warehouse: input.warehouseId,
      location: input.locationId,
      catalogVariantId: input.catalogVariantId,
      lot: input.lotId ?? null,
      serialNumber: input.serialNumber ?? null,
      deletedAt: null,
    },
    { lockMode: LockMode.PESSIMISTIC_WRITE },
    scope,
  )
}

async function findReservationBucketBalance(
  em: EntityManager,
  scope: Scope,
  reservation: InventoryReservation,
  bucket: AllocationBucket,
) {
  const warehouseId =
    typeof reservation.warehouse === 'string'
      ? reservation.warehouse
      : reservation.warehouse.id

  if (typeof bucket.balanceId === 'string' && bucket.balanceId.length > 0) {
    const balance = await findOneWithDecryption(
      em,
      InventoryBalance,
      { id: bucket.balanceId, deletedAt: null },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
      scope,
    )
    if (balance) return balance
  }

  return findExactBalanceForUpdate(em, scope, {
    warehouseId,
    locationId: bucket.locationId,
    catalogVariantId: reservation.catalogVariantId,
    lotId: bucket.lotId ?? undefined,
    serialNumber: bucket.serialNumber ?? undefined,
  })
}

async function upsertBalanceBucket(
  em: EntityManager,
  scope: Scope,
  input: {
    warehouseId: string
    locationId: string
    catalogVariantId: string
    lotId?: string
    serialNumber?: string
  },
): Promise<{ balance: InventoryBalance; created: boolean }> {
  const existing = await findExactBalanceForUpdate(em, scope, input)
  if (existing) return { balance: existing, created: false }
  const balance = em.create(InventoryBalance, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    warehouse: em.getReference(Warehouse, input.warehouseId),
    location: em.getReference(WarehouseLocation, input.locationId),
    catalogVariantId: input.catalogVariantId,
    lot: input.lotId ? em.getReference(InventoryLot, input.lotId) : null,
    serialNumber: input.serialNumber ?? null,
    quantityOnHand: '0',
    quantityReserved: '0',
    quantityAllocated: '0',
    metadata: null,
  })
  em.persist(balance)
  await em.flush()
  return { balance, created: true }
}

async function resolveReceivedAtForBalance(
  em: EntityManager,
  balance: InventoryBalance | null,
  scope: Scope,
  fallback: Date,
): Promise<Date> {
  if (!balance) return fallback
  const warehouseId = typeof balance.warehouse === 'string' ? balance.warehouse : balance.warehouse.id
  const locationId = typeof balance.location === 'string' ? balance.location : balance.location.id
  const lotIdRaw = balance.lot ?? null
  const lotId = typeof lotIdRaw === 'string' ? lotIdRaw : lotIdRaw?.id ?? null
  const movement = await findOneWithDecryption(
    em,
    InventoryMovement,
    {
      warehouse: warehouseId,
      catalogVariantId: balance.catalogVariantId,
      lot: lotId,
      serialNumber: balance.serialNumber ?? null,
      deletedAt: null,
      $or: [
        { locationFrom: locationId },
        { locationTo: locationId },
      ],
    },
    { orderBy: { receivedAt: 'asc' } },
    scope,
  )
  return movement?.receivedAt ?? fallback
}

async function createMovement(
  em: EntityManager,
  scope: Scope,
  input: {
    warehouseId: string
    locationFromId?: string | null
    locationToId?: string | null
    catalogVariantId: string
    lotId?: string | null
    serialNumber?: string | null
    quantity: number
    type: InventoryMovement['type']
    referenceType: InventoryMovement['referenceType']
    referenceId: string
    performedBy: string
    performedAt: Date
    receivedAt: Date
    reason?: string | null
    metadata?: Record<string, unknown> | null
  },
) {
  const movement = em.create(InventoryMovement, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    warehouse: em.getReference(Warehouse, input.warehouseId),
    locationFrom: input.locationFromId ? em.getReference(WarehouseLocation, input.locationFromId) : null,
    locationTo: input.locationToId ? em.getReference(WarehouseLocation, input.locationToId) : null,
    catalogVariantId: input.catalogVariantId,
    lot: input.lotId ? em.getReference(InventoryLot, input.lotId) : null,
    serialNumber: input.serialNumber ?? null,
    quantity: toNumericString(input.quantity),
    type: input.type,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    performedBy: input.performedBy,
    performedAt: input.performedAt,
    receivedAt: input.receivedAt,
    reason: input.reason ?? null,
    metadata: input.metadata ?? null,
  })
  em.persist(movement)
  return movement
}

const reserveInventoryCommand: CommandHandler<InventoryReservationCreateInput, ReservationCommandResult> = {
  id: 'wms.inventory.reserve',
  // See "WMS Inventory Mutation Commands — Undo Policy" at top of file.
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = inventoryReservationCreateSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const em = resolveEm(ctx)
    const result = await runInTransaction(em, async (trx) => {
      const scope = resolveScope(ctx, input)
      await requireWarehouse(trx, ctx, input.warehouseId, scope)
      const strategy = await resolveReservationStrategy(trx, ctx, input, scope)
      const balances = await listCandidateBalances(trx, ctx, input, scope)
      const receiptMap = await loadReceivedAtByBucket(trx, balances, scope)
      const ordered = sortBalancesForStrategy(
        balances.filter((balance) => getAvailableQuantity(balance) > 0),
        strategy,
        receiptMap,
      )
      let remaining = input.quantity
      const buckets: AllocationBucket[] = []
      const touchedBalances: InventoryBalance[] = []
      for (const balance of ordered) {
        if (remaining <= 0) break
        const available = getAvailableQuantity(balance)
        if (available <= 0) continue
        const quantity = Math.min(available, remaining)
        const locationId = typeof balance.location === 'string' ? balance.location : balance.location.id
        const lotIdRaw = balance.lot ?? null
        const lotId = typeof lotIdRaw === 'string' ? lotIdRaw : lotIdRaw?.id ?? null
        const persistedBalance = await findExactBalanceForUpdate(trx, scope, {
          warehouseId: input.warehouseId,
          locationId,
          catalogVariantId: input.catalogVariantId,
          lotId: lotId ?? undefined,
          serialNumber: balance.serialNumber ?? undefined,
        })
        if (!persistedBalance) {
          throw new CrudHttpError(409, { error: 'invalid_tracking_state' })
        }
        setNumeric(
          persistedBalance as unknown as Record<string, unknown>,
          'quantityReserved',
          toNumber(persistedBalance.quantityReserved) + quantity,
        )
        touchedBalances.push(persistedBalance)
        buckets.push({
          balanceId: persistedBalance.id,
          locationId,
          lotId,
          serialNumber: balance.serialNumber ?? null,
          quantity,
        })
        remaining -= quantity
      }
      requireSufficientAvailability(remaining)
      const reservation = trx.create(InventoryReservation, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouse: trx.getReference(Warehouse, input.warehouseId),
        catalogVariantId: input.catalogVariantId,
        lot: buckets.length === 1 && buckets[0].lotId ? trx.getReference(InventoryLot, buckets[0].lotId) : null,
        serialNumber: buckets.length === 1 ? buckets[0].serialNumber : null,
        quantity: toNumericString(input.quantity),
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        expiresAt: input.expiresAt ?? null,
        status: 'active',
        metadata: {
          ...(input.metadata ?? {}),
          allocatedBuckets: buckets,
          allocationState: 'reserved',
          strategy,
        },
      })
      trx.persist(reservation)
      await trx.flush()
      return {
        reservationId: reservation.id,
        allocatedBuckets: serializeAllocationBuckets(buckets),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        warehouseId: input.warehouseId,
        catalogVariantId: input.catalogVariantId,
        quantity: input.quantity,
        reservationEntity: reservation,
        touchedBalances,
      }
    })
    await emitInventorySideEffects(ctx, {
      reservations: [{ entity: result.reservationEntity, action: 'created' }],
      balances: result.touchedBalances.map((entity) => ({ entity, action: 'updated' as const })),
    })
    void emitWmsEvent('wms.inventory.reserved', {
      id: result.reservationId,
      reservationId: result.reservationId,
      warehouseId: result.warehouseId,
      catalogVariantId: result.catalogVariantId,
      quantity: toNumericString(result.quantity),
      tenantId: result.tenantId,
      organizationId: result.organizationId,
    }).catch(() => undefined)
    void emitLowStockEventIfNeeded(
      resolveEm(ctx),
      ctx,
      { tenantId: result.tenantId, organizationId: result.organizationId },
      result.catalogVariantId,
    ).catch(() => undefined)
    return {
      reservationId: result.reservationId,
      allocatedBuckets: result.allocatedBuckets,
    }
  },
  buildLog: async ({ input, result, ctx }) =>
    buildMutationLog({
      actionKey: 'wms.audit.inventory.reserve',
      fallbackLabel: 'Reserve inventory',
      resourceKind: WMS_INVENTORY_RESERVATION_RESOURCE,
      resourceId: result?.reservationId ?? null,
      parentResourceId:
        input?.warehouseId && input?.catalogVariantId
          ? `${input.warehouseId}:${input.catalogVariantId}`
          : null,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      cacheAliases: [WMS_INVENTORY_BALANCE_RESOURCE],
    }),
}

const releaseInventoryReservationCommand: CommandHandler<InventoryReservationReleaseInput, { reservationId: string }> = {
  id: 'wms.inventory.release',
  // See "WMS Inventory Mutation Commands — Undo Policy" at top of file.
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = inventoryReservationReleaseSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const em = resolveEm(ctx)
    const result = await runInTransaction(em, async (trx) => {
      const scope = resolveScope(ctx, input)
      const reservation = await requireReservation(trx, ctx, input.reservationId, scope, true)
      const metadata = extractReservationMetadata(reservation)
      const buckets = Array.isArray(metadata.allocatedBuckets) ? (metadata.allocatedBuckets as AllocationBucket[]) : []
      const allocationState = metadata.allocationState ?? 'reserved'
      const touchedBalances: InventoryBalance[] = []
      for (const bucket of buckets) {
        const balance = await findReservationBucketBalance(
          trx,
          scope,
          reservation,
          bucket,
        )
        if (!balance) continue
        if (allocationState === 'allocated') {
          setNumeric(
            balance as unknown as Record<string, unknown>,
            'quantityAllocated',
            Math.max(0, toNumber(balance.quantityAllocated) - bucket.quantity),
          )
        } else {
          setNumeric(
            balance as unknown as Record<string, unknown>,
            'quantityReserved',
            Math.max(0, toNumber(balance.quantityReserved) - bucket.quantity),
          )
        }
        touchedBalances.push(balance)
      }
      reservation.status = 'released'
      reservation.metadata = {
        ...metadata,
        releasedReason: input.reason,
        releasedAt: new Date().toISOString(),
      }
      await trx.flush()
      return {
        reservationId: reservation.id,
        warehouseId: typeof reservation.warehouse === 'string' ? reservation.warehouse : reservation.warehouse.id,
        catalogVariantId: reservation.catalogVariantId,
        quantity: reservation.quantity,
        tenantId: reservation.tenantId,
        organizationId: reservation.organizationId,
        reservationEntity: reservation,
        touchedBalances,
      }
    })
    await emitInventorySideEffects(ctx, {
      reservations: [{ entity: result.reservationEntity, action: 'updated' }],
      balances: result.touchedBalances.map((entity) => ({ entity, action: 'updated' as const })),
    })
    void emitWmsEvent('wms.inventory.released', {
      id: result.reservationId,
      reservationId: result.reservationId,
      warehouseId: result.warehouseId,
      catalogVariantId: result.catalogVariantId,
      quantity: result.quantity,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
    }).catch(() => undefined)
    void emitLowStockEventIfNeeded(
      resolveEm(ctx),
      ctx,
      { tenantId: result.tenantId, organizationId: result.organizationId },
      result.catalogVariantId,
    ).catch(() => undefined)
    return { reservationId: result.reservationId }
  },
  buildLog: async ({ input, result, ctx }) =>
    buildMutationLog({
      actionKey: 'wms.audit.inventory.release',
      fallbackLabel: 'Release inventory reservation',
      resourceKind: WMS_INVENTORY_RESERVATION_RESOURCE,
      resourceId: result?.reservationId ?? input?.reservationId ?? null,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      cacheAliases: [WMS_INVENTORY_BALANCE_RESOURCE],
    }),
}

const allocateInventoryReservationCommand: CommandHandler<InventoryReservationAllocateInput, { reservationId: string; allocationState: 'allocated' }> = {
  id: 'wms.inventory.allocate',
  // See "WMS Inventory Mutation Commands — Undo Policy" at top of file.
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = inventoryReservationAllocateSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const em = resolveEm(ctx)
    const result = await runInTransaction(em, async (trx) => {
      const scope = resolveScope(ctx, input)
      const reservation = await requireReservation(trx, ctx, input.reservationId, scope, true)
      const metadata = extractReservationMetadata(reservation)
      if (metadata.allocationState === 'allocated') {
        return {
          reservationId: reservation.id,
          allocationState: 'allocated' as const,
          warehouseId: typeof reservation.warehouse === 'string' ? reservation.warehouse : reservation.warehouse.id,
          catalogVariantId: reservation.catalogVariantId,
          quantity: reservation.quantity,
          tenantId: reservation.tenantId,
          organizationId: reservation.organizationId,
          reservationEntity: reservation,
          touchedBalances: [] as InventoryBalance[],
        }
      }
      const buckets = Array.isArray(metadata.allocatedBuckets) ? (metadata.allocatedBuckets as AllocationBucket[]) : []
      const touchedBalances: InventoryBalance[] = []
      for (const bucket of buckets) {
        const balance = await findReservationBucketBalance(
          trx,
          scope,
          reservation,
          bucket,
        )
        if (!balance) throw new CrudHttpError(409, { error: 'invalid_tracking_state' })
        if (toNumber(balance.quantityReserved) < bucket.quantity - 0.000001) {
          throw new CrudHttpError(409, { error: 'invalid_tracking_state' })
        }
        setNumeric(
          balance as unknown as Record<string, unknown>,
          'quantityReserved',
          Math.max(0, toNumber(balance.quantityReserved) - bucket.quantity),
        )
        setNumeric(
          balance as unknown as Record<string, unknown>,
          'quantityAllocated',
          toNumber(balance.quantityAllocated) + bucket.quantity,
        )
        touchedBalances.push(balance)
      }
      reservation.metadata = {
        ...metadata,
        allocationState: 'allocated',
        allocatedAt: new Date().toISOString(),
      }
      await trx.flush()
      return {
        reservationId: reservation.id,
        allocationState: 'allocated' as const,
        warehouseId: typeof reservation.warehouse === 'string' ? reservation.warehouse : reservation.warehouse.id,
        catalogVariantId: reservation.catalogVariantId,
        quantity: reservation.quantity,
        tenantId: reservation.tenantId,
        organizationId: reservation.organizationId,
        reservationEntity: reservation,
        touchedBalances,
      }
    })
    await emitInventorySideEffects(ctx, {
      reservations: [{ entity: result.reservationEntity, action: 'updated' }],
      balances: result.touchedBalances.map((entity) => ({ entity, action: 'updated' as const })),
    })
    void emitWmsEvent('wms.inventory.allocated', {
      id: result.reservationId,
      reservationId: result.reservationId,
      warehouseId: result.warehouseId,
      catalogVariantId: result.catalogVariantId,
      quantity: result.quantity,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
    }).catch(() => undefined)
    return { reservationId: result.reservationId, allocationState: result.allocationState }
  },
  buildLog: async ({ input, result, ctx }) =>
    buildMutationLog({
      actionKey: 'wms.audit.inventory.allocate',
      fallbackLabel: 'Allocate inventory reservation',
      resourceKind: WMS_INVENTORY_RESERVATION_RESOURCE,
      resourceId: result?.reservationId ?? input?.reservationId ?? null,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      cacheAliases: [WMS_INVENTORY_BALANCE_RESOURCE],
    }),
}

const adjustInventoryCommand: CommandHandler<InventoryAdjustInput, { movementId: string }> = {
  id: 'wms.inventory.adjust',
  // See "WMS Inventory Mutation Commands — Undo Policy" at top of file.
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = inventoryAdjustSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const em = resolveEm(ctx)
    const result = await runInTransaction(em, async (trx) => {
      const scope = resolveScope(ctx, input)
      await requireWarehouse(trx, ctx, input.warehouseId, scope)
      const location = await requireLocation(trx, ctx, input.locationId, scope)
      const locationWarehouseId = typeof location.warehouse === 'string' ? location.warehouse : location.warehouse.id
      if (locationWarehouseId !== input.warehouseId) {
        throw new CrudHttpError(422, { error: 'invalid_location' })
      }
      const { balance, created: balanceWasNew } = await upsertBalanceBucket(trx, scope, {
        warehouseId: input.warehouseId,
        locationId: input.locationId,
        catalogVariantId: input.catalogVariantId,
        lotId: input.lotId,
        serialNumber: input.serialNumber,
      })
      const delta = input.delta
      if (delta < 0 && getAvailableQuantity(balance) < Math.abs(delta) - 0.000001) {
        throw new CrudHttpError(409, { error: 'insufficient_stock' })
      }
      setNumeric(
        balance as unknown as Record<string, unknown>,
        'quantityOnHand',
        toNumber(balance.quantityOnHand) + delta,
      )
      const performedAt = input.performedAt ?? new Date()
      const movement = await createMovement(trx, scope, {
        warehouseId: input.warehouseId,
        locationToId: input.locationId,
        catalogVariantId: input.catalogVariantId,
        lotId: input.lotId ?? null,
        serialNumber: input.serialNumber ?? null,
        quantity: delta,
        type: 'adjust',
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        performedBy: input.performedBy,
        performedAt,
        receivedAt: performedAt,
        reason: input.reason,
        metadata: input.metadata ?? null,
      })
      await trx.flush()
      return {
        movementId: movement.id,
        warehouseId: input.warehouseId,
        catalogVariantId: input.catalogVariantId,
        quantity: delta,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        movementEntity: movement,
        balanceEntity: balance,
        balanceAction: balanceWasNew ? ('created' as const) : ('updated' as const),
      }
    })
    await emitInventorySideEffects(ctx, {
      movements: [{ entity: result.movementEntity, action: 'created' }],
      balances: [{ entity: result.balanceEntity, action: result.balanceAction }],
    })
    void emitWmsEvent('wms.inventory.adjusted', {
      id: result.movementId,
      movementId: result.movementId,
      warehouseId: result.warehouseId,
      catalogVariantId: result.catalogVariantId,
      quantity: toNumericString(result.quantity),
      tenantId: result.tenantId,
      organizationId: result.organizationId,
    }).catch(() => undefined)
    void emitLowStockEventIfNeeded(
      resolveEm(ctx),
      ctx,
      { tenantId: result.tenantId, organizationId: result.organizationId },
      result.catalogVariantId,
    ).catch(() => undefined)
    return { movementId: result.movementId }
  },
  buildLog: async ({ input, result, ctx }) =>
    buildMutationLog({
      actionKey: 'wms.audit.inventory.adjust',
      fallbackLabel: 'Adjust inventory',
      resourceKind: WMS_INVENTORY_MOVEMENT_RESOURCE,
      resourceId: result?.movementId ?? null,
      parentResourceId:
        input?.warehouseId && input?.catalogVariantId
          ? `${input.warehouseId}:${input.catalogVariantId}`
          : null,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      cacheAliases: [WMS_INVENTORY_BALANCE_RESOURCE],
    }),
}

const receiveInventoryCommand: CommandHandler<InventoryReceiveInput, { movementId: string }> = {
  id: 'wms.inventory.receive',
  // See "WMS Inventory Mutation Commands — Undo Policy" at top of file.
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = inventoryReceiveSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const em = resolveEm(ctx)
    const result = await runInTransaction(em, async (trx) => {
      const scope = resolveScope(ctx, input)
      await requireWarehouse(trx, ctx, input.warehouseId, scope)
      const location = await requireLocation(trx, ctx, input.locationId, scope)
      const locationWarehouseId = typeof location.warehouse === 'string' ? location.warehouse : location.warehouse.id
      if (locationWarehouseId !== input.warehouseId) {
        throw new CrudHttpError(422, { error: 'invalid_location' })
      }
      const { balance, created: balanceWasNew } = await upsertBalanceBucket(trx, scope, {
        warehouseId: input.warehouseId,
        locationId: input.locationId,
        catalogVariantId: input.catalogVariantId,
        lotId: input.lotId,
        serialNumber: input.serialNumber,
      })
      setNumeric(
        balance as unknown as Record<string, unknown>,
        'quantityOnHand',
        toNumber(balance.quantityOnHand) + input.quantity,
      )
      const receivedAt = input.receivedAt ?? input.performedAt ?? new Date()
      const performedAt = input.performedAt ?? receivedAt
      const movement = await createMovement(trx, scope, {
        warehouseId: input.warehouseId,
        locationToId: input.locationId,
        catalogVariantId: input.catalogVariantId,
        lotId: input.lotId ?? null,
        serialNumber: input.serialNumber ?? null,
        quantity: input.quantity,
        type: 'receipt',
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        performedBy: input.performedBy,
        performedAt,
        receivedAt,
        reason: input.reason,
        metadata: input.metadata ?? null,
      })
      await trx.flush()
      return {
        movementId: movement.id,
        warehouseId: input.warehouseId,
        locationId: input.locationId,
        catalogVariantId: input.catalogVariantId,
        quantity: input.quantity,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        movementEntity: movement,
        balanceEntity: balance,
        balanceAction: balanceWasNew ? ('created' as const) : ('updated' as const),
      }
    })
    await emitInventorySideEffects(ctx, {
      movements: [{ entity: result.movementEntity, action: 'created' }],
      balances: [{ entity: result.balanceEntity, action: result.balanceAction }],
    })
    void emitWmsEvent('wms.inventory.received', {
      id: result.movementId,
      movementId: result.movementId,
      warehouseId: result.warehouseId,
      locationId: result.locationId,
      catalogVariantId: result.catalogVariantId,
      quantity: toNumericString(result.quantity),
      tenantId: result.tenantId,
      organizationId: result.organizationId,
    }).catch(() => undefined)
    void emitLowStockEventIfNeeded(
      resolveEm(ctx),
      ctx,
      { tenantId: result.tenantId, organizationId: result.organizationId },
      result.catalogVariantId,
    ).catch(() => undefined)
    return { movementId: result.movementId }
  },
  buildLog: async ({ input, result, ctx }) =>
    buildMutationLog({
      actionKey: 'wms.audit.inventory.receive',
      fallbackLabel: 'Receive inventory',
      resourceKind: WMS_INVENTORY_MOVEMENT_RESOURCE,
      resourceId: result?.movementId ?? null,
      parentResourceId:
        input?.warehouseId && input?.catalogVariantId
          ? `${input.warehouseId}:${input.catalogVariantId}`
          : null,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      cacheAliases: [WMS_INVENTORY_BALANCE_RESOURCE],
    }),
}

const moveInventoryCommand: CommandHandler<InventoryMoveInput, { movementId: string }> = {
  id: 'wms.inventory.move',
  // See "WMS Inventory Mutation Commands — Undo Policy" at top of file.
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = inventoryMoveSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const em = resolveEm(ctx)
    const result = await runInTransaction(em, async (trx) => {
      const scope = resolveScope(ctx, input)
      await requireWarehouse(trx, ctx, input.warehouseId, scope)
      const sourceLocation = await requireLocation(trx, ctx, input.fromLocationId, scope)
      const targetLocation = await requireLocation(trx, ctx, input.toLocationId, scope)
      const sourceWarehouseId = typeof sourceLocation.warehouse === 'string' ? sourceLocation.warehouse : sourceLocation.warehouse.id
      const targetWarehouseId = typeof targetLocation.warehouse === 'string' ? targetLocation.warehouse : targetLocation.warehouse.id
      if (sourceWarehouseId !== input.warehouseId || targetWarehouseId !== input.warehouseId) {
        throw new CrudHttpError(422, { error: 'invalid_location' })
      }
      const sourceResult = await upsertBalanceBucket(trx, scope, {
        warehouseId: input.warehouseId,
        locationId: input.fromLocationId,
        catalogVariantId: input.catalogVariantId,
        lotId: input.lotId,
        serialNumber: input.serialNumber,
      })
      const sourceBalance = sourceResult.balance
      const sourceBalanceAction = sourceResult.created ? ('created' as const) : ('updated' as const)
      if (getAvailableQuantity(sourceBalance) < input.quantity - 0.000001) {
        throw new CrudHttpError(409, { error: 'insufficient_stock' })
      }
      const targetResult = await upsertBalanceBucket(trx, scope, {
        warehouseId: input.warehouseId,
        locationId: input.toLocationId,
        catalogVariantId: input.catalogVariantId,
        lotId: input.lotId,
        serialNumber: input.serialNumber,
      })
      const targetBalance = targetResult.balance
      const targetBalanceAction = targetResult.created ? ('created' as const) : ('updated' as const)
      setNumeric(
        sourceBalance as unknown as Record<string, unknown>,
        'quantityOnHand',
        toNumber(sourceBalance.quantityOnHand) - input.quantity,
      )
      setNumeric(
        targetBalance as unknown as Record<string, unknown>,
        'quantityOnHand',
        toNumber(targetBalance.quantityOnHand) + input.quantity,
      )
      const performedAt = input.performedAt ?? new Date()
      const receivedAt = await resolveReceivedAtForBalance(trx, sourceBalance, scope, performedAt)
      const movement = await createMovement(trx, scope, {
        warehouseId: input.warehouseId,
        locationFromId: input.fromLocationId,
        locationToId: input.toLocationId,
        catalogVariantId: input.catalogVariantId,
        lotId: input.lotId ?? null,
        serialNumber: input.serialNumber ?? null,
        quantity: input.quantity,
        type: 'transfer',
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        performedBy: input.performedBy,
        performedAt,
        receivedAt,
        reason: input.reason,
        metadata: input.metadata ?? null,
      })
      await trx.flush()
      return {
        movementId: movement.id,
        warehouseId: input.warehouseId,
        catalogVariantId: input.catalogVariantId,
        quantity: input.quantity,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        movementEntity: movement,
        balances: [
          { entity: sourceBalance, action: sourceBalanceAction },
          { entity: targetBalance, action: targetBalanceAction },
        ] as AffectedBalance[],
      }
    })
    await emitInventorySideEffects(ctx, {
      movements: [{ entity: result.movementEntity, action: 'created' }],
      balances: result.balances,
    })
    void emitWmsEvent('wms.inventory.moved', {
      id: result.movementId,
      movementId: result.movementId,
      warehouseId: result.warehouseId,
      catalogVariantId: result.catalogVariantId,
      quantity: toNumericString(result.quantity),
      tenantId: result.tenantId,
      organizationId: result.organizationId,
    }).catch(() => undefined)
    void emitLowStockEventIfNeeded(
      resolveEm(ctx),
      ctx,
      { tenantId: result.tenantId, organizationId: result.organizationId },
      result.catalogVariantId,
    ).catch(() => undefined)
    return { movementId: result.movementId }
  },
  buildLog: async ({ input, result, ctx }) =>
    buildMutationLog({
      actionKey: 'wms.audit.inventory.move',
      fallbackLabel: 'Move inventory',
      resourceKind: WMS_INVENTORY_MOVEMENT_RESOURCE,
      resourceId: result?.movementId ?? null,
      parentResourceId:
        input?.warehouseId && input?.catalogVariantId
          ? `${input.warehouseId}:${input.catalogVariantId}`
          : null,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      cacheAliases: [WMS_INVENTORY_BALANCE_RESOURCE],
    }),
}

const cycleCountInventoryCommand: CommandHandler<InventoryCycleCountInput, { adjustmentDelta: string; movementId?: string | null }> = {
  id: 'wms.inventory.cycleCount',
  // See "WMS Inventory Mutation Commands — Undo Policy" at top of file.
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = inventoryCycleCountSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const em = resolveEm(ctx)
    const result = await runInTransaction(em, async (trx) => {
      const scope = resolveScope(ctx, input)
      await requireWarehouse(trx, ctx, input.warehouseId, scope)
      const location = await requireLocation(trx, ctx, input.locationId, scope)
      const locationWarehouseId = typeof location.warehouse === 'string' ? location.warehouse : location.warehouse.id
      if (locationWarehouseId !== input.warehouseId) {
        throw new CrudHttpError(422, { error: 'invalid_location' })
      }
      const { balance, created: balanceWasNew } = await upsertBalanceBucket(trx, scope, {
        warehouseId: input.warehouseId,
        locationId: input.locationId,
        catalogVariantId: input.catalogVariantId,
        lotId: input.lotId,
        serialNumber: input.serialNumber,
      })
      const currentOnHand = toNumber(balance.quantityOnHand)
      const delta = input.countedQuantity - currentOnHand
      if (delta === 0) {
        return {
          adjustmentDelta: '0',
          movementId: null as string | null,
          warehouseId: input.warehouseId,
          catalogVariantId: input.catalogVariantId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          movementEntity: null as InventoryMovement | null,
          balanceEntity: balance,
          balanceAction: ('updated' as const),
        }
      }
      setNumeric(
        balance as unknown as Record<string, unknown>,
        'quantityOnHand',
        input.countedQuantity,
      )
      const performedAt = input.performedAt ?? new Date()
      const receivedAt = await resolveReceivedAtForBalance(trx, balance, scope, performedAt)
      const movement = await createMovement(trx, scope, {
        warehouseId: input.warehouseId,
        locationToId: input.locationId,
        catalogVariantId: input.catalogVariantId,
        lotId: input.lotId ?? null,
        serialNumber: input.serialNumber ?? null,
        quantity: delta,
        type: 'cycle_count',
        referenceType: 'manual',
        referenceId: input.referenceId,
        performedBy: input.performedBy,
        performedAt,
        receivedAt,
        reason: input.reason,
        metadata: input.metadata ?? null,
      })
      await trx.flush()
      return {
        adjustmentDelta: toNumericString(delta),
        movementId: movement.id as string | null,
        warehouseId: input.warehouseId,
        catalogVariantId: input.catalogVariantId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        movementEntity: movement as InventoryMovement | null,
        balanceEntity: balance,
        balanceAction: balanceWasNew ? ('created' as const) : ('updated' as const),
      }
    })
    await emitInventorySideEffects(ctx, {
      movements: result.movementEntity ? [{ entity: result.movementEntity, action: 'created' }] : [],
      balances: [{ entity: result.balanceEntity, action: result.balanceAction }],
    })
    if (result.movementId) {
      void emitWmsEvent('wms.inventory.reconciled', {
        id: result.movementId,
        movementId: result.movementId,
        warehouseId: result.warehouseId,
        catalogVariantId: result.catalogVariantId,
        adjustmentDelta: result.adjustmentDelta,
        tenantId: result.tenantId,
        organizationId: result.organizationId,
      }).catch(() => undefined)
      void emitLowStockEventIfNeeded(
        resolveEm(ctx),
        ctx,
        { tenantId: result.tenantId, organizationId: result.organizationId },
        result.catalogVariantId,
      ).catch(() => undefined)
    }
    return {
      adjustmentDelta: result.adjustmentDelta,
      movementId: result.movementId ?? null,
    }
  },
  buildLog: async ({ input, result, ctx }) =>
    buildMutationLog({
      actionKey: 'wms.audit.inventory.cycleCount',
      fallbackLabel: 'Run cycle count reconciliation',
      resourceKind: WMS_INVENTORY_MOVEMENT_RESOURCE,
      resourceId: result?.movementId ?? null,
      parentResourceId:
        input?.warehouseId && input?.catalogVariantId
          ? `${input.warehouseId}:${input.catalogVariantId}`
          : null,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      cacheAliases: [WMS_INVENTORY_BALANCE_RESOURCE],
    }),
}

registerCommand(reserveInventoryCommand)
registerCommand(releaseInventoryReservationCommand)
registerCommand(allocateInventoryReservationCommand)
registerCommand(adjustInventoryCommand)
registerCommand(receiveInventoryCommand)
registerCommand(moveInventoryCommand)
registerCommand(cycleCountInventoryCommand)
