import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { NotificationSeverity } from '@open-mercato/shared/modules/notifications/types'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import {
  buildFeatureNotificationFromType,
  buildNotificationFromType,
} from '../../notifications/lib/notificationBuilder'
import { notificationTypes } from '../notifications'
import { emitStaffEvent } from '../events'
import { MANAGE_PROJECTS_FEATURE } from '../lib/time-tracking/access'
import { computeProjectFinancials } from '../lib/timesheets-projects/computeProjectFinancials'
import { FULL_BUDGET_PERCENT, evaluateBudgetThreshold } from '../lib/timesheets-projects/budgetThreshold'
import {
  claimBudgetThresholdAlert,
  loadTimeProjectBudgetStateForEntry,
} from '../lib/timesheets-projects/budgetThresholdState'

const logger = createLogger('staff').child({ component: 'subscribers/time-project-budget-threshold' })

const NOTIFICATION_TYPE = 'staff.timesheets.time_project.budget_threshold_reached'
const PROJECTS_LIST_HREF = '/backend/staff/time-tracking/projects'

/**
 * Every write that can move a project's logged minutes or cost travels as a
 * `staff.timesheets.time_entry.*` event — create, update, delete (soft), the bulk
 * route and both timer transitions all emit through the same CRUD event config with
 * the same `{ id, tenantId, organizationId }` payload. Subscribing to the family
 * rather than three exact ids is what keeps a future write path from silently
 * skipping the budget check.
 *
 * `persistent: true`: this ends in a user-visible alert about money and hours
 * already spent. It has to survive a worker restart and be retried on failure — an
 * ephemeral subscription would drop the alert whenever the process handling the
 * entry write went away, and nothing would ever raise it again.
 */
export const metadata = {
  event: 'staff.timesheets.time_entry.*',
  persistent: true,
  id: 'staff:time-project-budget-threshold-notification',
}

export type TimeEntryWritePayload = {
  id?: string | null
  tenantId?: string | null
  organizationId?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export function buildBudgetThresholdLinkHref(timeProjectId: string): string {
  return `${PROJECTS_LIST_HREF}/${encodeURIComponent(timeProjectId)}`
}

/**
 * One group key per project AND threshold, so the 80% alert and the 100% alert are
 * two separate items in the bell, while a retry of the same crossing refreshes the
 * existing item instead of stacking a duplicate.
 */
export function buildBudgetThresholdGroupKey(input: {
  timeProjectId: string
  thresholdPercent: number
}): string {
  return `staff:time-project-budget:${input.timeProjectId}:${input.thresholdPercent}`
}

export function resolveBudgetThresholdSeverity(thresholdPercent: number): NotificationSeverity {
  return thresholdPercent >= FULL_BUDGET_PERCENT ? 'error' : 'warning'
}

export default async function handle(payload: TimeEntryWritePayload, ctx: ResolverContext) {
  try {
    const timeEntryId = payload?.id ?? null
    const tenantId = payload?.tenantId ?? null
    const organizationId = payload?.organizationId ?? null
    if (!timeEntryId || !tenantId || !organizationId) return

    const typeDef = notificationTypes.find((type) => type.type === NOTIFICATION_TYPE)
    if (!typeDef) return

    const em = (ctx.resolve('em') as EntityManager).fork()
    const project = await loadTimeProjectBudgetStateForEntry({ em, tenantId, organizationId, timeEntryId })
    if (!project) return
    // A project without a budget never notifies. It is also the common case, so it
    // exits before the aggregate query — unless a stale marker from a budget that
    // has since been switched off still needs clearing.
    if (project.budgetKind === 'none' && project.budgetAlertedAtPercent === null) return

    const financials = await computeProjectFinancials({
      em,
      tenantId,
      organizationId,
      projectIds: [project.timeProjectId],
      hourlyRateByProjectId: new Map([[project.timeProjectId, project.hourlyRate]]),
    })
    const totals = financials.get(project.timeProjectId)

    const evaluation = evaluateBudgetThreshold({
      budgetKind: project.budgetKind,
      budgetValue: project.budgetValue,
      budgetWarnAtPercent: project.budgetWarnAtPercent,
      budgetAlertedAtPercent: project.budgetAlertedAtPercent,
      totalMinutes: totals?.totalMinutes ?? 0,
      cost: totals?.cost ?? null,
      currencyCode: project.currencyCode,
    })

    if (!evaluation.shouldPersistAlertedAt) return

    // Compare-and-swap on the marker: the loser of a race between two concurrent
    // entry writes stops here, so a threshold is announced exactly once. The marker
    // is written before the alert, which makes this at-most-once by design — a
    // repeated alert about the same crossing is worse than a missed retry.
    const claimed = await claimBudgetThresholdAlert({
      em,
      tenantId,
      organizationId,
      timeProjectId: project.timeProjectId,
      expectedAlertedAtPercent: project.budgetAlertedAtPercent,
      nextAlertedAtPercent: evaluation.nextAlertedAtPercent,
    })
    if (!claimed) return

    const thresholdPercent = evaluation.crossedThresholdPercent
    // The marker moved down (usage fell back under the band it was raised for) or
    // the budget was switched off. Nothing to announce; the reset is the point.
    if (thresholdPercent === null) return

    await emitStaffEvent(
      'staff.timesheets.time_project.budget_threshold_reached',
      {
        id: project.timeProjectId,
        timeProjectId: project.timeProjectId,
        tenantId,
        organizationId,
        thresholdPercent,
        percent: evaluation.percent,
        budgetKind: evaluation.kind,
        budgetValue: evaluation.budgetValue,
        usedValue: evaluation.usedValue,
      },
      { persistent: true },
    )

    const notificationService = resolveNotificationService(ctx)
    const scope = { tenantId, organizationId }
    const severity = resolveBudgetThresholdSeverity(thresholdPercent)
    const commonOptions = {
      bodyVariables: {
        projectName: project.name || project.timeProjectId,
        percent: String(evaluation.percent ?? 0),
        thresholdPercent: String(thresholdPercent),
      },
      sourceEntityType: 'staff:time_project',
      sourceEntityId: project.timeProjectId,
      linkHref: buildBudgetThresholdLinkHref(project.timeProjectId),
      groupKey: buildBudgetThresholdGroupKey({ timeProjectId: project.timeProjectId, thresholdPercent }),
    }

    // Manage-feature holders are resolved through the notification service's feature
    // fan-out, which matches grants with the shared feature policy — a `staff.*`
    // wildcard counts — and then re-checks each candidate against this organization
    // through the RBAC service.
    const featureNotifications = await notificationService.createForFeature(
      {
        ...buildFeatureNotificationFromType(typeDef, {
          ...commonOptions,
          requiredFeature: MANAGE_PROJECTS_FEATURE,
        }),
        severity,
        restrictRecipientsToOrganization: true,
      },
      scope,
    )

    const ownerUserId = project.ownerUserId
    if (!ownerUserId) return
    const ownerAlreadyNotified = featureNotifications.some(
      (notification) => notification?.recipientUserId === ownerUserId,
    )
    if (ownerAlreadyNotified) return

    // The owner is notified even without the manage feature — it is their project's
    // budget. An owner who has left the scope is not an error worth failing on.
    try {
      await notificationService.create(
        {
          ...buildNotificationFromType(typeDef, { ...commonOptions, recipientUserId: ownerUserId }),
          severity,
        },
        scope,
      )
    } catch (err) {
      logger.warn('Skipped the budget threshold notification for an out-of-scope project owner', {
        subscriber: metadata.id,
        timeProjectId: project.timeProjectId,
        err,
      })
    }
  } catch (err) {
    logger.error('Failed to evaluate the time project budget threshold', {
      subscriber: metadata.id,
      err,
    })
  }
}
