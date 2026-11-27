"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { expandOccurrences } from '../../lib/calendar/recurrence'
import { getFetchWindow } from '../../lib/calendar/range'
import { mapInteractionToCalendarItem } from '../../lib/calendar/mapItem'
import { fetchCalendarCandidates } from '@open-mercato/core/helpers/calendar/interactionCandidates'
import type { CalendarInteractionPayload, CalendarItem, CalendarRange } from './types'

export {
  fetchCalendarCandidates,
  fetchInteractionWindow,
  MAX_WINDOW_ITEMS,
  mergeInteractionPayloads,
} from '@open-mercato/core/helpers/calendar/interactionCandidates'

type ActivityTypeDictionaryEntry = {
  value?: unknown
  label?: unknown
  color?: unknown
  icon?: unknown
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

export function useCalendarItems(range: CalendarRange): UseCalendarItemsResult {
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
        const result = await fetchCalendarCandidates(fetchWindow, controller.signal)
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

  return { items, isLoading, error, truncated, typeLabels, typeColors, typeIcons, refetch }
}
