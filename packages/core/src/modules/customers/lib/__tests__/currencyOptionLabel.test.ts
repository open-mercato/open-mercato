import { formatCurrencyOptionLabel } from '../currencyOptionLabel'

describe('formatCurrencyOptionLabel', () => {
  it('keeps a seeded code-prefixed label without repeating the code', () => {
    expect(formatCurrencyOptionLabel('USD', 'USD – US Dollar')).toBe('USD – US Dollar')
    expect(formatCurrencyOptionLabel('jpy', 'JPY – Japanese Yen')).toBe('JPY – Japanese Yen')
  })

  it('normalizes other code separators to a single prefix', () => {
    expect(formatCurrencyOptionLabel('PLN', 'pln - Polish Zloty')).toBe('PLN – Polish Zloty')
    expect(formatCurrencyOptionLabel('EUR', 'EUR: Euro')).toBe('EUR – Euro')
  })

  it('prefixes name-only custom labels with the code', () => {
    expect(formatCurrencyOptionLabel('KES', 'Kenyan Shilling')).toBe('KES – Kenyan Shilling')
    expect(formatCurrencyOptionLabel('USD', 'USDollar')).toBe('USD – USDollar')
  })

  it('falls back to the code for code-only, empty, or missing labels', () => {
    expect(formatCurrencyOptionLabel('USD', 'usd')).toBe('USD')
    expect(formatCurrencyOptionLabel('USD', 'USD – ')).toBe('USD')
    expect(formatCurrencyOptionLabel('USD', '  ')).toBe('USD')
    expect(formatCurrencyOptionLabel('USD', null)).toBe('USD')
    expect(formatCurrencyOptionLabel('USD', undefined)).toBe('USD')
  })
})
