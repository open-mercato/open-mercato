/**
 * Release 5 Phase 3 (Step 2.3). Both §10 jobs — the one-minute expiry sweep (A11) and the
 * hourly reconciliation sweep (A12) — following the `cart` sweeper pattern
 * (`cart/lib/sweepers.ts`): one tick per tenant (`{ tenantId }`, D-R5-32), batched, idempotent
 * (a re-run changes nothing the first run did not). Each hold-level transition reuses Step
 * 2.2's own `wmsReservationService` methods (`releaseInTransaction`/`convertInTransaction`)
 * through the SAME duck-typed `WmsReservationServiceLike` surface `lib/reservationCommands.ts`
 * already defines — never a parallel release/convert implementation.
 *
 * @see .ai/specs/2026-08-14-availability-contract.md §10
 * @see .ai/specs/analysis/ANALYSIS-2026-10-26-availability-release-5.md A11/A12/A13
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { AvailabilityReservation } from '../data/entities'
import { emitAvailabilityEvent } from '../events'
import {
  buildServiceCtx,
  mergeSideEffects,
  tryResolveWmsService,
  type ReservationScope,
  type Resolver,
  type WmsSideEffectsLike,
} from './reservationCommands'

const logger = createLogger('availability')

const BATCH_SIZE = 200
// Defensive circuit breaker, mirrors `cart/lib/sweepers.ts#MAX_PAGES_PER_TICK`: one tick must
// never loop forever against a pathological backlog.
const MAX_PAGES_PER_TICK = 1000
// §10/A12 drift (b): "rows older than the maximum TTL (3600 s) so that a hold mid-transaction
// is never touched" — the TTL ceiling `availabilityReserveInputSchema.ttlSeconds` enforces.
const MAX_TTL_MS = 3600_000

// ---------------------------------------------------------------------------
// A11: expiry
// ---------------------------------------------------------------------------

export type ExpireReservationsResult = { expiredCount: number }

/**
 * Selects `active` holds past `expires_at` for one tenant (the partial index §5.3 added makes
 * this scan cheap), CAS each to `expired` in its own transaction, releases the wms rows it
 * owns through `wmsReservationService.releaseInTransaction` in the SAME transaction, then
 * emits `availability.reservation.expired` after commit. A CAS that matches nothing means
 * `release`/`commit` already won the race — the hold is skipped, never double-processed.
 */
export async function expireAvailabilityReservations(
  container: Resolver,
  input: { tenantId: string },
  now: Date = new Date(),
): Promise<ExpireReservationsResult> {
  const em = (container.resolve('em') as EntityManager).fork()
  const wmsService = tryResolveWmsService(container)
  let expiredCount = 0

  for (let page = 0; page < MAX_PAGES_PER_TICK; page += 1) {
    const candidates = await em.find(
      AvailabilityReservation,
      { tenantId: input.tenantId, status: 'active', expiresAt: { $lt: now } },
      { limit: BATCH_SIZE, orderBy: { id: 'asc' } },
    )
    if (candidates.length === 0) break

    for (const candidate of candidates) {
      const scope: ReservationScope = { tenantId: input.tenantId, organizationId: candidate.organizationId }
      const ctx = buildServiceCtx(container, scope, 'availability.expire')
      let expired = false
      let sideEffects: WmsSideEffectsLike = {}

      await em.transactional(async (trx) => {
        const affected = await trx.nativeUpdate(
          AvailabilityReservation,
          { id: candidate.id, status: 'active' },
          { status: 'expired', statusReason: 'ttl', updatedAt: now },
        )
        if (affected === 0) return
        expired = true
        if (!wmsService) return
        for (const wmsReservationId of candidate.wmsReservationIds) {
          const released = await wmsService.releaseInTransaction(trx, ctx, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            reservationId: wmsReservationId,
            reason: 'ttl',
          })
          sideEffects = mergeSideEffects(sideEffects, {
            reservations: [{ entity: released.reservationEntity, action: 'updated' }],
            balances: released.touchedBalances.map((entity) => ({ entity, action: 'updated' as const })),
          })
        }
      })

      if (!expired) continue

      if (wmsService) await wmsService.emitSideEffects(ctx, sideEffects)
      // A13/§9: `availability.reservation.expired` — never `wms.inventory.reservation_shortfall`
      // (that id belongs to `wms`'s sales-order automation, a different signal entirely).
      await emitAvailabilityEvent(
        'availability.reservation.expired',
        {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          reservationId: candidate.id,
          sourceType: candidate.sourceType,
          sourceId: candidate.sourceId,
          reason: 'ttl',
          lines: candidate.items.map((item) => ({
            catalogProductId: item.catalogProductId,
            catalogVariantId: item.catalogVariantId,
            heldQuantity: item.heldQuantity,
          })),
        },
        { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId },
      )
      expiredCount += 1
      logger.info('availability:expire-reservations expired a hold', {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        reservationId: candidate.id,
      })
    }

    if (candidates.length < BATCH_SIZE) break
  }

  return { expiredCount }
}

// ---------------------------------------------------------------------------
// A12: reconciliation (drift a/b/c)
// ---------------------------------------------------------------------------

export type ReconcileReservationsResult = {
  releasedHolds: number
  orphanWmsReleased: number
  convertedHolds: number
}

async function reportDrift(code: string, attributes: Record<string, string | number | boolean | undefined>): Promise<void> {
  logger.warn(`[availability:reconcile-reservations] ${code}`, attributes)
  getTelemetryRuntime()?.reportError(
    new Error(`[internal] availability reconciliation drift: ${code}`),
    { module: 'availability', code: `availability.reconciliation.${code}`, attributes },
  )
}

/**
 * Checks only that the two sides of a hold agree — `availability` cannot ask whether a
 * checkout session still exists (§10/A12). Three drift cases, each repaired in its own
 * transaction with the same CAS guard as `release`/`expire`:
 *   (a) hold `active`, one or more of its wms rows released or missing → release the rest,
 *       CAS the hold to `released` (`status_reason: 'reconciled'`), emit `.released`.
 *   (b) active `wms` 'checkout' row that no hold's `wmsReservationIds` references → release it.
 *   (c) hold `committed`, one or more of its wms rows still `sourceType: 'checkout'` →
 *       convert them to `order` through `convertInTransaction`.
 * Every repair is logged AND reported (`reportError`) — a non-zero count is a defect signal,
 * never a routine event, same convention `customer_groups:credit-exposure-audit` (Step 1.8)
 * established.
 */
export async function reconcileAvailabilityReservations(
  container: Resolver,
  input: { tenantId: string },
  now: Date = new Date(),
): Promise<ReconcileReservationsResult> {
  const em = (container.resolve('em') as EntityManager).fork()
  const wmsService = tryResolveWmsService(container)
  const result: ReconcileReservationsResult = { releasedHolds: 0, orphanWmsReleased: 0, convertedHolds: 0 }
  if (!wmsService) return result

  const referencedWmsIds = new Set<string>()

  // Cases (a) and (c): walk every active/committed hold and check its own wms rows.
  let holdCursor: string | null = null
  for (let page = 0; page < MAX_PAGES_PER_TICK; page += 1) {
    const where: Record<string, unknown> = {
      tenantId: input.tenantId,
      status: { $in: ['active', 'committed'] },
    }
    if (holdCursor) where.id = { $gt: holdCursor }
    const holds = await em.find(AvailabilityReservation, where, { limit: BATCH_SIZE, orderBy: { id: 'asc' } })
    if (holds.length === 0) break

    for (const hold of holds) {
      for (const id of hold.wmsReservationIds) referencedWmsIds.add(id)
      if (hold.wmsReservationIds.length === 0) continue

      const scope: ReservationScope = { tenantId: input.tenantId, organizationId: hold.organizationId }
      const ctx = buildServiceCtx(container, scope, 'availability.reconcile')
      const wmsRows = await wmsService.findReservationsByIds(em, ctx, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        ids: hold.wmsReservationIds,
      })
      const wmsById = new Map(wmsRows.map((row) => [row.id, row]))

      if (hold.status === 'active') {
        const drifted = hold.wmsReservationIds.some((id) => {
          const row = wmsById.get(id)
          return !row || row.status !== 'active'
        })
        if (!drifted) continue

        await reportDrift('hold_active_wms_released_or_missing', {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          holdId: hold.id,
        })

        let released = false
        let sideEffects: WmsSideEffectsLike = {}
        await em.transactional(async (trx) => {
          const affected = await trx.nativeUpdate(
            AvailabilityReservation,
            { id: hold.id, status: 'active' },
            { status: 'released', statusReason: 'reconciled', updatedAt: now },
          )
          if (affected === 0) return
          released = true
          for (const id of hold.wmsReservationIds) {
            const row = wmsById.get(id)
            if (!row || row.status !== 'active') continue
            const releaseResult = await wmsService.releaseInTransaction(trx, ctx, {
              tenantId: scope.tenantId,
              organizationId: scope.organizationId,
              reservationId: id,
              reason: 'reconciled',
            })
            sideEffects = mergeSideEffects(sideEffects, {
              reservations: [{ entity: releaseResult.reservationEntity, action: 'updated' }],
              balances: releaseResult.touchedBalances.map((entity) => ({ entity, action: 'updated' as const })),
            })
          }
        })
        if (!released) continue

        await wmsService.emitSideEffects(ctx, sideEffects)
        await emitAvailabilityEvent(
          'availability.reservation.released',
          {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            reservationId: hold.id,
            sourceType: hold.sourceType,
            sourceId: hold.sourceId,
            reason: 'reconciled',
            lines: hold.items.map((item) => ({
              catalogProductId: item.catalogProductId,
              catalogVariantId: item.catalogVariantId,
              heldQuantity: item.heldQuantity,
            })),
          },
          { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId },
        )
        result.releasedHolds += 1
        continue
      }

      // hold.status === 'committed'
      const stillCheckout = hold.wmsReservationIds.filter((id) => wmsById.get(id)?.sourceType === 'checkout')
      if (stillCheckout.length === 0 || !hold.orderId) continue

      await reportDrift('hold_committed_wms_still_checkout', {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        holdId: hold.id,
        orderId: hold.orderId,
      })

      await em.transactional(async (trx) => {
        for (const id of stillCheckout) {
          await wmsService.convertInTransaction(trx, ctx, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            reservationId: id,
            sourceType: 'order',
            sourceId: hold.orderId as string,
          })
        }
      })
      result.convertedHolds += 1
    }

    holdCursor = holds[holds.length - 1].id
    if (holds.length < BATCH_SIZE) break
  }

  // Case (b): active 'checkout' wms rows no hold references, older than the max TTL.
  const createdBefore = new Date(now.getTime() - MAX_TTL_MS)
  let wmsCursor: string | null = null
  for (let page = 0; page < MAX_PAGES_PER_TICK; page += 1) {
    const wmsRows = await wmsService.listActiveReservationsBySourceType(em, {
      tenantId: input.tenantId,
      sourceType: 'checkout',
      createdBefore,
      cursor: wmsCursor,
      limit: BATCH_SIZE,
    })
    if (wmsRows.length === 0) break

    for (const row of wmsRows) {
      if (referencedWmsIds.has(row.id)) continue

      await reportDrift('orphan_checkout_wms_reservation', {
        tenantId: row.tenantId,
        organizationId: row.organizationId,
        wmsReservationId: row.id,
      })

      const scope: ReservationScope = { tenantId: row.tenantId, organizationId: row.organizationId }
      const ctx = buildServiceCtx(container, scope, 'availability.reconcile')
      let sideEffects: WmsSideEffectsLike = {}
      await em.transactional(async (trx) => {
        const releaseResult = await wmsService.releaseInTransaction(trx, ctx, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          reservationId: row.id,
          reason: 'reconciled',
        })
        sideEffects = mergeSideEffects(sideEffects, {
          reservations: [{ entity: releaseResult.reservationEntity, action: 'updated' }],
          balances: releaseResult.touchedBalances.map((entity) => ({ entity, action: 'updated' as const })),
        })
      })
      await wmsService.emitSideEffects(ctx, sideEffects)
      result.orphanWmsReleased += 1
    }

    wmsCursor = wmsRows[wmsRows.length - 1].id
    if (wmsRows.length < BATCH_SIZE) break
  }

  return result
}
