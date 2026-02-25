"use client"
import { useEffect, useRef } from 'react'
import type { AppEventPayload } from '@open-mercato/shared/modules/widgets/injection'

/**
 * DOM Event Bridge event name.
 * Server-side events with `clientBroadcast: true` are dispatched as
 * CustomEvents with this name on the window object.
 */
export const APP_EVENT_DOM_NAME = 'om:event'

/**
 * Match an event ID against a wildcard pattern.
 *
 * Supports:
 * - Exact match: `'example.todo.created'`
 * - Wildcard suffix: `'example.todo.*'` matches `'example.todo.created'`, `'example.todo.updated'`
 * - Global wildcard: `'*'` matches everything
 *
 * @example
 * matchesPattern('example.todo.*', 'example.todo.created') // true
 * matchesPattern('example.todo.*', 'example.item.created') // false
 * matchesPattern('*', 'anything.here') // true
 */
export function matchesPattern(pattern: string, eventId: string): boolean {
  if (pattern === '*') return true
  if (!pattern.includes('*')) return pattern === eventId
  const regex = new RegExp(
    '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$',
  )
  return regex.test(eventId)
}

/**
 * React hook that listens for app events delivered via the DOM Event Bridge.
 *
 * Events are dispatched as `om:event` CustomEvents on `window` by the event bridge
 * (see `eventBridge.ts`). This hook filters events by pattern and calls the handler.
 *
 * @param eventPattern - Pattern to match event IDs against (e.g., 'example.todo.*')
 * @param handler - Callback invoked when a matching event arrives
 * @param deps - Optional dependency array for the handler (defaults to [])
 *
 * @example
 * useAppEvent('example.todo.*', (event) => {
 *   console.log('Todo event:', event.id, event.payload)
 *   setRefreshKey(k => k + 1)
 * })
 */
export function useAppEvent(
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

    window.addEventListener(APP_EVENT_DOM_NAME, listener)
    return () => {
      window.removeEventListener(APP_EVENT_DOM_NAME, listener)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventPattern, ...deps])
}
