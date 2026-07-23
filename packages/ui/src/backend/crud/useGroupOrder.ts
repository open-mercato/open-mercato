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
 *
 * State holds only the saved preference; the visible order is derived during
 * render. Syncing derived order back into state via an effect looped forever
 * when a host recreated `defaultGroupIds` with different content on every
 * render (#4386), so no effect writes state from `defaultGroupIds` here.
 */
export function useGroupOrder(pageType: string, defaultGroupIds: string[]) {
  const [savedOrder, setSavedOrder] = React.useState<string[] | null>(null)

  React.useEffect(() => {
    const saved = readJsonFromLocalStorage<string[] | null>(getStorageKey(pageType), null)
    setSavedOrder(Array.isArray(saved) ? saved : null)
  }, [pageType])

  const mergedIds = React.useMemo(
    () => (savedOrder ? mergeOrder(savedOrder, defaultGroupIds) : defaultGroupIds),
    [defaultGroupIds, savedOrder],
  )

  const stableIdsRef = React.useRef(mergedIds)
  if (!arraysEqual(stableIdsRef.current, mergedIds)) {
    stableIdsRef.current = mergedIds
  }
  const orderedIds = stableIdsRef.current

  const reorder = React.useCallback(
    (fromIndex: number, toIndex: number) => {
      const next = [...stableIdsRef.current]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      writeJsonToLocalStorage(getStorageKey(pageType), next)
      setSavedOrder(next)
    },
    [pageType],
  )

  return { orderedIds, reorder }
}
