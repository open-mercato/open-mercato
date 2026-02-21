import { buildNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { resolveRecordLockNotificationType, resolveRecordResourceLink } from '../lib/notificationHelpers'

export const metadata = {
  event: 'record_locks.lock.force_released',
  persistent: true,
  id: 'record_locks:lock-force-released-notification',
}

type Payload = {
  lockId: string
  resourceKind: string
  resourceId: string
  tenantId: string
  organizationId?: string | null
  lockedByUserId: string
  releasedByUserId: string
  reason?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(payload: Payload, ctx: ResolverContext) {
  if (!payload.lockedByUserId || payload.lockedByUserId === payload.releasedByUserId) return

  try {
    const notificationService = resolveNotificationService(ctx)
    const typeDef = resolveRecordLockNotificationType('record_locks.lock.force_released')
    if (!typeDef) return

    const notificationInput = buildNotificationFromType(typeDef, {
      recipientUserId: payload.lockedByUserId,
      bodyVariables: {
        resourceKind: payload.resourceKind,
      },
      sourceEntityType: 'record_locks:lock',
      sourceEntityId: payload.lockId,
      linkHref: resolveRecordResourceLink(payload.resourceKind, payload.resourceId),
    })

    await notificationService.create(notificationInput, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  } catch (error) {
    console.error('[record_locks:lock-force-released-notification] Failed to create notification:', error)
  }
}
