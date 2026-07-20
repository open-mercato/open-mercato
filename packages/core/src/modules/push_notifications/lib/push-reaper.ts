import type { EntityManager } from '@mikro-orm/postgresql'
import { PushNotificationDelivery } from '../data/entities'
import { emitPushNotificationsEvent } from '../events'
import { MAX_ATTEMPTS } from './push-delivery'
import { enqueuePushDelivery } from './queue'

// Minutes a row may sit in `sending`/`pending` before it is treated as abandoned by a dead worker.
// Tunable via OM_PUSH_STUCK_RECLAIM_MINUTES (values below MIN_STUCK_MINUTES, negative, or non-numeric
// → default).
//
// INVARIANT: this window MUST exceed the worst-case single provider send time. `updated_at` is stamped
// once when the row is claimed (`pending` → `sending`) and is NOT refreshed mid-send (no heartbeat), so
// a legitimate send that runs longer than the window would be reclaimed and re-enqueued → a duplicate
// push. The default (5m) is comfortably above any adapter's send/HTTP timeout; if you lower it, keep it
// above the adapter timeout. Duplicates are otherwise bounded by MAX_ATTEMPTS (now incremented at claim
// time — see push-delivery.ts) and inherent to at-least-once delivery.
//
// A floor of MIN_STUCK_MINUTES is enforced: `0` (the old "reclaim on the next tick") is UNSAFE because
// `cutoff = now` matches an actively-`sending` row whose `updated_at` was stamped at claim, re-opening
// an in-flight send and causing a genuine duplicate push. Sub-floor values fall back to the default.
const DEFAULT_STUCK_MINUTES = 5
const MIN_STUCK_MINUTES = 1

export type ReclaimStuckResult = { reEnqueued: number; expired: number }

function resolveStuckThresholdMs(): number {
  const raw = Number.parseInt(process.env.OM_PUSH_STUCK_RECLAIM_MINUTES ?? '', 10)
  const minutes = Number.isFinite(raw) && raw >= MIN_STUCK_MINUTES ? raw : DEFAULT_STUCK_MINUTES
  return minutes * 60 * 1000
}

async function emitFailed(delivery: PushNotificationDelivery, willRetry: boolean): Promise<void> {
  await emitPushNotificationsEvent(
    'push_notifications.delivery.failed',
    {
      deliveryId: delivery.id,
      tenantId: delivery.tenantId,
      organizationId: delivery.organizationId ?? null,
      userId: delivery.userId,
      provider: delivery.provider,
      status: delivery.status,
      ...(willRetry ? { willRetry: true } : {}),
    },
    { persistent: true },
  )
}

/**
 * Recover push delivery rows stranded by a worker (or an enqueue) that never finished:
 *
 *  - `sending` rows — a worker crashed between claiming the row (`pending` → `sending`) and finalizing
 *    it. Such a row has no outstanding job the claim can re-match.
 *  - `pending` rows — the fan-out committed the delivery row (a plain INSERT, auto-committed) but the
 *    subsequent enqueue never landed (process died, or the queue dropped the job). The row then sits
 *    `pending` forever: the send-path claim only runs when a job fires, so no job ⇒ no claim ⇒ the row
 *    is never retried, expired, nor surfaced as failed. Only a *synchronous* enqueue throw is handled
 *    inline by the fan-out; a lost job after the INSERT committed is invisible without this sweep.
 *
 * Both are recovered identically: re-enqueue if retry budget remains, else finalize `expired`. Driven
 * by the `push_notifications:reclaim-stuck` scheduler tick (one per tenant), so the query is scoped to
 * the tenant only (covers org-bound and tenant-level rows alike); there is no cross-tenant read.
 *
 * The stale-`updated_at < cutoff` guard is what makes sweeping `pending` safe: a freshly fan-outed row
 * (with a live job in flight) is younger than the cutoff and is left alone; only a row that has sat
 * past the reclaim window — long after any real job would have claimed it — is re-enqueued. A rare
 * duplicate job is a no-op because the send-path claim is atomic (`pending` → `sending`, exactly one
 * winner), and provider-send duplicates are bounded by MAX_ATTEMPTS.
 *
 * Each transition is an atomic `nativeUpdate` guarded on the row's observed `status` AND still-stale
 * `updated_at < cutoff`, so overlapping ticks (or a worker that re-claimed the row in the meantime)
 * can never re-open an actively-processing delivery — exactly one actor wins each row.
 */
export async function reclaimStuckPushDeliveries(
  em: EntityManager,
  scope: { tenantId: string },
  now: Date = new Date(),
): Promise<ReclaimStuckResult> {
  const cutoff = new Date(now.getTime() - resolveStuckThresholdMs())
  const stuck = await em.find(PushNotificationDelivery, {
    tenantId: scope.tenantId,
    status: { $in: ['sending', 'pending'] },
    updatedAt: { $lt: cutoff },
  })

  let reEnqueued = 0
  let expired = 0
  for (const delivery of stuck) {
    const claimGuard = { id: delivery.id, tenantId: scope.tenantId, status: delivery.status, updatedAt: { $lt: cutoff } }

    if (delivery.attempts >= MAX_ATTEMPTS) {
      const claimed = await em.nativeUpdate(PushNotificationDelivery, claimGuard, {
        status: 'expired',
        lastError: 'stuck_reclaimed',
        nextRetryAt: null,
        updatedAt: new Date(),
      })
      if (claimed === 0) continue
      delivery.status = 'expired'
      delivery.lastError = 'stuck_reclaimed'
      await emitFailed(delivery, false)
      expired += 1
      continue
    }

    const claimed = await em.nativeUpdate(PushNotificationDelivery, claimGuard, {
      status: 'pending',
      nextRetryAt: null,
      updatedAt: new Date(),
    })
    if (claimed === 0) continue
    delivery.status = 'pending'

    try {
      await enqueuePushDelivery({
        deliveryId: delivery.id,
        tenantId: scope.tenantId,
        organizationId: delivery.organizationId ?? null,
      })
      reEnqueued += 1
    } catch (error) {
      // Re-enqueue failed: don't leave the row pending with no job. Fail it terminally instead.
      const reason = error instanceof Error ? `reclaim_enqueue_failed: ${error.message}` : 'reclaim_enqueue_failed'
      await em.nativeUpdate(
        PushNotificationDelivery,
        { id: delivery.id, tenantId: scope.tenantId, status: 'pending' },
        { status: 'failed', lastError: reason, nextRetryAt: null, updatedAt: new Date() },
      )
      delivery.status = 'failed'
      delivery.lastError = reason
      await emitFailed(delivery, false)
    }
  }

  return { reEnqueued, expired }
}
