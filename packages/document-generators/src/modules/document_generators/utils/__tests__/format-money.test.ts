import { formatMoney } from '../formatMoney'

describe('formatMoney', () => {
  it.each([
    ['en', 'EUR', '€1,234.50'],
    ['pl', 'PLN', '1234,50\u00a0zł'],
    ['de', 'EUR', '1.234,50\u00a0€'],
  ])('formats currency using the %s locale', (locale, currency, expected) => {
    expect(formatMoney(1234.5, currency, locale)).toBe(expected)
  })
})
