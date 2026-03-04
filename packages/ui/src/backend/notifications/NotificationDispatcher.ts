import { flash, type FlashKind } from '@open-mercato/ui/backend/FlashMessages'
import {
  getNotificationHandlerEntries,
} from '@open-mercato/shared/lib/notifications/handler-registry'
import type {
  NotificationHandler,
  NotificationHandlerContext,
  NotificationHandlerPopupOptions,
  NotificationHandlerToastOptions,
} from '@open-mercato/shared/modules/notifications/handler'
import type { NotificationDto } from '@open-mercato/shared/modules/notifications/types'

type RuntimeContext = {
  userId?: string
  features: string[]
  currentPath: string
  refreshNotifications: () => void
  navigate: (href: string) => void
  markAsRead: (notificationId: string) => Promise<void>
  dismiss: (notificationId: string) => Promise<void>
}

type NotificationEffectListener = {
  id: number
  pattern: string | string[]
  effect: (notification: NotificationDto) => void
}

const DEFAULT_PRIORITY = 50
const MAX_TRACKED_IDS = 500
const RETAINED_IDS_AFTER_PRUNE = 200
const POPUP_EVENT_NAME = 'om:notifications:popup'

function toFlashKind(value: NotificationHandlerToastOptions['severity'] | NotificationHandlerPopupOptions['severity']): FlashKind {
  if (value === 'success') return 'success'
  if (value === 'warning') return 'warning'
  if (value === 'error') return 'error'
  return 'info'
}

function matchesType(pattern: string | string[], type: string): boolean {
  const patterns = Array.isArray(pattern) ? pattern : [pattern]
  return patterns.some((current) => {
    if (current === '*') return true
    if (current.endsWith('.*')) return type.startsWith(current.slice(0, -1))
    return current === type
  })
}

function matchesFeatures(required: string[] | undefined, current: string[]): boolean {
  if (!required || required.length === 0) return true
  return required.every((feature) => current.includes(feature))
}

function buildHandlerContext(runtime: RuntimeContext): NotificationHandlerContext {
  return {
    userId: runtime.userId,
    features: runtime.features,
    currentPath: runtime.currentPath,
    toast(options) {
      const text = options.body ? `${options.title}: ${options.body}` : options.title
      flash(text, toFlashKind(options.severity))
    },
    popup(options) {
      if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
        window.dispatchEvent(new CustomEvent(POPUP_EVENT_NAME, { detail: options }))
      }
      const text = options.body ? `${options.title}: ${options.body}` : options.title
      flash(text, toFlashKind(options.severity))
    },
    emitEvent(eventName, detail) {
      if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return
      window.dispatchEvent(new CustomEvent(eventName, { detail }))
    },
    refreshNotifications: runtime.refreshNotifications,
    navigate(href) {
      runtime.navigate(href)
    },
    markAsRead: runtime.markAsRead,
    dismiss: runtime.dismiss,
  }
}

class NotificationDispatcher {
  private handledIds = new Set<string>()
  private handledOrder: string[] = []
  private listeners = new Map<number, NotificationEffectListener>()
  private listenerIdSeq = 1
  private debounceByHandler = new Map<string, number>()

  dispatch(notifications: NotificationDto[], runtime: RuntimeContext) {
    const entries = getNotificationHandlerEntries()
    if (notifications.length === 0 && this.listeners.size === 0) return
    const context = buildHandlerContext(runtime)
    const sortedEntries = entries
      .slice()
      .sort((a, b) => (b.handler.priority ?? DEFAULT_PRIORITY) - (a.handler.priority ?? DEFAULT_PRIORITY))

    for (const notification of notifications) {
      if (this.handledIds.has(notification.id)) continue

      for (const entry of sortedEntries) {
        const handler = entry.handler
        if (!matchesType(handler.notificationType, notification.type)) continue
        if (!matchesFeatures(handler.features, runtime.features)) continue
        if (this.shouldDebounce(handler, notification.id)) continue
        try {
          void Promise.resolve(handler.handle(notification, context))
        } catch (error) {
          console.error(`[notifications] handler failed: ${handler.id}`, error)
        }
      }

      for (const listener of this.listeners.values()) {
        if (!matchesType(listener.pattern, notification.type)) continue
        try {
          listener.effect(notification)
        } catch (error) {
          console.error('[notifications] effect listener failed', error)
        }
      }

      this.markHandled(notification.id)
    }
  }

  subscribe(pattern: string | string[], effect: (notification: NotificationDto) => void): () => void {
    const id = this.listenerIdSeq++
    this.listeners.set(id, { id, pattern, effect })
    return () => {
      this.listeners.delete(id)
    }
  }

  resetForTests() {
    this.handledIds.clear()
    this.handledOrder = []
    this.listeners.clear()
    this.listenerIdSeq = 1
    this.debounceByHandler.clear()
  }

  private shouldDebounce(handler: NotificationHandler, notificationId: string): boolean {
    if (!handler.debounceMs || handler.debounceMs <= 0) return false
    const key = `${handler.id}:${notificationId}`
    const now = Date.now()
    const previous = this.debounceByHandler.get(key)
    if (typeof previous === 'number' && now - previous < handler.debounceMs) {
      return true
    }
    this.debounceByHandler.set(key, now)
    return false
  }

  private markHandled(notificationId: string) {
    this.handledIds.add(notificationId)
    this.handledOrder.push(notificationId)
    if (this.handledOrder.length <= MAX_TRACKED_IDS) return
    const removeCount = this.handledOrder.length - RETAINED_IDS_AFTER_PRUNE
    const removed = this.handledOrder.splice(0, removeCount)
    for (const id of removed) {
      this.handledIds.delete(id)
    }
  }
}

const dispatcher = new NotificationDispatcher()

export function dispatchNotificationHandlers(
  notifications: NotificationDto[],
  runtime: RuntimeContext,
) {
  dispatcher.dispatch(notifications, runtime)
}

export function subscribeNotificationEffects(
  pattern: string | string[],
  effect: (notification: NotificationDto) => void,
): () => void {
  return dispatcher.subscribe(pattern, effect)
}

export function getRequiredNotificationHandlerFeatures(): string[] {
  const required = new Set<string>()
  const entries = getNotificationHandlerEntries()
  for (const entry of entries) {
    for (const feature of entry.handler.features ?? []) {
      if (feature && feature.trim().length > 0) {
        required.add(feature)
      }
    }
  }
  return Array.from(required)
}

export function __resetNotificationDispatcherForTests() {
  dispatcher.resetForTests()
}
