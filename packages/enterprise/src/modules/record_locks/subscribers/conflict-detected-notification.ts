import { buildNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import {
  isConflictNotificationEnabled,
  resolveRecordLockNotificationType,
  resolveRecordResourceLink,
} from '../lib/notificationHelpers'

export const metadata = {
  event: 'record_locks.conflict.detected',
  persistent: true,
  id: 'record_locks:conflict-detected-notification',
}

type Payload = {
  conflictId: string
  resourceKind: string
  resourceId: string
  tenantId: string
  organizationId?: string | null
  conflictActorUserId: string
  incomingActorUserId?: string | null
  baseActionLogId?: string | null
  incomingActionLogId?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(payload: Payload, ctx: ResolverContext) {
  if (!payload.conflictActorUserId) return

  const notificationsEnabled = await isConflictNotificationEnabled(ctx)
  if (!notificationsEnabled) return

  try {
    const em = (ctx.resolve('em') as EntityManager).fork()
    const incomingLog = payload.incomingActionLogId
      ? await em.findOne(ActionLog, { id: payload.incomingActionLogId, deletedAt: null })
      : null
    const changedFields = incomingLog?.changesJson && typeof incomingLog.changesJson === 'object'
      ? Object.keys(incomingLog.changesJson).slice(0, 12).join(', ')
      : ''

    const notificationService = resolveNotificationService(ctx)
    const typeDef = resolveRecordLockNotificationType('record_locks.conflict.detected')
    if (!typeDef) return

    const notificationInput = buildNotificationFromType(typeDef, {
      recipientUserId: payload.conflictActorUserId,
      bodyVariables: {
        resourceKind: payload.resourceKind,
        changedFields: changedFields || '-',
      },
      sourceEntityType: 'record_locks:conflict',
      sourceEntityId: payload.conflictId,
      linkHref: resolveRecordResourceLink(payload.resourceKind, payload.resourceId),
    })

    await notificationService.create(notificationInput, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  } catch (error) {
    console.error('[record_locks:conflict-detected-notification] Failed to create notification:', error)
  }
}
