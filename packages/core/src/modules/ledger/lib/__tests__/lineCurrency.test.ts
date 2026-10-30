import { isLineConsistent, resolveLineCurrency, toScaledUnits } from '../lineCurrency'

const PLN = 'pln'
const EUR = 'eur'
const USD = 'usd'

describe('toScaledUnits', () => {
  it('parses exactly, without float error', () => {
    expect(toScaledUnits('0.1', 4)).toBe(1000n)
    expect(toScaledUnits('4.2500', 4)).toBe(42500n)
    expect(toScaledUnits('4.25', 8)).toBe(425000000n)
    expect(toScaledUnits(undefined, 4)).toBe(0n)
  })
})

describe('resolveLineCurrency', () => {
  it('base-currency line without own fields: header currency, rate 1, amount = debit', () => {
    const r = resolveLineCurrency({ debit: '100.0000' }, { currencyId: PLN }, PLN)
    expect(r).toEqual({ ok: true, value: { currencyId: PLN, exchangeRate: '1', amountCurrency: '100.0000' } })
  })

  it('base-currency credit line takes amountCurrency from credit', () => {
    const r = resolveLineCurrency({ credit: '55.5000' }, { currencyId: PLN }, PLN)
    expect(r).toEqual({ ok: true, value: { currencyId: PLN, exchangeRate: '1', amountCurrency: '55.5000' } })
  })

  it('foreign line without own fields inherits header currency and rate; needs amountCurrency', () => {
    const header = { currencyId: EUR, exchangeRate: '4.25000000' }
    expect(resolveLineCurrency({ debit: '425.0000', amountCurrency: '100.0000' }, header, PLN)).toEqual({
      ok: true,
      value: { currencyId: EUR, exchangeRate: '4.25000000', amountCurrency: '100.0000' },
    })
    expect(resolveLineCurrency({ debit: '425.0000' }, header, PLN)).toEqual({ ok: false, problem: 'amountCurrencyMissing' })
  })

  it('a line in a different currency than the header must carry its own rate (no silent header rate)', () => {
    const header = { currencyId: EUR, exchangeRate: '4.25000000' }
    expect(resolveLineCurrency({ currencyId: USD, debit: '390.0000', amountCurrency: '100.0000' }, header, PLN)).toEqual({
      ok: false,
      problem: 'rateMissing',
    })
    expect(
      resolveLineCurrency({ currencyId: USD, exchangeRate: '3.9', debit: '390.0000', amountCurrency: '100.0000' }, header, PLN),
    ).toEqual({ ok: true, value: { currencyId: USD, exchangeRate: '3.9', amountCurrency: '100.0000' } })
  })

  it('a base-currency line inside a foreign-currency entry stores rate 1', () => {
    const header = { currencyId: EUR, exchangeRate: '4.25000000' }
    expect(resolveLineCurrency({ currencyId: PLN, credit: '425.0000' }, header, PLN)).toEqual({
      ok: true,
      value: { currencyId: PLN, exchangeRate: '1', amountCurrency: '425.0000' },
    })
  })

  it('rejects a base-currency line whose rate is not 1', () => {
    expect(resolveLineCurrency({ currencyId: PLN, exchangeRate: '1.1', debit: '1', amountCurrency: '1' }, { currencyId: PLN }, PLN)).toEqual({
      ok: false,
      problem: 'baseRateNotOne',
    })
    expect(resolveLineCurrency({ currencyId: PLN, exchangeRate: '1.00000000', debit: '1' }, { currencyId: PLN }, PLN).ok).toBe(true)
  })

  it('rejects a zero rate', () => {
    expect(
      resolveLineCurrency({ currencyId: EUR, exchangeRate: '0', debit: '1', amountCurrency: '1' }, { currencyId: EUR }, PLN),
    ).toEqual({ ok: false, problem: 'rateNotPositive' })
  })

  it('foreign header without a rate and a line without its own rate: rateMissing', () => {
    expect(resolveLineCurrency({ debit: '10', amountCurrency: '2' }, { currencyId: EUR }, PLN)).toEqual({
      ok: false,
      problem: 'rateMissing',
    })
  })
})

describe('isLineConsistent', () => {
  const make = (amountCurrency: string, exchangeRate: string) => ({ currencyId: EUR, exchangeRate, amountCurrency })

  it('accepts an exact product', () => {
    expect(isLineConsistent(make('100.0000', '4.25000000'), { debit: '425.0000' }, 2)).toBe(true)
  })

  it('accepts a difference within half the smallest base unit (PLN: 0.005)', () => {
    // 33.3333 * 4.2517 = 141.72... ; base rounded to 2 dp
    expect(isLineConsistent(make('33.3333', '4.25170000'), { debit: '141.7200' }, 2)).toBe(true)
    expect(isLineConsistent(make('100.0000', '4.25000000'), { debit: '425.0050' }, 2)).toBe(true)
  })

  it('rejects a difference beyond half the smallest base unit', () => {
    expect(isLineConsistent(make('100.0000', '4.25000000'), { debit: '425.0051' }, 2)).toBe(false)
    expect(isLineConsistent(make('100.0000', '4.25000000'), { debit: '430.0000' }, 2)).toBe(false)
  })

  it('exempts amountCurrency = 0 (exchange-difference line)', () => {
    expect(isLineConsistent(make('0.0000', '4.25000000'), { credit: '12.3400' }, 2)).toBe(true)
  })

  it('respects the base currency decimal places', () => {
    // JPY-like base with 0 decimals: tolerance 0.5
    expect(isLineConsistent(make('10.0000', '1.00000000'), { debit: '10.4000' }, 0)).toBe(true)
    expect(isLineConsistent(make('10.0000', '1.00000000'), { debit: '10.6000' }, 0)).toBe(false)
  })
})
