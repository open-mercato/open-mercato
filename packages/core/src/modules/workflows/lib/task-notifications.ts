/**
 * Delivering a task notification to whoever the task actually names.
 *
 * One place, three subscribers: assignment, reminder and deadline breach all
 * address the same audience — the individual assignee when there is one, and
 * otherwise every member of the authored role queue. Keeping the recipient
 * resolution here is what stops a reminder from reaching a narrower audience
 * than the assignment did.
 *
 * The caller supplies the `groupKey` so a retried delivery refreshes one row in
 * place. Assignment keeps its historic bare `workflows:user_task:<id>` key;
 * reminder and breach suffix the type, so a reminder never overwrites the
 * assignment it is reminding about.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import {
  buildNotificationFromType,
  buildRoleNotificationFromType,
} from '../../notifications/lib/notificationBuilder'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

export interface TaskNotificationResolverContext {
  resolve: <T = unknown>(name: string) => T
}

export interface TaskNotificationRecipients {
  assignedUserId?: string | null
  assignedToRoles?: string[] | null
}

export interface TaskNotificationContent {
  taskId: string
  tenantId: string
  organizationId?: string | null
  bodyVariables: Record<string, string>
  groupKey: string
  /** Overrides the type definition's static actions when the caller computed them per task. */
  actions?: NotificationTypeDefinition['actions']
  primaryActionId?: string
}

export const TASK_NOTIFICATION_SOURCE_ENTITY_TYPE = 'workflows:user_task'

export function buildTaskDeepLink(taskId: string): string {
  return `/backend/tasks/${taskId}`
}

/** Historic key for the assignment notification; kept byte-identical. */
export function buildTaskNotificationGroupKey(taskId: string, notificationType?: string): string {
  const base = `${TASK_NOTIFICATION_SOURCE_ENTITY_TYPE}:${taskId}`
  return notificationType ? `${base}:${notificationType}` : base
}

/**
 * `UserTask.assignedToRoles` stores role NAMES (that is what the Studio's role
 * picker and the task API's `myTasks` filter both speak), while the
 * notification service addresses a role by id. Resolve the names against the
 * caller's tenant so a role name from another tenant can never widen delivery.
 */
export async function resolveRoleIdsByName(
  ctx: TaskNotificationResolverContext,
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

export function normalizeAssignedRoles(roles: unknown): string[] {
  return Array.isArray(roles)
    ? roles.filter((role): role is string => typeof role === 'string' && role.length > 0)
    : []
}

/**
 * Create the notification for one task event, addressed to the assignee or to
 * the role queue. Best-effort by contract: a delivery failure must never break
 * the workflow engine or the queue job that triggered it.
 */
export async function deliverTaskNotification(
  ctx: TaskNotificationResolverContext,
  typeDef: NotificationTypeDefinition,
  recipients: TaskNotificationRecipients,
  content: TaskNotificationContent,
  component: string
): Promise<void> {
  const assignedToRoles = normalizeAssignedRoles(recipients.assignedToRoles)
  if (!recipients.assignedUserId && assignedToRoles.length === 0) return

  const effectiveTypeDef: NotificationTypeDefinition = content.actions
    ? {
        ...typeDef,
        actions: content.actions,
        ...(content.primaryActionId ? { primaryActionId: content.primaryActionId } : {}),
      }
    : typeDef

  try {
    const notificationService = resolveNotificationService(ctx)
    const scope = {
      tenantId: content.tenantId,
      organizationId: content.organizationId ?? null,
    }

    const common = {
      bodyVariables: content.bodyVariables,
      sourceEntityType: TASK_NOTIFICATION_SOURCE_ENTITY_TYPE,
      sourceEntityId: content.taskId,
      linkHref: buildTaskDeepLink(content.taskId),
      groupKey: content.groupKey,
    }

    if (recipients.assignedUserId) {
      await notificationService.create(
        buildNotificationFromType(effectiveTypeDef, {
          ...common,
          recipientUserId: recipients.assignedUserId,
        }),
        scope
      )
      return
    }

    const roleIds = await resolveRoleIdsByName(ctx, content.tenantId, assignedToRoles)
    if (roleIds.length === 0) {
      logger.warn('Task assigned to roles that resolve to no role in this tenant', {
        component,
        taskId: content.taskId,
      })
      return
    }

    for (const roleId of roleIds) {
      await notificationService.createForRole(
        buildRoleNotificationFromType(effectiveTypeDef, { ...common, roleId }),
        scope
      )
    }
  } catch (err) {
    logger.error('Failed to create notification', { component, err })
  }
}

/**
 * Payload shape shared by every task lifecycle event that produces a
 * notification. The three subscribers differ only in which notification type
 * they name, which is why they route through one function.
 */
export type TaskLifecycleNotificationPayload = {
  taskId: string
  taskName: string
  workflowName: string
  assignedUserId?: string | null
  assignedToRoles?: string[] | null
  dueDate?: string | null
  tenantId: string
  organizationId?: string | null
}

export async function notifyTaskLifecycleEvent(options: {
  ctx: TaskNotificationResolverContext
  notificationTypes: NotificationTypeDefinition[]
  notificationType: string
  payload: TaskLifecycleNotificationPayload
  /** Omit to reuse the historic bare group key (assignment only). */
  groupByType?: boolean
  actions?: NotificationTypeDefinition['actions']
  primaryActionId?: string
  component: string
}): Promise<void> {
  const { ctx, payload, notificationType, component } = options
  if (!payload?.taskId || !payload?.tenantId) return

  const typeDef = options.notificationTypes.find((type) => type.type === notificationType)
  if (!typeDef) return

  await deliverTaskNotification(
    ctx,
    typeDef,
    { assignedUserId: payload.assignedUserId, assignedToRoles: payload.assignedToRoles },
    {
      taskId: payload.taskId,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
      bodyVariables: {
        taskName: payload.taskName,
        workflowName: payload.workflowName,
        dueDate: payload.dueDate ?? '',
      },
      groupKey: buildTaskNotificationGroupKey(
        payload.taskId,
        options.groupByType ? notificationType : undefined
      ),
      ...(options.actions ? { actions: options.actions } : {}),
      ...(options.primaryActionId ? { primaryActionId: options.primaryActionId } : {}),
    },
    component
  )
}
