// =============================================================================
// wmsReservationService — A1 extraction
// =============================================================================
//
// `.ai/specs/analysis/ANALYSIS-2026-10-26-availability-release-5.md` finding A1:
// `wms.inventory.reserve`/`.release` each fork their own `EntityManager`
// (`commands/inventory-actions.ts` `resolveEm`) and open their own transaction
// on it. In MikroORM v7 a fork carries no transaction context, so a caller
// that wants to "compose" those commands inside its own transaction (the
// future `availability.reserve`/`.release`/`.commit`, Phase 2 of the same
// analysis) cannot — the wms side opens a second transaction on another
// connection and the two wait on each other's locks.
//
// The fix is additive and behaviour-preserving: this service is the SAME
// reserve/release logic the commands ran before, parameterized so the caller
// supplies the `EntityManager` (`trx`) instead of the service forking its
// own. `commands/inventory-actions.ts`'s `wms.inventory.reserve`/`.release`
// are now thin wrappers that fork `em` exactly as they did before this
// extraction and hand it to this service — zero behaviour change for every
// existing caller. A future in-process caller that is already inside a
// transaction instead passes ITS OWN `trx` directly, so
// `reserveInTransaction`/`releaseInTransaction` run inside that ambient
// transaction (same `em.transactional()` join-or-open contract
// `runInTransaction`, in `../commands/shared`, already relies on — see that
// helper's doc comment).
//
// `convertInTransaction` is a stub (see its own doc comment below): no
// existing wms command converts a reservation's `sourceType`/`sourceId` in
// place today, so there is nothing to extract yet.
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { LockMode } from '@mikro-orm/core'
import { emitWmsEvent } from '../events'
import {
  InventoryBalance,
  InventoryLot,
  InventoryMovement,
  InventoryReservation,
  ProductInventoryProfile,
  Warehouse,
  type InventoryStrategy,
} from '../data/entities'
import type {
  InventoryReservationCreateInput,
  InventoryReservationReleaseInput,
} from '../data/validators'
import {
  isBalanceLocationReservable,
  isLotEligible,
  resolveReservationStrategyFromProfile,
  sortBucketsForStrategy,
  type InventoryStrategyBucket,
} from './inventoryPolicy'
import { buildReservationIdempotencyKey } from './inventoryIdempotency'
import { computeSellableQuantities } from './availabilityCalculation'
import {
  resolvePrimaryWarehouseId,
  sortWarehouseAvailabilityForReservation,
  type WarehouseAvailability,
} from './primaryWarehousePolicy'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  findExactBalanceForUpdate,
  getAvailableQuantity,
  inventoryBalanceCrudEvents,
  inventoryBalanceCrudIndexer,
  inventoryReservationCrudEvents,
  inventoryReservationCrudIndexer,
  isUniqueConstraintError,
  loadProfileForVariant,
  requireWarehouse,
  resolveScope,
  runInTransaction,
  setNumeric,
  toNumber,
  toNumericString,
  type Scope,
} from '../commands/shared'

export type AllocationBucket = {
  balanceId: string
  locationId: string
  lotId: string | null
  serialNumber: string | null
  quantity: number
}

export type ReservationMetadata = {
  allocatedBuckets?: AllocationBucket[]
  allocationState?: 'reserved' | 'allocated'
  strategy?: InventoryStrategy
  releasedReason?: string
  releasedAt?: string
  allocatedAt?: string
  [key: string]: unknown
}

export type ReserveInTransactionResult = {
  reservationId: string
  allocatedBuckets: Array<{ locationId: string; lotId: string | null; quantity: string }>
  tenantId: string
  organizationId: string
  warehouseId: string
  catalogVariantId: string
  quantity: number
  reservationEntity: InventoryReservation
  touchedBalances: InventoryBalance[]
  idempotentReplay: boolean
}

export type ReleaseInTransactionResult = {
  reservationId: string
  warehouseId: string
  catalogVariantId: string
  quantity: string
  tenantId: string
  organizationId: string
  reservationEntity: InventoryReservation
  touchedBalances: InventoryBalance[]
}

export type ReleaseInTransactionOptions = {
  /**
   * Source types the caller is not allowed to release directly (A16-style guard). The
   * public `wms.inventory.release` command passes `['checkout']` here: a `'checkout'` row
   * is system-owned by `availability`'s own reserve/release/commit lifecycle, and releasing
   * it out of band leaves the `availability_reservations` hold dangling (reconciliation
   * would then have to repair it). In-process callers that own that lifecycle themselves
   * (the expiry sweep, reconciliation, `availability.release`) never pass this option.
   */
  rejectSourceTypes?: InventoryReservation['sourceType'][]
}

export type ConvertInTransactionInput = {
  reservationId: string
  tenantId: string
  organizationId: string
  /** Only `'order'` is a real caller today — `availability.commit` (A1/A5/§4.4). */
  sourceType: 'order'
  sourceId: string
}

export type ConvertInTransactionResult = {
  reservationId: string
  reservationEntity: InventoryReservation
}

// =============================================================================
// Release 5 Phase 3 (A1/A6/A7/A19) — the gate's own allocator and side-effect
// replicator. `reserveLinesForCheckout`/`emitSideEffects` have no command of
// their own (§4.1b): only `availability`'s `reserve`/`release`/`commit` call
// them, in-process, inside their OWN transaction.
// =============================================================================

export type WmsSideEffects = {
  reservations?: Array<{ entity: InventoryReservation; action: 'created' | 'updated' }>
  balances?: Array<{ entity: InventoryBalance; action: 'updated' }>
}

export type ReserveLinesForCheckoutLineInput = {
  key: string
  catalogProductId: string
  catalogVariantId: string
  quantity: number
  /** 'up_to_sellable' = backorder line (hold min(requested, sellable)); 'exact' = everything else. */
  mode: 'exact' | 'up_to_sellable'
}

export type ReserveLinesForCheckoutLineResult = {
  key: string
  sellable: number
  heldQuantity: number
  reservationIds: string[]
}

export type ReserveLinesForCheckoutShortfallLine = {
  key: string
  requested: number
  sellable: number
}

export type ReserveLinesForCheckoutInput = {
  scope: Scope
  lines: ReserveLinesForCheckoutLineInput[]
  sourceType: 'checkout' | 'order'
  sourceId: string
  expiresAt: Date | null
  warehouseIds?: string[] | null
}

export type ReserveLinesForCheckoutResult =
  | { ok: true; lines: ReserveLinesForCheckoutLineResult[]; sideEffects: WmsSideEffects }
  | { ok: false; lines: ReserveLinesForCheckoutShortfallLine[] }

// §4.1b step 2: locks every balance row of every variant the call touches with
// `LockMode.PESSIMISTIC_WRITE`, ordered by id, in ONE statement — through the ORM
// (`findWithDecryption`, the SAME call shape `listCandidateBalances` above already uses
// successfully under concurrency), never a raw `em.getConnection().execute()`. MikroORM's
// raw SQL escape hatch does NOT bind to the ambient transaction unless the driver's
// transaction context is threaded through explicitly (verified against this installed
// MikroORM version's `AbstractSqlConnection.execute`: an omitted `ctx` always falls back to
// the pool's plain client) — a lock taken that way, or an aggregate read issued that way,
// would silently run outside this method's own transaction and see a stale, pre-lock
// snapshot under real concurrency. `em.find`/`findWithDecryption` do not have this problem:
// every ORM-level query is already transaction-bound by `wms`'s own proven lock path
// (`reserveInTransaction`'s `listCandidateBalances`). Product-pool expansion (locking every
// OTHER active variant of a pooled product) is deferred — see this Step's "Decisions taken
// without the owner" note; per-variant correctness (the parallel last-unit guarantee) holds
// either way.
async function lockCandidateBalances(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  scope: Scope,
  variantIds: string[],
  warehouseIds?: string[] | null,
): Promise<InventoryBalance[]> {
  if (variantIds.length === 0) return []
  const where: Record<string, unknown> = { catalogVariantId: { $in: variantIds }, deletedAt: null }
  if (warehouseIds && warehouseIds.length > 0) where.warehouse = { $in: warehouseIds }
  const balances = await findWithDecryption(
    em,
    InventoryBalance,
    where,
    { populate: ['lot', 'warehouse', 'location'], lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'asc' } },
    scope,
  )
  const reservable: InventoryBalance[] = []
  for (const balance of balances) {
    ensureTenantScope(ctx, balance.tenantId)
    ensureOrganizationScope(ctx, balance.organizationId)
    // MUST match `listCandidateBalances`'s own filter (staging/dock are inbound holding
    // locations, never pick/reserve candidates). Locking still covers every row the WHERE
    // matched above — only the returned/counted set narrows here — so the gate's sellable
    // aggregate and its per-warehouse bucket view never count quantity that the later
    // `reserveInTransaction` call (which DOES apply this filter) would refuse to allocate.
    // Without this, a shortfall could surface as a raw `insufficient_stock` 409 instead of
    // the gate's own `ReserveShortfallSignal` / `availability.shortfall.detected` path.
    if (!isBalanceLocationReservable(balance)) continue
    reservable.push(balance)
  }
  return reservable
}

type SafetyStockProfileRow = {
  catalog_product_id: string
  catalog_variant_id: string | null
  safety_stock: string | number | null
  reorder_point: string | number | null
}

// STRICT variant-level safety-stock rows only (no product-pool row), matching A2's
// `computeSellableQuantities` contract — the gate never falls back to the pool row for a
// single variant's own buffer. Not concurrency-sensitive (profiles are configuration, not
// raced by concurrent reserves), so a plain `em.find` — no lock — is enough; it still goes
// through the ORM so it reads this transaction's own view consistently.
async function loadVariantSafetyStockRows(
  em: EntityManager,
  scope: Scope,
  variantIds: string[],
): Promise<SafetyStockProfileRow[]> {
  if (variantIds.length === 0) return []
  const rows = await findWithDecryption(
    em,
    ProductInventoryProfile,
    { catalogVariantId: { $in: variantIds }, deletedAt: null },
    undefined,
    scope,
  )
  return rows.map((row) => ({
    catalog_product_id: row.catalogProductId,
    catalog_variant_id: row.catalogVariantId ?? null,
    safety_stock: row.safetyStock,
    reorder_point: row.reorderPoint,
  }))
}

// Sums the ALREADY-LOCKED balance rows (§4.2: eligible lots only), client-side — the SQL
// half of the shared sellable builder (`availabilityCalculation.ts#loadBalanceAggregates`)
// cannot be reused here for the reason `lockCandidateBalances` explains above; this is the
// same arithmetic, fed from the locked entities instead of a second (non-transactional) query.
function aggregateAvailableByVariant(balances: InventoryBalance[], now: Date): Map<string, number> {
  const result = new Map<string, number>()
  for (const balance of balances) {
    if (!balanceHasEligibleLot(balance, now)) continue
    result.set(balance.catalogVariantId, (result.get(balance.catalogVariantId) ?? 0) + getAvailableQuantity(balance))
  }
  return result
}

// Per-(variant, warehouse) raw available quantity (eligible lots only), for
// `sortWarehouseAvailabilityForReservation` ordering ONLY — never the sellable budget,
// which the gate enforces once at the variant-aggregate level above.
function warehouseAvailabilityForVariant(
  balances: InventoryBalance[],
  now: Date,
  catalogVariantId: string,
): WarehouseAvailability[] {
  const byWarehouse = new Map<string, number>()
  for (const balance of balances) {
    if (balance.catalogVariantId !== catalogVariantId) continue
    if (!balanceHasEligibleLot(balance, now)) continue
    const warehouseId = typeof balance.warehouse === 'string' ? balance.warehouse : balance.warehouse.id
    byWarehouse.set(warehouseId, (byWarehouse.get(warehouseId) ?? 0) + getAvailableQuantity(balance))
  }
  return Array.from(byWarehouse.entries())
    .map(([warehouseId, available]) => ({ warehouseId, available }))
    .filter((bucket) => bucket.available > 0)
}

export function extractReservationMetadata(reservation: InventoryReservation): ReservationMetadata {
  if (!reservation.metadata || typeof reservation.metadata !== 'object' || Array.isArray(reservation.metadata)) {
    return {}
  }
  return { ...(reservation.metadata as Record<string, unknown>) }
}

export async function requireReservation(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  reservationId: string,
  scope?: Scope,
  lock = false,
): Promise<InventoryReservation> {
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

export async function findReservationBucketBalance(
  em: EntityManager,
  scope: Scope,
  reservation: InventoryReservation,
  bucket: AllocationBucket,
): Promise<InventoryBalance | null> {
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

async function emitBalanceDriftIfNeeded(
  balance: InventoryBalance,
  field: 'quantityReserved' | 'quantityAllocated',
  attemptedValue: number,
  scope: Scope,
  reservationId: string,
) {
  if (attemptedValue >= -0.000001) return
  await emitWmsEvent('wms.inventory.balance_drift', {
    id: balance.id,
    balanceId: balance.id,
    reservationId,
    field,
    attemptedValue: toNumericString(attemptedValue),
    clampedValue: '0',
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  }).catch(() => undefined)
}

export function enforceNonNegativeBalance(
  balance: InventoryBalance,
  field: 'quantityReserved' | 'quantityAllocated',
  nextValue: number,
  reservationId: string,
  scope: Scope,
): void {
  if (nextValue < -0.000001) {
    void emitBalanceDriftIfNeeded(balance, field, nextValue, scope, reservationId)
    throw new CrudHttpError(409, { error: 'balance_integrity_violation' })
  }
  setNumeric(balance as unknown as Record<string, unknown>, field, nextValue)
}

function resolveLotFromBalance(balance: InventoryBalance): InventoryLot | null {
  const lotRaw = balance.lot ?? null
  if (!lotRaw || typeof lotRaw === 'string') return null
  return lotRaw
}

function balanceHasEligibleLot(balance: InventoryBalance, now: Date): boolean {
  const lot = resolveLotFromBalance(balance)
  return isLotEligible(lot, now)
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

async function findExistingActiveReservationByIdempotencyKey(
  em: EntityManager,
  scope: Scope,
  idempotencyKey: string,
): Promise<InventoryReservation | null> {
  return findOneWithDecryption(
    em,
    InventoryReservation,
    {
      organizationId: scope.organizationId,
      idempotencyKey,
      status: 'active',
      deletedAt: null,
    },
    undefined,
    scope,
  )
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
  const reservable: InventoryBalance[] = []
  for (const balance of balances) {
    ensureTenantScope(ctx, balance.tenantId)
    ensureOrganizationScope(ctx, balance.organizationId)
    // Staging/dock are inbound holding locations — not pick/reserve candidates
    // (Phase 2: ASN receive must not reserve staging stock and block putaway).
    if (!isBalanceLocationReservable(balance)) continue
    reservable.push(balance)
  }
  return reservable
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

export class WmsReservationService {
  async reserveInTransaction(
    trx: EntityManager,
    ctx: CommandRuntimeContext,
    input: InventoryReservationCreateInput,
  ): Promise<ReserveInTransactionResult> {
    return runInTransaction(trx, async (innerTrx) => {
      const scope = resolveScope(ctx, input)
      await requireWarehouse(innerTrx, ctx, input.warehouseId, scope)
      const reservationIdempotencyKey = buildReservationIdempotencyKey({
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        catalogVariantId: input.catalogVariantId,
        warehouseId: input.warehouseId,
        quantity: input.quantity,
      })
      const existingReservation = await findExistingActiveReservationByIdempotencyKey(
        innerTrx,
        scope,
        reservationIdempotencyKey,
      )
      if (existingReservation) {
        const metadata = extractReservationMetadata(existingReservation)
        const buckets = Array.isArray(metadata.allocatedBuckets)
          ? (metadata.allocatedBuckets as AllocationBucket[])
          : []
        return {
          reservationId: existingReservation.id,
          allocatedBuckets: serializeAllocationBuckets(buckets),
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          warehouseId: input.warehouseId,
          catalogVariantId: input.catalogVariantId,
          quantity: input.quantity,
          reservationEntity: existingReservation,
          touchedBalances: [] as InventoryBalance[],
          idempotentReplay: true,
        }
      }
      const strategy = await resolveReservationStrategy(innerTrx, ctx, input, scope)
      const balances = await listCandidateBalances(innerTrx, ctx, input, scope)
      const receiptMap = await loadReceivedAtByBucket(innerTrx, balances, scope)
      const now = new Date()
      const ordered = sortBalancesForStrategy(
        balances.filter(
          (balance) => balanceHasEligibleLot(balance, now) && getAvailableQuantity(balance) > 0,
        ),
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
        const persistedBalance = await findExactBalanceForUpdate(innerTrx, scope, {
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
      let reservation: InventoryReservation
      try {
        reservation = innerTrx.create(InventoryReservation, {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouse: innerTrx.getReference(Warehouse, input.warehouseId),
          catalogVariantId: input.catalogVariantId,
          lot: buckets.length === 1 && buckets[0].lotId ? innerTrx.getReference(InventoryLot, buckets[0].lotId) : null,
          serialNumber: buckets.length === 1 ? buckets[0].serialNumber : null,
          quantity: toNumericString(input.quantity),
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          expiresAt: input.expiresAt ?? null,
          status: 'active',
          idempotencyKey: reservationIdempotencyKey,
          metadata: {
            ...(input.metadata ?? {}),
            allocatedBuckets: buckets,
            allocationState: 'reserved',
            strategy,
          },
        })
        innerTrx.persist(reservation)
        await innerTrx.flush()
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error
        const raced = await findExistingActiveReservationByIdempotencyKey(
          innerTrx,
          scope,
          reservationIdempotencyKey,
        )
        if (!raced) throw error
        const metadata = extractReservationMetadata(raced)
        const racedBuckets = Array.isArray(metadata.allocatedBuckets)
          ? (metadata.allocatedBuckets as AllocationBucket[])
          : []
        return {
          reservationId: raced.id,
          allocatedBuckets: serializeAllocationBuckets(racedBuckets),
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          warehouseId: input.warehouseId,
          catalogVariantId: input.catalogVariantId,
          quantity: input.quantity,
          reservationEntity: raced,
          touchedBalances: [] as InventoryBalance[],
          idempotentReplay: true,
        }
      }
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
        idempotentReplay: false,
      }
    })
  }

  async releaseInTransaction(
    trx: EntityManager,
    ctx: CommandRuntimeContext,
    input: InventoryReservationReleaseInput,
    options?: ReleaseInTransactionOptions,
  ): Promise<ReleaseInTransactionResult> {
    return runInTransaction(trx, async (innerTrx) => {
      const scope = resolveScope(ctx, input)
      const reservation = await requireReservation(innerTrx, ctx, input.reservationId, scope, true)
      if (options?.rejectSourceTypes?.includes(reservation.sourceType)) {
        throw new CrudHttpError(400, { error: 'checkout_reservation_is_system_only' })
      }
      // Idempotency guard: the expiry sweep, reconciliation, `availability.release`, and this
      // same command can all reach the same row for the same reservation (TTL expiry racing a
      // manual release, reconciliation racing a user action, etc). Once this row is no longer
      // `active`, its balances were already decremented by whichever caller won the race — a
      // second decrement here would double-release and oversell. Checked inside the SAME
      // PESSIMISTIC_WRITE lock `requireReservation` just took, so no other writer can flip the
      // status between this check and the lock being held. No-op, matching the idempotent
      // release contract every caller already relies on (a second release changes nothing).
      if (reservation.status !== 'active') {
        return {
          reservationId: reservation.id,
          warehouseId: typeof reservation.warehouse === 'string' ? reservation.warehouse : reservation.warehouse.id,
          catalogVariantId: reservation.catalogVariantId,
          quantity: reservation.quantity,
          tenantId: reservation.tenantId,
          organizationId: reservation.organizationId,
          reservationEntity: reservation,
          touchedBalances: [],
        }
      }
      const metadata = extractReservationMetadata(reservation)
      const buckets = Array.isArray(metadata.allocatedBuckets) ? (metadata.allocatedBuckets as AllocationBucket[]) : []
      const allocationState = metadata.allocationState ?? 'reserved'
      const touchedBalances: InventoryBalance[] = []
      for (const bucket of buckets) {
        const balance = await findReservationBucketBalance(
          innerTrx,
          scope,
          reservation,
          bucket,
        )
        if (!balance) continue
        if (allocationState === 'allocated') {
          enforceNonNegativeBalance(
            balance,
            'quantityAllocated',
            toNumber(balance.quantityAllocated) - bucket.quantity,
            reservation.id,
            scope,
          )
        } else {
          enforceNonNegativeBalance(
            balance,
            'quantityReserved',
            toNumber(balance.quantityReserved) - bucket.quantity,
            reservation.id,
            scope,
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
      await innerTrx.flush()
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
  }

  /**
   * Converts an active reservation's `sourceType`/`sourceId` in place — a checkout hold
   * becoming an `order` hold at `availability.commit` (§4.1/§4.4, A1/A5/A16) — without
   * releasing and re-reserving, so no window exists in which the stock is unheld. Rebuilds
   * the row's `wms` idempotency key, since that key is derived from
   * `sourceType|sourceId|variant|warehouse|quantity` (`buildReservationIdempotencyKey`) and
   * goes stale the moment the first two change; `expires_at` is cleared, because nothing
   * expires an `order` row.
   *
   * §4.4's "confirmed-first" collision case (the `sales.order.confirmed` automation having
   * already created an `order` row with the SAME rebuilt key before `commit` runs) is
   * deliberately NOT handled here — checkout always commits before any status that emits
   * `sales.order.confirmed` (D-R5-8), so it never takes that path; this method is kept for
   * `availability.commit`'s own caller, which is the only caller today.
   */
  async convertInTransaction(
    trx: EntityManager,
    ctx: CommandRuntimeContext,
    input: ConvertInTransactionInput,
  ): Promise<ConvertInTransactionResult> {
    return runInTransaction(trx, async (innerTrx) => {
      const scope = resolveScope(ctx, input)
      const reservation = await requireReservation(innerTrx, ctx, input.reservationId, scope, true)
      const warehouseId =
        typeof reservation.warehouse === 'string' ? reservation.warehouse : reservation.warehouse.id
      reservation.sourceType = input.sourceType
      reservation.sourceId = input.sourceId
      reservation.expiresAt = null
      reservation.idempotencyKey = buildReservationIdempotencyKey({
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        catalogVariantId: reservation.catalogVariantId,
        warehouseId,
        quantity: toNumber(reservation.quantity),
      })
      await innerTrx.flush()
      return { reservationId: reservation.id, reservationEntity: reservation }
    })
  }

  /**
   * §4.1b, A6/A7: the gate. In ONE `SELECT … FOR UPDATE` locks every balance row of every
   * variant in the call, re-derives sellable from those locked rows with the §4.2 shared
   * builder, and — only when every `'exact'`-mode line's `requested` fits its own sellable
   * — allocates each line's `heldQuantity` across warehouses (primary first, A7) and
   * inserts one `wms_inventory_reservations` row per `(variant, warehouse)` bucket via
   * `reserveInTransaction` (same transaction, same locks, re-entrant). Any `'exact'` line
   * that does not fit fails the WHOLE call: nothing is written, matching "all lines unheld
   * when any line shortfalls" (A1). A `'up_to_sellable'` line (backorder) never shortfalls
   * — it holds `min(requested, sellable)`, possibly zero.
   *
   * Returns the collected `sideEffects` instead of emitting them: this method runs INSIDE
   * the caller's transaction, and side effects (cache invalidation, the `wms.inventory.*`
   * events `emitSideEffects` fires) must only run after that transaction commits (A19) —
   * the caller (`availability.reserve`/`.commit`) owns that boundary.
   */
  async reserveLinesForCheckout(
    trx: EntityManager,
    ctx: CommandRuntimeContext,
    input: ReserveLinesForCheckoutInput,
  ): Promise<ReserveLinesForCheckoutResult> {
    return runInTransaction(trx, async (innerTrx) => {
      const { scope, lines, sourceType, sourceId, expiresAt, warehouseIds } = input
      if (lines.length === 0) {
        return { ok: true as const, lines: [], sideEffects: {} }
      }
      const variantIds = Array.from(new Set(lines.map((line) => line.catalogVariantId)))
      const now = new Date()

      const lockedBalances = await lockCandidateBalances(innerTrx, ctx, scope, variantIds, warehouseIds)
      const aggregates = aggregateAvailableByVariant(lockedBalances, now)
      const profileRows = await loadVariantSafetyStockRows(innerTrx, scope, variantIds)
      const sellableByVariant = computeSellableQuantities(
        { balances: aggregates, profiles: profileRows },
        { variantIds, productRollups: [] },
      ).perVariant

      const shortfalls: ReserveLinesForCheckoutShortfallLine[] = []
      const toHold: Array<{ line: ReserveLinesForCheckoutLineInput; heldQuantity: number; sellableForLine: number }> = []
      for (const line of lines) {
        const sellableForLine = sellableByVariant.get(line.catalogVariantId) ?? 0
        if (line.mode === 'exact') {
          if (line.quantity > sellableForLine + 0.000001) {
            shortfalls.push({ key: line.key, requested: line.quantity, sellable: sellableForLine })
            continue
          }
          toHold.push({ line, heldQuantity: line.quantity, sellableForLine })
        } else {
          toHold.push({ line, heldQuantity: Math.min(line.quantity, sellableForLine), sellableForLine })
        }
      }
      if (shortfalls.length > 0) {
        return { ok: false as const, lines: shortfalls }
      }

      const primaryWarehouseId = await resolvePrimaryWarehouseId(innerTrx, scope)
      const resultLines: ReserveLinesForCheckoutLineResult[] = []
      const sideEffects: WmsSideEffects = { reservations: [], balances: [] }

      for (const { line, heldQuantity, sellableForLine } of toHold) {
        if (heldQuantity <= 0) {
          resultLines.push({ key: line.key, sellable: sellableForLine, heldQuantity: 0, reservationIds: [] })
          continue
        }
        const warehouseBuckets = sortWarehouseAvailabilityForReservation(
          warehouseAvailabilityForVariant(lockedBalances, now, line.catalogVariantId),
          primaryWarehouseId,
        )
        let remaining = heldQuantity
        const reservationIds: string[] = []
        for (const bucket of warehouseBuckets) {
          if (remaining <= 0.000001) break
          const take = Math.min(bucket.available, remaining)
          if (take <= 0) continue
          const bucketResult = await this.reserveInTransaction(innerTrx, ctx, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            warehouseId: bucket.warehouseId,
            catalogVariantId: line.catalogVariantId,
            quantity: take,
            sourceType,
            sourceId,
            expiresAt: expiresAt ?? undefined,
          })
          reservationIds.push(bucketResult.reservationId)
          if (!bucketResult.idempotentReplay) {
            sideEffects.reservations!.push({ entity: bucketResult.reservationEntity, action: 'created' })
            for (const balance of bucketResult.touchedBalances) {
              sideEffects.balances!.push({ entity: balance, action: 'updated' })
            }
          }
          remaining -= take
        }
        if (remaining > 0.000001) {
          // The warehouse-level view came in lower than the variant-level aggregate
          // (for example, an earlier line in this SAME call already consumed part of
          // a shared bucket) — fail loudly instead of silently under-holding.
          throw new CrudHttpError(409, { error: 'insufficient_stock' })
        }
        resultLines.push({ key: line.key, sellable: sellableForLine, heldQuantity, reservationIds })
      }

      return { ok: true as const, lines: resultLines, sideEffects }
    })
  }

  /**
   * Step 2.3 (A12, reconciliation drift a/c). Scoped-by-id lookup of `wms_inventory_reservations`
   * rows — a read, never a mutation, so it carries no side effects. `availability`'s
   * reconciliation job uses this to check whether a hold's own `wmsReservationIds` still
   * resolve to `active` rows (drift a) or have moved off `'checkout'` (drift c), without a
   * static `wms` entity import (duck-typed via `WmsReservationServiceLike`, cross-module rule).
   */
  async findReservationsByIds(
    trx: EntityManager,
    ctx: CommandRuntimeContext,
    input: { tenantId: string; organizationId: string; ids: string[] },
  ): Promise<InventoryReservation[]> {
    if (input.ids.length === 0) return []
    const scope: Scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const rows = await findWithDecryption(
      trx,
      InventoryReservation,
      { id: { $in: input.ids }, organizationId: input.organizationId, deletedAt: null },
      undefined,
      scope,
    )
    for (const row of rows) {
      ensureTenantScope(ctx, row.tenantId)
      ensureOrganizationScope(ctx, row.organizationId)
    }
    return rows
  }

  /**
   * Step 2.3 (A12, reconciliation drift b). The ONE tenant-wide (cross-organization) read on
   * this service — `availability`'s hourly reconciliation tick is itself tenant-scoped only
   * (§10, D-R5-32: payload carries `{ tenantId }`, no `organizationId`), the same scope shape
   * `cart`'s own sweeper schedules use. Tenant isolation is the `WHERE tenant_id = …` filter
   * itself (filter-based, not an `ensureOrganizationScope` assertion — there is no single
   * organization to assert against here), matching `cart/lib/sweepers.ts`'s own boundary.
   * Takes no `ctx`: nothing here is scoped to one organization for an `ensure*` check to make
   * sense against, and the caller builds a fresh per-row `ctx` once it knows which hold (and
   * therefore which organization) a returned row belongs to.
   */
  async listActiveReservationsBySourceType(
    trx: EntityManager,
    input: { tenantId: string; sourceType: string; createdBefore: Date; cursor?: string | null; limit: number },
  ): Promise<InventoryReservation[]> {
    const where: Record<string, unknown> = {
      tenantId: input.tenantId,
      sourceType: input.sourceType,
      status: 'active',
      createdAt: { $lt: input.createdBefore },
      deletedAt: null,
    }
    if (input.cursor) where.id = { $gt: input.cursor }
    return findWithDecryption(
      trx,
      InventoryReservation,
      where,
      { orderBy: { id: 'asc' }, limit: input.limit },
      { tenantId: input.tenantId },
    )
  }

  /**
   * A19: runs the side effects a write collected, AFTER the caller's transaction has
   * committed — the same `emitCrudSideEffects` cache/query-index invalidation
   * `commands/inventory-actions.ts`'s thin command wrappers already run for
   * `wms.inventory.reserve`/`.release`, now also reachable by `reserveLinesForCheckout`'s
   * in-process caller (`availability`). Re-resolving `dataEngine` defensively (never
   * throwing when it is not registered) mirrors the existing wrappers' own behaviour.
   */
  async emitSideEffects(ctx: CommandRuntimeContext, sideEffects: WmsSideEffects): Promise<void> {
    let de: DataEngine | null = null
    try {
      de = ctx.container.resolve('dataEngine') as DataEngine
    } catch {
      de = null
    }
    if (!de) return

    for (const { entity, action } of sideEffects.reservations ?? []) {
      await emitCrudSideEffects({
        dataEngine: de,
        action,
        entity,
        identifiers: { id: entity.id, organizationId: entity.organizationId, tenantId: entity.tenantId },
        indexer: inventoryReservationCrudIndexer,
        events: inventoryReservationCrudEvents,
      })
    }
    for (const { entity, action } of sideEffects.balances ?? []) {
      await emitCrudSideEffects({
        dataEngine: de,
        action,
        entity,
        identifiers: { id: entity.id, organizationId: entity.organizationId, tenantId: entity.tenantId },
        indexer: inventoryBalanceCrudIndexer,
        events: inventoryBalanceCrudEvents,
      })
    }
  }
}
