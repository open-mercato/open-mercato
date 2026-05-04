import { normalizeCustomerDetailCustomFields } from '../detailCustomFields'

describe('normalizeCustomerDetailCustomFields', () => {
  it('strips cf_ prefixes from detail custom field payloads', () => {
    expect(
      normalizeCustomerDetailCustomFields({
        cf_priority: 3,
        cf_status: 'hot',
      }),
    ).toEqual({
      priority: 3,
      status: 'hot',
    })
  })

  it('strips cf: prefixes and keeps plain keys untouched', () => {
    expect(
      normalizeCustomerDetailCustomFields({
        'cf:severity': 'high',
        annual_revenue_currency: 'EUR',
      }),
    ).toEqual({
      severity: 'high',
      annual_revenue_currency: 'EUR',
    })
  })

  it('returns an empty object for missing values', () => {
    expect(normalizeCustomerDetailCustomFields(undefined)).toEqual({})
  })
})
