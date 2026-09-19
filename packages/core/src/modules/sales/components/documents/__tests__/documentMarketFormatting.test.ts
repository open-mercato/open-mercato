import { EU_DISPLAY_TEMPLATE, US_DISPLAY_TEMPLATE } from '@open-mercato/shared/lib/display/templates'
import { formatMoney } from '../lineItemUtils'
import { formatPriceWithCurrency } from '../../PriceWithCurrency'

describe('sales document money under a market display profile', () => {
  it('renders the US market conventions', () => {
    expect(formatMoney(48250, 'USD', 'en', US_DISPLAY_TEMPLATE)).toBe('$48,250.00')
    expect(formatPriceWithCurrency(48250, 'USD', '—', 'en', US_DISPLAY_TEMPLATE)).toBe('$48,250.00')
  })

  it('renders the EU market conventions from the same input', () => {
    // The EU template pins a space thousands separator and a comma decimal; the symbol placement
    // stays the locale's, which is what the template's `languageTag` decides.
    expect(formatMoney(48250, 'EUR', 'en', EU_DISPLAY_TEMPLATE)).toBe('€48 250,00')
    expect(formatPriceWithCurrency(48250, 'EUR', '—', 'en', EU_DISPLAY_TEMPLATE)).toBe('€48 250,00')
  })

  it('leaves an organization with no market exactly where it was', () => {
    expect(formatMoney(48250, 'USD', 'en')).toBe('$48,250.00')
    expect(formatPriceWithCurrency(48250, 'USD', '—', 'en')).toBe('$48,250.00')
  })

  it('keeps the currency-less branch a bare fixed-point number', () => {
    expect(formatMoney(12, null, 'en', US_DISPLAY_TEMPLATE)).toBe('12.00')
    expect(formatMoney(12, undefined, 'en')).toBe('12.00')
  })

  it('returns the fallback for a value that is not a number', () => {
    expect(formatPriceWithCurrency(null, 'USD', 'n/a', 'en', US_DISPLAY_TEMPLATE)).toBe('n/a')
    expect(formatPriceWithCurrency('not a number', 'USD', 'n/a', 'en', US_DISPLAY_TEMPLATE)).toBe('n/a')
  })
})
