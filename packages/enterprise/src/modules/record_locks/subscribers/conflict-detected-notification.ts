import { buildNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import type { ActionLogHistoryService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import {
  isConflictNotificationEnabled,
  resolveRecordLockNotificationType,
  resolveRecordResourceLink,
} from '../lib/notificationHelpers'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('record_locks').child({ subscriber: 'conflict-detected-notification' })

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
  resolve: <T = unknown>(name: string, options?: { allowUnregistered: true }) => T
}

function formatChangedFieldLabel(rawField: string): string {
  const trimmedField = rawField.trim()
  const withoutNamespace = trimmedField.includes('::') ? (trimmedField.split('::').pop() ?? trimmedField) : trimmedField
  const withoutPrefix = withoutNamespace.includes('.') ? (withoutNamespace.split('.').pop() ?? withoutNamespace) : withoutNamespace
  const words = withoutPrefix
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)

  if (!words.length) return trimmedField
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export default async function handle(payload: Payload, ctx: ResolverContext) {
  if (!payload.conflictActorUserId) return

  const notificationsEnabled = await isConflictNotificationEnabled(ctx, {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId ?? null,
  })
  if (!notificationsEnabled) return

  try {
    const history = payload.incomingActionLogId
      ? ctx.resolve<ActionLogHistoryService | undefined>('actionLogHistoryService', { allowUnregistered: true })
      : undefined
    const incomingLog = history && payload.incomingActionLogId
      ? await history.findResourceHistoryById({
          tenantId: payload.tenantId,
          resourceKind: payload.resourceKind,
          resourceId: payload.resourceId,
          organization: { mode: 'exact', organizationId: payload.organizationId ?? null },
        }, payload.incomingActionLogId)
      : null
    const changesJson = incomingLog?.changesJson
    const changedFields = changesJson
      ? Object.keys(changesJson).slice(0, 12).map(formatChangedFieldLabel).join(', ')
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
      groupKey: `record_locks.conflict.detected:${payload.conflictId}`,
    })

    await notificationService.create(notificationInput, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  } catch (error) {
    logger.error('Failed to create notification', { err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'record_locks', code: 'record_locks.conflict_notification_failed' })
  }
}
