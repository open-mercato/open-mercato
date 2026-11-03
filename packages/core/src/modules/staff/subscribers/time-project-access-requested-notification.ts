import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { notificationTypes } from '../notifications'
import { MANAGE_PROJECTS_FEATURE } from '../lib/time-tracking/access'

const logger = createLogger('staff').child({ component: 'subscribers/time-project-access-requested' })

const NOTIFICATION_TYPE = 'staff.timesheets.project_access.requested'
const PROJECTS_LIST_HREF = '/backend/staff/time-tracking/projects'

export const metadata = {
  event: 'staff.timesheets.project_access.requested',
  persistent: true,
  id: 'staff:time-project-access-requested-notification',
}

export type ProjectAccessRequestedPayload = {
  tenantId: string
  organizationId?: string | null
  requesterUserId: string
  requesterName?: string | null
  timeProjectId?: string | null
  timeProjectName?: string | null
  requestedAt?: string
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

/**
 * Spec D-6: the notification action opens the project team drawer with the
 * requester pre-selected, so a Team Leader grants access without hunting for
 * the row. A general request carries no project, so it lands on the list.
 */
export function buildProjectAccessRequestLinkHref(input: {
  requesterUserId: string
  timeProjectId?: string | null
}): string {
  if (!input.timeProjectId) return PROJECTS_LIST_HREF
  const projectSegment = encodeURIComponent(input.timeProjectId)
  const requesterParam = encodeURIComponent(input.requesterUserId)
  return `${PROJECTS_LIST_HREF}/${projectSegment}?panel=team&requesterUserId=${requesterParam}`
}

export function buildProjectAccessRequestGroupKey(input: {
  requesterUserId: string
  timeProjectId?: string | null
}): string {
  return `staff:time-project-access:${input.requesterUserId}:${input.timeProjectId ?? 'general'}`
}

export default async function handle(payload: ProjectAccessRequestedPayload, ctx: ResolverContext) {
  try {
    if (!payload?.tenantId || !payload?.requesterUserId) return
    const typeDef = notificationTypes.find((type) => type.type === NOTIFICATION_TYPE)
    if (!typeDef) return

    const notificationService = resolveNotificationService(ctx)
    const requesterName = payload.requesterName?.trim() || payload.requesterUserId
    const timeProjectId = payload.timeProjectId ?? null

    const notificationInput = buildFeatureNotificationFromType(typeDef, {
      requiredFeature: MANAGE_PROJECTS_FEATURE,
      bodyVariables: {
        requesterName,
        ...(payload.timeProjectName ? { projectName: payload.timeProjectName } : {}),
      },
      sourceEntityType: 'staff:time_project',
      sourceEntityId: timeProjectId ?? undefined,
      linkHref: buildProjectAccessRequestLinkHref({
        requesterUserId: payload.requesterUserId,
        timeProjectId,
      }),
      groupKey: buildProjectAccessRequestGroupKey({
        requesterUserId: payload.requesterUserId,
        timeProjectId,
      }),
    })

    await notificationService.createForFeature(
      { ...notificationInput, restrictRecipientsToOrganization: true },
      {
        tenantId: payload.tenantId,
        organizationId: payload.organizationId ?? null,
      },
    )
  } catch (err) {
    logger.error('Failed to create the project access request notification', {
      subscriber: metadata.id,
      err,
    })
  }
}
