import { expandOccurrences } from '../recurrence'
import * as timezone from '../timezone'
import { makeCalendarItem, makePayload } from './fixtures'
import type { CalendarItem, CalendarRange } from '../../../components/calendar/types'

function makeRecurringItem(rule: string | null, options: { recurrenceEnd?: string | null } = {}): CalendarItem {
  const start = new Date(2026, 5, 1, 10, 0, 0)
  const end = new Date(2026, 5, 1, 11, 0, 0)
  return makeCalendarItem({
    id: 'series-base',
    start,
    end,
    raw: makePayload({
      id: 'series-base',
      recurrenceRule: rule,
      recurrenceEnd: options.recurrenceEnd ?? null,
    }),
  })
}

function windowOf(from: Date, to: Date): CalendarRange {
  return { from, to }
}

function makeOldZonedAllDayItem(rule: string): CalendarItem {
  const timezoneName = 'America/New_York'
  const start = timezone.calendarDayStartInstant('1900-01-01', timezoneName)
  const end = timezone.calendarDayEndInstant('1900-01-01', timezoneName)
  if (!start || !end) throw new Error('[internal] Expected a valid all-day calendar fixture')
  return makeCalendarItem({
    id: 'old-zoned-series',
    start,
    end,
    allDay: true,
    raw: makePayload({
      id: 'old-zoned-series',
      scheduledAt: start.toISOString(),
      timezone: timezoneName,
      allDay: true,
      recurrenceRule: rule,
    }),
  })
}

const twoWeekWindow = windowOf(new Date(2026, 5, 1, 0, 0, 0), new Date(2026, 5, 14, 23, 59, 59))

describe('expandOccurrences', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('returns the item unchanged when no recurrence rule is set', () => {
    const item = makeRecurringItem(null)
    const occurrences = expandOccurrences(item, twoWeekWindow)
    expect(occurrences).toHaveLength(1)
    expect(occurrences[0]).toBe(item)
  })

  it('returns the base occurrence only for unsupported rules', () => {
    const monthly = makeRecurringItem('FREQ=MONTHLY;COUNT=3')
    expect(expandOccurrences(monthly, twoWeekWindow)).toEqual([monthly])

    const withInterval = makeRecurringItem('FREQ=DAILY;INTERVAL=2')
    expect(expandOccurrences(withInterval, twoWeekWindow)).toEqual([withInterval])

    const malformed = makeRecurringItem('FREQ=WEEKLY;BYDAY=XX')
    expect(expandOccurrences(malformed, twoWeekWindow)).toEqual([malformed])

    const malformedUntil = makeRecurringItem('FREQ=DAILY;UNTIL=2026-06-05')
    expect(expandOccurrences(malformedUntil, twoWeekWindow)).toEqual([malformedUntil])
  })

  it('expands FREQ=DAILY with COUNT and suffixes occurrence ids', () => {
    const item = makeRecurringItem('FREQ=DAILY;COUNT=3')
    const occurrences = expandOccurrences(item, twoWeekWindow)
    expect(occurrences.map((occurrence) => occurrence.id)).toEqual([
      'series-base:0',
      'series-base:1',
      'series-base:2',
    ])
    expect(occurrences.map((occurrence) => occurrence.start.getDate())).toEqual([1, 2, 3])
    for (const occurrence of occurrences) {
      expect(occurrence.isRecurringOccurrence).toBe(true)
      expect(occurrence.raw.id).toBe('series-base')
      expect(occurrence.start.getHours()).toBe(10)
      expect(occurrence.end.getTime() - occurrence.start.getTime()).toBe(60 * 60 * 1000)
    }
  })

  it('expands FREQ=WEEKLY with a BYDAY list', () => {
    const item = makeRecurringItem('FREQ=WEEKLY;BYDAY=MO,WE,FR')
    const oneWeekWindow = windowOf(new Date(2026, 5, 1, 0, 0, 0), new Date(2026, 5, 7, 23, 59, 59))
    const occurrences = expandOccurrences(item, oneWeekWindow)
    expect(occurrences.map((occurrence) => occurrence.start.getDate())).toEqual([1, 3, 5])
    expect(occurrences.map((occurrence) => occurrence.start.getDay())).toEqual([1, 3, 5])
  })

  it('stops weekly expansion at UNTIL', () => {
    const item = makeRecurringItem('FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20260605T235959Z')
    const occurrences = expandOccurrences(item, twoWeekWindow)
    expect(occurrences.map((occurrence) => occurrence.start.getDate())).toEqual([1, 3, 5])
  })

  it('round-trips the producer rule format with COUNT', () => {
    const item = makeRecurringItem('FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=4')
    const occurrences = expandOccurrences(item, twoWeekWindow)
    expect(occurrences.map((occurrence) => occurrence.start.getDate())).toEqual([1, 3, 5, 8])
    expect(occurrences.map((occurrence) => occurrence.id)).toEqual([
      'series-base:0',
      'series-base:1',
      'series-base:2',
      'series-base:3',
    ])
  })

  it('respects the recurrenceEnd column as an expansion bound', () => {
    const item = makeRecurringItem('FREQ=DAILY', { recurrenceEnd: '2026-06-03T23:59:59.000Z' })
    const occurrences = expandOccurrences(item, twoWeekWindow)
    expect(occurrences.map((occurrence) => occurrence.start.getDate())).toEqual([1, 2, 3])
  })

  it('keeps the final occurrence when recurrenceEnd is stored as UTC midnight of the until date', () => {
    const item = makeRecurringItem('FREQ=WEEKLY;BYDAY=MO;UNTIL=20260608T235959Z', {
      // UTC midnight of the until date (the shape ScheduleActivityDialog persists);
      // built via Date.UTC so the fixed scenario carries no rotting date literal.
      recurrenceEnd: new Date(Date.UTC(2026, 5, 8)).toISOString(),
    })
    const occurrences = expandOccurrences(item, twoWeekWindow)
    expect(occurrences.map((occurrence) => occurrence.start.getDate())).toEqual([1, 8])
  })

  it('keeps series occurrence indices stable when the window starts mid-series', () => {
    const item = makeRecurringItem('FREQ=DAILY')
    const midSeriesWindow = windowOf(new Date(2026, 5, 3, 0, 0, 0), new Date(2026, 5, 4, 23, 59, 59))
    const occurrences = expandOccurrences(item, midSeriesWindow)
    expect(occurrences.map((occurrence) => occurrence.id)).toEqual(['series-base:2', 'series-base:3'])
  })

  it('counts duplicate BYDAY tokens once when fast-forwarding', () => {
    const item = makeRecurringItem('FREQ=WEEKLY;BYDAY=MO,MO')
    const midSeriesWindow = windowOf(new Date(2026, 5, 8, 0, 0, 0), new Date(2026, 5, 8, 23, 59, 59))
    const occurrences = expandOccurrences(item, midSeriesWindow)
    expect(occurrences.map((occurrence) => occurrence.id)).toEqual(['series-base:1'])
  })

  it('fast-forwards an old zoned all-day daily series across a DST boundary', () => {
    const item = makeOldZonedAllDayItem('FREQ=DAILY')
    const dayStartSpy = jest.spyOn(timezone, 'calendarDayStartInstant')
    const occurrences = expandOccurrences(
      item,
      windowOf(new Date('2026-03-08T05:00:00.000Z'), new Date('2026-03-09T03:59:59.999Z')),
    )

    expect(
      occurrences.map((occurrence) => [
        occurrence.id,
        occurrence.start.toISOString(),
        occurrence.end.toISOString(),
      ]),
    ).toEqual([['old-zoned-series:46087', '2026-03-08T05:00:00.000Z', '2026-03-09T03:59:59.999Z']])
    expect(dayStartSpy).toHaveBeenCalledTimes(2)
  })

  it('fast-forwards an old zoned all-day weekly series without changing its occurrence index', () => {
    const item = makeOldZonedAllDayItem('FREQ=WEEKLY;BYDAY=SU,TU,TH;COUNT=19752')
    const dayStartSpy = jest.spyOn(timezone, 'calendarDayStartInstant')
    const occurrences = expandOccurrences(
      item,
      windowOf(new Date('2026-03-08T05:00:00.000Z'), new Date('2026-03-09T03:59:59.999Z')),
    )

    expect(
      occurrences.map((occurrence) => [
        occurrence.id,
        occurrence.start.toISOString(),
        occurrence.end.toISOString(),
      ]),
    ).toEqual([['old-zoned-series:19751', '2026-03-08T05:00:00.000Z', '2026-03-09T03:59:59.999Z']])
    expect(dayStartSpy).toHaveBeenCalledTimes(2)
  })

  it('caps expansion at 100 occurrences per window', () => {
    const item = makeRecurringItem('FREQ=DAILY')
    const yearWindow = windowOf(new Date(2026, 5, 1, 0, 0, 0), new Date(2027, 5, 1, 0, 0, 0))
    const occurrences = expandOccurrences(item, yearWindow)
    expect(occurrences).toHaveLength(100)
    expect(occurrences[99].id).toBe('series-base:99')
  })

  it('falls back to the series start weekday for WEEKLY without BYDAY', () => {
    const item = makeRecurringItem('FREQ=WEEKLY')
    const occurrences = expandOccurrences(item, twoWeekWindow)
    expect(occurrences.map((occurrence) => occurrence.start.getDate())).toEqual([1, 8])
    expect(occurrences.every((occurrence) => occurrence.start.getDay() === 1)).toBe(true)
  })

  it('skips the series start day when BYDAY excludes its weekday', () => {
    const item = makeRecurringItem('FREQ=WEEKLY;BYDAY=TU;COUNT=2')
    const occurrences = expandOccurrences(item, twoWeekWindow)
    expect(occurrences.map((occurrence) => occurrence.start.getDate())).toEqual([2, 9])
    expect(occurrences[0].id).toBe('series-base:0')
  })
})
