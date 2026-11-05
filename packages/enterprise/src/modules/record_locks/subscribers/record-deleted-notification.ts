import { buildNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { resolveRecordLockNotificationType } from '../lib/notificationHelpers'

export const metadata = {
  event: 'record_locks.record.deleted',
  persistent: true,
  id: 'record_locks:record-deleted-notification',
}

type Payload = {
  resourceKind: string
  resourceId: string
  tenantId: string
  organizationId?: string | null
  deletedByUserId: string
  recipientUserIds?: string[]
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(payload: Payload, ctx: ResolverContext) {
  const recipientUserIds = Array.isArray(payload.recipientUserIds)
    ? Array.from(new Set(payload.recipientUserIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)))
    : []
  if (!recipientUserIds.length) return

  const notificationService = resolveNotificationService(ctx)
  const typeDef = resolveRecordLockNotificationType('record_locks.record.deleted')
  if (!typeDef) return

  for (const recipientUserId of recipientUserIds) {
    if (recipientUserId === payload.deletedByUserId) continue

    const notificationInput = buildNotificationFromType(typeDef, {
      recipientUserId,
      bodyVariables: {
        resourceKind: payload.resourceKind,
      },
      sourceEntityType: 'record_locks:record',
      sourceEntityId: payload.resourceId,
      groupKey: `record_locks.record.deleted:${payload.resourceKind}:${payload.resourceId}`,
    })

    await notificationService.create(notificationInput, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  }
}
