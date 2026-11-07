import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CheckoutSessionStatus } from '../data/entities'

/**
 * Allowed status transitions for a `CheckoutSession` (§4.1, §6, §7.2, §8.2, §9.0, §12).
 *
 * This Step (2.12, B.1) ships the SKELETON only: the entity, the enum and this legal-
 * transition table, enforced by a row-level CAS (`transitionCheckoutSessionStatus`,
 * mirroring `checkout.transaction.updateStatus`'s own `VALID_CHECKOUT_TRANSITIONS` /
 * `nativeUpdate ... WHERE status = <from>` pattern, §11's own text: "the same CAS pattern
 * applied to the new entity"). No submit business logic (Steps 2.13/3.5/4.1/4.2) runs any
 * of the `submitting`/`awaiting_payment` transitions yet — only `open -> canceled` (the
 * cancel route and the "one live session per cart" supersede rule) and the job-driven
 * `open -> expired` / `awaiting_approval -> expired` paths are reachable from code this
 * Step ships. The remaining rows exist so later Steps build on an already-tested guard
 * instead of inventing their own.
 *
 * The table is this Step's own synthesis of the spec's narrative (no explicit adjacency
 * table exists in the spec text) — see `NOTIFY.md` for the exact reasoning per row:
 *
 *   open              -> awaiting_approval (request-approval, §8.2)
 *   open              -> submitting        (submit begins, §7.2 step 0 CAS)
 *   open              -> canceled           (cancel route, §9.0; "one live session per cart")
 *   open              -> expired            (expire-checkout-sessions job, §12)
 *   awaiting_approval -> open               (approved / expired / withdrawn, §8.2)
 *   awaiting_approval -> failed             (rejected, §8.2)
 *   awaiting_approval -> canceled           ("one live session per cart" supersede, §9.0)
 *   awaiting_approval -> expired            (expire-checkout-sessions job, §12)
 *   submitting        -> awaiting_payment   (§7.2 step 7, gateway)
 *   submitting        -> completed          (quote outcome or on-account order outcome)
 *   submitting        -> failed             (an aborted/compensated attempt)
 *   submitting        -> open               (recovery resumes an unrecoverable attempt, §12.1)
 *   awaiting_payment  -> completed          (§7.2 step 7 success)
 *   awaiting_payment  -> failed             (expire-awaiting-payment / payment failure, §12)
 *   completed         -> (terminal)
 *   failed            -> (terminal)
 *   canceled          -> (terminal)
 *   expired           -> (terminal)
 */
export const VALID_CHECKOUT_SESSION_TRANSITIONS: Record<CheckoutSessionStatus, CheckoutSessionStatus[]> = {
  open: ['awaiting_approval', 'submitting', 'canceled', 'expired'],
  awaiting_approval: ['open', 'failed', 'canceled', 'expired'],
  submitting: ['awaiting_payment', 'completed', 'failed', 'open'],
  awaiting_payment: ['completed', 'failed'],
  completed: [],
  failed: [],
  canceled: [],
  expired: [],
}

/** Same-state transitions are allowed as safe no-ops to support idempotency. */
export function isValidCheckoutSessionTransition(
  from: CheckoutSessionStatus,
  to: CheckoutSessionStatus,
): boolean {
  if (from === to) return true
  const allowed = VALID_CHECKOUT_SESSION_TRANSITIONS[from]
  if (!allowed) return false
  return allowed.includes(to)
}

/**
 * Throws a structured `409` when the requested transition is not in the legal-transition
 * table. Callers pair this with the atomic `nativeUpdate` CAS (`WHERE status = from`) —
 * this assertion is the human-readable guard, the `nativeUpdate` is the TOCTOU-safe one.
 */
export function assertValidCheckoutSessionTransition(
  from: CheckoutSessionStatus,
  to: CheckoutSessionStatus,
): void {
  if (isValidCheckoutSessionTransition(from, to)) return
  throw new CrudHttpError(409, {
    error: `[internal] Cannot transition checkout session from "${from}" to "${to}"`,
    code: 'invalid_session_transition',
    currentStatus: from,
    requestedStatus: to,
  })
}
