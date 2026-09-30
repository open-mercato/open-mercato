import { calendarDayEndInstant, calendarInstantToWallTime, calendarWallTimeToInstant, isCalendarTimezone } from '../timezone'
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

  it('rejects nonexistent DST wall times and chooses the earlier instant during an overlap', () => {
    expect(calendarWallTimeToInstant('2026-03-29', '02:30', 'Europe/Warsaw')).toBeNull()
    expect(calendarWallTimeToInstant('2026-10-25', '02:30', 'Europe/Warsaw')?.toISOString()).toBe('2026-10-25T00:30:00.000Z')
    expect(calendarWallTimeToInstant('2026-02-30', '10:00', 'UTC')).toBeNull()
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

  it('keeps recurring event wall times fixed when the chosen zone crosses DST', () => {
    const item = mapInteractionToCalendarItem(makePayload({ timezone: 'Europe/Warsaw', scheduledAt: '2026-03-28T08:00:00Z', durationMinutes: 60, recurrenceRule: 'FREQ=DAILY;COUNT=3' }), {})!
    expect(expandOccurrences(item, { from: new Date('2026-03-28T00:00:00Z'), to: new Date('2026-03-31T00:00:00Z') }).map((entry) => entry.start.toISOString())).toEqual(['2026-03-28T08:00:00.000Z', '2026-03-29T07:00:00.000Z', '2026-03-30T07:00:00.000Z'])
  })
})
