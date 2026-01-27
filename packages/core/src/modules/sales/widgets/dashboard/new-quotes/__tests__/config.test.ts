import { DEFAULT_SETTINGS, hydrateSalesNewQuotesSettings } from '../config'

describe('hydrateSalesNewQuotesSettings', () => {
  it('returns default settings for null input', () => {
    expect(hydrateSalesNewQuotesSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('validates and clamps pageSize', () => {
    expect(hydrateSalesNewQuotesSettings({ pageSize: 0 })).toHaveProperty('pageSize', DEFAULT_SETTINGS.pageSize)
    expect(hydrateSalesNewQuotesSettings({ pageSize: 25 })).toHaveProperty('pageSize', 20)
    expect(hydrateSalesNewQuotesSettings({ pageSize: 10 })).toHaveProperty('pageSize', 10)
  })

  it('validates datePeriod', () => {
    expect(hydrateSalesNewQuotesSettings({ datePeriod: 'invalid' })).toHaveProperty('datePeriod', DEFAULT_SETTINGS.datePeriod)
    expect(hydrateSalesNewQuotesSettings({ datePeriod: 'last30d' })).toHaveProperty('datePeriod', 'last30d')
  })

  it('includes custom dates only when datePeriod is custom', () => {
    const result = hydrateSalesNewQuotesSettings({
      datePeriod: 'custom',
      customFrom: '2026-01-20T00:00:00Z',
      customTo: '2026-01-27T23:59:59Z',
    })
    expect(result.customFrom).toBe('2026-01-20T00:00:00Z')
    expect(result.customTo).toBe('2026-01-27T23:59:59Z')
  })
})
