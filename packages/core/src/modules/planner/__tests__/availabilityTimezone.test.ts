/** @jest-environment node */

/**
 * Unit coverage for the planner timezone primitives (issue #5862).
 *
 * Every expectation here is an absolute instant or a zone-relative calendar
 * field, so none of them may depend on the host process's `TZ`. The suite runs
 * on both CI legs (`test` in America/New_York and `test:tz` at a positive offset).
 */

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

import {
  isResolvableTimeZone,
  nextWeekdayDateKey,
  resolveTimeZone,
  warnOnUnresolvableTimeZone,
  zonedDateKey,
  zonedDayBounds,
  zonedWallTimeToInstant,
  zonedWeekday,
} from '../lib/availabilityTimezone'
import {
  plannerAvailabilityDateSpecificReplaceSchema,
  plannerAvailabilityWeeklyReplaceSchema,
} from '../data/validators'

const mockLogger = jest.requireMock('@open-mercato/shared/lib/logger').createLogger('test') as {
  warn: jest.Mock
}

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SUBJECT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

describe('resolveTimeZone', () => {
  it('passes through a resolvable IANA zone', () => {
    expect(resolveTimeZone('Europe/Warsaw')).toBe('Europe/Warsaw')
    expect(resolveTimeZone('  Pacific/Auckland  ')).toBe('Pacific/Auckland')
  })

  it('degrades an unresolvable or empty zone to UTC rather than throwing', () => {
    // Legacy rows store `timezone` as free-form text, so a malformed value must
    // not turn a read into a 500. Writes still accept it during the deprecation
    // window, log a `[deprecated]` warning and anchor to UTC.
    expect(resolveTimeZone('Europe/Warszawa')).toBe('UTC')
    expect(resolveTimeZone('')).toBe('UTC')
    expect(resolveTimeZone('   ')).toBe('UTC')
    expect(resolveTimeZone(null)).toBe('UTC')
    expect(resolveTimeZone(undefined)).toBe('UTC')
  })
})

describe('zonedWallTimeToInstant', () => {
  it('resolves wall time against the given zone', () => {
    expect(zonedWallTimeToInstant('2026-06-15', '09:00', 'UTC')?.toISOString())
      .toBe('2026-06-15T09:00:00.000Z')
    // CEST (+2) in June.
    expect(zonedWallTimeToInstant('2026-06-15', '09:00', 'Europe/Warsaw')?.toISOString())
      .toBe('2026-06-15T07:00:00.000Z')
    // NZST (+12) — lands on the previous UTC day.
    expect(zonedWallTimeToInstant('2026-06-15', '09:00', 'Pacific/Auckland')?.toISOString())
      .toBe('2026-06-14T21:00:00.000Z')
    // EDT (-4) — lands later the same UTC day.
    expect(zonedWallTimeToInstant('2026-06-15', '09:00', 'America/New_York')?.toISOString())
      .toBe('2026-06-15T13:00:00.000Z')
  })

  it('tracks the zone offset across a DST transition', () => {
    // Warsaw is +2 before 2026-10-25 and +1 after, so the same wall time maps
    // to different instants either side of the boundary.
    expect(zonedWallTimeToInstant('2026-10-24', '09:00', 'Europe/Warsaw')?.toISOString())
      .toBe('2026-10-24T07:00:00.000Z')
    expect(zonedWallTimeToInstant('2026-10-26', '09:00', 'Europe/Warsaw')?.toISOString())
      .toBe('2026-10-26T08:00:00.000Z')
  })

  it('moves a skipped wall time forward by the length of the gap', () => {
    // Cairo has no 2026-04-24 00:00 (+2 → +3); 00:30 becomes 01:30 local.
    expect(zonedWallTimeToInstant('2026-04-24', '00:00', 'Africa/Cairo')?.toISOString())
      .toBe('2026-04-23T22:00:00.000Z')
    expect(zonedWallTimeToInstant('2026-04-24', '00:30', 'Africa/Cairo')?.toISOString())
      .toBe('2026-04-23T22:30:00.000Z')
    // Warsaw skips 02:00–03:00 on 2026-03-29.
    expect(zonedWallTimeToInstant('2026-03-29', '02:30', 'Europe/Warsaw')?.toISOString())
      .toBe('2026-03-29T01:30:00.000Z')
  })

  it('resolves a repeated wall time to its earlier occurrence', () => {
    // Warsaw repeats 02:00–03:00 on 2026-10-25; the first 02:30 is CEST (+2).
    expect(zonedWallTimeToInstant('2026-10-25', '02:30', 'Europe/Warsaw')?.toISOString())
      .toBe('2026-10-25T00:30:00.000Z')
    expect(zonedWallTimeToInstant('2026-10-25', '03:30', 'Europe/Warsaw')?.toISOString())
      .toBe('2026-10-25T02:30:00.000Z')
    // New York repeats 01:00–02:00 on 2026-11-01; the first 01:30 is EDT (-4).
    expect(zonedWallTimeToInstant('2026-11-01', '01:30', 'America/New_York')?.toISOString())
      .toBe('2026-11-01T05:30:00.000Z')
  })

  it('rejects malformed date keys and times', () => {
    expect(zonedWallTimeToInstant('15-06-2026', '09:00', 'UTC')).toBeNull()
    expect(zonedWallTimeToInstant('2026-02-30', '09:00', 'UTC')).toBeNull()
    expect(zonedWallTimeToInstant('', '09:00', 'UTC')).toBeNull()
    expect(zonedWallTimeToInstant('2026-06-15', '25:00', 'UTC')).toBeNull()
    expect(zonedWallTimeToInstant('2026-06-15', '09:61', 'UTC')).toBeNull()
    expect(zonedWallTimeToInstant('2026-06-15', 'nope', 'UTC')).toBeNull()
  })
})

describe('zonedDayBounds', () => {
  it('spans local midnight to the next local midnight', () => {
    const bounds = (dateKey: string, zone: string) => {
      const result = zonedDayBounds(dateKey, zone)
      return result && [result.start.toISOString(), result.end.toISOString()]
    }
    expect(bounds('2026-06-15', 'Europe/Warsaw')).toEqual(['2026-06-14T22:00:00.000Z', '2026-06-15T22:00:00.000Z'])
    // 23 hours: midnight is skipped, the day starts at 01:00 local.
    expect(bounds('2026-04-24', 'Africa/Cairo')).toEqual(['2026-04-23T22:00:00.000Z', '2026-04-24T21:00:00.000Z'])
    // 25 hours: the fall-back day.
    expect(bounds('2026-10-25', 'Europe/Warsaw')).toEqual(['2026-10-24T22:00:00.000Z', '2026-10-25T23:00:00.000Z'])
    expect(bounds('2026-12-31', 'UTC')).toEqual(['2026-12-31T00:00:00.000Z', '2027-01-01T00:00:00.000Z'])
    expect(zonedDayBounds('2011-12-30', 'Pacific/Apia')).toBeNull()
    expect(zonedDayBounds('2026-13-01', 'UTC')).toBeNull()
  })
})

describe('zonedDateKey', () => {
  it('reports the calendar day as seen from the zone', () => {
    const instant = new Date('2026-06-14T21:00:00Z')
    expect(zonedDateKey(instant, 'UTC')).toBe('2026-06-14')
    // The same instant is already the 15th in Auckland.
    expect(zonedDateKey(instant, 'Pacific/Auckland')).toBe('2026-06-15')
    expect(zonedDateKey(instant, 'America/New_York')).toBe('2026-06-14')
  })

  it('falls back to UTC for an unresolvable zone', () => {
    expect(zonedDateKey(new Date('2026-06-14T21:00:00Z'), 'Not/AZone')).toBe('2026-06-14')
  })
})

describe('zonedWeekday', () => {
  it('reports the weekday as seen from the zone', () => {
    // 2026-06-14T21:00Z is a Sunday in UTC, Monday in Auckland.
    const instant = new Date('2026-06-14T21:00:00Z')
    expect(zonedWeekday(instant, 'UTC')).toBe(0)
    expect(zonedWeekday(instant, 'Pacific/Auckland')).toBe(1)
  })
})

describe('nextWeekdayDateKey', () => {
  const from = new Date('2026-06-15T12:00:00Z') // Monday in UTC

  it('returns today when the requested weekday is today in that zone', () => {
    expect(nextWeekdayDateKey(1, 'UTC', from)).toBe('2026-06-15')
  })

  it('rolls forward a full week when the zone is already past that weekday', () => {
    // 12:00Z Monday is Tuesday in Auckland, so the next Monday is the 22nd.
    // Reading the weekday from the host clock shifted the whole series.
    expect(nextWeekdayDateKey(1, 'Pacific/Auckland', from)).toBe('2026-06-22')
  })

  it('finds the next occurrence later in the same week', () => {
    expect(nextWeekdayDateKey(3, 'UTC', from)).toBe('2026-06-17')
    expect(nextWeekdayDateKey(0, 'UTC', from)).toBe('2026-06-21')
  })
})

describe('replace schemas keep accepting an unresolvable timezone (deprecation window)', () => {
  const weeklyBase = {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    subjectType: 'member' as const,
    subjectId: SUBJECT_ID,
    windows: [{ weekday: 1, start: '09:00', end: '17:00' }],
  }
  const dateSpecificBase = {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    subjectType: 'member' as const,
    subjectId: SUBJECT_ID,
    dates: ['2026-06-15'],
    windows: [{ start: '09:00', end: '17:00' }],
  }

  it('accepts resolvable zones', () => {
    expect(plannerAvailabilityWeeklyReplaceSchema.safeParse({ ...weeklyBase, timezone: 'Europe/Warsaw' }).success).toBe(true)
    expect(plannerAvailabilityDateSpecificReplaceSchema.safeParse({ ...dateSpecificBase, timezone: 'UTC' }).success).toBe(true)
  })

  it('still accepts an unknown zone so the request contract is not narrowed', () => {
    expect(plannerAvailabilityWeeklyReplaceSchema.safeParse({ ...weeklyBase, timezone: 'Europe/Warszawa' }).success).toBe(true)
    expect(plannerAvailabilityDateSpecificReplaceSchema.safeParse({ ...dateSpecificBase, timezone: 'Mars/Olympus_Mons' }).success).toBe(true)
    expect(plannerAvailabilityWeeklyReplaceSchema.safeParse({ ...weeklyBase, timezone: '' }).success).toBe(false)
  })
})

describe('warnOnUnresolvableTimeZone', () => {
  beforeEach(() => mockLogger.warn.mockClear())

  it('flags an unresolvable zone as deprecated with the command and the fallback', () => {
    warnOnUnresolvableTimeZone('Europe/Warszawa', 'planner.availability.weekly.replace')
    expect(mockLogger.warn).toHaveBeenCalledTimes(1)
    expect(mockLogger.warn.mock.calls[0][0]).toMatch(/^\[deprecated\]/)
    expect(mockLogger.warn.mock.calls[0][1]).toEqual({
      commandId: 'planner.availability.weekly.replace',
      timezone: 'Europe/Warszawa',
      fallback: 'UTC',
    })
  })

  it('stays silent for resolvable zones, including legacy aliases Intl accepts', () => {
    ;['Europe/Warsaw', 'UTC', 'PST', 'US/Pacific', 'Etc/GMT+2'].forEach((zone) => {
      expect(isResolvableTimeZone(zone)).toBe(true)
      warnOnUnresolvableTimeZone(zone, 'planner.availability.date-specific.replace')
    })
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })
})
