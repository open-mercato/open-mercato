"use client"
import { useEffect, useRef } from 'react'
import type { AppEventPayload } from '@open-mercato/shared/modules/widgets/injection'
import { APP_EVENT_DOM_NAME, matchesPattern } from './useAppEvent'

/**
 * Default coalescing window. Long enough to swallow a server-side ingest burst
 * (a mail poll emits its per-message events within a few hundred milliseconds),
 * short enough that the trailing refresh is not perceived as lag.
 */
export const DEFAULT_APP_EVENT_COALESCE_WINDOW_MS = 1000

export type AppEventCoalesceOptions = {
  /** Coalescing window in milliseconds. Defaults to {@link DEFAULT_APP_EVENT_COALESCE_WINDOW_MS}. */
  windowMs?: number
}

/**
 * Like {@link useAppEvent}, but collapses a burst of matching events into a
 * leading and a trailing handler call.
 *
 * Use this when the handler is expensive and idempotent — a react-query
 * invalidation that reloads a list is the canonical case: a single ingest cycle
 * emitting N events would otherwise trigger N full reloads of the same page.
 *
 * Semantics (leading + trailing, not plain debounce):
 * - The first event of a quiet period is handled synchronously, so a single
 *   user action still refreshes immediately.
 * - Every further event inside the window is collapsed; when the window closes,
 *   the handler runs once more with the most recent payload, so the final state
 *   is never missed. A burst spanning several windows keeps collapsing at a
 *   steady one call per window.
 * - Unmounting clears the pending window; the handler never runs afterwards.
 *
 * This differs from `NotificationDispatcher`'s `debounceMs` suppression, which
 * drops repeats outright because re-showing a toast has no value. Here the
 * trailing call is mandatory, because dropping it would leave the list stale.
 *
 * @param eventPattern - Pattern to match event IDs against (e.g. 'messages.message.*')
 * @param handler - Callback invoked with the most recent matching event of the window
 * @param deps - Optional dependency array for the handler (defaults to [])
 * @param options - Coalescing options
 *
 * @example
 * useAppEventCoalesced('messages.message.*', () => {
 *   void queryClient.invalidateQueries({ queryKey: ['messages', 'list'] })
 * }, [queryClient])
 */
export function useAppEventCoalesced(
  eventPattern: string,
  handler: (payload: AppEventPayload) => void,
  deps: unknown[] = [],
  options: AppEventCoalesceOptions = {},
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  const windowMs = options.windowMs ?? DEFAULT_APP_EVENT_COALESCE_WINDOW_MS

  useEffect(() => {
    let windowTimer: ReturnType<typeof setTimeout> | null = null
    let pending: AppEventPayload | null = null

    const closeWindow = () => {
      windowTimer = null
      if (!pending) return
      const payload = pending
      pending = null
      handlerRef.current(payload)
    }

    const listener = (e: Event) => {
      const detail = (e as CustomEvent<AppEventPayload>).detail
      if (!detail || typeof detail.id !== 'string') return
      if (!matchesPattern(eventPattern, detail.id)) return
      if (windowTimer !== null) {
        pending = detail
        return
      }
      windowTimer = setTimeout(closeWindow, windowMs)
      handlerRef.current(detail)
    }

    window.addEventListener(APP_EVENT_DOM_NAME, listener)
    return () => {
      window.removeEventListener(APP_EVENT_DOM_NAME, listener)
      if (windowTimer !== null) clearTimeout(windowTimer)
      windowTimer = null
      pending = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventPattern, windowMs, ...deps])
}
