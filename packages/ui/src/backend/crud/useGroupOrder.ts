'use client'
import * as React from 'react'

const STORAGE_PREFIX = 'om:group-order:'

function readOrder(pageType: string): string[] | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${pageType}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeOrder(pageType: string, order: string[]) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${pageType}`, JSON.stringify(order))
  } catch {
    // localStorage may be unavailable
  }
}

/**
 * Returns the group IDs in the user's preferred order.
 * Falls back to the default order when no preference is stored.
 */
export function useGroupOrder(pageType: string, defaultGroupIds: string[]) {
  const [orderedIds, setOrderedIds] = React.useState<string[]>(() => {
    const saved = readOrder(pageType)
    if (!saved) return defaultGroupIds
    // Merge: keep saved order for known IDs, append any new ones at end
    const known = new Set(defaultGroupIds)
    const result = saved.filter((id) => known.has(id))
    for (const id of defaultGroupIds) {
      if (!result.includes(id)) result.push(id)
    }
    return result
  })

  // Sync when defaultGroupIds changes (e.g. new groups added dynamically)
  React.useEffect(() => {
    setOrderedIds((prev) => {
      const known = new Set(defaultGroupIds)
      const merged = prev.filter((id) => known.has(id))
      for (const id of defaultGroupIds) {
        if (!merged.includes(id)) merged.push(id)
      }
      return merged
    })
  }, [defaultGroupIds.join(',')])

  const reorder = React.useCallback(
    (fromIndex: number, toIndex: number) => {
      setOrderedIds((prev) => {
        const next = [...prev]
        const [moved] = next.splice(fromIndex, 1)
        next.splice(toIndex, 0, moved)
        writeOrder(pageType, next)
        return next
      })
    },
    [pageType],
  )

  return { orderedIds, reorder }
}
