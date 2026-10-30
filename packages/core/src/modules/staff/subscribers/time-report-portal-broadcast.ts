import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitStaffEvent } from '../events'
import { StaffTimeReport } from '../data/entities'
import { resolvePortalRecipientUserIds } from '../lib/time-tracking/portalRecipients'

const logger = createLogger('staff').child({ component: 'subscribers/time-report-portal-broadcast' })

/**
 * EP-06 / EP-50. Mirrors a closed report to the customer portal — and is the only
 * emitter of `staff.timesheets.time_report.portal_published`.
 *
 * The glue lives here, in an optional consumer, rather than in the close command,
 * because resolving "which portal users belong to this customer" reads a
 * `customer_accounts` table. As a subscriber it is skippable: if the query fails
 * the recipient list is empty and nothing is emitted, so a deployment without the
 * portal installed behaves exactly as it did before.
 *
 * Two invariants this file exists to hold:
 *
 *  1. **No recipients, no event.** The portal SSE stream falls back to an
 *     organization-wide audience for a payload with no `recipientUserIds`, and one
 *     organization serves many customers. Emitting an unpinned report event would
 *     be a cross-customer disclosure.
 *  2. **No money on the wire.** The payload carries the reference and the period
 *     only. Amounts are gated on `staff.timesheets.rates.view`, which SSE cannot
 *     apply, and a portal user never holds it in any case.
 *
 * `persistent: true`: a client-visible publication should survive a worker restart.
 */
export const metadata = {
  event: 'staff.timesheets.time_report.closed',
  persistent: true,
  id: 'staff:time-report-portal-broadcast',
}

export type TimeReportClosedPayload = {
  id?: string | null
  reportId?: string | null
  tenantId?: string | null
  organizationId?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

function readId(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const trimmed = candidate.trim()
    if (trimmed.length > 0) return trimmed
  }
  return null
}

function toIsoDate(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return value.toISOString().slice(0, 10)
  }
  if (typeof value === 'string' && value.trim().length > 0) return value.trim().slice(0, 10)
  return null
}

export default async function handle(
  payload: TimeReportClosedPayload,
  ctx: ResolverContext,
): Promise<void> {
  try {
    const reportId = readId(payload?.reportId, payload?.id)
    const tenantId = readId(payload?.tenantId)
    const organizationId = readId(payload?.organizationId)
    if (!reportId || !tenantId || !organizationId) return

    const em = ctx.resolve<EntityManager>('em').fork()
    const report = await findOneWithDecryption(
      em,
      StaffTimeReport,
      { id: reportId, tenantId, organizationId, deletedAt: null },
      {},
      { tenantId, organizationId },
    )
    if (!report || report.status !== 'closed') return

    const customerId = readId(report.customerId)
    if (!customerId) return

    const recipientUserIds = await resolvePortalRecipientUserIds(em, {
      tenantId,
      organizationId,
      customerId,
    })
    if (recipientUserIds.length === 0) return

    const periodFrom = toIsoDate(report.periodFrom)
    const periodTo = toIsoDate(report.periodTo)
    if (!periodFrom || !periodTo) return

    await emitStaffEvent(
      'staff.timesheets.time_report.portal_published',
      {
        id: report.id,
        tenantId,
        organizationId,
        reference: report.reference,
        periodFrom,
        periodTo,
        recipientUserIds,
      },
      { persistent: true },
    )
  } catch (err) {
    logger.error('Failed to publish a closed time report to the customer portal', {
      subscriber: metadata.id,
      err,
    })
  }
}
