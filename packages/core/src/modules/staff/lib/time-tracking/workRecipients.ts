import type { EntityManager } from '@mikro-orm/postgresql'
import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveNotificationService } from '../../../notifications/lib/notificationService'
import {
  buildBatchNotificationFromType,
  buildFeatureNotificationFromType,
} from '../../../notifications/lib/notificationBuilder'
import { StaffTimeProject } from '../../data/entities'
import { loadActiveProjectMembers, type ProjectAssignmentScope } from './projectAssignment'

const logger = createLogger('staff').child({ component: 'lib/time-tracking/workRecipients' })

export const PROJECT_MANAGERS_FEATURE = 'staff.timesheets.projects.manage'

export type WorkRecipientStep = 1 | 2 | 3 | 4

export type ResolvedWorkRecipients =
  | { step: 1 | 2 | 3; userIds: string[] }
  | { step: 4; userIds: [] }

export type WorkRecipientsInput = {
  timeProjectId: string
  /** Step 1: the type's own audience. Empty or omitted starts the chain at step 2. */
  audienceUserIds?: readonly (string | null | undefined)[]
  /** Excluded from steps 1–3. Step 4 hands resolution to `createForFeature`, which cannot exclude a user. */
  actorUserId?: string | null
  graceDays?: number | null
  now?: Date
}

function uniqueExcluding(ids: readonly (string | null | undefined)[], actorUserId: string | null): string[] {
  const seen = new Set<string>()
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0) continue
    if (actorUserId && id === actorUserId) continue
    seen.add(id)
  }
  return [...seen]
}

/**
 * The escalation chain shared by every project-work notification: the type's own
 * audience, then the project's active assigners, then the project owner, then the
 * organization's project managers. Each step is used only when the one before it
 * is empty. Steps 1–3 are resolved here; step 4 is returned as a marker for
 * `notifyProjectWork`, which sends it through `createForFeature`.
 */
export async function resolveProjectWorkRecipients(
  em: EntityManager,
  scope: ProjectAssignmentScope,
  input: WorkRecipientsInput,
): Promise<ResolvedWorkRecipients> {
  const actorUserId = input.actorUserId ?? null
  const audience = uniqueExcluding(input.audienceUserIds ?? [], actorUserId)
  if (audience.length > 0) return { step: 1, userIds: audience }

  const assigners = await loadActiveProjectMembers(em, scope, input.timeProjectId, {
    graceDays: input.graceDays,
    now: input.now,
    assignersOnly: true,
  })
  const assignerUserIds = uniqueExcluding(assigners.map((member) => member.userId), actorUserId)
  if (assignerUserIds.length > 0) return { step: 2, userIds: assignerUserIds }

  const project = await em.findOne(
    StaffTimeProject,
    { id: input.timeProjectId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    { fields: ['id', 'ownerUserId'] },
  )
  const owner = uniqueExcluding([project?.ownerUserId], actorUserId)
  if (owner.length > 0) return { step: 3, userIds: owner }

  return { step: 4, userIds: [] }
}

export type ActiveAssignerUserIdsInput = {
  timeProjectId: string
  graceDays?: number | null
  now?: Date
}

export async function loadActiveAssignerUserIds(
  em: EntityManager,
  scope: ProjectAssignmentScope,
  input: ActiveAssignerUserIdsInput,
): Promise<string[]> {
  const assigners = await loadActiveProjectMembers(em, scope, input.timeProjectId, {
    graceDays: input.graceDays,
    now: input.now,
    assignersOnly: true,
  })
  return uniqueExcluding(assigners.map((member) => member.userId), null)
}

type ContainerLike = { resolve: <T = unknown>(name: string) => T }

export type NotifyProjectWorkOptions = {
  typeDef: NotificationTypeDefinition
  recipients: ResolvedWorkRecipients
  build: {
    titleVariables?: Record<string, string>
    bodyVariables?: Record<string, string>
    sourceEntityType?: string
    sourceEntityId?: string
    linkHref?: string
    groupKey?: string
  }
}

export type NotifyProjectWorkResult = {
  step: WorkRecipientStep
  notifiedCount: number
}

/**
 * Sends one notification to the resolved recipients. Step 4 always passes
 * `restrictRecipientsToOrganization: true`: without it `createForFeature` notifies
 * every holder of the feature in the whole tenant. With the flag on, the service
 * returns no recipients (and logs) when the organization is missing, more than 200
 * tenant-wide candidates hold the feature, the container is unavailable, the RBAC
 * check throws, or nobody in the organization holds it; `notifiedCount` is then 0
 * and the caller decides what "nobody notified" means for its record.
 */
export async function notifyProjectWork(
  container: ContainerLike,
  scope: ProjectAssignmentScope,
  options: NotifyProjectWorkOptions,
): Promise<NotifyProjectWorkResult> {
  const notificationService = resolveNotificationService(container)
  const context = { tenantId: scope.tenantId, organizationId: scope.organizationId }
  const { typeDef, recipients, build } = options
  if (recipients.step === 4) {
    const created = await notificationService.createForFeature(
      {
        ...buildFeatureNotificationFromType(typeDef, { ...build, requiredFeature: PROJECT_MANAGERS_FEATURE }),
        restrictRecipientsToOrganization: true,
      },
      context,
    )
    return { step: 4, notifiedCount: created.length }
  }
  if (recipients.userIds.length === 0) return { step: recipients.step, notifiedCount: 0 }
  try {
    const created = await notificationService.createBatch(
      buildBatchNotificationFromType(typeDef, { ...build, recipientUserIds: recipients.userIds }),
      context,
    )
    return { step: recipients.step, notifiedCount: created.length }
  } catch (err) {
    logger.error('staff project-work notification failed', { err, type: typeDef.type, step: recipients.step })
    return { step: recipients.step, notifiedCount: 0 }
  }
}
