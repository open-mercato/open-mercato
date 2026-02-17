import { DEFAULT_SETTINGS, hydrateSalesNewOrdersSettings } from '../config'

describe('sales new-orders widget config', () => {
  it('returns defaults for empty input', () => {
    expect(hydrateSalesNewOrdersSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(hydrateSalesNewOrdersSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('clamps invalid pageSize and invalid period to defaults', () => {
    expect(hydrateSalesNewOrdersSettings({ pageSize: 999, datePeriod: 'invalid' as never })).toEqual({
      pageSize: DEFAULT_SETTINGS.pageSize,
      datePeriod: DEFAULT_SETTINGS.datePeriod,
      customFrom: undefined,
      customTo: undefined,
    })
  })

  it('keeps valid custom range only when dates are valid', () => {
    expect(
      hydrateSalesNewOrdersSettings({
        pageSize: 10,
        datePeriod: 'custom',
        customFrom: '2026-01-01T00:00:00.000Z',
        customTo: '2026-01-31T23:59:59.000Z',
      })
    ).toEqual({
      pageSize: 10,
      datePeriod: 'custom',
      customFrom: '2026-01-01T00:00:00.000Z',
      customTo: '2026-01-31T23:59:59.000Z',
    })

    expect(
      hydrateSalesNewOrdersSettings({
        pageSize: 5,
        datePeriod: 'custom',
        customFrom: 'not-a-date',
        customTo: '2026-01-31T23:59:59.000Z',
      })
    ).toEqual({
      pageSize: 5,
      datePeriod: 'custom',
      customFrom: undefined,
      customTo: '2026-01-31T23:59:59.000Z',
    })
  })
})
