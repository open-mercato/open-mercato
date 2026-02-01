import type { EntityManager } from '@mikro-orm/core'
import { Notification } from '../data/entities'
import type { CreateNotificationInput } from '../data/validators'
import { NOTIFICATION_EVENTS } from './events'
import { assertSafeNotificationHref, sanitizeNotificationActions } from './safeHref'

export type NotificationContentInput = Omit<CreateNotificationInput, 'recipientUserId'>

export type NotificationTenantContext = {
  tenantId: string
  organizationId?: string | null
}

export function buildNotificationEntity(
  em: EntityManager,
  input: NotificationContentInput,
  recipientUserId: string,
  ctx: NotificationTenantContext
): Notification {
  const actions = sanitizeNotificationActions(input.actions)
  const linkHref = assertSafeNotificationHref(input.linkHref)

  return em.create(Notification, {
    recipientUserId,
    type: input.type,
    // i18n-first: store keys and variables for translation at display time
    titleKey: input.titleKey,
    bodyKey: input.bodyKey,
    titleVariables: input.titleVariables,
    bodyVariables: input.bodyVariables,
    // Fallback text (required for backward compatibility)
    title: input.title || input.titleKey || '',
    body: input.body,
    icon: input.icon,
    severity: input.severity ?? 'info',
    actionData: actions
      ? {
          actions,
          primaryActionId: input.primaryActionId,
        }
      : null,
    sourceModule: input.sourceModule,
    sourceEntityType: input.sourceEntityType,
    sourceEntityId: input.sourceEntityId,
    linkHref,
    groupKey: input.groupKey,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
  })
}

export async function emitNotificationCreated(
  eventBus: { emit: (event: string, payload: unknown) => Promise<void> },
  notification: Notification,
  ctx: NotificationTenantContext
): Promise<void> {
  await eventBus.emit(NOTIFICATION_EVENTS.CREATED, {
    notificationId: notification.id,
    recipientUserId: notification.recipientUserId,
    type: notification.type,
    title: notification.title,
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
  })
}

export async function emitNotificationCreatedBatch(
  eventBus: { emit: (event: string, payload: unknown) => Promise<void> },
  notifications: Notification[],
  ctx: NotificationTenantContext
): Promise<void> {
  for (const notification of notifications) {
    await emitNotificationCreated(eventBus, notification, ctx)
  }
}
