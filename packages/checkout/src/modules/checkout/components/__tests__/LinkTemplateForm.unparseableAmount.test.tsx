/**
 * @jest-environment jsdom
 *
 * Regression test for issue #6311.
 *
 * `toSubmittedAmount` returns `null` for text the locale-aware parser cannot read (`abc`, or an
 * ambiguous mixed-separator value such as `10.9,5`). The form used to send that `null` (a
 * price-list row sent `NaN`, which `JSON.stringify` also writes as `null`), and the API's
 * `z.coerce.number()` coerced it to `0` — so the row amount was saved as 0 with no error shown.
 * `collectUnparseableAmountPaths` now finds those fields before submission so the form stops
 * with a localized field error instead.
 */

jest.mock('lucide-react', () => {
  const IconStub = () => null
  return new Proxy(
    { __esModule: true },
    { get: (target, prop) => (prop in target ? (target as Record<string | symbol, unknown>)[prop] : IconStub) },
  )
})

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  RecordNotFoundState: () => null,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
  useLocale: () => 'pl-PL',
}))

jest.mock('../CheckoutCurrencySelect', () => ({
  CheckoutCurrencySelect: () => null,
}))

jest.mock('../CustomerFieldsEditor', () => ({
  CustomerFieldsEditor: () => null,
}))

jest.mock('../GatewaySettingsFields', () => ({
  GatewaySettingsFields: () => null,
}))

jest.mock('../LogoUploadField', () => ({
  LogoUploadField: () => null,
}))

import { collectUnparseableAmountPaths } from '../LinkTemplateForm'

const TEST_LOCALE = 'pl-PL'

function priceListValues(amounts: unknown[]) {
  return {
    pricingMode: 'price_list',
    priceListItems: amounts.map((amount, index) => ({
      id: `item-${index + 1}`,
      description: 'Item',
      amount,
      currencyCode: 'PLN',
    })),
  }
}

describe('LinkTemplateForm unparseable amount input (issue #6311)', () => {
  it.each(['10.9,5', 'abc', '12.5,6'])('flags a price-list row amount of %p instead of letting it save as 0', (raw) => {
    expect(collectUnparseableAmountPaths(priceListValues(['25,99', raw]), TEST_LOCALE)).toEqual([
      'priceListItems.1.amount',
    ])
  })

  it('accepts price-list amounts with a single comma or dot decimal separator, numbers and blanks', () => {
    expect(collectUnparseableAmountPaths(priceListValues(['110,70', '110.70', 15, '']), TEST_LOCALE)).toEqual([])
  })

  it('flags unparseable fixed price and compare-at amounts', () => {
    expect(
      collectUnparseableAmountPaths(
        { pricingMode: 'fixed', fixedPriceAmount: 'abc', fixedPriceOriginalAmount: '10.9,5' },
        TEST_LOCALE,
      ),
    ).toEqual(['fixedPriceAmount', 'fixedPriceOriginalAmount'])
  })

  it('treats a missing pricing mode as fixed', () => {
    expect(collectUnparseableAmountPaths({ fixedPriceAmount: 'abc' }, TEST_LOCALE)).toEqual(['fixedPriceAmount'])
  })

  it('flags unparseable custom amount bounds', () => {
    expect(
      collectUnparseableAmountPaths(
        { pricingMode: 'custom_amount', customAmountMin: '1,5', customAmountMax: 'abc' },
        TEST_LOCALE,
      ),
    ).toEqual(['customAmountMax'])
  })

  it('ignores leftover text in fields the active pricing mode does not submit', () => {
    expect(
      collectUnparseableAmountPaths(
        { pricingMode: 'custom_amount', fixedPriceAmount: 'abc', customAmountMin: '10', customAmountMax: '20' },
        TEST_LOCALE,
      ),
    ).toEqual([])
  })
})
