"use client"
import * as React from 'react'
import type { NotificationDto } from '@open-mercato/shared/modules/notifications/types'
import { apiCall } from '../../backend/utils/apiCall'

export type UsePortalNotificationsResult = {
  notifications: NotificationDto[]
  unreadCount: number
  hasNew: boolean
  isLoading: boolean
  refresh: () => void
  markAsRead: (id: string) => Promise<void>
  dismiss: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
}

const POLL_INTERVAL = 8000
const BASE = '/api/customer_accounts/portal/notifications'

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const { ok, result } = await apiCall<T>(url, init)
    if (!ok) return null
    return result
  } catch {
    return null
  }
}

/**
 * Portal notification hook — polls customer notification endpoints.
 *
 * Fetches notifications from `/api/customer_accounts/portal/notifications`
 * and unread count from `.../unread-count`. Polls every 8 seconds.
 *
 * Also listens for portal SSE events (`notifications.notification.created`)
 * to trigger immediate refresh.
 */
export function usePortalNotifications(): UsePortalNotificationsResult {
  const [notifications, setNotifications] = React.useState<NotificationDto[]>([])
  const [unreadCount, setUnreadCount] = React.useState(0)
  const [hasNew, setHasNew] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const lastIdRef = React.useRef<string | null>(null)

  const fetchAll = React.useCallback(async () => {
    const [listData, countData] = await Promise.all([
      fetchJson<{ ok: boolean; items: NotificationDto[] }>(`${BASE}?pageSize=50`),
      fetchJson<{ ok: boolean; unreadCount: number }>(`${BASE}/unread-count`),
    ])

    if (listData?.ok && listData.items) {
      const items = listData.items
      if (lastIdRef.current && items.length > 0 && items[0].id !== lastIdRef.current) {
        setHasNew(true)
        setTimeout(() => setHasNew(false), 3000)
      }
      if (items.length > 0) lastIdRef.current = items[0].id
      setNotifications(items)
    }

    if (countData?.ok) {
      setUnreadCount(countData.unreadCount)
    }

    setIsLoading(false)
  }, [])

  const [usePolling, setUsePolling] = React.useState(() => {
    if (typeof window === 'undefined' || !('EventSource' in window)) {
      return true
    }
    return (window as any).__portalBridgeHealthy === false
  })

  React.useEffect(() => {
    if (typeof window === 'undefined' || !('EventSource' in window)) {
      return
    }
    const handleStatusChange = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail && typeof detail.healthy === 'boolean') {
        setUsePolling(!detail.healthy)
      }
    }
    window.addEventListener('om:portal-bridge:status', handleStatusChange)
    return () => {
      window.removeEventListener('om:portal-bridge:status', handleStatusChange)
    }
  }, [])

  // Poll when fallback is active
  React.useEffect(() => {
    fetchAll()
    if (!usePolling) return
    const interval = setInterval(fetchAll, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchAll, usePolling])

  // Listen for portal SSE notification and bridge events
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (
        detail?.id === 'notifications.notification.created' ||
        detail?.id === 'notifications.notification.batch_created' ||
        detail?.id === 'om:portal-bridge:reconnected'
      ) {
        fetchAll()
      }
    }
    window.addEventListener('om:portal-event', handler)
    return () => window.removeEventListener('om:portal-event', handler)
  }, [fetchAll])

  // Focus refetch
  React.useEffect(() => {
    const onFocus = () => {
      fetchAll()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [fetchAll])

  const markAsRead = React.useCallback(async (id: string) => {
    await fetchJson(`${BASE}/${id}/read`, { method: 'PUT' })
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, status: 'read', readAt: new Date().toISOString() } : n)),
    )
    setUnreadCount((prev) => Math.max(0, prev - 1))
  }, [])

  const dismiss = React.useCallback(async (id: string) => {
    await fetchJson(`${BASE}/${id}/dismiss`, { method: 'PUT' })
    setNotifications((prev) => prev.filter((n) => n.id !== id))
    setUnreadCount((prev) => {
      const wasDismissedUnread = notifications.find((n) => n.id === id)?.status === 'unread'
      return wasDismissedUnread ? Math.max(0, prev - 1) : prev
    })
  }, [notifications])

  const markAllRead = React.useCallback(async () => {
    await fetchJson(`${BASE}/mark-all-read`, { method: 'PUT' })
    setNotifications((prev) =>
      prev.map((n) => (n.status === 'unread' ? { ...n, status: 'read', readAt: new Date().toISOString() } : n)),
    )
    setUnreadCount(0)
  }, [])

  const refresh = React.useCallback(() => { fetchAll() }, [fetchAll])

  return { notifications, unreadCount, hasNew, isLoading, refresh, markAsRead, dismiss, markAllRead }
}
