import { buildNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { resolveRecordLockNotificationType, resolveRecordResourceLink } from '../lib/notificationHelpers'

export const metadata = {
  event: 'record_locks.participant.joined',
  persistent: true,
  id: 'record_locks:participant-joined-notification',
}

type Payload = {
  lockId: string
  resourceKind: string
  resourceId: string
  tenantId: string
  organizationId?: string | null
  joinedUserId: string
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
  const typeDef = resolveRecordLockNotificationType('record_locks.participant.joined')
  if (!typeDef) return

  const linkHref = resolveRecordResourceLink(payload.resourceKind, payload.resourceId)
  for (const recipientUserId of recipientUserIds) {
    if (recipientUserId === payload.joinedUserId) continue

    const notificationInput = buildNotificationFromType(typeDef, {
      recipientUserId,
      bodyVariables: {
        resourceKind: payload.resourceKind,
      },
      sourceEntityType: 'record_locks:lock',
      sourceEntityId: payload.lockId,
      linkHref,
      groupKey: `record_locks.participant.joined:${payload.lockId}:${payload.joinedUserId}`,
    })

    await notificationService.create(notificationInput, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  }
}
