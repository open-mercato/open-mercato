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
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
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
import { buildSqlInClause } from './sqlInClause'
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
  /** Set with `sourceTargetQuantity`: the source's active quantity of the variant after this call. */
  sourceHeldQuantity?: number
}

export type ReserveInTransactionOptions = {
  /**
   * Caps what `sourceType`/`sourceId` holds of the variant across all warehouses. The call
   * reserves at most the still-missing part of this target, counted under the source-variant
   * lock `convertInTransaction` also takes, so a reserve and a checkout conversion for the
   * same order can never jointly hold more than the target. When nothing is missing it
   * replays an existing row instead of writing.
   */
  sourceTargetQuantity?: number
}

export const SOURCE_RESERVATION_BUSY_ERROR = 'source_reservation_busy'

export function isSourceReservationBusyError(error: unknown): boolean {
  return isCrudHttpError(error) && error.status === 409 && error.body?.error === SOURCE_RESERVATION_BUSY_ERROR
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
  /** The hold's own `sourceId`; a row owned by anything else is `not_convertible`. */
  expectedSourceId?: string
}

export type ConvertNotConvertibleReason = 'missing' | 'not_active' | 'not_checkout' | 'source_mismatch'

export type ConvertInTransactionResult = {
  reservationId: string
  reservationEntity: InventoryReservation | null
  outcome: 'converted' | 'already_converted' | 'covered_released' | 'not_convertible'
  reason?: ConvertNotConvertibleReason
  touchedBalances: InventoryBalance[]
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
// (`reserveInTransaction`'s `listCandidateBalances`). The caller passes the line variants
// UNION every active variant of each product that has a product-level safety-stock pool row,
// so a pooled product's whole shared budget is locked in the same id-ordered statement.
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

async function loadProductPoolRows(
  em: EntityManager,
  scope: Scope,
  productIds: string[],
): Promise<SafetyStockProfileRow[]> {
  if (productIds.length === 0) return []
  const rows = await findWithDecryption(
    em,
    ProductInventoryProfile,
    { catalogProductId: { $in: productIds }, catalogVariantId: null, deletedAt: null },
    undefined,
    scope,
  )
  return rows.map((row) => ({
    catalog_product_id: row.catalogProductId,
    catalog_variant_id: null,
    safety_stock: row.safetyStock,
    reorder_point: row.reorderPoint,
  }))
}

async function loadActiveVariantIdsByProduct(
  em: EntityManager,
  scope: Scope,
  productIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>()
  if (productIds.length === 0) return result
  const productClause = buildSqlInClause('product_id', productIds)
  const rows = await em.execute<Array<{ id: string; product_id: string }>>(
    `select id, product_id from catalog_product_variants
     where organization_id = ? and tenant_id = ? and ${productClause.sql} and is_active = true and deleted_at is null`,
    [scope.organizationId, scope.tenantId, ...productClause.params],
  )
  for (const row of rows) {
    const list = result.get(row.product_id) ?? []
    list.push(row.id)
    result.set(row.product_id, list)
  }
  return result
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

async function shrinkReservationBuckets(
  em: EntityManager,
  scope: Scope,
  reservation: InventoryReservation,
  delta: number,
): Promise<InventoryBalance[]> {
  const metadata = extractReservationMetadata(reservation)
  const buckets = Array.isArray(metadata.allocatedBuckets) ? (metadata.allocatedBuckets as AllocationBucket[]) : []
  const field = (metadata.allocationState ?? 'reserved') === 'allocated' ? 'quantityAllocated' : 'quantityReserved'
  const touched: InventoryBalance[] = []
  const nextBuckets: AllocationBucket[] = []
  let remaining = delta
  for (const bucket of [...buckets].reverse()) {
    if (remaining <= 0.000001) {
      nextBuckets.unshift(bucket)
      continue
    }
    const take = Math.min(bucket.quantity, remaining)
    const balance = await findReservationBucketBalance(em, scope, reservation, bucket)
    if (balance) {
      enforceNonNegativeBalance(balance, field, toNumber(balance[field]) - take, reservation.id, scope)
      touched.push(balance)
    }
    remaining -= take
    const left = bucket.quantity - take
    if (left > 0.000001) nextBuckets.unshift({ ...bucket, quantity: left })
  }
  reservation.quantity = toNumericString(toNumber(reservation.quantity) - delta)
  reservation.metadata = { ...metadata, allocatedBuckets: nextBuckets }
  await em.flush()
  return touched
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

// Serializes "what does this source already hold of this variant" decisions: the checkout
// conversion (`convertInTransaction`, blocking) and a `sourceTargetQuantity` reserve (try
// only, after its balance locks). Same transaction, same connection, released at commit.
const SOURCE_VARIANT_LOCK_SQL = 'select pg_advisory_xact_lock(hashtextextended(?, 0))'
const SOURCE_VARIANT_TRY_LOCK_SQL = 'select pg_try_advisory_xact_lock(hashtextextended(?, 0)) as acquired'

function sourceVariantLockKey(scope: Scope, sourceType: string, sourceId: string, catalogVariantId: string): string {
  return ['wms:source-variant-reservation', scope.organizationId, sourceType, sourceId, catalogVariantId]
    .map((segment) => segment.toLowerCase())
    .join(':')
}

async function lockSourceVariant(
  em: EntityManager,
  scope: Scope,
  sourceType: string,
  sourceId: string,
  catalogVariantId: string,
): Promise<void> {
  await em.execute(SOURCE_VARIANT_LOCK_SQL, [sourceVariantLockKey(scope, sourceType, sourceId, catalogVariantId)])
}

async function tryLockSourceVariant(
  em: EntityManager,
  scope: Scope,
  sourceType: string,
  sourceId: string,
  catalogVariantId: string,
): Promise<boolean> {
  const rows = await em.execute<Array<{ acquired: boolean }>>(SOURCE_VARIANT_TRY_LOCK_SQL, [
    sourceVariantLockKey(scope, sourceType, sourceId, catalogVariantId),
  ])
  return rows[0]?.acquired === true
}

async function listActiveSourceVariantReservations(
  em: EntityManager,
  scope: Scope,
  sourceType: InventoryReservation['sourceType'],
  sourceId: string,
  catalogVariantId: string,
): Promise<InventoryReservation[]> {
  return findWithDecryption(
    em,
    InventoryReservation,
    {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      sourceType,
      sourceId,
      catalogVariantId,
      status: 'active',
      deletedAt: null,
    },
    { orderBy: { createdAt: 'asc', id: 'asc' } },
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
    options?: ReserveInTransactionOptions,
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
      const replay = (existing: InventoryReservation): ReserveInTransactionResult => {
        const metadata = extractReservationMetadata(existing)
        const buckets = Array.isArray(metadata.allocatedBuckets)
          ? (metadata.allocatedBuckets as AllocationBucket[])
          : []
        return {
          reservationId: existing.id,
          allocatedBuckets: serializeAllocationBuckets(buckets),
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          warehouseId: typeof existing.warehouse === 'string' ? existing.warehouse : existing.warehouse.id,
          catalogVariantId: input.catalogVariantId,
          quantity: input.quantity,
          reservationEntity: existing,
          touchedBalances: [],
          idempotentReplay: true,
        }
      }
      const existingReservation = await findExistingActiveReservationByIdempotencyKey(
        innerTrx,
        scope,
        reservationIdempotencyKey,
      )
      if (existingReservation) return replay(existingReservation)
      const strategy = await resolveReservationStrategy(innerTrx, ctx, input, scope)
      const balances = await listCandidateBalances(innerTrx, ctx, input, scope)
      let reserveQuantity = input.quantity
      let sourceHeldQuantity: number | undefined
      if (options?.sourceTargetQuantity !== undefined) {
        // Taken after the balance locks, so it must never wait: a commit holding this lock may
        // be waiting on those same balance rows. Busy rolls back and is retried by the caller.
        if (!(await tryLockSourceVariant(innerTrx, scope, input.sourceType, input.sourceId, input.catalogVariantId))) {
          throw new CrudHttpError(409, { error: SOURCE_RESERVATION_BUSY_ERROR })
        }
        const held = await listActiveSourceVariantReservations(
          innerTrx,
          scope,
          input.sourceType,
          input.sourceId,
          input.catalogVariantId,
        )
        const heldQuantity = held.reduce((sum, row) => sum + toNumber(row.quantity), 0)
        const missing = options.sourceTargetQuantity - heldQuantity
        if (missing <= 0.000001 && held.length > 0) {
          return { ...replay(held[0]), sourceHeldQuantity: heldQuantity }
        }
        reserveQuantity = Math.min(input.quantity, missing)
        sourceHeldQuantity = heldQuantity + reserveQuantity
      }
      const receiptMap = await loadReceivedAtByBucket(innerTrx, balances, scope)
      const now = new Date()
      const ordered = sortBalancesForStrategy(
        balances.filter(
          (balance) => balanceHasEligibleLot(balance, now) && getAvailableQuantity(balance) > 0,
        ),
        strategy,
        receiptMap,
      )
      // The writes run in a savepoint with its own identity map: when the insert loses the
      // active-key race on PostgreSQL, only the savepoint is rolled back, so the replay read
      // below runs in a live transaction and no half-applied balance change is left dirty.
      let written: { reservation: InventoryReservation; buckets: AllocationBucket[]; touchedBalances: InventoryBalance[] }
      try {
        written = await runInTransaction(
          innerTrx,
          async (writeTrx) => {
            let remaining = reserveQuantity
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
              const persistedBalance = await findExactBalanceForUpdate(writeTrx, scope, {
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
            const reservation = writeTrx.create(InventoryReservation, {
              organizationId: scope.organizationId,
              tenantId: scope.tenantId,
              warehouse: writeTrx.getReference(Warehouse, input.warehouseId),
              catalogVariantId: input.catalogVariantId,
              lot: buckets.length === 1 && buckets[0].lotId ? writeTrx.getReference(InventoryLot, buckets[0].lotId) : null,
              serialNumber: buckets.length === 1 ? buckets[0].serialNumber : null,
              quantity: toNumericString(reserveQuantity),
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
            writeTrx.persist(reservation)
            await writeTrx.flush()
            return { reservation, buckets, touchedBalances }
          },
          { clear: true },
        )
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error
        const raced = await findExistingActiveReservationByIdempotencyKey(
          innerTrx,
          scope,
          reservationIdempotencyKey,
        )
        if (!raced) throw error
        return replay(raced)
      }
      return {
        reservationId: written.reservation.id,
        allocatedBuckets: serializeAllocationBuckets(written.buckets),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        warehouseId: input.warehouseId,
        catalogVariantId: input.catalogVariantId,
        quantity: reserveQuantity,
        reservationEntity: written.reservation,
        touchedBalances: written.touchedBalances,
        idempotentReplay: false,
        ...(sourceHeldQuantity === undefined ? {} : { sourceHeldQuantity }),
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
   * Converts an ACTIVE `checkout` reservation row's `sourceType`/`sourceId` in place — a
   * checkout hold becoming an `order` hold at `availability.commit` (§4.1/§4.4, A1/A5/A16) —
   * without releasing and re-reserving. Only rows that are `active`, `sourceType: 'checkout'`
   * and (when `expectedSourceId` is given) owned by the calling hold are converted; a
   * released, missing, foreign-source or foreign-owner row is reported as
   * `outcome: 'not_convertible'` and left untouched, so the caller can recover with a fresh
   * gated order reservation or surface `stock_lost` instead of relabeling a row that no
   * longer holds stock. A row already converted to this same order is an idempotent no-op.
   *
   * Confirmed-first case (§4.4): when `sales.order.confirmed` automation already holds active
   * `order` rows for the same order/variant/warehouse, those rows are locked and counted as
   * covering. A fully covered checkout row is released (`covered_released`); a partly covered
   * one is shrunk to the uncovered quantity before conversion. The rebuilt idempotency key
   * gets a deterministic suffix when another active row already owns it, so the active-key
   * unique index can never reject the conversion.
   *
   * The covering read runs under the source-variant advisory lock (taken after the checkout
   * row lock) that a `sourceTargetQuantity` reserve also takes. The automation's reserve either
   * commits first and is counted here, or runs after this commit and counts the converted row,
   * so the two never jointly hold more than the order needs.
   */
  async convertInTransaction(
    trx: EntityManager,
    ctx: CommandRuntimeContext,
    input: ConvertInTransactionInput,
  ): Promise<ConvertInTransactionResult> {
    return runInTransaction(trx, async (innerTrx) => {
      const scope = resolveScope(ctx, input)
      const reservation = await findOneWithDecryption(
        innerTrx,
        InventoryReservation,
        { id: input.reservationId, deletedAt: null },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
        scope,
      )
      if (!reservation) {
        return {
          reservationId: input.reservationId,
          reservationEntity: null,
          outcome: 'not_convertible' as const,
          reason: 'missing' as const,
          touchedBalances: [],
        }
      }
      ensureTenantScope(ctx, reservation.tenantId)
      ensureOrganizationScope(ctx, reservation.organizationId)
      const notConvertible = (reason: ConvertNotConvertibleReason): ConvertInTransactionResult => ({
        reservationId: reservation.id,
        reservationEntity: reservation,
        outcome: 'not_convertible',
        reason,
        touchedBalances: [],
      })
      if (
        reservation.status === 'active' &&
        reservation.sourceType === input.sourceType &&
        reservation.sourceId === input.sourceId
      ) {
        return {
          reservationId: reservation.id,
          reservationEntity: reservation,
          outcome: 'already_converted',
          touchedBalances: [],
        }
      }
      if (reservation.status !== 'active') return notConvertible('not_active')
      if (reservation.sourceType !== 'checkout') return notConvertible('not_checkout')
      if (input.expectedSourceId && reservation.sourceId !== input.expectedSourceId) {
        return notConvertible('source_mismatch')
      }

      const warehouseId =
        typeof reservation.warehouse === 'string' ? reservation.warehouse : reservation.warehouse.id
      await lockSourceVariant(innerTrx, scope, input.sourceType, input.sourceId, reservation.catalogVariantId)
      const covering = await findWithDecryption(
        innerTrx,
        InventoryReservation,
        {
          organizationId: scope.organizationId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          catalogVariantId: reservation.catalogVariantId,
          status: 'active',
          deletedAt: null,
          id: { $ne: reservation.id },
        },
        { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'asc' } },
        scope,
      )
      const independentCovering = covering.filter(
        (row) => extractReservationMetadata(row).convertedFromCheckout !== true,
      )
      const coveredQuantity = independentCovering.reduce((sum, row) => sum + toNumber(row.quantity), 0)
      const heldQuantity = toNumber(reservation.quantity)
      const touchedBalances: InventoryBalance[] = []

      if (coveredQuantity >= heldQuantity - 0.000001 && coveredQuantity > 0) {
        const released = await this.releaseInTransaction(innerTrx, ctx, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          reservationId: reservation.id,
          reason: 'covered_by_order_reservation',
        } as InventoryReservationReleaseInput)
        return {
          reservationId: reservation.id,
          reservationEntity: released.reservationEntity,
          outcome: 'covered_released',
          touchedBalances: released.touchedBalances,
        }
      }
      if (coveredQuantity > 0.000001) {
        touchedBalances.push(...(await shrinkReservationBuckets(innerTrx, scope, reservation, coveredQuantity)))
      }

      const baseKey = buildReservationIdempotencyKey({
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        catalogVariantId: reservation.catalogVariantId,
        warehouseId,
        quantity: toNumber(reservation.quantity),
      })
      const keyOwner = await findExistingActiveReservationByIdempotencyKey(innerTrx, scope, baseKey)
      reservation.sourceType = input.sourceType
      reservation.sourceId = input.sourceId
      reservation.expiresAt = null
      reservation.metadata = { ...extractReservationMetadata(reservation), convertedFromCheckout: true }
      reservation.idempotencyKey = keyOwner && keyOwner.id !== reservation.id ? `${baseKey}|converted|${reservation.id}` : baseKey
      await innerTrx.flush()
      return {
        reservationId: reservation.id,
        reservationEntity: reservation,
        outcome: 'converted',
        touchedBalances,
      }
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
      const lineVariantIds = Array.from(new Set(lines.map((line) => line.catalogVariantId)))
      const productIds = Array.from(new Set(lines.map((line) => line.catalogProductId)))
      const now = new Date()

      const poolRows = await loadProductPoolRows(innerTrx, scope, productIds)
      const pooledProductIds = Array.from(new Set(poolRows.map((row) => row.catalog_product_id)))
      const activeVariantsByProduct = await loadActiveVariantIdsByProduct(innerTrx, scope, pooledProductIds)
      const rollups = pooledProductIds.map((productId) => ({
        productId,
        variantIds: Array.from(
          new Set([
            ...(activeVariantsByProduct.get(productId) ?? []),
            ...lines.filter((line) => line.catalogProductId === productId).map((line) => line.catalogVariantId),
          ]),
        ).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
      }))
      const lockVariantIds = Array.from(
        new Set([...lineVariantIds, ...rollups.flatMap((rollup) => rollup.variantIds)]),
      ).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))

      const lockedBalances = await lockCandidateBalances(innerTrx, ctx, scope, lockVariantIds, warehouseIds)
      const aggregates = aggregateAvailableByVariant(lockedBalances, now)
      const variantProfileRows = await loadVariantSafetyStockRows(innerTrx, scope, lockVariantIds)
      const sellable = computeSellableQuantities(
        { balances: aggregates, profiles: [...variantProfileRows, ...poolRows] },
        { variantIds: lineVariantIds, productRollups: rollups },
      )
      const sellableByVariant = sellable.perVariant
      const remainingProductBudget = new Map(sellable.perProductRollup)

      const shortfalls: ReserveLinesForCheckoutShortfallLine[] = []
      const toHold: Array<{ line: ReserveLinesForCheckoutLineInput; heldQuantity: number; sellableForLine: number }> = []
      for (const line of lines) {
        const variantSellable = sellableByVariant.get(line.catalogVariantId) ?? 0
        const productBudget = remainingProductBudget.get(line.catalogProductId)
        const sellableForLine = productBudget === undefined ? variantSellable : Math.min(variantSellable, productBudget)
        if (line.mode === 'exact') {
          if (line.quantity > sellableForLine + 0.000001) {
            shortfalls.push({ key: line.key, requested: line.quantity, sellable: sellableForLine })
            continue
          }
          toHold.push({ line, heldQuantity: line.quantity, sellableForLine })
        } else {
          toHold.push({ line, heldQuantity: Math.min(line.quantity, sellableForLine), sellableForLine })
        }
        if (productBudget !== undefined) {
          const held = line.mode === 'exact' ? line.quantity : Math.min(line.quantity, sellableForLine)
          remainingProductBudget.set(line.catalogProductId, Math.max(0, productBudget - held))
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
