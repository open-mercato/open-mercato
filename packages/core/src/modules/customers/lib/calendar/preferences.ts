// Whose overlaps the calendar flags as conflicts:
// - 'mine': only when the current user is an actor (owner/participant) in BOTH
//   overlapping events — i.e. the current user is personally double-booked.
// - 'all': any two visible org events that share an actor, even when the current
//   user is in neither (team-wide scheduling awareness).
export type ConflictScope = 'mine' | 'all'

export const CONFLICT_SCOPES: ConflictScope[] = ['mine', 'all']

export type CalendarPreferences = {
  showWeekends: boolean
  conflictWarnings: boolean
  conflictScope: ConflictScope
  showCrmActivities: boolean
  aiSummaries: boolean
  eventCategories: string[]
  activityTypes: string[]
}

export const MAX_EVENT_CATEGORIES = 8
export const MAX_ACTIVITY_TYPES = 6

export const DEFAULT_CALENDAR_PREFERENCES: CalendarPreferences = {
  showWeekends: false,
  conflictWarnings: true,
  conflictScope: 'mine',
  showCrmActivities: true,
  aiSummaries: true,
  eventCategories: [],
  activityTypes: [],
}

export const CALENDAR_PREFERENCES_STORAGE_PREFIX = 'om.customers.calendar.preferences.v1'

export function calendarPreferencesStorageKey(scopeKey: string): string {
  return `${CALENDAR_PREFERENCES_STORAGE_PREFIX}:${scopeKey}`
}

export function normalizeCalendarTagList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
    if (result.length >= max) break
  }
  return result
}

function readConflictScope(value: unknown, fallback: ConflictScope): ConflictScope {
  return value === 'mine' || value === 'all' ? value : fallback
}

export function mergeCalendarPreferences(stored: unknown): CalendarPreferences {
  if (!stored || typeof stored !== 'object') return { ...DEFAULT_CALENDAR_PREFERENCES }
  const record = stored as Record<string, unknown>
  const readBoolean = (key: keyof CalendarPreferences, fallback: boolean): boolean =>
    typeof record[key] === 'boolean' ? (record[key] as boolean) : fallback
  return {
    showWeekends: readBoolean('showWeekends', DEFAULT_CALENDAR_PREFERENCES.showWeekends),
    conflictWarnings: readBoolean('conflictWarnings', DEFAULT_CALENDAR_PREFERENCES.conflictWarnings),
    conflictScope: readConflictScope(record.conflictScope, DEFAULT_CALENDAR_PREFERENCES.conflictScope),
    showCrmActivities: readBoolean('showCrmActivities', DEFAULT_CALENDAR_PREFERENCES.showCrmActivities),
    aiSummaries: readBoolean('aiSummaries', DEFAULT_CALENDAR_PREFERENCES.aiSummaries),
    eventCategories: normalizeCalendarTagList(record.eventCategories, MAX_EVENT_CATEGORIES),
    activityTypes: normalizeCalendarTagList(record.activityTypes, MAX_ACTIVITY_TYPES),
  }
}

export function parseStoredCalendarPreferences(raw: string | null): CalendarPreferences {
  if (!raw) return { ...DEFAULT_CALENDAR_PREFERENCES }
  try {
    return mergeCalendarPreferences(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_CALENDAR_PREFERENCES }
  }
}

export function calendarPreferencesEqual(first: CalendarPreferences, second: CalendarPreferences): boolean {
  return (
    first.showWeekends === second.showWeekends &&
    first.conflictWarnings === second.conflictWarnings &&
    first.conflictScope === second.conflictScope &&
    first.showCrmActivities === second.showCrmActivities &&
    first.aiSummaries === second.aiSummaries &&
    first.eventCategories.length === second.eventCategories.length &&
    first.eventCategories.every((value, index) => value === second.eventCategories[index]) &&
    first.activityTypes.length === second.activityTypes.length &&
    first.activityTypes.every((value, index) => value === second.activityTypes[index])
  )
}
