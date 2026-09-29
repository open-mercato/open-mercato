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
 *
 * `stableIdsRef` is mutated during render, which React's render-purity rule
 * normally forbids. It is safe here because the guard swaps the reference only
 * when the *content* differs: a concurrent render that React discards can leave
 * behind a different array identity, but never a content-stale value, and the
 * render that commits always leaves `stableIdsRef.current` content-equal to its
 * own `mergedIds`. `reorder` advances the same ref from its event handler so
 * that several reorders within one commit compose instead of overwriting each
 * other; a discarded state update leaves the ref ahead of `savedOrder` only
 * until the next render's content guard pulls it back (#4691).
 */
export function useGroupOrder(pageType: string, defaultGroupIds: string[]) {
  const [savedOrder, setSavedOrder] = React.useState<string[] | null>(null)

  React.useEffect(() => {
    const saved = readJsonFromLocalStorage<string[] | null>(getStorageKey(pageType), null)
    setSavedOrder(Array.isArray(saved) ? saved : null)
  }, [pageType])

  const mergedIds = savedOrder ? mergeOrder(savedOrder, defaultGroupIds) : defaultGroupIds

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
      stableIdsRef.current = next
      writeJsonToLocalStorage(getStorageKey(pageType), next)
      setSavedOrder(next)
    },
    [pageType],
  )

  return { orderedIds, reorder }
}
