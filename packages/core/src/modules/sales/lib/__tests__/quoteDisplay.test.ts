import { EU_DISPLAY_TEMPLATE, US_DISPLAY_TEMPLATE } from '@open-mercato/shared/lib/display/templates'
import { buildQuoteDisplayViewModel } from '../quoteDisplay'

// Echoes the key rather than the fallback, so an assertion names the key the market chose rather
// than whatever English happened to be inlined at the call site.
const translate = (key: string) => key

const totals = {
  currencyCode: 'USD',
  subtotalNetAmount: '48250',
  subtotalGrossAmount: '59347.50',
  discountTotalAmount: '0',
  taxTotalAmount: '0',
  grandTotalNetAmount: '48250',
  grandTotalGrossAmount: '59347.50',
  validUntil: '2026-10-18',
  taxStatus: null,
}

const lines = [
  {
    currencyCode: 'USD',
    unitPriceNet: '1930',
    unitPriceGross: '2373.90',
    totalNetAmount: '48250',
    totalGrossAmount: '59347.50',
  },
]

describe('buildQuoteDisplayViewModel', () => {
  it('shows the net amount as the single price under a US market', () => {
    const view = buildQuoteDisplayViewModel(totals, lines, US_DISPLAY_TEMPLATE, translate, 'en')

    expect(view.singlePricePlusTax).toBe(true)
    expect(view.grandTotal).toBe('$48,250.00')
    expect(view.subtotal).toBe('$48,250.00')
    expect(view.lines[0]).toEqual({ unitPrice: '$1,930.00', total: '$48,250.00' })
    expect(view.validUntil).toBe('10/18/2026')
  })

  it('names the tax line and its estimate note from the market', () => {
    const view = buildQuoteDisplayViewModel(totals, lines, US_DISPLAY_TEMPLATE, translate, 'en')

    expect(view.taxLabel).toBe('markets.tax.label.salesTax')
    expect(view.taxNote).toBe('markets.tax.note.calculatedAtOrder')
  })

  it('drops the estimate note once the tax is a firm calculation', () => {
    const view = buildQuoteDisplayViewModel(
      { ...totals, taxStatus: 'calculated' },
      lines,
      US_DISPLAY_TEMPLATE,
      translate,
      'en',
    )

    expect(view.taxNote).toBeNull()
  })

  it('keeps the gross amount as the headline under a dual net/gross market', () => {
    const view = buildQuoteDisplayViewModel(
      { ...totals, currencyCode: 'EUR' },
      [{ ...lines[0], currencyCode: 'EUR' }],
      EU_DISPLAY_TEMPLATE,
      translate,
      'en',
    )

    expect(view.singlePricePlusTax).toBe(false)
    expect(view.grandTotal).toBe('€59 347,50')
    expect(view.taxLabel).toBe('markets.tax.label.vat')
    expect(view.taxNote).toBeNull()
    expect(view.validUntil).toBe('18.10.2026')
  })

  it('falls back to the gross headline and the ambient locale with no market at all', () => {
    const view = buildQuoteDisplayViewModel(totals, lines, null, translate, 'en')

    expect(view.singlePricePlusTax).toBe(false)
    expect(view.grandTotal).toBe('$59,347.50')
    expect(view.taxNote).toBeNull()
  })

  it('returns null for an amount the quote does not carry', () => {
    const view = buildQuoteDisplayViewModel(
      { currencyCode: 'USD', validUntil: null },
      [],
      US_DISPLAY_TEMPLATE,
      translate,
      'en',
    )

    expect(view.grandTotal).toBeNull()
    expect(view.validUntil).toBeNull()
    expect(view.lines).toEqual([])
  })
})
