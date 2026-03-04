"use client"
import * as React from 'react'
import { apiCall } from '../utils/apiCall'
import type { NotificationDto } from '@open-mercato/shared/modules/notifications/types'

export type NotificationDismissUndoState = {
  notification: NotificationDto
  previousStatus: 'read' | 'unread'
} | null

type SetUnreadCount = React.Dispatch<React.SetStateAction<number>>

export type NotificationActionsResult = {
  markAsRead: (id: string) => Promise<void>
  executeAction: (id: string, actionId: string) => Promise<{ href?: string }>
  dismiss: (id: string) => Promise<void>
  dismissUndo: NotificationDismissUndoState
  undoDismiss: () => Promise<void>
  markAllRead: () => Promise<void>
  markAsReadRef: React.MutableRefObject<(id: string) => Promise<void>>
  dismissRef: React.MutableRefObject<(id: string) => Promise<void>>
}

export function useNotificationActions(
  notifications: NotificationDto[],
  setNotifications: React.Dispatch<React.SetStateAction<NotificationDto[]>>,
  setUnreadCount: SetUnreadCount,
): NotificationActionsResult {
  const markAsReadRef = React.useRef<(id: string) => Promise<void>>(async () => {})
  const dismissRef = React.useRef<(id: string) => Promise<void>>(async () => {})
  const [dismissUndo, setDismissUndo] = React.useState<NotificationDismissUndoState>(null)
  const dismissUndoTimerRef = React.useRef<number | null>(null)

  const markAsRead = React.useCallback(async (id: string) => {
    await apiCall(`/api/notifications/${id}/read`, { method: 'PUT' })
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, status: 'read', readAt: new Date().toISOString() } : n,
      ),
    )
    setUnreadCount((prev) => Math.max(0, prev - 1))
  }, [setNotifications, setUnreadCount])

  React.useEffect(() => {
    markAsReadRef.current = markAsRead
  }, [markAsRead])

  const executeAction = React.useCallback(async (id: string, actionId: string) => {
    const result = await apiCall<{ ok: boolean; href?: string }>(
      `/api/notifications/${id}/action`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actionId }),
      },
    )

    if (result.ok) {
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, status: 'actioned', actionTaken: actionId } : n,
        ),
      )
      setUnreadCount((prev) => Math.max(0, prev - 1))
    }

    return { href: result.result?.href }
  }, [setNotifications, setUnreadCount])

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
    [notifications, setNotifications, setUnreadCount],
  )

  React.useEffect(() => {
    dismissRef.current = dismiss
  }, [dismiss])

  const undoDismiss = React.useCallback(async () => {
    if (!dismissUndo) return
    await apiCall(`/api/notifications/${dismissUndo.notification.id}/restore`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
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
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
    })

    if (dismissUndo.previousStatus === 'unread') {
      setUnreadCount((prev) => prev + 1)
    }

    if (dismissUndoTimerRef.current) {
      window.clearTimeout(dismissUndoTimerRef.current)
    }
    setDismissUndo(null)
  }, [dismissUndo, setNotifications, setUnreadCount])

  const markAllRead = React.useCallback(async () => {
    await apiCall('/api/notifications/mark-all-read', { method: 'PUT' })
    setNotifications((prev) =>
      prev.map((n) =>
        n.status === 'unread'
          ? { ...n, status: 'read', readAt: new Date().toISOString() }
          : n,
      ),
    )
    setUnreadCount(0)
  }, [setNotifications, setUnreadCount])

  React.useEffect(() => {
    return () => {
      if (dismissUndoTimerRef.current) {
        window.clearTimeout(dismissUndoTimerRef.current)
      }
    }
  }, [])

  return {
    markAsRead,
    executeAction,
    dismiss,
    dismissUndo,
    undoDismiss,
    markAllRead,
    markAsReadRef,
    dismissRef,
  }
}
