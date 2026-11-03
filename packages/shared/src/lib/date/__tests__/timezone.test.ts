import { canonicalizeTimeZone, isValidTimeZone } from '../timezone'

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
