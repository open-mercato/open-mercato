import type { NotificationDto } from '@open-mercato/shared/modules/notifications/types'
import { Notification } from '../data/entities'

export function toNotificationDto(notification: Notification): NotificationDto {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    titleKey: notification.titleKey,
    bodyKey: notification.bodyKey,
    titleVariables: notification.titleVariables,
    bodyVariables: notification.bodyVariables,
    icon: notification.icon,
    severity: notification.severity,
    status: notification.status,
    actions: notification.actionData?.actions?.map((action) => ({
      id: action.id,
      label: action.label,
      labelKey: action.labelKey,
      variant: action.variant,
      icon: action.icon,
    })) ?? [],
    primaryActionId: notification.actionData?.primaryActionId,
    sourceModule: notification.sourceModule,
    sourceEntityType: notification.sourceEntityType,
    sourceEntityId: notification.sourceEntityId,
    linkHref: notification.linkHref,
    createdAt: notification.createdAt.toISOString(),
    readAt: notification.readAt?.toISOString() ?? null,
    actionTaken: notification.actionTaken,
  }
}
