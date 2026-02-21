import { buildNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import {
  isConflictNotificationEnabled,
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
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(payload: Payload, ctx: ResolverContext) {
  const recipientUserIds = Array.isArray(payload.recipientUserIds)
    ? Array.from(new Set(payload.recipientUserIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)))
    : []
  if (!recipientUserIds.length) return

  const notificationsEnabled = await isConflictNotificationEnabled(ctx)
  if (!notificationsEnabled) return

  const notificationService = resolveNotificationService(ctx)
  const typeDef = resolveRecordLockNotificationType('record_locks.incoming_changes.available')
  if (!typeDef) return

  const linkHref = resolveRecordResourceLink(payload.resourceKind, payload.resourceId)
  const changedFields = typeof payload.changedFields === 'string' && payload.changedFields.trim().length > 0
    ? payload.changedFields
    : '-'

  for (const recipientUserId of recipientUserIds) {
    if (payload.incomingActorUserId && recipientUserId === payload.incomingActorUserId) continue

    const notificationInput = buildNotificationFromType(typeDef, {
      recipientUserId,
      bodyVariables: {
        resourceKind: payload.resourceKind,
        changedFields,
      },
      sourceEntityType: 'record_locks:incoming_change',
      sourceEntityId: payload.incomingActionLogId ?? undefined,
      linkHref,
    })

    await notificationService.create(notificationInput, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  }
}
