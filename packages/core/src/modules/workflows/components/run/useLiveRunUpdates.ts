'use client'

import * as React from 'react'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'

/** The DOM Event Bridge dispatches this after re-establishing a dropped SSE stream. */
const BRIDGE_RECONNECTED_EVENT = 'om:bridge:reconnected'

/**
 * A busy tenant can advance dozens of instances a second, and every step
 * advance re-emits `workflows.instance.started`. Collapsing the burst into one
 * refresh is what keeps a live run list from refetching per event.
 */
export const LIVE_REFRESH_THROTTLE_MS = 1500

export type UseLiveRunUpdatesOptions = {
  /**
   * When set, only events carrying this instance id refresh. Omit on the run
   * list, which cares about every instance in scope.
   */
  instanceId?: string | null
  onRefresh: () => void
  /** Turn the subscription off entirely (e.g. before the instance has loaded). */
  enabled?: boolean
  throttleMs?: number
}

/**
 * Live run updates (spec §8.3): "`workflows.instance.*` lifecycle events gain
 * `clientBroadcast: true`; run views subscribe via the DOM Event Bridge."
 *
 * The bridge is best-effort by design — the stream can drop, and the platform
 * caps an SSE payload at 4KB and replaces anything larger with a stub. So a
 * refresh is always a REFETCH, never an attempt to patch state from the
 * payload, and the hook also refreshes on the bridge's reconnect event to
 * close whatever gap the disconnection left.
 */
export function useLiveRunUpdates({
  instanceId,
  onRefresh,
  enabled = true,
  throttleMs = LIVE_REFRESH_THROTTLE_MS,
}: UseLiveRunUpdatesOptions): void {
  const onRefreshRef = React.useRef(onRefresh)
  onRefreshRef.current = onRefresh

  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastRunRef = React.useRef(0)

  const scheduleRefresh = React.useCallback(() => {
    if (timerRef.current !== null) return
    const sinceLast = Date.now() - lastRunRef.current
    const delay = Math.max(throttleMs - sinceLast, 0)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      lastRunRef.current = Date.now()
      onRefreshRef.current()
    }, delay)
  }, [throttleMs])

  React.useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    },
    []
  )

  useAppEvent(
    'workflows.instance.*',
    (event) => {
      if (!enabled) return
      if (instanceId) {
        const payloadInstanceId = event.payload?.id
        if (typeof payloadInstanceId !== 'string' || payloadInstanceId !== instanceId) return
      }
      scheduleRefresh()
    },
    [enabled, instanceId, scheduleRefresh]
  )

  useAppEvent(
    BRIDGE_RECONNECTED_EVENT,
    () => {
      if (!enabled) return
      scheduleRefresh()
    },
    [enabled, scheduleRefresh]
  )
}
