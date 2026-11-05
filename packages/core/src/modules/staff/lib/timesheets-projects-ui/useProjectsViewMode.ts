"use client"

import * as React from 'react'

export type ProjectsViewMode = 'table' | 'cards'

const STORAGE_KEY_PREFIX = 'staff.timesheets.projects.viewMode'

function storageKey(userKey: string | null | undefined): string {
  return userKey ? `${STORAGE_KEY_PREFIX}:${userKey}` : STORAGE_KEY_PREFIX
}

function readStoredMode(userKey: string | null | undefined): ProjectsViewMode | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(storageKey(userKey))
    return raw === 'cards' || raw === 'table' ? raw : null
  } catch {
    return null
  }
}

function writeStoredMode(userKey: string | null | undefined, mode: ProjectsViewMode): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(userKey), mode)
  } catch {
    // ignore — quota errors etc. are non-critical
  }
}

export function useProjectsViewMode({
  userKey,
  urlOverride,
  fallback = 'table',
}: {
  userKey: string | null | undefined
  urlOverride?: string | null
  fallback?: ProjectsViewMode
}): [ProjectsViewMode, (next: ProjectsViewMode) => void] {
  const initial = React.useMemo<ProjectsViewMode>(() => {
    if (urlOverride === 'cards' || urlOverride === 'table') return urlOverride
    return readStoredMode(userKey) ?? fallback
  }, [urlOverride, userKey, fallback])

  const [mode, setMode] = React.useState<ProjectsViewMode>(initial)

  React.useEffect(() => {
    if (urlOverride === 'cards' || urlOverride === 'table') {
      setMode(urlOverride)
    }
  }, [urlOverride])

  const update = React.useCallback(
    (next: ProjectsViewMode) => {
      setMode(next)
      writeStoredMode(userKey, next)
    },
    [userKey],
  )

  return [mode, update]
}
