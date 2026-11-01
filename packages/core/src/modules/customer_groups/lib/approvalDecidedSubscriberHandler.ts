import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { sendApprovalDecidedRequesterEmail } from './approvalEmails'

const logger = createLogger('customer_groups')

// Release 5 Phase 4 (G15, D-R5-6, §10.2, Step 2.7). Shared by the three thin
// `.approved`/`.rejected`/`.expired` subscriber files — one event id per subscriber
// file (the `events` module's registry contract), so the common payload parsing and
// the e-mail call live here once rather than three times. `.withdrawn` is NOT one of
// these three: the spec's own e-mail trigger table never names it (`lib/
// approvalEmails.ts`'s own comment).
export type ApprovalDecidedStatus = 'approved' | 'rejected' | 'expired'

export type SubscriberContext = {
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

export function createApprovalDecidedHandler(status: ApprovalDecidedStatus, subscriberId: string) {
  return async function handle(payload: unknown, ctx: SubscriberContext): Promise<void> {
    const record = toRecord(payload)
    const approvalId = readString(record, 'approvalId')
    const amountGross = readString(record, 'amountGross') ?? ''
    const currencyCode = readString(record, 'currencyCode') ?? ''
    const tenantId = readString(record, 'tenantId') ?? ctx.tenantId ?? null
    const organizationId = readString(record, 'organizationId') ?? ctx.organizationId ?? null
    const requestedBy = readRequestedBy(record)

    if (!approvalId || !tenantId || !organizationId || !requestedBy) {
      logger.debug(`[${subscriberId}] skipped incomplete payload`, {
        hasApprovalId: Boolean(approvalId),
        hasTenantId: Boolean(tenantId),
        hasOrganizationId: Boolean(organizationId),
        hasRequestedBy: Boolean(requestedBy),
      })
      return
    }

    const container = ctx.container ?? { resolve: ctx.resolve }
    try {
      const em = container.resolve<EntityManager>('em').fork()
      await sendApprovalDecidedRequesterEmail(em, container, {
        tenantId,
        organizationId,
        approvalId,
        amountGross,
        currencyCode,
        status,
        requestedBy,
      })
    } catch (err) {
      logger.warn(`[${subscriberId}] requester e-mail failed`, { err })
    }
  }
}
