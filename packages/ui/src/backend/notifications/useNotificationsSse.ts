"use client"
import * as React from 'react'
import { apiCall } from '../utils/apiCall'
import {
  subscribeNotificationNew,
  emitNotificationCountChanged,
} from '@open-mercato/shared/lib/frontend/notificationEvents'
import type { AppEventPayload } from '@open-mercato/shared/modules/widgets/injection'
import type { NotificationDto } from '@open-mercato/shared/modules/notifications/types'
import { useAppEvent } from '../injection/useAppEvent'
import {
  dispatchNotificationHandlers,
  getRequiredNotificationHandlerFeatures,
} from './NotificationDispatcher'
import { useNotificationActions } from './useNotificationActions'

type NotificationCreatedPayload = {
  recipientUserId?: string
  notification?: NotificationDto
}

type NotificationBatchCreatedPayload = {
  recipientUserIds?: string[]
  count?: number
}

export type UseNotificationsSseResult = {
  notifications: NotificationDto[]
  unreadCount: number
  hasNew: boolean
  isLoading: boolean
  error: string | null
  refresh: () => void
  markAsRead: (id: string) => Promise<void>
  executeAction: (id: string, actionId: string) => Promise<{ href?: string }>
  dismiss: (id: string) => Promise<void>
  dismissUndo: { notification: NotificationDto; previousStatus: 'read' | 'unread' } | null
  undoDismiss: () => Promise<void>
  markAllRead: () => Promise<void>
}

export function useNotificationsSse(): UseNotificationsSseResult {
  const [notifications, setNotifications] = React.useState<NotificationDto[]>([])
  const [unreadCount, setUnreadCount] = React.useState(0)
  const [hasNew, setHasNew] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const grantedFeaturesRef = React.useRef<string[]>([])
  const lastIdRef = React.useRef<string | null>(null)
  const prevUnreadRef = React.useRef(0)
  const {
    markAsRead,
    executeAction,
    dismiss,
    dismissUndo,
    undoDismiss,
    markAllRead,
    markAsReadRef,
    dismissRef,
  } = useNotificationActions(notifications, setNotifications, setUnreadCount)

  const fetchNotifications = React.useCallback(async () => {
    try {
      const [notifResult, countResult] = await Promise.all([
        apiCall<{ items: NotificationDto[] }>('/api/notifications?pageSize=50'),
        apiCall<{ unreadCount: number }>('/api/notifications/unread-count'),
      ])

      if (notifResult.ok && notifResult.result) {
        const fetched = notifResult.result.items
        setNotifications(fetched)
        if (fetched.length > 0) {
          lastIdRef.current = fetched[0].id
          dispatchNotificationHandlers(fetched, {
            features: grantedFeaturesRef.current,
            currentPath:
              typeof window === 'undefined'
                ? '/'
                : `${window.location.pathname}${window.location.search}`,
            refreshNotifications: () => {
              // No-op: data was just fetched — avoid redundant refetch loop.
            },
            navigate: (href) => {
              if (typeof window === 'undefined' || !href.startsWith('/')) return
              window.location.assign(href)
            },
            markAsRead: async (notificationId) => markAsReadRef.current(notificationId),
            dismiss: async (notificationId) => dismissRef.current(notificationId),
          })
        }
      }

      if (countResult.ok && countResult.result) {
        setUnreadCount(countResult.result.unreadCount)
      }

      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch notifications')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const refresh = React.useCallback(() => {
    void fetchNotifications()
  }, [fetchNotifications])

  React.useEffect(() => {
    let mounted = true
    const run = async () => {
      const requiredFeatures = getRequiredNotificationHandlerFeatures()
      if (requiredFeatures.length === 0) {
        grantedFeaturesRef.current = []
        return
      }
      const response = await apiCall<{ granted?: string[] }>('/api/auth/feature-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ features: requiredFeatures }),
      })
      if (!mounted) return
      grantedFeaturesRef.current = response.ok ? (response.result?.granted ?? []) : []
    }
    void run()
    return () => {
      mounted = false
    }
  }, [])

  React.useEffect(() => {
    void fetchNotifications()
  }, [fetchNotifications])

  React.useEffect(() => {
    const unsub = subscribeNotificationNew(() => refresh())
    return unsub
  }, [refresh])

  React.useEffect(() => {
    if (unreadCount === prevUnreadRef.current) return
    prevUnreadRef.current = unreadCount
    emitNotificationCountChanged(unreadCount)
  }, [unreadCount])

  useAppEvent(
    'notifications.notification.created',
    (event: AppEventPayload) => {
      const payload = event.payload as NotificationCreatedPayload
      const notification = payload?.notification
      if (!notification || !notification.id) {
        void fetchNotifications()
        return
      }
      if (notification.id === lastIdRef.current) return
      lastIdRef.current = notification.id
      setNotifications((prev) => [notification, ...prev.filter((item) => item.id !== notification.id)].slice(0, 50))
      if (notification.status === 'unread') {
        setUnreadCount((prev) => prev + 1)
      }
      setHasNew(true)
      window.setTimeout(() => setHasNew(false), 3000)
      dispatchNotificationHandlers([notification], {
        features: grantedFeaturesRef.current,
        currentPath:
          typeof window === 'undefined'
            ? '/'
            : `${window.location.pathname}${window.location.search}`,
        refreshNotifications: () => {
          // No-op: notification was already applied optimistically from the SSE payload.
          // Full refetch is only needed for batch_created, reconnect, or missing payload.
        },
        navigate: (href) => {
          if (typeof window === 'undefined' || !href.startsWith('/')) return
          window.location.assign(href)
        },
        markAsRead: async (notificationId) => markAsReadRef.current(notificationId),
        dismiss: async (notificationId) => dismissRef.current(notificationId),
      })
    },
    [fetchNotifications],
  )

  useAppEvent(
    'notifications.notification.batch_created',
    (event: AppEventPayload) => {
      const payload = event.payload as NotificationBatchCreatedPayload
      if (!payload || typeof payload !== 'object') return
      void fetchNotifications()
    },
    [fetchNotifications],
  )

  useAppEvent('om:bridge:reconnected', () => {
    void fetchNotifications()
  }, [fetchNotifications])

  React.useEffect(() => {
    const onFocus = () => {
      void fetchNotifications()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [fetchNotifications])

  return {
    notifications,
    unreadCount,
    hasNew,
    isLoading,
    error,
    refresh,
    markAsRead,
    executeAction,
    dismiss,
    dismissUndo,
    undoDismiss,
    markAllRead,
  }
}
