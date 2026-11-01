import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CheckoutSession } from '../data/entities'
import { writeSessionEvent } from './sessionEvents'
import { emitCheckoutEvent } from '../events'

const logger = createLogger('checkout')

export type CheckoutApprovalResumeOutcome = 'approved' | 'rejected' | 'expired' | 'withdrawn'

export type CheckoutApprovalResumeSubscriberContext = {
  resolve: <T = unknown>(name: string) => T
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

// Release 5, Step 5.2 (C11, §8.2 step 3) — shared by the four thin `.approved`/
// `.rejected`/`.expired`/`.withdrawn` subscriber files (one event id per subscriber file,
// the `events` module's registry contract — mirrors `cart/lib/approvalDecidedSubscriber.ts`'s
// identical shape for its own four-subscriber family).
//
// §8.2 step 3, read literally: "A checkout subscriber on `customer_groups.approval.approved
// | rejected | expired | withdrawn` with `subjectType = 'cart'` finds the live session in
// `awaiting_approval` for that cart in the event's tenant and organization:
//   - `approved` → `open`, `quoted_totals` cleared so review re-evaluates; emits
//     `checkout.session.approval_approved`;
//   - `rejected` → `failed`, `failure_code = 'approval_rejected'`; emits
//     `checkout.session.approval_rejected`;
//   - `expired` / `withdrawn` → `open` (the buyer may request again or reduce the cart);
//     emits `checkout.session.approval_rejected` with the outcome in the payload.
// No live session (expired, canceled, superseded) → the event is ignored."
//
// Checkout stores no `approval_id` on the session (§8.2's own opening line: "Checkout
// creates no approval and stores no approval id") — matching by `cartId` + `status =
// 'awaiting_approval'` is therefore the spec's own, sole mechanism, not a shortcut; the
// CAS `WHERE status = 'awaiting_approval'` below is what makes a redelivered or
// out-of-order event a safe no-op (zero rows matched) rather than a double transition.
export function createCheckoutApprovalResumeHandler(
  subscriberId: string,
  outcome: CheckoutApprovalResumeOutcome,
) {
  return async function handle(
    payload: unknown,
    ctx: CheckoutApprovalResumeSubscriberContext,
  ): Promise<void> {
    const record = toRecord(payload)
    // `customer_groups` emits this event family for `subject_type: 'quote'` too (reserved,
    // unreachable in Release 5, §9a.6-equivalent) — never touch those.
    const subjectType = readString(record, 'subjectType')
    if (subjectType !== 'cart') return

    const cartId = readString(record, 'subjectId')
    const approvalId = readString(record, 'approvalId')
    const tenantId = readString(record, 'tenantId')
    const organizationId = readString(record, 'organizationId')
    const outcomeDetail = readString(record, 'status') ?? outcome

    if (!cartId || !tenantId || !organizationId) {
      logger.debug(`[${subscriberId}] skipped incomplete payload`, {
        hasCartId: Boolean(cartId),
        hasTenantId: Boolean(tenantId),
        hasOrganizationId: Boolean(organizationId),
      })
      return
    }

    try {
      const em = ctx.resolve<EntityManager>('em').fork()
      const sessions = await em.find(CheckoutSession, {
        cartId,
        tenantId,
        organizationId,
        status: 'awaiting_approval',
      } as any)
      if (sessions.length === 0) return

      const eventId = outcome === 'approved'
        ? 'checkout.session.approval_approved'
        : 'checkout.session.approval_rejected'

      for (const session of sessions) {
        const affected = await em.nativeUpdate(
          CheckoutSession,
          { id: session.id, tenantId, organizationId, status: 'awaiting_approval' },
          outcome === 'approved'
            ? { status: 'open', quotedTotals: null, updatedAt: new Date() }
            : outcome === 'rejected'
              ? { status: 'failed', failureCode: 'approval_rejected', updatedAt: new Date() }
              : { status: 'open', updatedAt: new Date() },
        )
        // Raced with a cancel/expiry/another resume between `em.find` and this CAS — "the
        // event is ignored" for this row, same tolerance `cart`'s own sibling subscriber
        // and `supersedeOpenSessionsForCart` already apply to a WHERE that matches zero.
        if (affected === 0) continue

        await writeSessionEvent(em, {
          tenantId,
          organizationId,
          sessionId: session.id,
          kind: 'approval_state',
          actor: 'system',
          payload: { approvalId, outcome: outcomeDetail },
        })

        await emitCheckoutEvent(eventId, {
          sessionId: session.id,
          tenantId,
          organizationId,
          cartId,
          approvalId,
          outcome: outcomeDetail,
        }).catch(() => undefined)
      }
    } catch (err) {
      logger.warn(`[${subscriberId}] failed to resume checkout session`, { err, cartId, approvalId })
    }
  }
}
