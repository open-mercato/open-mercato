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
import { useAppEvent } from '../injection/useAppEvent'
import type { UseNotificationsPollResult } from './useNotificationsPoll'

type NotificationCreatedEventPayload = {
  notification?: NotificationDto
}

export function useNotificationsSse(): UseNotificationsPollResult {
  const [notifications, setNotifications] = React.useState<NotificationDto[]>([])
  const [unreadCount, setUnreadCount] = React.useState(0)
  const [hasNew, setHasNew] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const grantedFeaturesRef = React.useRef<string[]>([])
  const markAsReadRef = React.useRef<(id: string) => Promise<void>>(async () => {})
  const dismissRef = React.useRef<(id: string) => Promise<void>>(async () => {})
  const [dismissUndo, setDismissUndo] = React.useState<{
    notification: NotificationDto
    previousStatus: 'read' | 'unread'
  } | null>(null)
  const dismissUndoTimerRef = React.useRef<number | null>(null)

  const fetchNotifications = React.useCallback(async () => {
    try {
      const [notifResult, countResult] = await Promise.all([
        apiCall<{ items: NotificationDto[] }>('/api/notifications?pageSize=50'),
        apiCall<{ unreadCount: number }>('/api/notifications/unread-count'),
      ])

      if (notifResult.ok && notifResult.result) {
        const nextNotifications = notifResult.result.items
        setNotifications(nextNotifications)

        if (nextNotifications.length > 0) {
          dispatchNotificationHandlers(nextNotifications, {
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
        const nextUnreadCount = countResult.result.unreadCount
        setUnreadCount(nextUnreadCount)
        emitNotificationCountChanged(nextUnreadCount)
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
      grantedFeaturesRef.current = response.ok
        ? (response.result?.granted ?? [])
        : []
    }
    void run()
    return () => {
      mounted = false
    }
  }, [])

  useAppEvent('notifications.notification.created', (event) => {
    const payload = event.payload as NotificationCreatedEventPayload
    const nextNotification = payload.notification
    if (!nextNotification) {
      return
    }

    setNotifications((prev) => {
      if (prev.some((entry) => entry.id === nextNotification.id)) {
        return prev
      }
      return [nextNotification, ...prev]
    })

    if (nextNotification.status === 'unread') {
      setUnreadCount((prev) => {
        const next = prev + 1
        emitNotificationCountChanged(next)
        return next
      })
    }

    setHasNew(true)
    window.setTimeout(() => setHasNew(false), 3000)
  }, [])

  useAppEvent('notifications.notification.batch_created', () => {
    refresh()
  }, [refresh])

  useAppEvent('om:bridge:reconnected', () => {
    refresh()
  }, [refresh])

  React.useEffect(() => {
    const unsub = subscribeNotificationNew(() => refresh())
    return unsub
  }, [refresh])

  const markAsRead = React.useCallback(async (id: string) => {
    await apiCall(`/api/notifications/${id}/read`, { method: 'PUT' })
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, status: 'read', readAt: new Date().toISOString() } : n
      )
    )
    setUnreadCount((prev) => {
      const next = Math.max(0, prev - 1)
      emitNotificationCountChanged(next)
      return next
    })
  }, [])

  React.useEffect(() => {
    markAsReadRef.current = markAsRead
  }, [markAsRead])

  const executeAction = React.useCallback(async (id: string, actionId: string) => {
    const result = await apiCall<{ ok: boolean; href?: string }>(
      `/api/notifications/${id}/action`,
      { method: 'POST', body: JSON.stringify({ actionId }) }
    )

    if (result.ok) {
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, status: 'actioned', actionTaken: actionId } : n
        )
      )
      setUnreadCount((prev) => {
        const next = Math.max(0, prev - 1)
        emitNotificationCountChanged(next)
        return next
      })
    }

    return { href: result.result?.href }
  }, [])

  const dismiss = React.useCallback(
    async (id: string) => {
      await apiCall(`/api/notifications/${id}/dismiss`, { method: 'PUT' })
      const notification = notifications.find((n) => n.id === id)
      setNotifications((prev) => prev.filter((n) => n.id !== id))
      if (notification?.status === 'unread') {
        setUnreadCount((prev) => {
          const next = Math.max(0, prev - 1)
          emitNotificationCountChanged(next)
          return next
        })
      }
      if (notification) {
        const previousStatus = notification.status === 'unread' ? 'unread' : 'read'
        setDismissUndo({ notification, previousStatus })
        if (dismissUndoTimerRef.current) {
          window.clearTimeout(dismissUndoTimerRef.current)
        }
        dismissUndoTimerRef.current = window.setTimeout(() => {
          setDismissUndo(null)
        }, 6000)
      }
    },
    [notifications]
  )

  React.useEffect(() => {
    dismissRef.current = dismiss
  }, [dismiss])

  const undoDismiss = React.useCallback(async () => {
    if (!dismissUndo) return
    await apiCall(`/api/notifications/${dismissUndo.notification.id}/restore`, {
      method: 'PUT',
      body: JSON.stringify({ status: dismissUndo.previousStatus }),
    })

    setNotifications((prev) => {
      const next = [
        {
          ...dismissUndo.notification,
          status: dismissUndo.previousStatus,
          readAt:
            dismissUndo.previousStatus === 'unread'
              ? null
              : dismissUndo.notification.readAt ?? new Date().toISOString(),
        },
        ...prev.filter((n) => n.id !== dismissUndo.notification.id),
      ]
      return next.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
    })

    if (dismissUndo.previousStatus === 'unread') {
      setUnreadCount((prev) => {
        const next = prev + 1
        emitNotificationCountChanged(next)
        return next
      })
    }

    if (dismissUndoTimerRef.current) {
      window.clearTimeout(dismissUndoTimerRef.current)
    }
    setDismissUndo(null)
  }, [dismissUndo])

  const markAllRead = React.useCallback(async () => {
    await apiCall('/api/notifications/mark-all-read', { method: 'PUT' })
    setNotifications((prev) =>
      prev.map((n) =>
        n.status === 'unread'
          ? { ...n, status: 'read', readAt: new Date().toISOString() }
          : n
      )
    )
    setUnreadCount(0)
    emitNotificationCountChanged(0)
  }, [])

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
