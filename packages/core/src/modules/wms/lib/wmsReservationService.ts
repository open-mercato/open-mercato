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
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { LockMode } from '@mikro-orm/core'
import { emitWmsEvent } from '../events'
import {
  InventoryBalance,
  InventoryLot,
  InventoryMovement,
  InventoryReservation,
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
import {
  ensureOrganizationScope,
  ensureTenantScope,
  findExactBalanceForUpdate,
  getAvailableQuantity,
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
  ): Promise<ReleaseInTransactionResult> {
    return runInTransaction(trx, async (innerTrx) => {
      const scope = resolveScope(ctx, input)
      const reservation = await requireReservation(innerTrx, ctx, input.reservationId, scope, true)
      if (reservation.status !== 'active') {
        throw new CrudHttpError(409, { error: 'invalid_reservation_state' })
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
}
