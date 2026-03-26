"use client"
import { useEffect, useRef } from 'react'
import type { AppEventPayload } from '@open-mercato/shared/modules/widgets/injection'
import { matchesPattern } from '../../backend/injection/useAppEvent'

/**
 * DOM Event name for portal events.
 * Portal server-side events with `portalBroadcast: true` are dispatched as
 * CustomEvents with this name on the window object.
 */
export const PORTAL_EVENT_DOM_NAME = 'om:portal-event'

/**
 * React hook that listens for portal app events delivered via the Portal Event Bridge.
 *
 * Events are dispatched as `om:portal-event` CustomEvents on `window` by the portal
 * event bridge (see `usePortalEventBridge.ts`). This hook filters events by pattern
 * and calls the handler.
 *
 * @param eventPattern - Pattern to match event IDs against (e.g., 'sales.order.*')
 * @param handler - Callback invoked when a matching event arrives
 * @param deps - Optional dependency array for the handler (defaults to [])
 *
 * @example
 * ```tsx
 * import { usePortalAppEvent } from '@open-mercato/ui/portal/hooks/usePortalAppEvent'
 *
 * usePortalAppEvent('sales.order.status_changed', (event) => {
 *   refetch() // Refresh order list
 * })
 * ```
 */
export function usePortalAppEvent(
  eventPattern: string,
  handler: (payload: AppEventPayload) => void,
  deps: unknown[] = [],
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    const listener = (e: Event) => {
      const detail = (e as CustomEvent<AppEventPayload>).detail
      if (!detail || typeof detail.id !== 'string') return
      if (matchesPattern(eventPattern, detail.id)) {
        handlerRef.current(detail)
      }
    }

    window.addEventListener(PORTAL_EVENT_DOM_NAME, listener)
    return () => {
      window.removeEventListener(PORTAL_EVENT_DOM_NAME, listener)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventPattern, ...deps])
}
