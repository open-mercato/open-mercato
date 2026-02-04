"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { VersionHistoryConfig, VersionHistoryEntry } from './types'

export type UseVersionHistoryResult = {
  entries: VersionHistoryEntry[]
  isLoading: boolean
  error: string | null
  hasMore: boolean
  loadMore: () => void
  refresh: () => void
}

type VersionHistoryResponse = {
  items: VersionHistoryEntry[]
}

const PAGE_SIZE = 20

export function useVersionHistory(
  config: VersionHistoryConfig | null,
  enabled: boolean,
): UseVersionHistoryResult {
  const [entries, setEntries] = React.useState<VersionHistoryEntry[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [hasMore, setHasMore] = React.useState(false)
  const lastConfigRef = React.useRef<string | null>(null)

  const fetchEntries = React.useCallback(async (opts: { before?: string; reset?: boolean }) => {
    if (!config) return
    const params = new URLSearchParams({
      resourceKind: config.resourceKind,
      resourceId: config.resourceId,
      limit: String(PAGE_SIZE),
    })
    if (opts.before) params.set('before', opts.before)
    setIsLoading(true)
    setError(null)
    try {
      const call = await apiCall<VersionHistoryResponse>(
        `/api/audit_logs/audit-logs/actions?${params.toString()}`,
      )
      if (!call.ok) {
        setError(`Failed to load (${call.status})`)
        return
      }
      const items = Array.isArray(call.result?.items) ? call.result!.items : []
      const sorted = [...items].sort((a, b) => {
        const aTs = Date.parse(a.createdAt)
        const bTs = Date.parse(b.createdAt)
        return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0)
      })
      setEntries((prev) => {
        const next = opts.reset ? sorted : [...prev, ...sorted]
        const seen = new Set<string>()
        return next.filter((entry) => {
          if (seen.has(entry.id)) return false
          seen.add(entry.id)
          return true
        })
      })
      setHasMore(items.length === PAGE_SIZE)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setIsLoading(false)
    }
  }, [config])

  const refresh = React.useCallback(() => {
    if (!config) return
    setEntries([])
    setHasMore(false)
    void fetchEntries({ reset: true })
  }, [config, fetchEntries])

  const loadMore = React.useCallback(() => {
    if (!config || isLoading) return
    if (entries.length === 0) {
      void fetchEntries({ reset: true })
      return
    }
    if (!hasMore) return
    const lastEntry = entries[entries.length - 1]
    if (!lastEntry?.createdAt) return
    void fetchEntries({ before: lastEntry.createdAt })
  }, [config, entries, fetchEntries, hasMore, isLoading])

  React.useEffect(() => {
    if (!enabled || !config) return
    const key = `${config.resourceKind}::${config.resourceId}`
    if (lastConfigRef.current !== key) {
      lastConfigRef.current = key
      setEntries([])
      setHasMore(false)
      setError(null)
      void fetchEntries({ reset: true })
      return
    }
    if (entries.length === 0 && !isLoading && !error) {
      void fetchEntries({ reset: true })
    }
  }, [config, enabled, entries.length, error, fetchEntries, isLoading])

  return {
    entries,
    isLoading,
    error,
    hasMore,
    loadMore,
    refresh,
  }
}
