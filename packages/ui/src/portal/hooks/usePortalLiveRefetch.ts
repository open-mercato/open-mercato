"use client"
import { useRef } from 'react'
import type { AppEventPayload } from '@open-mercato/shared/modules/widgets/injection'
import { matchesPattern } from '../../backend/injection/useAppEvent'
import { PORTAL_BRIDGE_RECONNECTED_EVENT_ID, usePortalAppEvent } from './usePortalAppEvent'

export type PortalLiveRefetchOptions = {
  /**
   * Extra predicate for matching portal events (e.g. "is this my record?").
   * Never applied to the portal bridge reconnect event, which always refetches.
   */
  filter?: (payload: AppEventPayload) => boolean
  /** Dependency array for `refetch` / `filter` (defaults to []). */
  deps?: unknown[]
}

/**
 * Keeps a live portal view fresh across portal event-bridge gaps.
 *
 * Calls `refetch()` (with no arguments) when a portal event matching `eventPattern`
 * passes `filter`, and on every {@link PORTAL_BRIDGE_RECONNECTED_EVENT_ID}. Browser
 * delivery is at-most-once with gaps — events emitted while the SSE stream is
 * reconnecting are never replayed — so the reconnect refetch is what recovers them.
 *
 * @example
 * usePortalLiveRefetch('sales.order.status_changed', () => reload(), {
 *   filter: (event) => event.payload.orderId === orderId,
 *   deps: [orderId, reload],
 * })
 */
export function usePortalLiveRefetch(
  eventPattern: string,
  refetch: () => unknown,
  options: PortalLiveRefetchOptions = {},
): void {
  const refetchRef = useRef(refetch)
  refetchRef.current = refetch
  const filterRef = useRef(options.filter)
  filterRef.current = options.filter

  usePortalAppEvent(
    '*',
    (payload) => {
      if (payload.id !== PORTAL_BRIDGE_RECONNECTED_EVENT_ID) {
        if (!matchesPattern(eventPattern, payload.id)) return
        if (filterRef.current && !filterRef.current(payload)) return
      }
      void refetchRef.current()
    },
    [eventPattern, ...(options.deps ?? [])],
  )
}
