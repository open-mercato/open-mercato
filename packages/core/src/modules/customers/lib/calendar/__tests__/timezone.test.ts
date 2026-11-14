import * as timezone from '../timezone'
import { calendarDayEndInstant, calendarDayStartInstant, calendarInstantToWallTime, calendarTimezoneOptions, calendarWallTimeToInstant, canonicalCalendarTimezone, isCalendarTimezone } from '../timezone'
import { buildInteractionPayload, computeDurationMinutes, createDefaultFormState, parseItemToFormState } from '../editorPayload'
import { mapInteractionToCalendarItem } from '../mapItem'
import { expandOccurrences } from '../recurrence'
import { makePayload } from './fixtures'

describe('calendar selected time zone', () => {
  it('converts Warsaw and UTC wall times into different instants and restores their wall time', () => {
    expect(calendarWallTimeToInstant('2026-09-29', '09:15', 'Europe/Warsaw')?.toISOString()).toBe('2026-09-29T07:15:00.000Z')
    expect(calendarWallTimeToInstant('2026-09-29', '09:15', 'UTC')?.toISOString()).toBe('2026-09-29T09:15:00.000Z')
    expect(calendarInstantToWallTime(new Date('2026-09-29T07:15:00Z'), 'Europe/Warsaw')).toEqual({ date: '2026-09-29', time: '09:15' })
    expect(isCalendarTimezone('invalid-zone')).toBe(false)
  })

  it('canonicalizes a differently cased zone id so one zone never lists twice', () => {
    expect(canonicalCalendarTimezone('europe/warsaw')).toBe('Europe/Warsaw')
    expect(canonicalCalendarTimezone('EUROPE/WARSAW')).toBe('Europe/Warsaw')
    expect(canonicalCalendarTimezone('utc')).toBe('UTC')
    expect(canonicalCalendarTimezone('Europe/Warsaw')).toBe('Europe/Warsaw')
    expect(canonicalCalendarTimezone('invalid-zone')).toBeNull()
    expect(canonicalCalendarTimezone(null)).toBeNull()
    expect(calendarTimezoneOptions(canonicalCalendarTimezone('europe/warsaw')).filter((option) => option === 'Europe/Warsaw')).toHaveLength(1)
  })

  it('rejects nonexistent DST wall times and chooses the earlier instant during an overlap', () => {
    expect(calendarWallTimeToInstant('2026-03-29', '02:30', 'Europe/Warsaw')).toBeNull()
    expect(calendarWallTimeToInstant('2026-10-25', '02:30', 'Europe/Warsaw')?.toISOString()).toBe('2026-10-25T00:30:00.000Z')
    expect(calendarWallTimeToInstant('2026-02-30', '10:00', 'UTC')).toBeNull()
  })

  it('keeps a valid stored timezone alias selectable even when Intl omits it from the canonical list', () => {
    expect(isCalendarTimezone('US/Eastern')).toBe(true)
    expect(calendarTimezoneOptions('US/Eastern')).toContain('US/Eastern')
  })

  it('round trips a saved timezone and calculates elapsed duration across DST', () => {
    const state = { ...createDefaultFormState(), timezone: 'Europe/Warsaw', date: '2026-03-29', startTime: '01:30', endDate: '2026-03-29', endTime: '03:30', title: 'DST meeting' }
    expect(computeDurationMinutes(state)).toBe(60)
    const payload = buildInteractionPayload(state, { mode: 'create' })
    expect(payload).toMatchObject({ timezone: 'Europe/Warsaw', scheduledAt: '2026-03-29T00:30:00.000Z', durationMinutes: 60 })
    const item = mapInteractionToCalendarItem(makePayload({ timezone: 'Europe/Warsaw', scheduledAt: String(payload.scheduledAt), durationMinutes: 60 }), {})!
    expect(parseItemToFormState(item)).toMatchObject({ timezone: 'Europe/Warsaw', date: '2026-03-29', startTime: '01:30', endTime: '03:30' })
  })

  it('uses the selected zone for all-day boundaries and repeat end dates', () => {
    const state = { ...createDefaultFormState(), timezone: 'Europe/Warsaw', date: '2026-03-29', allDay: true, repeatFreq: 'daily' as const, repeatEndType: 'date' as const, repeatUntilDate: '2026-03-29' }
    const payload = buildInteractionPayload(state, { mode: 'create' })
    expect(payload).toMatchObject({ scheduledAt: '2026-03-28T23:00:00.000Z', recurrenceRule: 'FREQ=DAILY;UNTIL=20260329T215959Z', recurrenceEnd: '2026-03-29T21:59:59.999Z' })
    expect(calendarDayEndInstant('2026-03-29', 'Europe/Warsaw')?.toISOString()).toBe('2026-03-29T21:59:59.999Z')
    const item = mapInteractionToCalendarItem(makePayload({ timezone: 'Europe/Warsaw', scheduledAt: String(payload.scheduledAt), allDay: true }), {})!
    expect(item.start.toISOString()).toBe('2026-03-28T23:00:00.000Z')
    expect(item.end.toISOString()).toBe('2026-03-29T21:59:59.999Z')
  })

  it('maps, restores and saves all-day civil dates across a midnight DST gap', () => {
    expect(calendarWallTimeToInstant('2026-09-06', '00:00', 'America/Santiago')).toBeNull()
    expect(calendarDayStartInstant('2026-09-06', 'America/Santiago')?.toISOString()).toBe('2026-09-06T04:00:00.000Z')
    expect(calendarDayEndInstant('2026-09-05', 'America/Santiago')?.toISOString()).toBe('2026-09-06T03:59:59.999Z')
    for (const date of ['2026-09-05', '2026-09-06']) {
      const state = { ...createDefaultFormState(), timezone: 'America/Santiago', date, startTime: '00:00', allDay: true, title: 'Midnight shift', repeatFreq: 'daily' as const, repeatEndType: 'date' as const, repeatUntilDate: date }
      const payload = buildInteractionPayload(state, { mode: 'create' })
      const item = mapInteractionToCalendarItem(makePayload({ timezone: state.timezone, scheduledAt: String(payload.scheduledAt), allDay: true, recurrenceEnd: String(payload.recurrenceEnd), recurrenceRule: String(payload.recurrenceRule) }), {})!
      expect(item.start).toEqual(calendarDayStartInstant(date, state.timezone))
      expect(item.end).toEqual(calendarDayEndInstant(date, state.timezone))
      const restored = parseItemToFormState(item)
      expect(restored).toMatchObject({ date, allDay: true, repeatUntilDate: date, timezone: state.timezone })
      expect(buildInteractionPayload(restored, { mode: 'edit', id: item.id }).scheduledAt).toBe(payload.scheduledAt)
    }
    const series = mapInteractionToCalendarItem(makePayload({ timezone: 'America/Santiago', scheduledAt: '2026-09-05T04:00:00Z', allDay: true, recurrenceRule: 'FREQ=DAILY;COUNT=3' }), {})!
    expect(expandOccurrences(series, { from: new Date('2026-09-05T00:00:00Z'), to: new Date('2026-09-08T00:00:00Z') }).map((item) => [item.start.toISOString(), item.end.toISOString()])).toEqual([
      ['2026-09-05T04:00:00.000Z', '2026-09-06T03:59:59.999Z'],
      ['2026-09-06T04:00:00.000Z', '2026-09-07T02:59:59.999Z'],
      ['2026-09-07T03:00:00.000Z', '2026-09-08T02:59:59.999Z'],
    ])
  })

  it('skips nonexistent whole civil dates while ending the previous day at the next real boundary', () => {
    expect(calendarDayStartInstant('2011-12-30', 'Pacific/Apia')).toBeNull()
    expect(calendarDayEndInstant('2011-12-30', 'Pacific/Apia')).toBeNull()
    expect(calendarDayEndInstant('2011-12-29', 'Pacific/Apia')?.toISOString()).toBe('2011-12-30T09:59:59.999Z')
    const state = { ...createDefaultFormState(), timezone: 'Pacific/Apia', date: '2011-12-30', allDay: true }
    expect(() => buildInteractionPayload(state, { mode: 'create' })).toThrow('[internal] Invalid calendar local time')
  })

  it('keeps recurring event wall times fixed when the chosen zone crosses DST', () => {
    const item = mapInteractionToCalendarItem(makePayload({ timezone: 'Europe/Warsaw', scheduledAt: '2026-03-28T08:00:00Z', durationMinutes: 60, recurrenceRule: 'FREQ=DAILY;COUNT=3' }), {})!
    expect(expandOccurrences(item, { from: new Date('2026-03-28T00:00:00Z'), to: new Date('2026-03-31T00:00:00Z') }).map((entry) => entry.start.toISOString())).toEqual(['2026-03-28T08:00:00.000Z', '2026-03-29T07:00:00.000Z', '2026-03-30T07:00:00.000Z'])
  })

  it('uses the pre-gap offset for recurring wall times instead of dropping the RFC occurrence', () => {
    const item = mapInteractionToCalendarItem(makePayload({ timezone: 'Europe/Warsaw', scheduledAt: '2026-03-28T01:30:00Z', durationMinutes: 60, recurrenceRule: 'FREQ=DAILY;COUNT=3' }), {})!
    const occurrences = expandOccurrences(item, { from: new Date('2026-03-28T00:00:00Z'), to: new Date('2026-03-31T00:00:00Z') })
    expect(occurrences.map((entry) => [entry.id, entry.start.toISOString()])).toEqual([
      [`${item.id}:0`, '2026-03-28T01:30:00.000Z'],
      [`${item.id}:1`, '2026-03-29T01:30:00.000Z'],
      [`${item.id}:2`, '2026-03-30T00:30:00.000Z'],
    ])
  })

  it('fast-forwards an old timed series to the visible window', () => {
    const recurrenceWallSpy = jest.spyOn(timezone, 'calendarRecurrenceWallTimeToInstant')
    const item = mapInteractionToCalendarItem(makePayload({ timezone: 'UTC', scheduledAt: '1900-01-01T10:00:00Z', durationMinutes: 60, recurrenceRule: 'FREQ=DAILY' }), {})!
    const occurrences = expandOccurrences(item, { from: new Date('2026-09-29T00:00:00Z'), to: new Date('2026-09-29T23:59:59Z') })
    const elapsedDays = Math.floor((Date.UTC(2026, 8, 29) - Date.UTC(1900, 0, 1)) / 86_400_000)
    expect(occurrences.map((entry) => entry.id)).toEqual([`${item.id}:${elapsedDays}`])
    expect(recurrenceWallSpy.mock.calls.length).toBeLessThanOrEqual(2)
    recurrenceWallSpy.mockRestore()
  })
})
