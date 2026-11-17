import { calendarDayInTimeZone, canonicalizeTimeZone, isValidTimeZone, listSupportedTimeZones } from '../timezone'

describe('canonicalizeTimeZone', () => {
  it('returns the canonical spelling of a valid zone', () => {
    expect(canonicalizeTimeZone('Europe/Warsaw')).toBe('Europe/Warsaw')
    expect(canonicalizeTimeZone('europe/warsaw')).toBe('Europe/Warsaw')
    expect(canonicalizeTimeZone(' UTC ')).toBe('UTC')
  })

  it('keeps current zone names that Intl reports as legacy aliases', () => {
    expect(canonicalizeTimeZone('Asia/Kolkata')).toBe('Asia/Kolkata')
    expect(canonicalizeTimeZone('Europe/Kyiv')).toBe('Europe/Kyiv')
    expect(canonicalizeTimeZone('America/Nuuk')).toBe('America/Nuuk')
  })

  it('stores an alias as the current name of the zone it links to', () => {
    expect(canonicalizeTimeZone('us/eastern')).toBe('America/New_York')
    expect(canonicalizeTimeZone('US/Eastern')).toBe('America/New_York')
    expect(canonicalizeTimeZone('GMT')).toBe('UTC')
    expect(canonicalizeTimeZone('Asia/Calcutta')).toBe('Asia/Kolkata')
    expect(canonicalizeTimeZone('Europe/Kiev')).toBe('Europe/Kyiv')
  })

  it('normalizes the letter case of renamed zones to their current name', () => {
    expect(canonicalizeTimeZone('asia/kolkata')).toBe('Asia/Kolkata')
    expect(canonicalizeTimeZone('EUROPE/KYIV')).toBe('Europe/Kyiv')
    expect(canonicalizeTimeZone('asia/ho_chi_minh')).toBe('Asia/Ho_Chi_Minh')
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

describe('listSupportedTimeZones', () => {
  it('lists IANA zones including UTC-equivalent and common regions', () => {
    const zones = listSupportedTimeZones()
    expect(zones.length).toBeGreaterThan(5)
    expect(zones).toEqual(expect.arrayContaining(['Europe/Warsaw', 'America/New_York']))
  })

  it('lists renamed zones under their current name, never the ICU legacy one', () => {
    const zones = listSupportedTimeZones()
    for (const [legacy, current] of [
      ['Asia/Calcutta', 'Asia/Kolkata'],
      ['Europe/Kiev', 'Europe/Kyiv'],
      ['Asia/Saigon', 'Asia/Ho_Chi_Minh'],
      ['Asia/Katmandu', 'Asia/Kathmandu'],
      ['Asia/Rangoon', 'Asia/Yangon'],
    ]) {
      expect(zones).toContain(current)
      expect(zones).not.toContain(legacy)
    }
    expect(new Set(zones).size).toBe(zones.length)
  })

  it('adds a stored zone the list does not carry, once', () => {
    expect(listSupportedTimeZones('Etc/GMT+5')).toContain('Etc/GMT+5')
    expect(listSupportedTimeZones('Europe/Warsaw').filter((zone) => zone === 'Europe/Warsaw')).toHaveLength(1)
    expect(listSupportedTimeZones(null)).toEqual(listSupportedTimeZones())
  })
})

describe('time zone edge cases', () => {
  it('always offers UTC, which the V8 canonical list omits', () => {
    expect(listSupportedTimeZones()[0]).toBe('UTC')
    expect(listSupportedTimeZones().filter((zone) => zone === 'UTC')).toHaveLength(1)
  })

  it('rejects UTC offset strings that Postgres would read with the opposite sign', () => {
    expect(canonicalizeTimeZone('+01:00')).toBeNull()
    expect(canonicalizeTimeZone('-05:30')).toBeNull()
    expect(isValidTimeZone('+01:00')).toBe(false)
  })
})
