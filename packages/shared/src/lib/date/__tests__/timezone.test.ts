import { calendarDayInTimeZone, canonicalizeTimeZone, isValidTimeZone } from '../timezone'

describe('canonicalizeTimeZone', () => {
  it('returns the canonical spelling of a valid zone', () => {
    expect(canonicalizeTimeZone('Europe/Warsaw')).toBe('Europe/Warsaw')
    expect(canonicalizeTimeZone('europe/warsaw')).toBe('Europe/Warsaw')
    expect(canonicalizeTimeZone(' UTC ')).toBe('UTC')
  })

  it('returns null for empty, missing or unknown zones', () => {
    expect(canonicalizeTimeZone(undefined)).toBeNull()
    expect(canonicalizeTimeZone(null)).toBeNull()
    expect(canonicalizeTimeZone('')).toBeNull()
    expect(canonicalizeTimeZone('Mars/Olympus')).toBeNull()
  })
})

describe('isValidTimeZone', () => {
  it('accepts IANA zones and rejects unknown values', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true)
    expect(isValidTimeZone('Not/AZone')).toBe(false)
  })
})

describe('calendarDayInTimeZone', () => {
  const instant = new Date('2026-12-31T23:30:00.000Z')

  it('names the day in the given zone', () => {
    expect(calendarDayInTimeZone(instant, 'UTC')).toBe('2026-12-31')
    expect(calendarDayInTimeZone(instant, 'Europe/Warsaw')).toBe('2027-01-01')
    expect(calendarDayInTimeZone(instant, 'America/Los_Angeles')).toBe('2026-12-31')
  })

  it('falls back to the runtime zone for an unknown zone', () => {
    expect(calendarDayInTimeZone(instant, 'Mars/Olympus')).toBe(calendarDayInTimeZone(instant, null))
  })
})
