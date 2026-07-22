import type { EntityManager } from '@mikro-orm/postgresql'
import { PushNotificationDelivery } from '../data/entities'
import { emitPushNotificationsEvent } from '../events'
import { MAX_ATTEMPTS } from './push-delivery'
import { resolveStuckThresholdMs } from './reclaim-window'
import { enqueuePushDelivery } from './queue'

// The stuck-reclaim window (minutes a row may sit in `sending`/`pending` before a dead-worker reclaim)
// lives in ./reclaim-window so the send-path timeout shares the same source of truth.
//
// INVARIANT: this window MUST exceed the worst-case single provider send time. `updated_at` is stamped
// once when the row is claimed (`pending` → `sending`) and is NOT refreshed mid-send (no heartbeat), so
// a legitimate send that runs longer than the window would be reclaimed and re-enqueued → a duplicate
// push. The send path caps each provider send below this window (see push-delivery.ts
// `resolvePushSendTimeoutMs`), and duplicates are otherwise bounded by MAX_ATTEMPTS (incremented at
// claim time) and inherent to at-least-once delivery.

// Bound the per-tick scan so a stranded backlog (provider/queue outage) cannot load an unbounded row
// set into memory and re-enqueue it serially in one tick. Oldest-stuck rows are drained first; the
// remainder is picked up by subsequent ticks. Tunable via OM_PUSH_STUCK_RECLAIM_BATCH_LIMIT (values
// below MIN_RECLAIM_BATCH_LIMIT, negative, or non-numeric → default). Mirrors the receipt reaper's
// OM_PUSH_RECEIPT_BATCH_LIMIT.
const DEFAULT_RECLAIM_BATCH_LIMIT = 500
const MIN_RECLAIM_BATCH_LIMIT = 1

export type ReclaimStuckResult = { reEnqueued: number; expired: number }

function resolveReclaimBatchLimit(): number {
  const raw = Number.parseInt(process.env.OM_PUSH_STUCK_RECLAIM_BATCH_LIMIT ?? '', 10)
  return Number.isFinite(raw) && raw >= MIN_RECLAIM_BATCH_LIMIT ? raw : DEFAULT_RECLAIM_BATCH_LIMIT
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
  const stuck = await em.find(
    PushNotificationDelivery,
    {
      tenantId: scope.tenantId,
      status: { $in: ['sending', 'pending'] },
      updatedAt: { $lt: cutoff },
    },
    { limit: resolveReclaimBatchLimit(), orderBy: { updatedAt: 'asc' } },
  )

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
