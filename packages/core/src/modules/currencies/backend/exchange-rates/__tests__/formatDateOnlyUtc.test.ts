import { describe, it, expect } from '@jest/globals'

function formatDateOnlyUtc(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

describe('formatDateOnlyUtc', () => {
  const originalTZ = process.env.TZ

  afterEach(() => {
    process.env.TZ = originalTZ
  })

  it('formats the UTC calendar day regardless of the local timezone', () => {
    process.env.TZ = 'America/New_York'

    const date = new Date('2026-10-30T00:00:00.000Z')
    expect(formatDateOnlyUtc(date)).toBe('2026-10-30')
  })

  it('does not shift to the previous day for timezones west of UTC', () => {
    process.env.TZ = 'America/Los_Angeles'

    const date = new Date('2026-01-15T00:00:00.000Z')
    expect(formatDateOnlyUtc(date)).toBe('2026-01-15')
  })

  it('pads single-digit months and days with zeros', () => {
    const date = new Date('2026-01-05T00:00:00.000Z')
    expect(formatDateOnlyUtc(date)).toBe('2026-01-05')
  })
})
