import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { buildNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { notificationTypes } from '../notifications'

export const metadata = {
  event: 'workflows.task.assigned',
  persistent: true,
  id: 'workflows:task-assigned-notification',
}

type TaskAssignedPayload = {
  taskId: string
  taskName: string
  workflowName: string
  assignedUserId: string
  dueDate?: string | null
  tenantId: string
  organizationId?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(payload: TaskAssignedPayload, ctx: ResolverContext) {
  if (!payload.assignedUserId) return

  try {
    const notificationService = resolveNotificationService(ctx)
    const typeDef = notificationTypes.find((type) => type.type === 'workflows.task.assigned')
    if (!typeDef) return

    const notificationInput = buildNotificationFromType(typeDef, {
      recipientUserId: payload.assignedUserId,
      bodyVariables: {
        taskName: payload.taskName,
        workflowName: payload.workflowName,
        dueDate: payload.dueDate ?? '',
      },
      sourceEntityType: 'workflows:user_task',
      sourceEntityId: payload.taskId,
      linkHref: `/backend/workflows/tasks/${payload.taskId}`,
    })

    await notificationService.create(notificationInput, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  } catch (err) {
    console.error('[workflows:task-assigned-notification] Failed to create notification:', err)
  }
}
