import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { notifyMerchantDecidersOfApprovalRequested } from '../lib/approvalNotifications'
import { sendApprovalRequestedBuyerEmails } from '../lib/approvalEmails'

const logger = createLogger('customer_groups')

// Release 5 Phase 4 (G15, D-R5-1/D-R5-6/D-R5-32, §10.2, Step 2.7).
// `customer_groups.approval.requested` fans out on TWO disjoint channels depending
// on `approvalPolicy` — in-app to every merchant decider (policy `merchant`/`both`)
// and e-mail to every eligible buyer decider (policy `buyer`/`both`). Both halves
// run from this one subscriber (one event id per subscriber file, per the shared
// `events` module's own registry contract) and fail independently: a failure
// building the in-app fan-out must not block the buyer e-mail, and vice versa.
export const metadata = {
  event: 'customer_groups.approval.requested',
  persistent: true,
  id: 'customer_groups:approval-requested-notification',
}

type SubscriberContext = {
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

function readRequestedBy(record: Record<string, unknown>): { actorType: 'customer_user' | 'staff_user'; actorId: string } | null {
  const requestedBy = toRecord(record.requestedBy)
  const actorType = requestedBy.actorType
  const actorId = requestedBy.actorId
  if ((actorType !== 'customer_user' && actorType !== 'staff_user') || typeof actorId !== 'string' || !actorId) {
    return null
  }
  return { actorType, actorId }
}

function resolveContainer(ctx: SubscriberContext): { resolve: <T = unknown>(name: string) => T } {
  return ctx.container ?? { resolve: ctx.resolve }
}

export default async function handle(payload: unknown, ctx: SubscriberContext): Promise<void> {
  const record = toRecord(payload)
  const approvalId = readString(record, 'approvalId')
  const customerId = readString(record, 'customerId')
  const amountGross = readString(record, 'amountGross') ?? ''
  const currencyCode = readString(record, 'currencyCode') ?? ''
  const approvalPolicy = readString(record, 'approvalPolicy')
  const tenantId = readString(record, 'tenantId') ?? ctx.tenantId ?? null
  const organizationId = readString(record, 'organizationId') ?? ctx.organizationId ?? null
  const requestedBy = readRequestedBy(record)

  if (
    !approvalId ||
    !customerId ||
    !tenantId ||
    !organizationId ||
    !requestedBy ||
    (approvalPolicy !== 'buyer' && approvalPolicy !== 'merchant' && approvalPolicy !== 'both')
  ) {
    logger.debug('[customer_groups:approval-requested-notification] skipped incomplete payload', {
      hasApprovalId: Boolean(approvalId),
      hasCustomerId: Boolean(customerId),
      hasTenantId: Boolean(tenantId),
      hasOrganizationId: Boolean(organizationId),
      hasRequestedBy: Boolean(requestedBy),
      approvalPolicy,
    })
    return
  }

  const container = resolveContainer(ctx)

  if (approvalPolicy === 'merchant' || approvalPolicy === 'both') {
    try {
      await notifyMerchantDecidersOfApprovalRequested(container, { tenantId, organizationId, approvalId, amountGross, currencyCode })
    } catch (err) {
      logger.warn('[customer_groups:approval-requested-notification] merchant decider notification failed', { err })
    }
  }

  if (approvalPolicy === 'buyer' || approvalPolicy === 'both') {
    try {
      const em = container.resolve<EntityManager>('em').fork()
      await sendApprovalRequestedBuyerEmails(em, container, {
        tenantId,
        organizationId,
        approvalId,
        customerId,
        amountGross,
        currencyCode,
        approvalPolicy,
        requestedBy,
      })
    } catch (err) {
      logger.warn('[customer_groups:approval-requested-notification] buyer decider e-mail failed', { err })
    }
  }
}
