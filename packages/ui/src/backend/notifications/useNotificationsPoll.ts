"use client"
import * as React from 'react'
import { apiCall } from '../utils/apiCall'
import {
  subscribeNotificationNew,
  emitNotificationCountChanged,
} from '@open-mercato/shared/lib/frontend/notificationEvents'
import type { NotificationDto } from '@open-mercato/shared/modules/notifications/types'

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
  const lastIdRef = React.useRef<string | null>(null)
  const prevUnreadRef = React.useRef(0)
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
    fetchNotifications()
    const interval = setInterval(fetchNotifications, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchNotifications])

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
    setUnreadCount((prev) => Math.max(0, prev - 1))
  }, [])

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
      setUnreadCount((prev) => Math.max(0, prev - 1))
    }

    return { href: result.result?.href }
  }, [])

  const dismiss = React.useCallback(
    async (id: string) => {
      await apiCall(`/api/notifications/${id}/dismiss`, { method: 'PUT' })
      const notification = notifications.find((n) => n.id === id)
      setNotifications((prev) => prev.filter((n) => n.id !== id))
      if (notification?.status === 'unread') {
        setUnreadCount((prev) => Math.max(0, prev - 1))
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
      setUnreadCount((prev) => prev + 1)
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
