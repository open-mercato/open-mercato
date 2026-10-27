"use client"

import * as React from 'react'

/**
 * Coalesces bursty reload triggers (e.g. SSE-driven refetches from
 * `useAppEvent`) into at most one execution per interval: the first call runs
 * immediately (leading edge) and every call arriving during the cooldown
 * collapses into a single trailing run at cooldown end. The pending timer is
 * cleared on unmount so a late reload never fires against an unmounted page.
 */
export function useCoalescedReload(
  reload: () => void,
  options?: { minIntervalMs?: number },
): () => void {
  const minIntervalMs = options?.minIntervalMs ?? 5000
  const reloadRef = React.useRef(reload)
  reloadRef.current = reload
  const lastRunAtRef = React.useRef(Number.NEGATIVE_INFINITY)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  return React.useCallback(() => {
    const elapsed = Date.now() - lastRunAtRef.current
    if (elapsed >= minIntervalMs) {
      lastRunAtRef.current = Date.now()
      reloadRef.current()
      return
    }
    if (timerRef.current) return
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      lastRunAtRef.current = Date.now()
      reloadRef.current()
    }, minIntervalMs - elapsed)
  }, [minIntervalMs])
}
