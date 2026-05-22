'use client'
import * as React from 'react'
import {
  readJsonFromLocalStorage,
  writeJsonToLocalStorage,
} from '@open-mercato/shared/lib/browser/safeLocalStorage'

const STORAGE_PREFIX = 'om:group-order:'

function getStorageKey(pageType: string) {
  return `${STORAGE_PREFIX}${pageType}`
}

function mergeOrder(saved: string[], defaults: string[]): string[] {
  const known = new Set(defaults)
  const result = saved.filter((id) => known.has(id))
  for (const id of defaults) {
    if (!result.includes(id)) result.push(id)
  }
  return result
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * Returns the group IDs in the user's preferred order.
 * Falls back to the default order when no preference is stored.
 */
export function useGroupOrder(pageType: string, defaultGroupIds: string[]) {
  const [orderedIds, setOrderedIds] = React.useState<string[]>(defaultGroupIds)
  const mounted = React.useRef(false)

  React.useEffect(() => {
    mounted.current = true
    const saved = readJsonFromLocalStorage<string[] | null>(getStorageKey(pageType), null)
    if (Array.isArray(saved)) {
      setOrderedIds(mergeOrder(saved, defaultGroupIds))
    }
    // Intentionally only runs on mount (per pageType); defaultGroupIds changes are
    // handled by the sync effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageType])

  // Sync when defaultGroupIds changes (e.g. new groups added dynamically)
  React.useEffect(() => {
    setOrderedIds((prev) => {
      const merged = mergeOrder(prev, defaultGroupIds)
      return arraysEqual(prev, merged) ? prev : merged
    })
  }, [defaultGroupIds])

  const reorder = React.useCallback(
    (fromIndex: number, toIndex: number) => {
      setOrderedIds((prev) => {
        const next = [...prev]
        const [moved] = next.splice(fromIndex, 1)
        next.splice(toIndex, 0, moved)
        if (mounted.current) {
          writeJsonToLocalStorage(getStorageKey(pageType), next)
        }
        return next
      })
    },
    [pageType],
  )

  return { orderedIds, reorder }
}
