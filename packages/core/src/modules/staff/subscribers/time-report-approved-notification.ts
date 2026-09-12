import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { buildNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { notificationTypes } from '../notifications'
import { StaffTimeReport } from '../data/entities'

const logger = createLogger('staff').child({ component: 'subscribers/time-report-approved' })

const NOTIFICATION_TYPE = 'staff.timesheets.time_report.approved'
const REPORTS_LIST_HREF = '/backend/staff/time-tracking/reports'

/**
 * EP-48. Closing a report IS its approval in this module: the close freezes every
 * per-entry rate and amount, locks the entries against further edits, and is
 * gated on `staff.timesheets.lock`. There is no separate "approved" transition to
 * subscribe to, and adding one would be a behaviour change, not an extension
 * point — so this subscribes to the close and announces it to the one person who
 * otherwise finds out by reopening the screen: whoever drafted the report.
 *
 * The closer is deliberately not notified about their own action, and a report
 * with no recorded author is a normal outcome (a seeded or imported report), not
 * an error.
 *
 * `persistent: true` — a report closing is a billing milestone; the alert has to
 * survive a worker restart and be retried, the same reasoning as the budget
 * threshold subscriber next to it.
 */
export const metadata = {
  event: 'staff.timesheets.time_report.closed',
  persistent: true,
  id: 'staff:time-report-approved-notification',
}

export type TimeReportClosedPayload = {
  id?: string | null
  reportId?: string | null
  reference?: string | null
  tenantId?: string | null
  organizationId?: string | null
  closedByUserId?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export function buildTimeReportLinkHref(reportId: string): string {
  return `${REPORTS_LIST_HREF}/${encodeURIComponent(reportId)}`
}

/** One item per report, so a re-close after an unlock refreshes rather than stacks. */
export function buildTimeReportApprovedGroupKey(reportId: string): string {
  return `staff:time-report-approved:${reportId}`
}

function readId(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const trimmed = candidate.trim()
    if (trimmed.length > 0) return trimmed
  }
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

    const typeDef = notificationTypes.find((entry) => entry.type === NOTIFICATION_TYPE)
    if (!typeDef) return

    const em = ctx.resolve<EntityManager>('em').fork()
    const scope = { tenantId, organizationId }
    const report = await findOneWithDecryption(
      em,
      StaffTimeReport,
      { id: reportId, tenantId, organizationId, deletedAt: null },
      {},
      scope,
    )
    if (!report) return

    const recipientUserId = readId(report.createdByUserId)
    if (!recipientUserId) return
    if (recipientUserId === readId(report.closedByUserId, payload?.closedByUserId)) return

    const notificationService = resolveNotificationService(ctx)
    await notificationService.create(
      buildNotificationFromType(typeDef, {
        recipientUserId,
        bodyVariables: {
          reference: report.reference,
          title: report.title,
        },
        sourceEntityType: 'staff:time_report',
        sourceEntityId: report.id,
        linkHref: buildTimeReportLinkHref(report.id),
        groupKey: buildTimeReportApprovedGroupKey(report.id),
      }),
      scope,
    )
  } catch (err) {
    logger.error('Failed to raise the time report approved notification', {
      subscriber: metadata.id,
      err,
    })
  }
}
