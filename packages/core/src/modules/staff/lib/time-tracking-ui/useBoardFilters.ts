"use client"

import * as React from 'react'
import { EMPTY_BOARD_FILTERS, normalizeBoardFilters, type BoardFilters } from './boardFilters'

/**
 * Persisted board chrome (T3.8) — the spec's "Persistent context" principle applied to
 * screen 6: a filter you set is still set when you come back to the board.
 *
 * Storage follows `timesheets-projects-ui/useProjectsViewMode.ts` verbatim rather than
 * introducing a second mechanism for the same job: `localStorage`, guarded reads and
 * writes, an optional `userKey` segment, and a lazy first read so a remount restores
 * without a round-trip. Filters are additionally scoped by project, because "assigned to
 * me on Nordvik" is not a statement about any other project's board.
 */

const FILTERS_STORAGE_KEY_PREFIX = 'staff.time_tracking.board.filters'
const VIEW_STORAGE_KEY_PREFIX = 'staff.time_tracking.board.viewMode'

export type BoardViewMode = 'board' | 'list'

function storageKey(prefix: string, ...segments: Array<string | null | undefined>): string {
  const parts = [prefix]
  for (const segment of segments) {
    if (segment) parts.push(segment)
  }
  return parts.join(':')
}

function readStored(key: string): unknown {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function writeStored(key: string, value: unknown): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore — quota errors etc. are non-critical
  }
}

export function useBoardFilters({
  timeProjectId,
  userKey,
}: {
  timeProjectId: string | null | undefined
  userKey?: string | null
}): [BoardFilters, (next: BoardFilters) => void] {
  const key = storageKey(FILTERS_STORAGE_KEY_PREFIX, timeProjectId, userKey)
  const [filters, setFilters] = React.useState<BoardFilters>(() =>
    normalizeBoardFilters(readStored(key)),
  )
  const keyRef = React.useRef(key)

  React.useEffect(() => {
    if (keyRef.current === key) return
    keyRef.current = key
    // Switching project (or identity) swaps which saved set is in force — it never
    // carries the previous project's chips over.
    setFilters(normalizeBoardFilters(readStored(key)))
  }, [key])

  const update = React.useCallback(
    (next: BoardFilters) => {
      const normalized = normalizeBoardFilters(next)
      setFilters(normalized)
      writeStored(key, normalized)
    },
    [key],
  )

  return [filters, update]
}

export function useBoardViewMode({
  userKey,
  fallback = 'board',
}: {
  userKey?: string | null
  fallback?: BoardViewMode
} = {}): [BoardViewMode, (next: BoardViewMode) => void] {
  const key = storageKey(VIEW_STORAGE_KEY_PREFIX, userKey)
  const [mode, setMode] = React.useState<BoardViewMode>(() => {
    const stored = readStored(key)
    return stored === 'board' || stored === 'list' ? stored : fallback
  })

  const update = React.useCallback(
    (next: BoardViewMode) => {
      setMode(next)
      writeStored(key, next)
    },
    [key],
  )

  return [mode, update]
}

export { EMPTY_BOARD_FILTERS }
