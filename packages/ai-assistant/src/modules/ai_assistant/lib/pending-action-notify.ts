import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { defaultLocale } from '@open-mercato/shared/lib/i18n/config'
import { loadDictionary } from '@open-mercato/shared/lib/i18n/server'
import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import {
  resolveNotificationService,
  type NotificationService,
} from '@open-mercato/core/modules/notifications/lib/notificationService'
import {
  buildFeatureNotificationFromType,
  buildNotificationFromType,
} from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'
import { notificationTypes } from '../notifications'
import type { AiPendingAction } from '../data/entities'
import { AI_PENDING_ACTION_APPROVE_FEATURE } from './pending-action-types'

const logger = createLogger('ai_assistant')

export const AI_PENDING_ACTION_AWAITING_APPROVAL_NOTIFICATION_TYPE =
  'ai_assistant.pending_action.awaiting_approval'

export const AI_PENDING_ACTION_SOURCE_ENTITY_TYPE = 'ai_assistant:ai_pending_action'

export type PendingActionNotifyContainer = {
  resolve: (name: string) => unknown
}

export type PendingActionNotifyScope = {
  tenantId: string
  organizationId: string | null
}

export type PendingActionNotifyRow = Pick<
  AiPendingAction,
  'id' | 'toolName' | 'createdByUserId' | 'channel'
>

export function buildPendingActionDetailHref(pendingActionId: string): string {
  return `/backend/config/ai-assistant/pending-actions/${pendingActionId}`
}

export function isPendingActionNotifiable(row: Pick<AiPendingAction, 'channel'>): boolean {
  return (row.channel ?? 'agent') !== 'agent'
}

function reportNotifyError(error: unknown, code: string): void {
  try {
    getTelemetryRuntime()?.reportError(error, { module: 'ai_assistant', code })
  } catch {
    return
  }
}

function resolveServiceSoftly(
  container: PendingActionNotifyContainer,
): NotificationService | null {
  try {
    if (!container.resolve('notificationService')) return null
  } catch {
    return null
  }
  try {
    return resolveNotificationService(container)
  } catch (error) {
    logger.warn('Notification service could not be resolved for pending action', { err: error })
    return null
  }
}

async function resolveDefaultLocaleCopy(
  typeDef: NotificationTypeDefinition,
  variables: Record<string, string>,
): Promise<{ title: string; body: string | undefined }> {
  try {
    const dictionary = await loadDictionary(defaultLocale)
    const translate = createTranslator(dictionary)
    return {
      title: translate(typeDef.titleKey, variables),
      body: typeDef.bodyKey ? translate(typeDef.bodyKey, variables) : undefined,
    }
  } catch {
    return { title: typeDef.titleKey, body: typeDef.bodyKey }
  }
}

export async function notifyPendingActionAwaitingApproval(
  container: PendingActionNotifyContainer,
  row: PendingActionNotifyRow,
  scope: PendingActionNotifyScope,
): Promise<void> {
  if (!row?.id || !scope?.tenantId) return
  if (!isPendingActionNotifiable(row)) return
  const typeDef = notificationTypes.find(
    (definition) => definition.type === AI_PENDING_ACTION_AWAITING_APPROVAL_NOTIFICATION_TYPE,
  )
  if (!typeDef) return
  const notificationService = resolveServiceSoftly(container)
  if (!notificationService) return

  const variables: Record<string, string> = { toolName: row.toolName }
  const commonOptions = {
    titleVariables: variables,
    bodyVariables: variables,
    sourceEntityType: AI_PENDING_ACTION_SOURCE_ENTITY_TYPE,
    sourceEntityId: row.id,
    linkHref: buildPendingActionDetailHref(row.id),
    groupKey: row.id,
  }
  const copy = await resolveDefaultLocaleCopy(typeDef, variables)
  const serviceContext = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId ?? null,
  }

  if (row.createdByUserId) {
    try {
      const requesterInput = buildNotificationFromType(typeDef, {
        ...commonOptions,
        recipientUserId: row.createdByUserId,
      })
      requesterInput.title = copy.title
      if (copy.body !== undefined) requesterInput.body = copy.body
      await notificationService.create(requesterInput, serviceContext)
    } catch (error) {
      logger.warn('Failed to notify pending action requester', { pendingActionId: row.id, err: error })
      reportNotifyError(error, 'ai_assistant.pending_action_notify_requester_failed')
    }
  }

  try {
    const approverInput = buildFeatureNotificationFromType(typeDef, {
      ...commonOptions,
      requiredFeature: AI_PENDING_ACTION_APPROVE_FEATURE,
    })
    approverInput.title = copy.title
    if (copy.body !== undefined) approverInput.body = copy.body
    await notificationService.createForFeature(
      { ...approverInput, restrictRecipientsToOrganization: true },
      serviceContext,
    )
  } catch (error) {
    logger.warn('Failed to notify pending action approvers', { pendingActionId: row.id, err: error })
    reportNotifyError(error, 'ai_assistant.pending_action_notify_approvers_failed')
  }
}

export async function clearPendingActionNotifications(
  container: PendingActionNotifyContainer,
  pendingActionId: string,
  scope: PendingActionNotifyScope,
): Promise<void> {
  if (!pendingActionId || !scope?.tenantId) return
  const notificationService = resolveServiceSoftly(container)
  if (!notificationService) return
  try {
    await notificationService.deleteBySource(AI_PENDING_ACTION_SOURCE_ENTITY_TYPE, pendingActionId, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId ?? null,
    })
  } catch (error) {
    logger.warn('Failed to clear pending action notifications', { pendingActionId, err: error })
    reportNotifyError(error, 'ai_assistant.pending_action_notify_clear_failed')
  }
}
