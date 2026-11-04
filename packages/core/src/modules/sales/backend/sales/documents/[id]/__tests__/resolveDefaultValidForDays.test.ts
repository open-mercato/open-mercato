/**
 * @jest-environment jsdom
 */
import { resolveDefaultValidForDays } from '../page'

describe('resolveDefaultValidForDays', () => {
  it('derives the remaining days from a future validUntil instead of the 14-day default', () => {
    const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

    const result = resolveDefaultValidForDays(validUntil)

    expect(result).toBeGreaterThanOrEqual(29)
    expect(result).toBeLessThanOrEqual(30)
  })

  it('falls back to 14 days when validUntil is missing', () => {
    expect(resolveDefaultValidForDays(null)).toBe(14)
    expect(resolveDefaultValidForDays(undefined)).toBe(14)
  })

  it('falls back to 14 days when validUntil is already in the past', () => {
    const validUntil = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    expect(resolveDefaultValidForDays(validUntil)).toBe(14)
  })

  it('caps the derived value at 365 days', () => {
    const validUntil = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString()

    expect(resolveDefaultValidForDays(validUntil)).toBe(365)
  })

  it('falls back to 14 days for an unparseable value', () => {
    expect(resolveDefaultValidForDays('not-a-date')).toBe(14)
  })
})
