"use client"
import { useEffect, useRef } from 'react'
import type { AppEventPayload } from '@open-mercato/shared/modules/widgets/injection'
import { APP_EVENT_DOM_NAME } from './useAppEvent'

const SSE_ENDPOINT = '/api/events/stream'
const HEARTBEAT_TIMEOUT = 45_000 // Expect heartbeat every 30s, allow 45s grace
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000
const DEDUP_WINDOW_MS = 500

/**
 * React hook that establishes a singleton SSE connection to the event bridge.
 *
 * Mount once in the app shell/layout. Receives server-side events with
 * `clientBroadcast: true` and dispatches them as `om:event` CustomEvents
 * on the window object for consumption by `useAppEvent`.
 *
 * Features:
 * - Auto-reconnect with exponential backoff
 * - Deduplication within 500ms window
 * - Heartbeat-based liveness detection
 * - Singleton connection per browser tab
 */
export function useEventBridge(): void {
  const sourceRef = useRef<EventSource | null>(null)
  const reconnectAttempts = useRef(0)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heartbeatTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recentEvents = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    let mounted = true

    function isDuplicate(eventPayload: AppEventPayload): boolean {
      const key = `${eventPayload.id}:${JSON.stringify(eventPayload.payload ?? {})}`
      const lastSeen = recentEvents.current.get(key)
      if (lastSeen && Date.now() - lastSeen < DEDUP_WINDOW_MS) return true
      recentEvents.current.set(key, Date.now())
      // Prune old entries
      if (recentEvents.current.size > 100) {
        const now = Date.now()
        for (const [k, v] of recentEvents.current) {
          if (now - v > DEDUP_WINDOW_MS * 2) recentEvents.current.delete(k)
        }
      }
      return false
    }

    function resetHeartbeatTimer() {
      if (heartbeatTimer.current) clearTimeout(heartbeatTimer.current)
      heartbeatTimer.current = setTimeout(() => {
        console.warn('[EventBridge] Heartbeat timeout — reconnecting')
        disconnect()
        scheduleReconnect()
      }, HEARTBEAT_TIMEOUT)
    }

    function connect() {
      if (!mounted) return
      if (sourceRef.current) return

      try {
        const source = new EventSource(SSE_ENDPOINT, { withCredentials: true })
        sourceRef.current = source

        source.onopen = () => {
          reconnectAttempts.current = 0
          resetHeartbeatTimer()
        }

        source.onmessage = (event) => {
          resetHeartbeatTimer()
          if (!event.data || event.data === ':heartbeat') return

          try {
            const parsed = JSON.parse(event.data) as AppEventPayload
            if (!parsed.id || typeof parsed.id !== 'string') return

            if (isDuplicate(parsed)) return

            window.dispatchEvent(
              new CustomEvent(APP_EVENT_DOM_NAME, { detail: parsed }),
            )
          } catch {
            // Ignore malformed events
          }
        }

        source.onerror = () => {
          disconnect()
          if (mounted) scheduleReconnect()
        }
      } catch {
        if (mounted) scheduleReconnect()
      }
    }

    function disconnect() {
      if (sourceRef.current) {
        sourceRef.current.close()
        sourceRef.current = null
      }
      if (heartbeatTimer.current) {
        clearTimeout(heartbeatTimer.current)
        heartbeatTimer.current = null
      }
    }

    function scheduleReconnect() {
      if (reconnectTimer.current) return
      const delay = Math.min(
        RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts.current),
        RECONNECT_MAX_MS,
      )
      reconnectAttempts.current++
      reconnectTimer.current = setTimeout(() => {
        reconnectTimer.current = null
        connect()
      }, delay)
    }

    connect()

    return () => {
      mounted = false
      disconnect()
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current)
        reconnectTimer.current = null
      }
    }
  }, [])
}
