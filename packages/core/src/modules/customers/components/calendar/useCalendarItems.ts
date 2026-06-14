"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { expandOccurrences } from '../../lib/calendar/recurrence'
import { getFetchWindow } from '../../lib/calendar/range'
import { mapInteractionToCalendarItem } from '../../lib/calendar/mapItem'
import {
  calendarInteractionPayloadSchema,
  type CalendarInteractionPayload,
  type CalendarItem,
  type CalendarRange,
} from './types'

const PAGE_LIMIT = 100
export const MAX_WINDOW_ITEMS = 500

/**
 * Cursor-follows `/api/customers/interactions` across the given window (already
 * padded by the caller) up to `MAX_WINDOW_ITEMS`. Shared by the grid data hook
 * and the editor's conflict probe so both see the exact same candidate set.
 */
export async function fetchInteractionWindow(
  window: CalendarRange,
  signal?: AbortSignal,
): Promise<{ payloads: CalendarInteractionPayload[]; truncated: boolean }> {
  const collected: CalendarInteractionPayload[] = []
  let cursor: string | undefined
  let truncated = false
  do {
    const params = new URLSearchParams({
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      limit: String(PAGE_LIMIT),
    })
    if (cursor) params.set('cursor', cursor)
    const call = await apiCall<{ items?: unknown[]; nextCursor?: string }>(
      `/api/customers/interactions?${params.toString()}`,
      { signal },
    )
    if (!call.ok) throw new Error(`[internal] calendar interactions fetch failed (${call.status})`)
    const pageItems = Array.isArray(call.result?.items) ? call.result.items : []
    for (const rawItem of pageItems) {
      const parsed = calendarInteractionPayloadSchema.safeParse(rawItem)
      if (parsed.success) collected.push(parsed.data)
    }
    cursor = typeof call.result?.nextCursor === 'string' ? call.result.nextCursor : undefined
    if (cursor && collected.length >= MAX_WINDOW_ITEMS) {
      truncated = true
      cursor = undefined
    }
  } while (cursor)
  return { payloads: collected.slice(0, MAX_WINDOW_ITEMS), truncated }
}

type ActivityTypeDictionaryEntry = {
  value?: unknown
  label?: unknown
  color?: unknown
}

export type UseCalendarItemsResult = {
  items: CalendarItem[]
  isLoading: boolean
  error: string | null
  truncated: boolean
  typeLabels: Record<string, string>
  typeColors: Record<string, string | null>
  refetch: () => void
}

export function useCalendarItems(range: CalendarRange): UseCalendarItemsResult {
  const [payloads, setPayloads] = React.useState<CalendarInteractionPayload[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [truncated, setTruncated] = React.useState(false)
  const [typeLabels, setTypeLabels] = React.useState<Record<string, string>>({})
  const [typeColors, setTypeColors] = React.useState<Record<string, string | null>>({})
  const [reloadToken, setReloadToken] = React.useState(0)

  const fromTime = range.from.getTime()
  const toTime = range.to.getTime()

  React.useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    async function loadActivityTypes() {
      const call = await apiCall<{ items?: ActivityTypeDictionaryEntry[] }>(
        '/api/customers/dictionaries/activity-types',
        { signal: controller.signal },
      )
      if (cancelled || !call.ok) return
      const entries = Array.isArray(call.result?.items) ? call.result.items : []
      const labels: Record<string, string> = {}
      const colors: Record<string, string | null> = {}
      for (const entry of entries) {
        if (typeof entry?.value !== 'string' || entry.value.length === 0) continue
        labels[entry.value] = typeof entry.label === 'string' && entry.label.length > 0 ? entry.label : entry.value
        colors[entry.value] = typeof entry.color === 'string' && entry.color.length > 0 ? entry.color : null
      }
      setTypeLabels(labels)
      setTypeColors(colors)
    }
    loadActivityTypes().catch(() => {
      if (cancelled || controller.signal.aborted) return
      setTypeLabels({})
      setTypeColors({})
    })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  React.useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    async function loadInteractions() {
      setIsLoading(true)
      setError(null)
      try {
        const fetchWindow = getFetchWindow({ from: new Date(fromTime), to: new Date(toTime) })
        const { payloads: collected, truncated: windowTruncated } = await fetchInteractionWindow(
          fetchWindow,
          controller.signal,
        )
        if (cancelled) return
        setPayloads(collected)
        setTruncated(windowTruncated)
      } catch (err) {
        if (cancelled || controller.signal.aborted) return
        setPayloads([])
        setTruncated(false)
        setError(err instanceof Error ? err.message : '[internal] calendar interactions fetch failed')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    void loadInteractions()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [fromTime, toTime, reloadToken])

  const items = React.useMemo(() => {
    const expansionWindow = getFetchWindow({ from: new Date(fromTime), to: new Date(toTime) })
    const mapped: CalendarItem[] = []
    for (const payload of payloads) {
      const item = mapInteractionToCalendarItem(payload, typeColors)
      if (!item) continue
      mapped.push(...expandOccurrences(item, expansionWindow))
    }
    return mapped
  }, [payloads, typeColors, fromTime, toTime])

  const refetch = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  return { items, isLoading, error, truncated, typeLabels, typeColors, refetch }
}
