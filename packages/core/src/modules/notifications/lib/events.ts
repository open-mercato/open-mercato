export const NOTIFICATION_EVENTS = {
  CREATED: 'notifications.created',
  READ: 'notifications.read',
  ACTIONED: 'notifications.actioned',
  DISMISSED: 'notifications.dismissed',
  EXPIRED: 'notifications.expired',
} as const

export type NotificationCreatedPayload = {
  notificationId: string
  recipientUserId: string
  type: string
  title: string
  tenantId: string
  organizationId?: string | null
}

export type NotificationReadPayload = {
  notificationId: string
  userId: string
  tenantId: string
}

export type NotificationActionedPayload = {
  notificationId: string
  actionId: string
  userId: string
  tenantId: string
}

export type NotificationDismissedPayload = {
  notificationId: string
  userId: string
  tenantId: string
}

export type NotificationExpiredPayload = {
  notificationIds: string[]
  tenantId: string
}
