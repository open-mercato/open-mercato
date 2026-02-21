import { buildNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import {
  isConflictNotificationEnabled,
  resolveRecordLockNotificationType,
  resolveRecordResourceLink,
} from '../lib/notificationHelpers'

export const metadata = {
  event: 'record_locks.conflict.resolved',
  persistent: true,
  id: 'record_locks:conflict-resolved-notification',
}

type Payload = {
  conflictId: string
  resourceKind: string
  resourceId: string
  tenantId: string
  organizationId?: string | null
  conflictActorUserId: string
  incomingActorUserId?: string | null
  resolution?: 'accept_incoming' | 'accept_mine' | 'merged' | null
  resolvedByUserId: string
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(payload: Payload, ctx: ResolverContext) {
  if (!payload.incomingActorUserId || payload.incomingActorUserId === payload.resolvedByUserId) return

  const notificationsEnabled = await isConflictNotificationEnabled(ctx)
  if (!notificationsEnabled) return

  try {
    const notificationService = resolveNotificationService(ctx)
    const typeDef = resolveRecordLockNotificationType('record_locks.conflict.resolved')
    if (!typeDef) return

    const notificationInput = buildNotificationFromType(typeDef, {
      recipientUserId: payload.incomingActorUserId,
      bodyVariables: {
        resourceKind: payload.resourceKind,
        resolution: payload.resolution ?? 'accept_mine',
      },
      sourceEntityType: 'record_locks:conflict',
      sourceEntityId: payload.conflictId,
      linkHref: resolveRecordResourceLink(payload.resourceKind, payload.resourceId),
      groupKey: `record_locks.conflict.resolved:${payload.conflictId}`,
    })

    await notificationService.create(notificationInput, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  } catch (error) {
    console.error('[record_locks:conflict-resolved-notification] Failed to create notification:', error)
  }
}
