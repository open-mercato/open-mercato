import { buildFeatureNotificationFromType, buildNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { notificationTypes } from '../notifications'

export const metadata = {
  event: 'reference_module.*',
  persistent: true,
  id: 'reference_module:reference-task-notifications',
}

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
  eventName?: string
  tenantId?: string | null
  organizationId?: string | null
}

type SafePayload = {
  id?: string
  jobId?: string
  title?: string
  status?: string
  recipientUserId?: string | null
  succeededCount?: number
  failedCount?: number
  skippedCount?: number
}

export default async function handle(payload: SafePayload, ctx: SubscriberContext): Promise<void> {
  if (!ctx.tenantId || !ctx.organizationId || !ctx.eventName) return
  const service = resolveNotificationService(ctx)
  if (ctx.eventName === 'reference_module.reference_task.updated') {
    if (!payload.id || (payload.status !== 'in_progress' && payload.status !== 'done')) return
    const definition = notificationTypes.find((entry) => entry.type === 'reference_module.reference_task.status_changed')
    if (!definition) return
    const common = {
      bodyVariables: { taskTitle: payload.title ?? '', status: payload.status },
      sourceEntityType: 'reference_module:reference_task',
      sourceEntityId: payload.id,
      linkHref: `/backend/reference_module/tasks/${payload.id}`,
      groupKey: `reference-task:${payload.id}:status:${payload.status}`,
    }
    if (payload.recipientUserId) {
      await service.create(buildNotificationFromType(definition, {
        ...common,
        recipientUserId: payload.recipientUserId,
      }), { tenantId: ctx.tenantId, organizationId: ctx.organizationId })
    } else {
      await service.createForFeature(buildFeatureNotificationFromType(definition, {
        ...common,
        requiredFeature: 'reference_module.view',
      }), { tenantId: ctx.tenantId, organizationId: ctx.organizationId })
    }
    return
  }
  if (ctx.eventName !== 'reference_module.import.completed' || !payload.jobId) return
  const definition = notificationTypes.find((entry) => entry.type === 'reference_module.import.completed')
  if (!definition) return
  const common = {
    bodyVariables: {
      succeededCount: String(payload.succeededCount ?? 0),
      failedCount: String(payload.failedCount ?? 0),
      skippedCount: String(payload.skippedCount ?? 0),
    },
    sourceEntityType: 'progress:job',
    sourceEntityId: payload.jobId,
    groupKey: `reference-import:${payload.jobId}`,
  }
  if (payload.recipientUserId) {
    await service.create(buildNotificationFromType(definition, {
      ...common,
      recipientUserId: payload.recipientUserId,
    }), { tenantId: ctx.tenantId, organizationId: ctx.organizationId })
  } else {
    await service.createForFeature(buildFeatureNotificationFromType(definition, {
      ...common,
      requiredFeature: 'reference_module.import',
    }), { tenantId: ctx.tenantId, organizationId: ctx.organizationId })
  }
}
