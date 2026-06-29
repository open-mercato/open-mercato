import {
  DEFAULT_CALENDAR_PREFERENCES,
  MAX_ACTIVITY_TYPES,
  MAX_EVENT_CATEGORIES,
  calendarPreferencesEqual,
  calendarPreferencesStorageKey,
  mergeCalendarPreferences,
  normalizeCalendarTagList,
  parseStoredCalendarPreferences,
} from '../preferences'

describe('normalizeCalendarTagList', () => {
  it('trims, drops empties/non-strings, dedupes and caps to max', () => {
    const result = normalizeCalendarTagList(['  Call ', 'Email', 'Call', '', 42, 'Meeting'], 2)
    expect(result).toEqual(['Call', 'Email'])
  })

  it('returns an empty array for non-array input', () => {
    expect(normalizeCalendarTagList(undefined, 5)).toEqual([])
    expect(normalizeCalendarTagList('Call', 5)).toEqual([])
  })
})

describe('mergeCalendarPreferences', () => {
  it('returns defaults for non-object input', () => {
    expect(mergeCalendarPreferences(null)).toEqual(DEFAULT_CALENDAR_PREFERENCES)
    expect(mergeCalendarPreferences('x')).toEqual(DEFAULT_CALENDAR_PREFERENCES)
  })

  it('reads booleans and falls back per-key for missing/invalid values', () => {
    const merged = mergeCalendarPreferences({ showWeekends: true, conflictWarnings: 'nope' })
    expect(merged.showWeekends).toBe(true)
    expect(merged.conflictWarnings).toBe(DEFAULT_CALENDAR_PREFERENCES.conflictWarnings)
    expect(merged.showCrmActivities).toBe(DEFAULT_CALENDAR_PREFERENCES.showCrmActivities)
  })

  it('normalizes tag lists with their respective caps', () => {
    const merged = mergeCalendarPreferences({
      eventCategories: Array.from({ length: 20 }, (_, index) => `cat-${index}`),
      activityTypes: ['Call', 'Call', 'Email'],
    })
    expect(merged.eventCategories).toHaveLength(MAX_EVENT_CATEGORIES)
    expect(merged.activityTypes).toEqual(['Call', 'Email'])
    expect(merged.activityTypes.length).toBeLessThanOrEqual(MAX_ACTIVITY_TYPES)
  })

  it('reads a valid conflictScope and defaults to "mine" for missing/invalid values', () => {
    expect(mergeCalendarPreferences({ conflictScope: 'all' }).conflictScope).toBe('all')
    expect(mergeCalendarPreferences({ conflictScope: 'mine' }).conflictScope).toBe('mine')
    expect(mergeCalendarPreferences({ conflictScope: 'everyone' }).conflictScope).toBe('mine')
    expect(mergeCalendarPreferences({}).conflictScope).toBe('mine')
    expect(DEFAULT_CALENDAR_PREFERENCES.conflictScope).toBe('mine')
  })
})

describe('parseStoredCalendarPreferences', () => {
  it('returns defaults for null or invalid JSON', () => {
    expect(parseStoredCalendarPreferences(null)).toEqual(DEFAULT_CALENDAR_PREFERENCES)
    expect(parseStoredCalendarPreferences('{not json')).toEqual(DEFAULT_CALENDAR_PREFERENCES)
  })

  it('parses and merges valid JSON', () => {
    const parsed = parseStoredCalendarPreferences(JSON.stringify({ aiSummaries: false, activityTypes: ['Meeting'] }))
    expect(parsed.aiSummaries).toBe(false)
    expect(parsed.activityTypes).toEqual(['Meeting'])
  })
})

describe('calendarPreferencesStorageKey', () => {
  it('namespaces by scope', () => {
    expect(calendarPreferencesStorageKey('user-1')).toBe('om.customers.calendar.preferences.v1:user-1')
  })
})

describe('calendarPreferencesEqual', () => {
  it('is true for structurally equal preferences and false otherwise', () => {
    const base = { ...DEFAULT_CALENDAR_PREFERENCES, activityTypes: ['Call', 'Email'] }
    expect(calendarPreferencesEqual(base, { ...base, activityTypes: ['Call', 'Email'] })).toBe(true)
    expect(calendarPreferencesEqual(base, { ...base, showWeekends: !base.showWeekends })).toBe(false)
    expect(calendarPreferencesEqual(base, { ...base, activityTypes: ['Call'] })).toBe(false)
    expect(calendarPreferencesEqual(base, { ...base, conflictScope: 'all' })).toBe(false)
  })
})
