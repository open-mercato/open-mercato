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

type FetchInteractionWindowOptions = {
  recurrenceMasters?: boolean
  maxItems?: number
}

/**
 * Cursor-follows `/api/customers/interactions` across the given window (already
 * padded by the caller) up to the candidate budget. The grid and the editor
 * conflict probe share this fetch path.
 */
export async function fetchInteractionWindow(
  window: CalendarRange,
  signal?: AbortSignal,
  options: FetchInteractionWindowOptions = {},
): Promise<{ payloads: CalendarInteractionPayload[]; truncated: boolean }> {
  const { maxItems = MAX_WINDOW_ITEMS, recurrenceMasters } = options
  const collected: CalendarInteractionPayload[] = []
  let cursor: string | undefined
  do {
    const params = new URLSearchParams({
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      limit: String(PAGE_LIMIT),
    })
    if (recurrenceMasters) params.set('recurrenceMasters', 'true')
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
  } while (cursor && collected.length < maxItems)
  return {
    payloads: collected.slice(0, maxItems),
    truncated: Boolean(cursor) || collected.length > maxItems,
  }
}

export function mergeInteractionPayloads(
  windowPayloads: CalendarInteractionPayload[],
  recurringPayloads: CalendarInteractionPayload[],
  maxItems = MAX_WINDOW_ITEMS,
): { payloads: CalendarInteractionPayload[]; truncated: boolean } {
  const windowById = new Map(windowPayloads.map((payload) => [payload.id, payload]))
  const byId = new Map<string, CalendarInteractionPayload>()
  for (const payload of recurringPayloads) {
    byId.set(payload.id, windowById.get(payload.id) ?? payload)
  }
  for (const payload of windowPayloads) {
    if (!byId.has(payload.id)) byId.set(payload.id, payload)
  }
  const payloads = Array.from(byId.values())
  return {
    payloads: payloads.slice(0, maxItems),
    truncated: payloads.length > maxItems,
  }
}

export async function fetchCalendarCandidates(
  window: CalendarRange,
  signal?: AbortSignal,
  maxItems = MAX_WINDOW_ITEMS,
): Promise<{ payloads: CalendarInteractionPayload[]; truncated: boolean }> {
  const [windowResult, recurringResult] = await Promise.all([
    fetchInteractionWindow(window, signal, { maxItems }),
    fetchInteractionWindow(window, signal, { maxItems, recurrenceMasters: true }),
  ])
  const merged = mergeInteractionPayloads(windowResult.payloads, recurringResult.payloads, maxItems)
  return {
    payloads: merged.payloads,
    truncated: windowResult.truncated || recurringResult.truncated || merged.truncated,
  }
}

type ActivityTypeDictionaryEntry = {
  value?: unknown
  label?: unknown
  color?: unknown
  icon?: unknown
}

export type UseCalendarItemsOptions = {
  maxItems?: number
}

export type UseCalendarItemsResult = {
  items: CalendarItem[]
  isLoading: boolean
  error: string | null
  truncated: boolean
  typeLabels: Record<string, string>
  typeColors: Record<string, string | null>
  typeIcons: Record<string, string | null>
  refetch: () => void
}

export function useCalendarItems(
  range: CalendarRange,
  { maxItems = MAX_WINDOW_ITEMS }: UseCalendarItemsOptions = {},
): UseCalendarItemsResult {
  const [payloads, setPayloads] = React.useState<CalendarInteractionPayload[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [truncated, setTruncated] = React.useState(false)
  const [typeLabels, setTypeLabels] = React.useState<Record<string, string>>({})
  const [typeColors, setTypeColors] = React.useState<Record<string, string | null>>({})
  const [typeIcons, setTypeIcons] = React.useState<Record<string, string | null>>({})
  const [reloadToken, setReloadToken] = React.useState(0)

  const fromTime = range.from.getTime()
  const toTime = range.to.getTime()
  const itemLimit = Number.isSafeInteger(maxItems) && maxItems > 0 ? maxItems : MAX_WINDOW_ITEMS

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
      const icons: Record<string, string | null> = {}
      for (const entry of entries) {
        if (typeof entry?.value !== 'string' || entry.value.length === 0) continue
        labels[entry.value] = typeof entry.label === 'string' && entry.label.length > 0 ? entry.label : entry.value
        colors[entry.value] = typeof entry.color === 'string' && entry.color.length > 0 ? entry.color : null
        icons[entry.value] = typeof entry.icon === 'string' && entry.icon.length > 0 ? entry.icon : null
      }
      setTypeLabels(labels)
      setTypeColors(colors)
      setTypeIcons(icons)
    }
    loadActivityTypes().catch(() => {
      if (cancelled || controller.signal.aborted) return
      setTypeLabels({})
      setTypeColors({})
      setTypeIcons({})
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
        const result = await fetchCalendarCandidates(fetchWindow, controller.signal, itemLimit)
        if (cancelled) return
        setPayloads(result.payloads)
        setTruncated(result.truncated)
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
  }, [fromTime, toTime, itemLimit, reloadToken])

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

  return { items, isLoading, error, truncated, typeLabels, typeColors, typeIcons, refetch }
}
