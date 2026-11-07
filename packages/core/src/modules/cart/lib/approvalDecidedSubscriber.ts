import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { Cart } from '../data/entities'

const logger = createLogger('cart')

// Step 3.2 (K5, §9a.5) — shared by the four thin `.approved`/`.rejected`/`.expired`/
// `.withdrawn` subscriber files (one event id per subscriber file, the `events` module's
// registry contract — mirrors `customer_groups/lib/approvalDecidedSubscriberHandler.ts`'s
// identical shape for its own three-subscriber family).
//
// §9a.5's own text, read literally: "When the cart's `approval_id` equals the event's
// `approvalId`, it clears `awaiting_approval_since`; otherwise it does nothing. It changes
// no other column and emits nothing." The lifecycle table in §9a.4 repeats this precisely
// ("Approval decided or expired in `customer_groups` | §9a.5 subscriber clears
// `awaiting_approval_since`; `approval_id` is unchanged") — for EVERY one of the four
// terminal events, including `.rejected`/`.expired`/`.withdrawn`, never only `.approved`.
// `Cart.approvalId` is deliberately left untouched here: an older rejected/withdrawn/
// expired approval stays the cart's `approval_id` until a fresh `cart.approval.request`
// call moves the pointer (§9a.4: "Only one approval is authoritative... An older approved
// approval that still names this cart as its subject is never read"), so `CartView.approval`
// can still show the final status of the last request the buyer made, through
// `customerPurchaseApprovalService.getApproval` — it does not need `approval_id` cleared to
// do that.
export type ApprovalSubscriberContext = {
  resolve: <T = unknown>(name: string) => T
  container?: { resolve: <T = unknown>(name: string) => T }
  tenantId?: string | null
  organizationId?: string | null
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export function createCartApprovalDecidedHandler(subscriberId: string) {
  return async function handle(payload: unknown, ctx: ApprovalSubscriberContext): Promise<void> {
    const record = toRecord(payload)
    // Filters on `subjectType = 'cart'` first (§9a.5's own text) — `customer_groups` also
    // emits this event family for `subject_type: 'quote'` (reserved, unreachable in
    // Release 5, §9a.6), which this handler must never touch.
    const subjectType = readString(record, 'subjectType')
    if (subjectType !== 'cart') return

    const subjectId = readString(record, 'subjectId')
    const approvalId = readString(record, 'approvalId')
    const tenantId = readString(record, 'tenantId') ?? ctx.tenantId ?? null
    const organizationId = readString(record, 'organizationId') ?? ctx.organizationId ?? null

    if (!subjectId || !approvalId || !tenantId || !organizationId) {
      logger.debug(`[${subscriberId}] skipped incomplete payload`, {
        hasSubjectId: Boolean(subjectId),
        hasApprovalId: Boolean(approvalId),
        hasTenantId: Boolean(tenantId),
        hasOrganizationId: Boolean(organizationId),
      })
      return
    }

    const container = ctx.container ?? { resolve: ctx.resolve }
    try {
      const em = container.resolve<EntityManager>('em').fork()
      // The WHERE's `approvalId` equality IS the "otherwise it does nothing" branch — a
      // cart that has since moved its `approval_id` to a newer request (or already had
      // `awaiting_approval_since` cleared) simply matches zero rows.
      await em.nativeUpdate(
        Cart,
        { id: subjectId, tenantId, organizationId, approvalId },
        { awaitingApprovalSince: null, updatedAt: new Date() },
      )
    } catch (err) {
      logger.warn(`[${subscriberId}] failed to clear awaiting_approval_since`, { err, subjectId, approvalId })
    }
  }
}
