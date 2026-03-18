"use client"
import * as React from 'react'
import { apiCall } from '../utils/apiCall'
import {
  subscribeNotificationNew,
  emitNotificationCountChanged,
} from '@open-mercato/shared/lib/frontend/notificationEvents'
import type { NotificationDto } from '@open-mercato/shared/modules/notifications/types'
import {
  dispatchNotificationHandlers,
  getRequiredNotificationHandlerFeatures,
} from './NotificationDispatcher'
import { useNotificationActions } from './useNotificationActions'

export type UseNotificationsPollResult = {
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

const POLL_INTERVAL = 5000

export function useNotificationsPoll(): UseNotificationsPollResult {
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
        const newNotifications = notifResult.result.items

        if (lastIdRef.current && newNotifications.length > 0) {
          const firstId = newNotifications[0].id
          if (firstId !== lastIdRef.current) {
            setHasNew(true)
            setTimeout(() => setHasNew(false), 3000)
          }
        }

        if (newNotifications.length > 0) {
          lastIdRef.current = newNotifications[0].id
        }

        setNotifications(newNotifications)

        if (newNotifications.length > 0) {
          dispatchNotificationHandlers(newNotifications, {
            features: grantedFeaturesRef.current,
            currentPath:
              typeof window === 'undefined'
                ? '/'
                : `${window.location.pathname}${window.location.search}`,
            refreshNotifications: () => {
              void fetchNotifications()
            },
            navigate: (href) => {
              if (typeof window === 'undefined') return
              if (!href.startsWith('/')) return
              window.location.assign(href)
            },
            markAsRead: async (notificationId) => markAsReadRef.current(notificationId),
            dismiss: async (notificationId) => dismissRef.current(notificationId),
          })
        }
      }

      if (countResult.ok && countResult.result) {
        const newCount = countResult.result.unreadCount
        if (newCount !== prevUnreadRef.current) {
          setUnreadCount(newCount)
          prevUnreadRef.current = newCount
          emitNotificationCountChanged(newCount)
        }
      }

      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch notifications')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const refresh = React.useCallback(() => {
    fetchNotifications()
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
      grantedFeaturesRef.current = response.ok
        ? (response.result?.granted ?? [])
        : []
    }
    void run()
    return () => {
      mounted = false
    }
  }, [])

  React.useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchNotifications, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchNotifications])

  React.useEffect(() => {
    const unsub = subscribeNotificationNew(() => refresh())
    return unsub
  }, [refresh])

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
