import { AnalyticsInvalidWindowError, AnalyticsWindowTooLargeError } from '../errors'
import {
  comparisonWindows,
  localCalendarDate,
  resolveDefaultWindow,
  resolveWindow,
  shiftCalendarDate,
  zonedDateParts,
  zonedMidnightUtc,
} from '../window'
import { DAY_MS, HOUR_MS } from './analyticsTestSupport'

const iso = (ms: number) => new Date(ms).toISOString()

describe('X-Ray analytics windows', () => {
  it('resolves default windows as calendar days of the zone, today included', () => {
    const nowMs = Date.UTC(2026, 4, 15, 13, 45)
    const week = resolveDefaultWindow('7d', nowMs, 'UTC')
    expect(week.fromMs).toBe(Date.UTC(2026, 4, 9))
    expect(week.toMs).toBe(Date.UTC(2026, 4, 16))
    expect(week.windowKey).toBe('7d')
    const quarter = resolveDefaultWindow('90d', nowMs, 'UTC')
    expect((quarter.toMs - quarter.fromMs) / DAY_MS).toBe(90)
  })

  it('uses the tenant zone for day boundaries, also across a DST change', () => {
    const afterSpringForward = Date.UTC(2026, 2, 31, 12)
    const warsaw = resolveDefaultWindow('7d', afterSpringForward, 'Europe/Warsaw')
    expect(warsaw.fromMs).toBe(Date.UTC(2026, 2, 24, 23))
    expect(warsaw.toMs).toBe(Date.UTC(2026, 2, 31, 22))
    expect(warsaw.toMs - warsaw.fromMs).toBe(7 * DAY_MS - HOUR_MS)
    const lateEveningInNewYork = Date.UTC(2026, 4, 16, 2)
    const newYork = resolveDefaultWindow('7d', lateEveningInNewYork, 'America/New_York')
    expect(localCalendarDate(lateEveningInNewYork, 'America/New_York')).toEqual({ year: 2026, month: 5, day: 15 })
    expect(newYork.toMs).toBe(Date.UTC(2026, 4, 16, 4))
    expect(newYork.fromMs).toBe(Date.UTC(2026, 4, 9, 4))
  })

  it('finds the first instant of every day of a year, including days whose midnight is skipped or repeated', () => {
    const zones = ['UTC', 'Europe/Warsaw', 'America/Santiago', 'America/Havana', 'Australia/Lord_Howe', 'Asia/Kolkata', 'Pacific/Chatham']
    for (const zone of zones) {
      let date = { year: 2026, month: 1, day: 1 }
      for (let index = 0; index < 366; index += 1) {
        const midnight = zonedMidnightUtc(date, zone)
        expect(localCalendarDate(midnight, zone)).toEqual(date)
        expect(localCalendarDate(midnight - 1, zone)).toEqual(shiftCalendarDate(date, -1))
        date = shiftCalendarDate(date, 1)
      }
    }
  })

  it('reads zoned parts with a 0-23 hour cycle', () => {
    expect(zonedDateParts(Date.UTC(2026, 6, 1, 22, 0, 0), 'Europe/Warsaw')).toEqual({ year: 2026, month: 7, day: 2, hour: 0, minute: 0, second: 0 })
  })

  it('accepts custom windows up to 180 days and refuses longer ones with a background-job hint', () => {
    const fromMs = Date.UTC(2026, 0, 1)
    const exact = resolveWindow({ from: iso(fromMs), to: iso(fromMs + 180 * DAY_MS) }, { nowMs: fromMs, timeZone: 'UTC' })
    expect(exact.toMs - exact.fromMs).toBe(180 * DAY_MS)
    expect(exact.windowKey).toBeNull()
    let refused: unknown = null
    try {
      resolveWindow({ from: iso(fromMs), to: iso(fromMs + 180 * DAY_MS + 1) }, { nowMs: fromMs, timeZone: 'UTC' })
    } catch (error) {
      refused = error
    }
    expect(refused).toBeInstanceOf(AnalyticsWindowTooLargeError)
    expect(refused).toEqual(expect.objectContaining({ status: 422, code: 'window_too_large', hint: 'run_background_analysis', maxDays: 180 }))
    expect((refused as Error).message.startsWith('[internal] ')).toBe(true)
  })

  it('canonicalizes the zone name', () => {
    expect(resolveWindow({ windowKey: '7d' }, { nowMs: Date.UTC(2026, 4, 15), timeZone: 'utc' }).timeZone).toBe('UTC')
  })

  it('refuses empty windows and unknown zones', () => {
    const at = Date.UTC(2026, 0, 1)
    expect(() => resolveWindow({ from: iso(at), to: iso(at) }, { nowMs: at, timeZone: 'UTC' })).toThrow(AnalyticsInvalidWindowError)
    expect(() => resolveWindow({ windowKey: '7d' }, { nowMs: at, timeZone: 'Mars/Olympus_Mons' })).toThrow(AnalyticsInvalidWindowError)
  })

  it('builds equal-length comparison windows clipped to now', () => {
    const nowMs = Date.UTC(2026, 4, 15, 12)
    const week = resolveDefaultWindow('7d', nowMs, 'UTC')
    const { current, previous, lengthMs } = comparisonWindows(week, nowMs)
    expect(current.toMs).toBe(nowMs)
    expect(current.toMs - current.fromMs).toBe(lengthMs)
    expect(previous.toMs).toBe(current.fromMs)
    expect(previous.toMs - previous.fromMs).toBe(lengthMs)
    const past = resolveWindow({ from: iso(Date.UTC(2026, 0, 1)), to: iso(Date.UTC(2026, 0, 11)) }, { nowMs, timeZone: 'UTC' })
    const pastComparison = comparisonWindows(past, nowMs)
    expect(pastComparison.previous.fromMs).toBe(Date.UTC(2025, 11, 22))
    expect(pastComparison.current.toMs).toBe(Date.UTC(2026, 0, 11))
  })
})
