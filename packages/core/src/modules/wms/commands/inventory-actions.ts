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
import { randomUUID } from 'crypto'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitWmsEvent } from '../events'
import { E } from '#generated/entities.ids.generated'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import {
  InventoryBalance,
  InventoryLot,
  InventoryMovement,
  InventoryReservation,
  ProductInventoryProfile,
  Warehouse,
  WarehouseLocation,
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
import { evaluateLowStock } from '../lib/inventoryPolicy'
import { enforceInventoryTrackingRequirements } from '../lib/inventoryTrackingValidation'
import { buildMovementIdempotencyKey } from '../lib/inventoryIdempotency'
// A1 extraction (`.ai/specs/analysis/ANALYSIS-2026-10-26-availability-release-5.md`):
// the reserve/release core logic now lives in `wmsReservationService` so a
// future in-process caller (`availability`, Phase 2) can run it inside its
// OWN transaction instead of composing these commands (which fork their own
// `EntityManager` and therefore their own transaction — the bug the
// extraction exists to fix). `allocate` still needs a few reservation/balance
// helpers the service now owns; it imports them back from there rather than
// duplicating them.
import {
  extractReservationMetadata,
  findReservationBucketBalance,
  requireReservation,
  WmsReservationService,
  type AllocationBucket,
} from '../lib/wmsReservationService'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  findExactBalanceForUpdate,
  getAvailableQuantity,
  inventoryBalanceCrudEvents,
  inventoryBalanceCrudIndexer,
  inventoryMovementCrudEvents,
  inventoryMovementCrudIndexer,
  inventoryReservationCrudEvents,
  inventoryReservationCrudIndexer,
  isUniqueConstraintError,
  loadProfileForVariant,
  requireId,
  requireWarehouse,
  resolveScope,
  runInTransaction,
  setNumeric,
  toNumber,
  toNumericString,
  type Scope,
  WMS_INVENTORY_BALANCE_RESOURCE,
  WMS_INVENTORY_MOVEMENT_RESOURCE,
  WMS_INVENTORY_RESERVATION_RESOURCE,
} from './shared'

function resolveReservationService(ctx: CommandRuntimeContext): WmsReservationService {
  return ctx.container.resolve('wmsReservationService') as WmsReservationService
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

function resolveEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

async function findExistingMovementByIdempotencyKey(
  em: EntityManager,
  scope: Scope,
  idempotencyKey: string,
): Promise<InventoryMovement | null> {
  return findOneWithDecryption(
    em,
    InventoryMovement,
    {
      organizationId: scope.organizationId,
      idempotencyKey,
      deletedAt: null,
    },
    undefined,
    scope,
  )
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

async function loadEffectiveProfileForVariant(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  catalogVariantId: string,
  scope: Scope,
) {
  const variantProfile = await loadProfileForVariant(em, ctx, catalogVariantId, scope)
  if (variantProfile) return variantProfile
  const rows = await em.getConnection().execute<Array<{ product_id: string | null }>>(
    `select product_id from catalog_product_variants
     where id = ? and organization_id = ? and tenant_id = ? and deleted_at is null
     limit 1`,
    [catalogVariantId, scope.organizationId, scope.tenantId],
  )
  const catalogProductId = rows[0]?.product_id
  if (!catalogProductId) return null
  const productProfile = await findOneWithDecryption(
    em,
    ProductInventoryProfile,
    {
      catalogProductId,
      catalogVariantId: null,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
  if (!productProfile) return null
  ensureTenantScope(ctx, productProfile.tenantId)
  ensureOrganizationScope(ctx, productProfile.organizationId)
  return productProfile
}

async function resolveReceiveLotId(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  scope: Scope,
  input: Pick<InventoryReceiveInput, 'catalogVariantId' | 'lotId' | 'lotNumber'>,
): Promise<string | undefined> {
  if (input.lotId?.trim()) return input.lotId.trim()
  const lotNumber = input.lotNumber?.trim()
  if (!lotNumber) return undefined

  const existing = await findOneWithDecryption(
    em,
    InventoryLot,
    {
      catalogVariantId: input.catalogVariantId,
      lotNumber,
      deletedAt: null,
    },
    undefined,
    scope,
  )
  if (existing) return existing.id

  const queryEngine = ctx.container.resolve<QueryEngine>('queryEngine')
  const variantResult = await queryEngine.query(E.catalog.catalog_product_variant, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    filters: { id: { $eq: input.catalogVariantId } },
    fields: ['id', 'sku'],
    page: { page: 1, pageSize: 1 },
  })
  const firstItem: unknown = variantResult.items?.[0]
  const sku =
    typeof firstItem === 'object' && firstItem !== null
      ? String((firstItem as Record<string, unknown>).sku ?? '').trim()
      : ''
  if (!sku) {
    throw new CrudHttpError(422, { error: 'variant_sku_missing' })
  }

  // Use a client-side UUID so the lot entity can be persisted into the
  // surrounding transaction without a premature flush (defaultRaw would
  // otherwise require a DB round-trip to obtain the generated id).
  const lot = em.create(InventoryLot, {
    id: randomUUID(),
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    catalogVariantId: input.catalogVariantId,
    sku,
    lotNumber,
    status: 'available',
  })
  em.persist(lot)
  return lot.id
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
  const profile = await loadEffectiveProfileForVariant(em, ctx, catalogVariantId, scope)
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

type BalanceBucketInput = {
  warehouseId: string
  locationId: string
  catalogVariantId: string
  lotId?: string
  serialNumber?: string
}

const BALANCE_BUCKET_CREATE_LOCK_SQL = 'select pg_advisory_xact_lock(hashtextextended(?, 0))'

function balanceBucketCreateLockKey(input: BalanceBucketInput): string {
  return [
    'wms:inventory-balance-bucket',
    input.warehouseId.toLowerCase(),
    input.locationId.toLowerCase(),
    input.catalogVariantId.toLowerCase(),
    input.lotId?.toLowerCase() ?? '',
    input.serialNumber ?? '',
  ].join(':')
}

async function upsertBalanceBucket(
  em: EntityManager,
  scope: Scope,
  input: BalanceBucketInput,
): Promise<{ balance: InventoryBalance; created: boolean }> {
  const existing = await findExactBalanceForUpdate(em, scope, input)
  if (existing) return { balance: existing, created: false }
  await em.execute(BALANCE_BUCKET_CREATE_LOCK_SQL, [balanceBucketCreateLockKey(input)])
  const createdConcurrently = await findExactBalanceForUpdate(em, scope, input)
  if (createdConcurrently) return { balance: createdConcurrently, created: false }
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
    reasonCode?: string | null
    metadata?: Record<string, unknown> | null
    idempotencyKey: string
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
    reasonCode: input.reasonCode ?? null,
    metadata: input.metadata ?? null,
    idempotencyKey: input.idempotencyKey,
  })
  em.persist(movement)
  return movement
}

type MovementMutationInput = {
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
  reasonCode?: string | null
  metadata?: Record<string, unknown> | null
}

async function persistMovementWithIdempotency(
  em: EntityManager,
  scope: Scope,
  input: MovementMutationInput,
): Promise<{ movement: InventoryMovement; idempotentReplay: boolean }> {
  const idempotencyKey = buildMovementIdempotencyKey({
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    type: input.type,
    warehouseId: input.warehouseId,
    locationFromId: input.locationFromId,
    locationToId: input.locationToId,
    catalogVariantId: input.catalogVariantId,
    lotId: input.lotId,
    serialNumber: input.serialNumber,
    quantity: input.quantity,
  })
  const existing = await findExistingMovementByIdempotencyKey(em, scope, idempotencyKey)
  if (existing) {
    return { movement: existing, idempotentReplay: true }
  }
  try {
    const movement = await createMovement(em, scope, {
      ...input,
      idempotencyKey,
    })
    return { movement, idempotentReplay: false }
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    const raced = await findExistingMovementByIdempotencyKey(em, scope, idempotencyKey)
    if (!raced) throw error
    return { movement: raced, idempotentReplay: true }
  }
}

const reserveInventoryCommand: CommandHandler<InventoryReservationCreateInput, ReservationCommandResult> = {
  id: 'wms.inventory.reserve',
  // See "WMS Inventory Mutation Commands — Undo Policy" at top of file.
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = inventoryReservationCreateSchema.parse(rawInput ?? {})
    // A16: `'checkout'` is a system-only source written only by
    // `wmsReservationService.reserveLinesForCheckout`/`convertInTransaction`
    // (`availability`'s reserve/commit, called in-process, never through this command).
    // Reject it here so the public route — and any other command-bus caller — can never
    // create one by hand; the expiry sweep would otherwise release a hand-made row.
    if (input.sourceType === 'checkout') {
      throw new CrudHttpError(400, { error: 'checkout_reservation_is_system_only' })
    }
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const em = resolveEm(ctx)
    // A1 extraction: the lock/allocation/idempotency logic itself now lives in
    // `wmsReservationService.reserveInTransaction` so a future in-process
    // caller can run it inside its OWN transaction. This wrapper still forks
    // its own `em` exactly as before, so behaviour is unchanged.
    const result = await resolveReservationService(ctx).reserveInTransaction(em, ctx, input)
    if (!result.idempotentReplay) {
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
    }
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
    // A1 extraction — see the matching comment on `wms.inventory.reserve`. `'checkout'` rows
    // are system-owned by `availability`'s own lifecycle (same A16 rule `wms.inventory.reserve`
    // enforces on create) — this command, and the public route behind it, must never release
    // one directly: that would desync the `availability_reservations` hold that still thinks
    // it owns this row.
    const result = await resolveReservationService(ctx).releaseInTransaction(em, ctx, input, {
      rejectSourceTypes: ['checkout'],
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
      if (reservation.status !== 'active') {
        throw new CrudHttpError(409, { error: 'invalid_reservation_state' })
      }
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
        // Guard above ensures the subtraction is non-negative within numeric(16,4) precision.
        setNumeric(
          balance as unknown as Record<string, unknown>,
          'quantityReserved',
          toNumber(balance.quantityReserved) - bucket.quantity,
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
      const performedAt = input.performedAt ?? new Date()
      const movementInput: MovementMutationInput = {
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
        reasonCode: input.reasonCode ?? null,
        metadata: input.metadata ?? null,
      }
      const idempotencyKey = buildMovementIdempotencyKey({
        referenceType: movementInput.referenceType,
        referenceId: movementInput.referenceId,
        type: movementInput.type,
        warehouseId: movementInput.warehouseId,
        locationFromId: movementInput.locationFromId,
        locationToId: movementInput.locationToId,
        catalogVariantId: movementInput.catalogVariantId,
        lotId: movementInput.lotId,
        serialNumber: movementInput.serialNumber,
        quantity: movementInput.quantity,
      })
      const existingMovement = await findExistingMovementByIdempotencyKey(trx, scope, idempotencyKey)
      if (existingMovement) {
        return {
          movementId: existingMovement.id,
          warehouseId: input.warehouseId,
          catalogVariantId: input.catalogVariantId,
          quantity: delta,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          movementEntity: existingMovement,
          balanceEntity: balance,
          balanceAction: ('updated' as const),
          idempotentReplay: true,
        }
      }
      if (delta < 0 && getAvailableQuantity(balance) < Math.abs(delta) - 0.000001) {
        throw new CrudHttpError(409, { error: 'insufficient_stock' })
      }
      // Persist movement before bumping balance so a unique-constraint replay cannot
      // leave a skewed on-hand and still report idempotentReplay: false.
      const { movement, idempotentReplay } = await persistMovementWithIdempotency(trx, scope, movementInput)
      if (idempotentReplay) {
        return {
          movementId: movement.id,
          warehouseId: input.warehouseId,
          catalogVariantId: input.catalogVariantId,
          quantity: delta,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          movementEntity: movement,
          balanceEntity: balance,
          balanceAction: ('updated' as const),
          idempotentReplay: true,
        }
      }
      setNumeric(
        balance as unknown as Record<string, unknown>,
        'quantityOnHand',
        toNumber(balance.quantityOnHand) + delta,
      )
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
        idempotentReplay: false,
      }
    })
    if (!result.idempotentReplay) {
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
    }
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

/**
 * Core receipt mutation for an already-open transaction.
 * Used by `wms.inventory.receive` and by ASN QC-pass receive so stock + line
 * qty + putaway can share one transactional boundary (nested commandBus
 * receives cannot participate in the ASN row lock).
 */
export type InventoryReceiveMutationResult = {
  movementId: string
  warehouseId: string
  locationId: string
  catalogVariantId: string
  quantity: number
  lotId: string | null
  tenantId: string
  organizationId: string
  movementEntity: InventoryMovement
  balanceEntity: InventoryBalance
  balanceAction: 'created' | 'updated'
  idempotentReplay: boolean
}

export async function applyInventoryReceiveInTransaction(
  trx: EntityManager,
  ctx: CommandRuntimeContext,
  input: InventoryReceiveInput,
): Promise<InventoryReceiveMutationResult> {
  const scope = resolveScope(ctx, input)
  await requireWarehouse(trx, ctx, input.warehouseId, scope)
  const location = await requireLocation(trx, ctx, input.locationId, scope)
  const locationWarehouseId = typeof location.warehouse === 'string' ? location.warehouse : location.warehouse.id
  if (locationWarehouseId !== input.warehouseId) {
    throw new CrudHttpError(422, { error: 'invalid_location' })
  }
  const profile = await loadProfileForVariant(trx, ctx, input.catalogVariantId, scope)
  const resolvedLotId = await resolveReceiveLotId(trx, ctx, scope, input)
  enforceInventoryTrackingRequirements(profile, {
    lotId: resolvedLotId ?? null,
    serialNumber: input.serialNumber ?? null,
  })
  const { balance, created: balanceWasNew } = await upsertBalanceBucket(trx, scope, {
    warehouseId: input.warehouseId,
    locationId: input.locationId,
    catalogVariantId: input.catalogVariantId,
    lotId: resolvedLotId,
    serialNumber: input.serialNumber,
  })
  const receivedAt = input.receivedAt ?? input.performedAt ?? new Date()
  const performedAt = input.performedAt ?? receivedAt
  const movementInput: MovementMutationInput = {
    warehouseId: input.warehouseId,
    locationToId: input.locationId,
    catalogVariantId: input.catalogVariantId,
    lotId: resolvedLotId ?? null,
    serialNumber: input.serialNumber ?? null,
    quantity: input.quantity,
    type: 'receipt',
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    performedBy: input.performedBy,
    performedAt,
    receivedAt,
    reason: input.reason,
    reasonCode: input.reasonCode ?? null,
    metadata: input.metadata ?? null,
  }
  const idempotencyKey = buildMovementIdempotencyKey({
    referenceType: movementInput.referenceType,
    referenceId: movementInput.referenceId,
    type: movementInput.type,
    warehouseId: movementInput.warehouseId,
    locationFromId: movementInput.locationFromId,
    locationToId: movementInput.locationToId,
    catalogVariantId: movementInput.catalogVariantId,
    lotId: movementInput.lotId,
    serialNumber: movementInput.serialNumber,
    quantity: movementInput.quantity,
  })
  const existingMovement = await findExistingMovementByIdempotencyKey(trx, scope, idempotencyKey)
  if (existingMovement) {
    const existingLotRaw = existingMovement.lot ?? null
    const existingLotId =
      typeof existingLotRaw === 'string' ? existingLotRaw : existingLotRaw?.id ?? resolvedLotId ?? null
    return {
      movementId: existingMovement.id,
      warehouseId: input.warehouseId,
      locationId: input.locationId,
      catalogVariantId: input.catalogVariantId,
      quantity: input.quantity,
      lotId: existingLotId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      movementEntity: existingMovement,
      balanceEntity: balance,
      balanceAction: 'updated' as const,
      idempotentReplay: true,
    }
  }
  // Persist movement before bumping balance so a unique-constraint replay cannot
  // leave an inflated on-hand and still report idempotentReplay: false.
  const { movement, idempotentReplay } = await persistMovementWithIdempotency(trx, scope, movementInput)
  if (idempotentReplay) {
    return {
      movementId: movement.id,
      warehouseId: input.warehouseId,
      locationId: input.locationId,
      catalogVariantId: input.catalogVariantId,
      quantity: input.quantity,
      lotId: resolvedLotId ?? null,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      movementEntity: movement,
      balanceEntity: balance,
      balanceAction: 'updated' as const,
      idempotentReplay: true,
    }
  }
  setNumeric(
    balance as unknown as Record<string, unknown>,
    'quantityOnHand',
    toNumber(balance.quantityOnHand) + input.quantity,
  )
  await trx.flush()
  return {
    movementId: movement.id,
    warehouseId: input.warehouseId,
    locationId: input.locationId,
    catalogVariantId: input.catalogVariantId,
    quantity: input.quantity,
    lotId: resolvedLotId ?? null,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    movementEntity: movement,
    balanceEntity: balance,
    balanceAction: balanceWasNew ? ('created' as const) : ('updated' as const),
    idempotentReplay: false,
  }
}

export async function emitInventoryReceiveSideEffects(
  ctx: CommandRuntimeContext,
  result: InventoryReceiveMutationResult,
): Promise<void> {
  if (result.idempotentReplay) return
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
    const result = await runInTransaction(em, async (trx) =>
      applyInventoryReceiveInTransaction(trx, ctx, input),
    )
    await emitInventoryReceiveSideEffects(ctx, result)
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

/**
 * Core move mutation for an already-open transaction.
 * Used by `wms.inventory.move` and by putaway complete so stock move + task
 * status share one transactional boundary (nested commandBus moves cannot).
 */
export type InventoryMoveMutationResult = {
  movementId: string
  warehouseId: string
  catalogVariantId: string
  quantity: number
  tenantId: string
  organizationId: string
  movementEntity: InventoryMovement
  balances: AffectedBalance[]
  idempotentReplay: boolean
}

export async function applyInventoryMoveInTransaction(
  trx: EntityManager,
  ctx: CommandRuntimeContext,
  input: InventoryMoveInput,
): Promise<InventoryMoveMutationResult> {
  const scope = resolveScope(ctx, input)
  await requireWarehouse(trx, ctx, input.warehouseId, scope)
  const sourceLocation = await requireLocation(trx, ctx, input.fromLocationId, scope)
  const targetLocation = await requireLocation(trx, ctx, input.toLocationId, scope)
  const sourceWarehouseId =
    typeof sourceLocation.warehouse === 'string' ? sourceLocation.warehouse : sourceLocation.warehouse.id
  const targetWarehouseId =
    typeof targetLocation.warehouse === 'string' ? targetLocation.warehouse : targetLocation.warehouse.id
  if (sourceWarehouseId !== input.warehouseId || targetWarehouseId !== input.warehouseId) {
    throw new CrudHttpError(422, { error: 'invalid_location' })
  }
  const sourceBalance = await findExactBalanceForUpdate(trx, scope, {
    warehouseId: input.warehouseId,
    locationId: input.fromLocationId,
    catalogVariantId: input.catalogVariantId,
    lotId: input.lotId,
    serialNumber: input.serialNumber,
  })
  if (!sourceBalance) {
    throw new CrudHttpError(409, { error: 'insufficient_stock' })
  }
  const sourceBalanceAction = 'updated' as const
  const targetResult = await upsertBalanceBucket(trx, scope, {
    warehouseId: input.warehouseId,
    locationId: input.toLocationId,
    catalogVariantId: input.catalogVariantId,
    lotId: input.lotId,
    serialNumber: input.serialNumber,
  })
  const targetBalance = targetResult.balance
  const targetBalanceAction = targetResult.created ? ('created' as const) : ('updated' as const)
  const performedAt = input.performedAt ?? new Date()
  const receivedAt = await resolveReceivedAtForBalance(trx, sourceBalance, scope, performedAt)
  const movementInput: MovementMutationInput = {
    warehouseId: input.warehouseId,
    locationFromId: input.fromLocationId,
    locationToId: input.toLocationId,
    catalogVariantId: input.catalogVariantId,
    lotId: input.lotId ?? null,
    serialNumber: input.serialNumber ?? null,
    quantity: input.quantity,
    type: input.type ?? 'transfer',
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    performedBy: input.performedBy,
    performedAt,
    receivedAt,
    reason: input.reason,
    reasonCode: input.reasonCode ?? null,
    metadata: input.metadata ?? null,
  }
  const idempotencyKey = buildMovementIdempotencyKey({
    referenceType: movementInput.referenceType,
    referenceId: movementInput.referenceId,
    type: movementInput.type,
    warehouseId: movementInput.warehouseId,
    locationFromId: movementInput.locationFromId,
    locationToId: movementInput.locationToId,
    catalogVariantId: movementInput.catalogVariantId,
    lotId: movementInput.lotId,
    serialNumber: movementInput.serialNumber,
    quantity: movementInput.quantity,
  })
  const existingMovement = await findExistingMovementByIdempotencyKey(trx, scope, idempotencyKey)
  if (existingMovement) {
    return {
      movementId: existingMovement.id,
      warehouseId: input.warehouseId,
      catalogVariantId: input.catalogVariantId,
      quantity: input.quantity,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      movementEntity: existingMovement,
      balances: [
        { entity: sourceBalance, action: sourceBalanceAction },
        { entity: targetBalance, action: targetBalanceAction },
      ],
      idempotentReplay: true,
    }
  }
  // Persist movement before mutating balances so unique-constraint replay cannot
  // leave skewed source/target on-hand and still report a fresh write.
  const { movement, idempotentReplay } = await persistMovementWithIdempotency(trx, scope, movementInput)
  if (idempotentReplay) {
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
      ],
      idempotentReplay: true,
    }
  }
  if (getAvailableQuantity(sourceBalance) < input.quantity - 0.000001) {
    throw new CrudHttpError(409, { error: 'insufficient_stock' })
  }
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
    ],
    idempotentReplay: false,
  }
}

export async function emitInventoryMoveSideEffects(
  ctx: CommandRuntimeContext,
  result: InventoryMoveMutationResult,
): Promise<void> {
  if (result.idempotentReplay) return
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
}

/** Find a putaway-complete movement by stable task reference (qty-independent). */
export async function findPutawayCompleteMovementByReference(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  referenceId: string,
): Promise<InventoryMovement | null> {
  return findOneWithDecryption(
    em,
    InventoryMovement,
    {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      referenceType: 'manual',
      referenceId,
      type: 'putaway',
      deletedAt: null,
    },
    undefined,
    scope,
  )
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
    const result = await runInTransaction(em, async (trx) =>
      applyInventoryMoveInTransaction(trx, ctx, input),
    )
    await emitInventoryMoveSideEffects(ctx, result)
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
      if (!input.autoAdjust) {
        throw new CrudHttpError(422, { error: 'auto_adjust_required' })
      }
      const performedAt = input.performedAt ?? new Date()
      const receivedAt = await resolveReceivedAtForBalance(trx, balance, scope, performedAt)
      const movementInput: MovementMutationInput = {
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
      }
      const idempotencyKey = buildMovementIdempotencyKey({
        referenceType: movementInput.referenceType,
        referenceId: movementInput.referenceId,
        type: movementInput.type,
        warehouseId: movementInput.warehouseId,
        locationFromId: movementInput.locationFromId,
        locationToId: movementInput.locationToId,
        catalogVariantId: movementInput.catalogVariantId,
        lotId: movementInput.lotId,
        serialNumber: movementInput.serialNumber,
        quantity: movementInput.quantity,
      })
      const existingMovement = await findExistingMovementByIdempotencyKey(trx, scope, idempotencyKey)
      if (existingMovement) {
        return {
          adjustmentDelta: toNumericString(delta),
          movementId: existingMovement.id,
          warehouseId: input.warehouseId,
          catalogVariantId: input.catalogVariantId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          movementEntity: existingMovement,
          balanceEntity: balance,
          balanceAction: ('updated' as const),
          idempotentReplay: true,
        }
      }
      if (delta < 0 && getAvailableQuantity(balance) < Math.abs(delta) - 0.000001) {
        throw new CrudHttpError(409, {
          error: 'insufficient_stock',
          countedQuantity: toNumericString(input.countedQuantity),
          committedQuantity: toNumericString(
            toNumber(balance.quantityReserved) + toNumber(balance.quantityAllocated),
          ),
        })
      }
      // Persist movement before setting on-hand so a unique-constraint replay cannot
      // skew the balance and still report idempotentReplay: false.
      const { movement, idempotentReplay } = await persistMovementWithIdempotency(trx, scope, movementInput)
      if (idempotentReplay) {
        return {
          adjustmentDelta: toNumericString(delta),
          movementId: movement.id,
          warehouseId: input.warehouseId,
          catalogVariantId: input.catalogVariantId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          movementEntity: movement,
          balanceEntity: balance,
          balanceAction: ('updated' as const),
          idempotentReplay: true,
        }
      }
      setNumeric(
        balance as unknown as Record<string, unknown>,
        'quantityOnHand',
        input.countedQuantity,
      )
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
        idempotentReplay: false,
      }
    })
    if (!result.idempotentReplay) {
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
