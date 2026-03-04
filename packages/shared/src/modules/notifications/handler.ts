import type { NotificationDto, NotificationSeverity } from './types'

export type NotificationHandlerPopupAction = {
  label: string
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost'
  onClick: () => void
}

export type NotificationHandlerToastOptions = {
  title: string
  body?: string
  severity?: NotificationSeverity
  duration?: number
  action?: {
    label: string
    onClick: () => void
  }
}

export type NotificationHandlerPopupOptions = {
  title: string
  body: string
  severity?: NotificationSeverity
  actions?: NotificationHandlerPopupAction[]
  modal?: boolean
  autoCloseMs?: number
}

export type NotificationHandlerContext = {
  userId?: string
  features: string[]
  currentPath: string
  toast: (options: NotificationHandlerToastOptions) => void
  popup: (options: NotificationHandlerPopupOptions) => void
  emitEvent: (eventName: string, detail?: unknown) => void
  refreshNotifications: () => void
  navigate: (href: string) => void
  markAsRead: (notificationId: string) => Promise<void>
  dismiss: (notificationId: string) => Promise<void>
}

export type NotificationHandler = {
  id: string
  notificationType: string | string[]
  features?: string[]
  priority?: number
  debounceMs?: number
  handle: (
    notification: NotificationDto,
    context: NotificationHandlerContext,
  ) => void | Promise<void>
}
