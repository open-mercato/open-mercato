"use client"

import * as React from 'react'
import { isTimesheetPeriodKind, type TimesheetPeriodKind } from './timesheetPeriod'

/**
 * "Filters (project, person, period) are remembered per user and come back next
 * time" — screen 11 note 4, US-E2.
 *
 * Storage follows `timesheets-projects-ui/useProjectsViewMode.ts` and
 * `time-tracking-ui/useBoardFilters.ts` verbatim rather than inventing a second
 * idiom for the same job: `localStorage`, guarded reads and writes, an optional
 * `userKey` segment no caller passes yet, and a lazy first read so a remount
 * restores without a round-trip.
 *
 * That precedent scopes the memory to the browser profile rather than to the
 * signed-in identity (watch item W10). Keying on the staff member id would be
 * strictly more correct, but the id is only known after the first request
 * resolves, so the first paint would either flash an unfiltered timesheet or
 * write under the wrong key. This matches the two hooks already shipped; when
 * one of them moves to identity keying, this moves with it.
 *
 * **The anchor day is deliberately NOT persisted.** A remembered week would
 * reopen the timesheet on whatever week the user last looked at, which is wrong
 * on Monday morning for everybody. The period *kind* is a preference; the period
 * *instance* is context, and context starts at today.
 */

export type TimesheetView = 'calendar' | 'list' | 'grid'

const PERIOD_KEY_PREFIX = 'staff.time_tracking.timesheet.period'
const VIEW_KEY_PREFIX = 'staff.time_tracking.timesheet.view'
const PROJECT_KEY_PREFIX = 'staff.time_tracking.timesheet.projectId'
const PERSON_KEY_PREFIX = 'staff.time_tracking.timesheet.staffMemberId'

export const ALL_OPTION_VALUE = 'all'

function storageKey(prefix: string, ...segments: Array<string | null | undefined>): string {
  const parts = [prefix]
  for (const segment of segments) {
    if (segment) parts.push(segment)
  }
  return parts.join(':')
}

function readStored(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // ignore — quota errors etc. are non-critical
  }
}

export function isTimesheetView(value: unknown): value is TimesheetView {
  return value === 'calendar' || value === 'list' || value === 'grid'
}

/**
 * Grid is the default for a week and the calendar for everything longer (the
 * spec fixes both ends; a quarter and a year read like a month, only more of
 * it). A week is the period people fill in, so it opens on the fastest surface
 * for filling it in.
 */
export function defaultViewForPeriod(kind: TimesheetPeriodKind): TimesheetView {
  return kind === 'week' ? 'grid' : 'calendar'
}

/**
 * The grid is a bulk-entry surface: one column per day, typed across. That holds
 * for a week and (tightly) for a month; ninety or three hundred and sixty five
 * columns is not a grid anybody can fill in, so longer periods simply do not
 * offer it.
 */
export function viewsForPeriod(kind: TimesheetPeriodKind): TimesheetView[] {
  return kind === 'week' || kind === 'month'
    ? ['calendar', 'list', 'grid']
    : ['calendar', 'list']
}

/** The view actually rendered — a remembered choice the current period cannot honour falls back to its default. */
export function resolveEffectiveView(kind: TimesheetPeriodKind, stored: TimesheetView): TimesheetView {
  return viewsForPeriod(kind).includes(stored) ? stored : defaultViewForPeriod(kind)
}

export function usePersistedPeriodKind(
  userKey?: string | null,
): [TimesheetPeriodKind, (next: TimesheetPeriodKind) => void] {
  const key = storageKey(PERIOD_KEY_PREFIX, userKey)
  const [kind, setKind] = React.useState<TimesheetPeriodKind>(() => {
    const stored = readStored(key)
    return isTimesheetPeriodKind(stored) ? stored : 'week'
  })
  const update = React.useCallback(
    (next: TimesheetPeriodKind) => {
      setKind(next)
      writeStored(key, next)
    },
    [key],
  )
  return [kind, update]
}

/**
 * The view is remembered PER PERIOD KIND, because the default is per period
 * kind. Choosing the list for a month must not silently override the grid a week
 * opens on, and vice versa.
 */
export function usePersistedView(
  periodKind: TimesheetPeriodKind,
  userKey?: string | null,
): [TimesheetView, (next: TimesheetView) => void] {
  const key = storageKey(VIEW_KEY_PREFIX, periodKind, userKey)
  const [view, setView] = React.useState<TimesheetView>(() => {
    const stored = readStored(key)
    return isTimesheetView(stored) ? stored : defaultViewForPeriod(periodKind)
  })
  const keyRef = React.useRef(key)
  React.useEffect(() => {
    if (keyRef.current === key) return
    keyRef.current = key
    const stored = readStored(key)
    setView(isTimesheetView(stored) ? stored : defaultViewForPeriod(periodKind))
  }, [key, periodKind])

  const update = React.useCallback(
    (next: TimesheetView) => {
      setView(next)
      writeStored(key, next)
    },
    [key],
  )
  return [view, update]
}

export function usePersistedFilterValue(
  kind: 'project' | 'person',
  userKey?: string | null,
): [string, (next: string) => void] {
  const key = storageKey(kind === 'project' ? PROJECT_KEY_PREFIX : PERSON_KEY_PREFIX, userKey)
  const [value, setValue] = React.useState<string>(() => readStored(key) ?? ALL_OPTION_VALUE)
  const update = React.useCallback(
    (next: string) => {
      setValue(next)
      writeStored(key, next)
    },
    [key],
  )
  return [value, update]
}
