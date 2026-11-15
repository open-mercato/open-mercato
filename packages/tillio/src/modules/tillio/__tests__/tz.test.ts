import { formatTillioTimestamp, isValidTimeZone, zonedDayEnd, zonedDayStart } from '../lib/tz'

describe('isValidTimeZone', () => {
  it('accepts IANA zones and rejects anything Intl cannot resolve', () => {
    expect(isValidTimeZone('Europe/Warsaw')).toBe(true)
    expect(isValidTimeZone('America/New_York')).toBe(true)
    expect(isValidTimeZone('UTC')).toBe(true)
    // Intl resolves fixed-offset zones too, so they pass; only names it cannot resolve fail.
    expect(isValidTimeZone('+02:00')).toBe(true)
    expect(isValidTimeZone('Europe/Atlantis')).toBe(false)
    expect(isValidTimeZone('Warsaw')).toBe(false)
  })
})

describe('a configured zone', () => {
  it('moves the day boundaries with it', () => {
    expect(zonedDayStart('2026-06-11', 'UTC').toISOString()).toBe('2026-06-11T00:00:00.000Z')
    expect(zonedDayEnd('2026-06-11', 'UTC').toISOString()).toBe('2026-06-11T23:59:00.000Z')
    expect(zonedDayStart('2026-06-11', 'America/New_York').toISOString()).toBe('2026-06-11T04:00:00.000Z')
  })
})

describe('tillio timezone helpers', () => {
  it('anchors a day to Europe/Warsaw wall-clock boundaries', () => {
    expect(zonedDayStart('2026-06-11').toISOString()).toBe('2026-06-10T22:00:00.000Z')
    expect(zonedDayEnd('2026-06-11').toISOString()).toBe('2026-06-11T21:59:00.000Z')
  })

  it('handles the spring DST switch, where a day starts at +01:00 and ends at +02:00', () => {
    expect(zonedDayStart('2026-03-29').toISOString()).toBe('2026-03-28T23:00:00.000Z')
    expect(zonedDayEnd('2026-03-29').toISOString()).toBe('2026-03-29T21:59:00.000Z')
  })

  it('handles the autumn DST switch, where a day starts at +02:00 and ends at +01:00', () => {
    expect(zonedDayStart('2026-10-25').toISOString()).toBe('2026-10-24T22:00:00.000Z')
    expect(zonedDayEnd('2026-10-25').toISOString()).toBe('2026-10-25T22:59:00.000Z')
  })

  it('round-trips day boundaries back to the wall-clock format Tillio expects', () => {
    for (const day of ['2026-01-15', '2026-03-29', '2026-06-11', '2026-10-25', '2026-12-31']) {
      expect(formatTillioTimestamp(zonedDayStart(day))).toBe(`${day} 00:00`)
      expect(formatTillioTimestamp(zonedDayEnd(day))).toBe(`${day} 23:59`)
    }
  })

  it('formats an instant using the Warsaw wall clock, not the host timezone', () => {
    expect(formatTillioTimestamp(new Date('2026-04-11T10:47:28.000Z'))).toBe('2026-04-11 12:47')
  })

  it('rejects a malformed day', () => {
    expect(() => zonedDayStart('11-04-2026')).toThrow()
  })
})
