import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import {
  buildNotificationFromType,
  buildRoleNotificationFromType,
} from '../../notifications/lib/notificationBuilder'
import { notificationTypes } from '../notifications'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

export const metadata = {
  event: 'workflows.task.assigned',
  persistent: true,
  id: 'workflows:task-assigned-notification',
}

type TaskAssignedPayload = {
  taskId: string
  taskName: string
  workflowName: string
  assignedUserId?: string | null
  assignedToRoles?: string[] | null
  dueDate?: string | null
  tenantId: string
  organizationId?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

/**
 * `UserTask.assignedToRoles` stores role NAMES (that is what the Studio's role
 * picker and the task API's `myTasks` filter both speak), while the
 * notification service addresses a role by id. Resolve the names against the
 * caller's tenant so a role name from another tenant can never widen delivery.
 */
async function resolveRoleIdsByName(
  ctx: ResolverContext,
  tenantId: string,
  roleNames: string[]
): Promise<string[]> {
  const rootEm = ctx.resolve<EntityManager>('em')
  const em = rootEm.fork()
  const { findWithDecryption } = await import('@open-mercato/shared/lib/encryption/find')
  const { Role } = await import('../../auth/data/entities')

  const roles = await findWithDecryption(
    em,
    Role,
    { name: { $in: roleNames }, tenantId, deletedAt: null },
    {},
    { tenantId }
  )

  return roles
    .map((role) => role.id)
    .filter((roleId): roleId is string => typeof roleId === 'string' && roleId.length > 0)
}

export default async function handle(payload: TaskAssignedPayload, ctx: ResolverContext) {
  if (!payload?.taskId || !payload?.tenantId) return

  const assignedToRoles = Array.isArray(payload.assignedToRoles)
    ? payload.assignedToRoles.filter((role) => typeof role === 'string' && role.length > 0)
    : []

  if (!payload.assignedUserId && assignedToRoles.length === 0) return

  try {
    const notificationService = resolveNotificationService(ctx)
    const typeDef = notificationTypes.find((type) => type.type === 'workflows.task.assigned')
    if (!typeDef) return

    const scope = {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    }

    // The same task reaching the same recipient twice (a reassignment, a retried
    // delivery) refreshes one row in place instead of stacking duplicates.
    const content = {
      bodyVariables: {
        taskName: payload.taskName,
        workflowName: payload.workflowName,
        dueDate: payload.dueDate ?? '',
      },
      sourceEntityType: 'workflows:user_task',
      sourceEntityId: payload.taskId,
      linkHref: `/backend/tasks/${payload.taskId}`,
      groupKey: `workflows:user_task:${payload.taskId}`,
    }

    if (payload.assignedUserId) {
      await notificationService.create(
        buildNotificationFromType(typeDef, { ...content, recipientUserId: payload.assignedUserId }),
        scope
      )
      return
    }

    const roleIds = await resolveRoleIdsByName(ctx, payload.tenantId, assignedToRoles)
    if (roleIds.length === 0) {
      logger.warn('Task assigned to roles that resolve to no role in this tenant', {
        component: 'task-assigned-notification',
        taskId: payload.taskId,
      })
      return
    }

    for (const roleId of roleIds) {
      await notificationService.createForRole(
        buildRoleNotificationFromType(typeDef, { ...content, roleId }),
        scope
      )
    }
  } catch (err) {
    logger.error('Failed to create notification', { component: 'task-assigned-notification', err })
  }
}
