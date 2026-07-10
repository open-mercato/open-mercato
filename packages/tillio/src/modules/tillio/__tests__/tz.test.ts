import { formatTillioTimestamp, zonedDayEnd, zonedDayStart } from '../lib/tz'

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
