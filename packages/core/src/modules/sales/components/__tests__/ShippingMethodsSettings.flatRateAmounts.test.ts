jest.mock('@open-mercato/ui/backend/DataTable', () => ({ DataTable: () => null }))
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({ CrudForm: () => null }))

import { normalizeFlatRateAmounts } from '../ShippingMethodsSettings'

describe('normalizeFlatRateAmounts', () => {
  it('keeps typed flat-rate amounts as exact decimal strings', () => {
    const settings = {
      applyBaseRate: true,
      rates: [{ metric: 'item_count', min: 0, amountNet: '1234567.123456789123456789', amountGross: '1234567,5' }],
    }
    expect(normalizeFlatRateAmounts(settings, 'pl')).toEqual({
      applyBaseRate: true,
      rates: [{ metric: 'item_count', min: 0, amountNet: '1234567.123456789123456789', amountGross: '1234567.5' }],
    })
  })

  it('leaves stored numbers, blanks and settings without rates unchanged', () => {
    expect(normalizeFlatRateAmounts({ rates: [{ amountNet: 5, amountGross: null }] }, 'en')).toEqual({
      rates: [{ amountNet: 5, amountGross: null }],
    })
    expect(normalizeFlatRateAmounts({ applyBaseRate: false }, 'en')).toEqual({ applyBaseRate: false })
  })
})
