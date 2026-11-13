"use client"
import { useCallback, useRef } from 'react'
import type { AppEventPayload } from '@open-mercato/shared/modules/widgets/injection'
import { BRIDGE_RECONNECTED_EVENT_ID, matchesPattern, useAppEvent } from './useAppEvent'
import { useAppEventCoalesced } from './useAppEventCoalesced'

const rejectAll = () => false

export type LiveRefetchOptions = {
  /**
   * Extra predicate for matching domain events (e.g. "is this my record?").
   * Never applied to the bridge reconnect event, which always refetches.
   */
  filter?: (payload: AppEventPayload) => boolean
  /** Dependency array for `refetch` / `filter` (defaults to []). */
  deps?: unknown[]
  /**
   * When set, collapse a burst of matching events (and any reconnect inside the
   * same window) into a leading and a trailing `refetch()` call via
   * `useAppEventCoalesced`.
   */
  coalesceMs?: number
}

/**
 * Keeps a live view fresh across event-bridge gaps.
 *
 * Calls `refetch()` (with no arguments) when an app event matching `eventPattern`
 * passes `filter`, and on every {@link BRIDGE_RECONNECTED_EVENT_ID}. Browser
 * delivery is at-most-once with gaps — events emitted while the SSE stream is
 * closed are never replayed — so the reconnect refetch is what recovers them.
 *
 * @example
 * useLiveRefetch('sales.order.*', () => reload(), {
 *   filter: (event) => event.payload.id === orderId,
 *   deps: [orderId, reload],
 * })
 */
export function useLiveRefetch(
  eventPattern: string,
  refetch: () => unknown,
  options: LiveRefetchOptions = {},
): void {
  const refetchRef = useRef(refetch)
  refetchRef.current = refetch
  const filterRef = useRef(options.filter)
  filterRef.current = options.filter
  const deps = options.deps ?? []
  const coalesce = typeof options.coalesceMs === 'number'

  const accepts = useCallback(
    (payload: AppEventPayload) => {
      if (payload.id === BRIDGE_RECONNECTED_EVENT_ID) return true
      if (!matchesPattern(eventPattern, payload.id)) return false
      return filterRef.current ? filterRef.current(payload) : true
    },
    [eventPattern],
  )

  useAppEvent(
    '*',
    (payload) => {
      if (!coalesce && accepts(payload)) void refetchRef.current()
    },
    [coalesce, accepts, ...deps],
  )

  useAppEventCoalesced(
    '*',
    () => {
      void refetchRef.current()
    },
    [accepts, ...deps],
    { windowMs: options.coalesceMs, filter: coalesce ? accepts : rejectAll },
  )
}
