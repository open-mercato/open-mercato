"use client"

import * as React from 'react'
import { useCurrentUserId } from '@open-mercato/ui/backend/utils/useCurrentUserId'
import {
  CalendarPreferences,
  DEFAULT_CALENDAR_PREFERENCES,
  calendarPreferencesStorageKey,
  parseStoredCalendarPreferences,
} from '../../lib/calendar/preferences'

export type UseCalendarPreferencesResult = {
  preferences: CalendarPreferences
  setPreferences(next: CalendarPreferences): void
  hydrated: boolean
  // The current user's id (JWT subject), reused to scope "my meetings" conflicts.
  userId: string | null
}

export function useCalendarPreferences(): UseCalendarPreferencesResult {
  const userId = useCurrentUserId()
  const scopeKey = userId || 'anon'
  const [preferences, setPreferencesState] = React.useState<CalendarPreferences>(DEFAULT_CALENDAR_PREFERENCES)
  const [hydrated, setHydrated] = React.useState(false)

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    let raw: string | null = null
    try {
      raw = window.localStorage.getItem(calendarPreferencesStorageKey(scopeKey))
    } catch {
      raw = null
    }
    setPreferencesState(parseStoredCalendarPreferences(raw))
    setHydrated(true)
  }, [scopeKey])

  const setPreferences = React.useCallback(
    (next: CalendarPreferences) => {
      setPreferencesState(next)
      if (typeof window === 'undefined') return
      try {
        window.localStorage.setItem(calendarPreferencesStorageKey(scopeKey), JSON.stringify(next))
      } catch {
        // Storage may be unavailable (private mode / quota) — keep the in-memory value.
      }
    },
    [scopeKey],
  )

  return { preferences, setPreferences, hydrated, userId: userId || null }
}
