import { instantToWallTime, isValidTimezone, resolveBrowserTimezone, wallTimeToInstant } from '../wall-time'

describe('wall-time helper', () => {
  it('converts Warsaw and UTC wall times into different instants and restores their wall time', () => {
    expect(wallTimeToInstant('2026-09-29', '09:15', 'Europe/Warsaw')?.toISOString()).toBe('2026-09-29T07:15:00.000Z')
    expect(wallTimeToInstant('2026-09-29', '09:15', 'UTC')?.toISOString()).toBe('2026-09-29T09:15:00.000Z')
    expect(instantToWallTime(new Date('2026-09-29T07:15:00Z'), 'Europe/Warsaw')).toEqual({ date: '2026-09-29', time: '09:15' })
  })

  it('returns null for a non-existent local time in the Europe/Warsaw spring gap', () => {
    expect(wallTimeToInstant('2026-03-29', '02:30', 'Europe/Warsaw')).toBeNull()
    expect(wallTimeToInstant('2026-03-29', '03:00', 'Europe/Warsaw')?.toISOString()).toBe('2026-03-29T01:00:00.000Z')
  })

  it('resolves an ambiguous Europe/Warsaw autumn overlap to the earlier (summer time) instant', () => {
    expect(wallTimeToInstant('2026-10-25', '02:30', 'Europe/Warsaw')?.toISOString()).toBe('2026-10-25T00:30:00.000Z')
  })

  it('rejects invalid dates, times and zones', () => {
    expect(wallTimeToInstant('2026-02-30', '10:00', 'UTC')).toBeNull()
    expect(wallTimeToInstant('2026-02-10', '25:00', 'UTC')).toBeNull()
    expect(wallTimeToInstant('2026-02-10', '10:00', 'invalid-zone')).toBeNull()
    expect(isValidTimezone('invalid-zone')).toBe(false)
    expect(isValidTimezone('+01:00')).toBe(false)
    expect(isValidTimezone('Europe/Warsaw')).toBe(true)
  })

  it('resolves the runtime timezone to a valid zone', () => {
    expect(isValidTimezone(resolveBrowserTimezone())).toBe(true)
  })
})
