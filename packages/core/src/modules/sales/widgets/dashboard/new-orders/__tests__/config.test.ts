import { DEFAULT_SETTINGS, hydrateSalesNewOrdersSettings } from '../config'

describe('hydrateSalesNewOrdersSettings', () => {
  it('returns default settings for null input', () => {
    expect(hydrateSalesNewOrdersSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('validates and clamps pageSize', () => {
    expect(hydrateSalesNewOrdersSettings({ pageSize: 0 })).toHaveProperty('pageSize', DEFAULT_SETTINGS.pageSize)
    expect(hydrateSalesNewOrdersSettings({ pageSize: 25 })).toHaveProperty('pageSize', 20)
    expect(hydrateSalesNewOrdersSettings({ pageSize: 10 })).toHaveProperty('pageSize', 10)
  })

  it('validates datePeriod', () => {
    expect(hydrateSalesNewOrdersSettings({ datePeriod: 'invalid' })).toHaveProperty('datePeriod', DEFAULT_SETTINGS.datePeriod)
    expect(hydrateSalesNewOrdersSettings({ datePeriod: 'last7d' })).toHaveProperty('datePeriod', 'last7d')
  })

  it('includes custom dates only when datePeriod is custom', () => {
    const result = hydrateSalesNewOrdersSettings({
      datePeriod: 'custom',
      customFrom: '2026-01-20T00:00:00Z',
      customTo: '2026-01-27T23:59:59Z',
    })
    expect(result.customFrom).toBe('2026-01-20T00:00:00Z')
    expect(result.customTo).toBe('2026-01-27T23:59:59Z')
  })
})
