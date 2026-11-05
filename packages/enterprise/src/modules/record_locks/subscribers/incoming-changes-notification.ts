import { buildNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import {
  resolveRecordLockNotificationType,
  resolveRecordResourceLink,
} from '../lib/notificationHelpers'

export const metadata = {
  event: 'record_locks.incoming_changes.available',
  persistent: true,
  id: 'record_locks:incoming-changes-notification',
}

type Payload = {
  resourceKind: string
  resourceId: string
  tenantId: string
  organizationId?: string | null
  recipientUserIds?: string[]
  incomingActorUserId?: string | null
  incomingActionLogId?: string | null
  changedFields?: string | null
  changedRowsJson?: string | null
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
  const typeDef = resolveRecordLockNotificationType('record_locks.incoming_changes.available')
  if (!typeDef) return

  const linkHref = resolveRecordResourceLink(payload.resourceKind, payload.resourceId)
  const changedFields = typeof payload.changedFields === 'string' && payload.changedFields.trim().length > 0
    ? payload.changedFields
    : '-'

  for (const recipientUserId of recipientUserIds) {
    const notificationInput = buildNotificationFromType(typeDef, {
      recipientUserId,
      bodyVariables: {
        resourceKind: payload.resourceKind,
        changedFields,
        changedRowsJson: typeof payload.changedRowsJson === 'string' ? payload.changedRowsJson : '',
      },
      sourceEntityType: 'record_locks:incoming_change',
      sourceEntityId: payload.incomingActionLogId ?? undefined,
      linkHref,
      groupKey: payload.incomingActionLogId
        ? `record_locks.incoming_changes:${payload.incomingActionLogId}`
        : `record_locks.incoming_changes:${payload.resourceKind}:${payload.resourceId}`,
    })

    await notificationService.create(notificationInput, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  }
}
