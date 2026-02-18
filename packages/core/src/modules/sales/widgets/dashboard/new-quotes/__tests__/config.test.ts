import { DEFAULT_SETTINGS, hydrateSalesNewQuotesSettings } from '../config'

describe('sales new-quotes widget config', () => {
  it('returns defaults for empty input', () => {
    expect(hydrateSalesNewQuotesSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(hydrateSalesNewQuotesSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('clamps invalid pageSize and invalid period to defaults', () => {
    expect(hydrateSalesNewQuotesSettings({ pageSize: 0, datePeriod: 'invalid' as never })).toEqual({
      pageSize: DEFAULT_SETTINGS.pageSize,
      datePeriod: DEFAULT_SETTINGS.datePeriod,
      customFrom: undefined,
      customTo: undefined,
    })
  })

  it('keeps valid custom range only when dates are valid', () => {
    expect(
      hydrateSalesNewQuotesSettings({
        pageSize: 8,
        datePeriod: 'custom',
        customFrom: '2026-02-01T00:00:00.000Z',
        customTo: '2026-02-28T23:59:59.000Z',
      })
    ).toEqual({
      pageSize: 8,
      datePeriod: 'custom',
      customFrom: '2026-02-01T00:00:00.000Z',
      customTo: '2026-02-28T23:59:59.000Z',
    })

    expect(
      hydrateSalesNewQuotesSettings({
        pageSize: 8,
        datePeriod: 'custom',
        customFrom: '2026-02-01T00:00:00.000Z',
        customTo: 'not-a-date',
      })
    ).toEqual({
      pageSize: 8,
      datePeriod: 'custom',
      customFrom: '2026-02-01T00:00:00.000Z',
      customTo: undefined,
    })
  })
})
