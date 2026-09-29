import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CheckoutTransaction } from '../data/entities'

/**
 * Allowed status transitions for a CheckoutTransaction.
 *
 * Terminal states (completed, failed, cancelled, expired) have an empty
 * allowed-set, meaning NO transition out of them is permitted.  This prevents
 * the race condition where the submit route's late `updateStatus('processing')`
 * call overwrites a `'completed'` status that the gateway webhook set first.
 *
 * Allowed path:
 *   pending     ──► processing  (transaction created, payment session initiated)
 *   pending     ──► completed   (captured webhook arrives before processing state)
 *   processing  ──► completed   (webhook: payment captured)
 *   processing  ──► failed      (webhook or session error)
 *   processing  ──► cancelled   (customer or merchant cancellation)
 *   processing  ──► expired     (expiry worker)
 *
 * Rejected (regression guard):
 *   completed ──► *   REJECTED
 *   failed    ──► *   REJECTED
 *   cancelled ──► *   REJECTED
 *   expired   ──► *   REJECTED
 */
export const VALID_CHECKOUT_TRANSITIONS: Record<CheckoutTransaction['status'], CheckoutTransaction['status'][]> = {
  pending: ['processing', 'completed', 'failed', 'cancelled', 'expired'],
  processing: ['completed', 'failed', 'cancelled', 'expired'],
  // Terminal states — no transitions out
  completed: [],
  failed: [],
  cancelled: [],
  expired: [],
}

/**
 * Returns `true` when transitioning from `from` to `to` is allowed by the
 * state machine. Same-state transitions are allowed as safe no-ops to support
 * idempotency.
 */
export function isValidCheckoutStatusTransition(
  from: CheckoutTransaction['status'],
  to: CheckoutTransaction['status'],
): boolean {
  if (from === to) return true
  const allowed = VALID_CHECKOUT_TRANSITIONS[from]
  if (!allowed) return false
  return allowed.includes(to)
}

/**
 * Throws a structured 409 Conflict when the requested status transition is
 * not allowed by the state machine.  The error body is compatible with the
 * `conflict` error shape that the frontend handles.
 *
 * This must be called **inside** a database transaction so that the check and
 * the subsequent write are atomic.  The atomic `nativeUpdate` WHERE-clause
 * provides the TOCTOU safety net; this function is the human-readable guard.
 */
export function assertValidCheckoutStatusTransition(
  from: CheckoutTransaction['status'],
  to: CheckoutTransaction['status'],
): void {
  if (isValidCheckoutStatusTransition(from, to)) return
  throw new CrudHttpError(409, {
    error: `[internal] Cannot transition payment from "${from}" to "${to}"`,
    code: 'invalid_status_transition',
    currentStatus: from,
    requestedStatus: to,
  })
}
