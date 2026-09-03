"use client"

import * as React from 'react'
import { isTimesheetPeriodKind, type TimesheetPeriodKind } from './timesheetPeriod'

/**
 * "Filters (project, person, period) are remembered per user and come back next
 * time" — screen 11 note 4, US-E2.
 *
 * Three inputs decide what the timesheet opens on, in this order:
 *
 *  1. **The query string** — `?period=` and `?view=` are the documented deep-link
 *     contract for screens 11 and 12, so a shared URL must beat whatever this
 *     browser happens to remember. An unparseable value is ignored rather than
 *     thrown on: a hand-edited link degrades to the remembered preference.
 *  2. **The remembered preference**, scoped to the signed-in staff member.
 *  3. **The period-dependent default.**
 *
 * `userKey` is the caller's staff member id, which only exists once the page has
 * resolved it. Reading the unscoped key first and writing BOTH keys keeps that
 * late arrival free: the unscoped entry is a first-paint hint (whoever wrote
 * last), the scoped entry is the truth, and for a browser with one user the two
 * always agree — so the hydration that follows the id is a no-op and costs no
 * reload. Two people sharing a browser converge on their own entry after the
 * first render pass instead of sharing one set of filters forever.
 *
 * **The anchor day is deliberately NOT persisted.** A remembered week would
 * reopen the timesheet on whatever week the user last looked at, which is wrong
 * on Monday morning for everybody. The period *kind* is a preference; the period
 * *instance* is context, and context starts at today.
 */

export type TimesheetView = 'calendar' | 'list' | 'grid'

export type TimesheetPreferenceScope = {
  /** Staff member id the preference belongs to; `null` until the page resolves it. */
  userKey?: string | null
}

export type TimesheetPreferenceOptions = TimesheetPreferenceScope & {
  /** Raw `?period=` / `?view=` value; anything unparseable is ignored. */
  urlOverride?: string | null
}

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

function readPreference<T>(
  scopedKey: string,
  sharedKey: string,
  parse: (raw: string | null) => T | null,
): T | null {
  const scoped = parse(readStored(scopedKey))
  if (scoped !== null) return scoped
  if (scopedKey === sharedKey) return null
  return parse(readStored(sharedKey))
}

function writePreference(scopedKey: string, sharedKey: string, value: string): void {
  writeStored(scopedKey, value)
  if (scopedKey !== sharedKey) writeStored(sharedKey, value)
}

export function isTimesheetView(value: unknown): value is TimesheetView {
  return value === 'calendar' || value === 'list' || value === 'grid'
}

function parsePeriodKind(raw: string | null): TimesheetPeriodKind | null {
  return isTimesheetPeriodKind(raw) ? raw : null
}

function parseView(raw: string | null): TimesheetView | null {
  return isTimesheetView(raw) ? raw : null
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
  options: TimesheetPreferenceOptions = {},
): [TimesheetPeriodKind, (next: TimesheetPeriodKind) => void] {
  const { userKey, urlOverride } = options
  const key = storageKey(PERIOD_KEY_PREFIX, userKey)
  const sharedKey = storageKey(PERIOD_KEY_PREFIX)
  const override = parsePeriodKind(urlOverride ?? null)

  const [kind, setKind] = React.useState<TimesheetPeriodKind>(
    () => override ?? readPreference(key, sharedKey, parsePeriodKind) ?? 'week',
  )

  // Back/forward and any other in-place URL change re-assert the link.
  React.useEffect(() => {
    if (override === null) return
    setKind(override)
  }, [override])

  const keyRef = React.useRef(key)
  React.useEffect(() => {
    if (keyRef.current === key) return
    keyRef.current = key
    if (override !== null) return
    setKind(readPreference(key, sharedKey, parsePeriodKind) ?? 'week')
  }, [key, override, sharedKey])

  const update = React.useCallback(
    (next: TimesheetPeriodKind) => {
      setKind(next)
      writePreference(key, sharedKey, next)
    },
    [key, sharedKey],
  )
  return [kind, update]
}

/**
 * The view is remembered PER PERIOD KIND, because the default is per period
 * kind. Choosing the list for a month must not silently override the grid a week
 * opens on, and vice versa.
 *
 * That is also why a period switch outranks `?view=`: the parameter described
 * the period the link was made on, while the remembered choice is specific to
 * the period now on screen.
 */
export function usePersistedView(
  periodKind: TimesheetPeriodKind,
  options: TimesheetPreferenceOptions = {},
): [TimesheetView, (next: TimesheetView) => void] {
  const { userKey, urlOverride } = options
  const key = storageKey(VIEW_KEY_PREFIX, periodKind, userKey)
  const sharedKey = storageKey(VIEW_KEY_PREFIX, periodKind)
  const override = parseView(urlOverride ?? null)

  const [view, setView] = React.useState<TimesheetView>(
    () => override ?? readPreference(key, sharedKey, parseView) ?? defaultViewForPeriod(periodKind),
  )

  React.useEffect(() => {
    if (override === null) return
    setView(override)
  }, [override])

  const keyRef = React.useRef(key)
  const periodRef = React.useRef(periodKind)
  React.useEffect(() => {
    if (keyRef.current === key) return
    const periodChanged = periodRef.current !== periodKind
    keyRef.current = key
    periodRef.current = periodKind
    if (override !== null && !periodChanged) return
    setView(readPreference(key, sharedKey, parseView) ?? defaultViewForPeriod(periodKind))
  }, [key, override, periodKind, sharedKey])

  const update = React.useCallback(
    (next: TimesheetView) => {
      setView(next)
      writePreference(key, sharedKey, next)
    },
    [key, sharedKey],
  )
  return [view, update]
}

export function usePersistedFilterValue(
  kind: 'project' | 'person',
  options: TimesheetPreferenceScope = {},
): [string, (next: string) => void] {
  const { userKey } = options
  const prefix = kind === 'project' ? PROJECT_KEY_PREFIX : PERSON_KEY_PREFIX
  const key = storageKey(prefix, userKey)
  const sharedKey = storageKey(prefix)

  const [value, setValue] = React.useState<string>(
    () => readPreference(key, sharedKey, (raw) => raw) ?? ALL_OPTION_VALUE,
  )

  const keyRef = React.useRef(key)
  React.useEffect(() => {
    if (keyRef.current === key) return
    keyRef.current = key
    setValue(readPreference(key, sharedKey, (raw) => raw) ?? ALL_OPTION_VALUE)
  }, [key, sharedKey])

  const update = React.useCallback(
    (next: string) => {
      setValue(next)
      writePreference(key, sharedKey, next)
    },
    [key, sharedKey],
  )
  return [value, update]
}
