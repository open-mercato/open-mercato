"use client"

import { useAppEvent } from './useAppEvent'
import { flash } from '../FlashMessages'

/**
 * Global SSE Event Indicator
 *
 * Mount once in AppShell to provide visible feedback when server events
 * arrive via the DOM Event Bridge. Shows a flash message for every
 * broadcast event received.
 *
 * This component renders nothing — it only listens and triggers flash messages.
 */
export function SseEventIndicator(): null {
  useAppEvent('*', (event) => {
    const parts = event.id.split('.')
    const module = parts[0] ?? ''
    const action = parts[parts.length - 1] ?? 'event'
    flash(`[SSE] ${module}: ${action} (${event.id})`, 'info')
  })

  return null
}
