"use client"

import * as React from 'react'
import { Notification, type NotificationProps } from './notification'

export type NotificationStackPlacement =
  | 'top-right'
  | 'top-left'
  | 'bottom-right'
  | 'bottom-left'
  | 'top-center'
  | 'bottom-center'

export type NotifyOptions = Omit<NotificationProps, 'id' | 'onDismiss'> & {
  /** Auto-dismiss the notification after this many milliseconds. Omit for manual-only dismiss (Notification default). */
  autoDismissMs?: number
}

export type NotificationEntry = NotifyOptions & {
  id: string
}

type NotificationContextValue = {
  notifications: NotificationEntry[]
  notify: (options: NotifyOptions) => string
  dismiss: (id: string) => void
  dismissAll: () => void
}

const NotificationContext = React.createContext<NotificationContextValue | null>(null)

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export type NotificationProviderProps = {
  children: React.ReactNode
  /**
   * Maximum number of notifications visible at once. Older entries beyond
   * this cap are removed FIFO. Default `5`.
   */
  maxVisible?: number
}

/**
 * Mount once near the app root (typically inside `AppShell` next to
 * `FlashMessages`). Provides the `useNotification()` hook to children
 * and renders the `NotificationStack` in a fixed-position portal-style
 * wrapper.
 *
 * Stack placement, gap, and per-entry behavior are consumer choice
 * via `NotificationStack` — `NotificationProvider` itself does not
 * render the visual list, only the context.
 */
export function NotificationProvider({ children, maxVisible = 5 }: NotificationProviderProps) {
  const [notifications, setNotifications] = React.useState<NotificationEntry[]>([])
  const timersRef = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const clearTimer = React.useCallback((id: string) => {
    const t = timersRef.current.get(id)
    if (t) {
      clearTimeout(t)
      timersRef.current.delete(id)
    }
  }, [])

  const dismiss = React.useCallback(
    (id: string) => {
      clearTimer(id)
      setNotifications((prev) => prev.filter((n) => n.id !== id))
    },
    [clearTimer],
  )

  const notify = React.useCallback(
    (options: NotifyOptions) => {
      const id = generateId()
      setNotifications((prev) => {
        const next = [...prev, { ...options, id }]
        // FIFO trim when exceeding the visible cap.
        return next.length > maxVisible ? next.slice(next.length - maxVisible) : next
      })
      if (typeof options.autoDismissMs === 'number' && options.autoDismissMs > 0) {
        const t = setTimeout(() => dismiss(id), options.autoDismissMs)
        timersRef.current.set(id, t)
      }
      return id
    },
    [dismiss, maxVisible],
  )

  const dismissAll = React.useCallback(() => {
    timersRef.current.forEach((t) => clearTimeout(t))
    timersRef.current.clear()
    setNotifications([])
  }, [])

  React.useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => clearTimeout(t))
      timersRef.current.clear()
    }
  }, [])

  const value = React.useMemo(
    () => ({ notifications, notify, dismiss, dismissAll }),
    [notifications, notify, dismiss, dismissAll],
  )

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
}

export function useNotification(): NotificationContextValue {
  const ctx = React.useContext(NotificationContext)
  if (!ctx) {
    throw new Error('useNotification must be used within a NotificationProvider')
  }
  return ctx
}

const placementClasses: Record<NotificationStackPlacement, string> = {
  'top-right': 'top-4 right-4 items-end',
  'top-left': 'top-4 left-4 items-start',
  'bottom-right': 'bottom-4 right-4 items-end',
  'bottom-left': 'bottom-4 left-4 items-start',
  'top-center': 'top-4 left-1/2 -translate-x-1/2 items-center',
  'bottom-center': 'bottom-4 left-1/2 -translate-x-1/2 items-center',
}

export type NotificationStackProps = {
  /** Where the stack floats on the viewport. Default `'top-right'`. */
  placement?: NotificationStackPlacement
  /** Max width per notification card. Default `380` (matches FlashMessages toast). */
  maxWidth?: number
  className?: string
}

/**
 * Renders the active `NotificationProvider` queue as a fixed-position
 * stack in one of six placements. Mount once next to
 * `NotificationProvider`, typically inside `AppShell` so notifications
 * float above every backend page.
 *
 * Each entry uses the `Notification` primitive — its `onDismiss`
 * automatically calls `dismiss(id)` from the provider so the user
 * clicking X removes the entry from the queue.
 */
export function NotificationStack({
  placement = 'top-right',
  maxWidth = 380,
  className,
}: NotificationStackProps) {
  const { notifications, dismiss } = useNotification()
  if (notifications.length === 0) return null

  return (
    <div
      className={[
        'pointer-events-none fixed z-toast flex flex-col gap-2',
        placementClasses[placement],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-slot="notification-stack"
      data-placement={placement}
    >
      {notifications.map((entry) => (
        <div
          key={entry.id}
          className="pointer-events-auto w-full"
          style={{ maxWidth }}
        >
          <Notification
            {...entry}
            onDismiss={() => dismiss(entry.id)}
          />
        </div>
      ))}
    </div>
  )
}
