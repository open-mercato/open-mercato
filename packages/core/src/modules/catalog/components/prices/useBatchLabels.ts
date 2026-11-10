"use client"

import * as React from 'react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

type LabelMap = Record<string, string>

/**
 * Resolves display names for a page's worth of foreign ids in one batched
 * request via the CRUD factory's generic `?ids=` narrowing (see
 * `packages/core/AGENTS.md` § API Interceptors) instead of one lookup per row.
 */
export function useBatchLabels(
  path: string,
  ids: string[],
  mapItem: (item: Record<string, unknown>) => { id: string; label: string } | null,
): LabelMap {
  const [labels, setLabels] = React.useState<LabelMap>({})
  const key = React.useMemo(
    () =>
      Array.from(new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0)))
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .join(','),
    [ids],
  )

  React.useEffect(() => {
    if (!key) return
    let cancelled = false
    async function load() {
      try {
        const idCount = key.split(',').length
        const payload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
          `${path}?ids=${encodeURIComponent(key)}&pageSize=${Math.min(100, idCount)}`,
          undefined,
          { fallback: { items: [] } },
        )
        if (cancelled) return
        const items = Array.isArray(payload.items) ? payload.items : []
        const next: LabelMap = {}
        for (const item of items) {
          const mapped = mapItem(item)
          if (mapped) next[mapped.id] = mapped.label
        }
        setLabels((prev) => ({ ...prev, ...next }))
      } catch {
        // Best-effort: callers fall back to the raw id when a label is missing.
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [key, path, mapItem])

  return labels
}
