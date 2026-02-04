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
  const loadedKeysRef = React.useRef<Set<string>>(new Set())
  const wasEnabledRef = React.useRef(false)
  const activeResourceIdRef = React.useRef<string | null>(null)
  const fallbackTriedRef = React.useRef(false)

  const fetchEntries = React.useCallback(async (opts: { before?: string; reset?: boolean; resourceId?: string }) => {
    if (!config) return
    const resourceId = opts.resourceId
      ?? activeResourceIdRef.current
      ?? config.resourceId
    const key = `${config.resourceKind}::${resourceId}::${config.resourceIdFallback ?? 'none'}::${config.organizationId ?? 'default'}`
    const params = new URLSearchParams({
      resourceKind: config.resourceKind,
      resourceId,
      limit: String(PAGE_SIZE),
    })
    if (config.organizationId) params.set('organizationId', config.organizationId)
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
      if (
        opts.reset
        && items.length === 0
        && config.resourceIdFallback
        && resourceId === config.resourceId
        && config.resourceIdFallback !== config.resourceId
        && !fallbackTriedRef.current
      ) {
        fallbackTriedRef.current = true
        activeResourceIdRef.current = config.resourceIdFallback
        setEntries([])
        setHasMore(false)
        void fetchEntries({ reset: true, resourceId: config.resourceIdFallback })
        return
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      loadedKeysRef.current.add(key)
      setIsLoading(false)
    }
  }, [config])

  const refresh = React.useCallback(() => {
    if (!config) return
    const key = `${config.resourceKind}::${config.resourceId}::${config.resourceIdFallback ?? 'none'}::${config.organizationId ?? 'default'}`
    loadedKeysRef.current.delete(key)
    activeResourceIdRef.current = config.resourceId
    fallbackTriedRef.current = false
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
    void fetchEntries({
      before: lastEntry.createdAt,
      resourceId: activeResourceIdRef.current ?? config.resourceId,
    })
  }, [config, entries, fetchEntries, hasMore, isLoading])

  React.useEffect(() => {
    if (!enabled || !config) return
    const key = `${config.resourceKind}::${config.resourceId}::${config.resourceIdFallback ?? 'none'}::${config.organizationId ?? 'default'}`
    const isFirstEnable = !wasEnabledRef.current
    wasEnabledRef.current = true
    if (lastConfigRef.current !== key) {
      lastConfigRef.current = key
      loadedKeysRef.current.delete(key)
      activeResourceIdRef.current = config.resourceId
      fallbackTriedRef.current = false
      setEntries([])
      setHasMore(false)
      setError(null)
      void fetchEntries({ reset: true })
      return
    }
    if (isFirstEnable && !loadedKeysRef.current.has(key)) {
      void fetchEntries({ reset: true })
    }
  }, [config, enabled, fetchEntries])

  React.useEffect(() => {
    if (enabled) return
    wasEnabledRef.current = false
  }, [enabled])

  return {
    entries,
    isLoading,
    error,
    hasMore,
    loadMore,
    refresh,
  }
}
