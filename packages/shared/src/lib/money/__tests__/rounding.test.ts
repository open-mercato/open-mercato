import { beforeAll, describe, expect, it } from '@jest/globals'
import { divideDecimals, roundDecimal, toDecimal } from '../../decimal'
import { CurrencyMismatchError, InvalidMoneyRoundingError } from '../errors'
import { convertMoney, createMoney, divideMoney, multiplyMoney, rescaleMoney, roundMoney } from '../money'
import type { Currency, Money, MoneyRounding, MoneyRoundingMode } from '../types'
import { currencyOf } from './helpers'

let usd: Currency
let usdFourPlaces: Currency
let eur: Currency
let jpy: Currency

beforeAll(async () => {
  usd = await currencyOf('USD')
  usdFourPlaces = await currencyOf('USD', { USD: { decimalPlaces: 4 } })
  eur = await currencyOf('EUR')
  jpy = await currencyOf('JPY')
})

const text = (money: Money) => money.amount.toFixed()
const sharedDecimalConstructor = () => toDecimal(1).constructor as unknown as { DP: number; RM: number }

describe('roundMoney', () => {
  const cases: Array<[MoneyRoundingMode, string, string]> = [
    ['down', '2.5', '2'],
    ['down', '-2.5', '-2'],
    ['down', '2.9', '2'],
    ['halfUp', '2.5', '3'],
    ['halfUp', '-2.5', '-3'],
    ['halfUp', '2.4', '2'],
    ['halfEven', '2.5', '2'],
    ['halfEven', '3.5', '4'],
    ['halfEven', '-2.5', '-2'],
    ['halfEven', '-3.5', '-4'],
    ['up', '2.1', '3'],
    ['up', '-2.1', '-3'],
    ['up', '2', '2'],
  ]

  it.each(cases)('rounds %s: %s -> %s', (mode, amount, expected) => {
    expect(text(roundMoney(createMoney(amount, usd), { decimalPlaces: 0, mode }))).toBe(expected)
  })

  it('keeps the currency and rounds to the given places', () => {
    const rounded = roundMoney(createMoney('1.005', usd), { decimalPlaces: 2, mode: 'halfEven' })
    expect(text(rounded)).toBe('1')
    expect(rounded.currency).toBe(usd)
  })

  it.each([
    [{ decimalPlaces: -1, mode: 'halfUp' }],
    [{ decimalPlaces: 51, mode: 'halfUp' }],
    [{ decimalPlaces: 1.5, mode: 'halfUp' }],
    [{ decimalPlaces: 2, mode: 'nearest' }],
    [{ decimalPlaces: 2, mode: 'toString' }],
    [undefined],
  ])('rejects the invalid rounding %p', (rounding) => {
    expect(() => roundMoney(createMoney(1, usd), rounding as unknown as MoneyRounding)).toThrow(
      InvalidMoneyRoundingError,
    )
  })
})

describe('divideMoney', () => {
  it('rounds the quotient with the caller rounding', () => {
    expect(text(divideMoney(createMoney(10, usd), 3, { decimalPlaces: 2, mode: 'halfUp' }))).toBe('3.33')
    expect(text(divideMoney(createMoney(10, usd), 3, { decimalPlaces: 2, mode: 'up' }))).toBe('3.34')
    expect(text(divideMoney(createMoney(-10, usd), 3, { decimalPlaces: 2, mode: 'up' }))).toBe('-3.34')
    expect(text(divideMoney(createMoney(-10, usd), 3, { decimalPlaces: 2, mode: 'down' }))).toBe('-3.33')
    expect(text(divideMoney(createMoney(5, usd), 2, { decimalPlaces: 0, mode: 'halfEven' }))).toBe('2')
    expect(text(divideMoney(createMoney(1, usd), 3, { decimalPlaces: 50, mode: 'halfUp' }))).toBe(
      `0.${'3'.repeat(50)}`,
    )
  })

  it('rounds a long quotient once, without a 50-place cut and a second rounding', () => {
    const dividend = toDecimal('0.01').minus(toDecimal('2e-63')).toFixed()
    const exactQuotient = toDecimal('0.005').minus(toDecimal('1e-63')).toFixed()
    expect(exactQuotient).toBe(`0.004${'9'.repeat(60)}`)
    const twiceRounded = roundDecimal(divideDecimals(dividend, 2), 2).toFixed(2)
    expect(twiceRounded).toBe('0.01')
    const quotient = divideMoney(createMoney(dividend, usd), 2, { decimalPlaces: 2, mode: 'halfUp' })
    expect(quotient.amount.toFixed(2)).toBe('0.00')
  })

  it('reports a quotient beyond the decimal range like the other operations', () => {
    const huge = createMoney('1e299', usd)
    expect(() => divideMoney(huge, '1e-10', { decimalPlaces: 2, mode: 'halfUp' })).toThrow('[internal] Decimal result out of range')
    expect(() => multiplyMoney(huge, '10')).toThrow('[internal] Decimal result out of range')
    expect(text(divideMoney(huge, 10, { decimalPlaces: 0, mode: 'halfUp' }))).toBe(`1${'0'.repeat(298)}`)
  })

  it('leaves the shared Decimal settings unchanged, also when it throws', () => {
    const shared = sharedDecimalConstructor()
    const before = { DP: shared.DP, RM: shared.RM }
    divideMoney(createMoney(1, usd), 3, { decimalPlaces: 2, mode: 'down' })
    expect({ DP: shared.DP, RM: shared.RM }).toEqual(before)
    expect(() => divideMoney(createMoney(1, usd), 0, { decimalPlaces: 2, mode: 'down' })).toThrow('[internal]')
    expect(() => divideMoney(createMoney(1, usd), 3, { decimalPlaces: 99, mode: 'down' })).toThrow(
      InvalidMoneyRoundingError,
    )
    expect({ DP: shared.DP, RM: shared.RM }).toEqual(before)
    expect(text(divideMoney(createMoney(1, usd), 3, { decimalPlaces: 4, mode: 'halfUp' }))).toBe('0.3333')
  })
})

describe('convertMoney', () => {
  it('applies the caller rounding to the exact, uncapped product', () => {
    const tiny = createMoney('1e-1000', usd)
    expect(text(convertMoney(tiny, '0.1', eur, { decimalPlaces: 2, mode: 'up' }))).toBe('0.01')
    expect(text(convertMoney(tiny, '0.1', eur, { decimalPlaces: 2, mode: 'down' }))).toBe('0')
    expect(text(convertMoney(tiny, '0.1', eur, { decimalPlaces: 2, mode: 'halfUp' }))).toBe('0')
    const negativeTiny = createMoney('-1e-1000', usd)
    expect(text(convertMoney(negativeTiny, '0.1', eur, { decimalPlaces: 2, mode: 'up' }))).toBe('-0.01')
    expect(text(convertMoney(negativeTiny, '0.1', eur, { decimalPlaces: 2, mode: 'down' }))).toBe('0')
  })

  it('rejects a converted amount beyond the stored-amount range', () => {
    expect(() => convertMoney(createMoney('1e299', usd), '10', eur, { decimalPlaces: 2, mode: 'halfUp' })).toThrow(
      '[internal] Decimal result out of range',
    )
  })

  it('multiplies by the rate exactly and rounds once', () => {
    const converted = convertMoney(createMoney('10.00', usd), '0.923456', eur, { decimalPlaces: 2, mode: 'halfUp' })
    expect(text(converted)).toBe('9.23')
    expect(converted.currency).toBe(eur)
    expect(text(convertMoney(createMoney('1.99', usd), '150.5', jpy, { decimalPlaces: 0, mode: 'halfEven' }))).toBe('299')
  })

  it('rejects a non-positive rate', () => {
    const rounding: MoneyRounding = { decimalPlaces: 2, mode: 'halfUp' }
    expect(() => convertMoney(createMoney(1, usd), 0, eur, rounding)).toThrow('[internal]')
    expect(() => convertMoney(createMoney(1, usd), '-1.2', eur, rounding)).toThrow('[internal]')
  })

  it('rejects a target with the same code', () => {
    expect(() => convertMoney(createMoney(1, usd), 1, usdFourPlaces, { decimalPlaces: 4, mode: 'halfUp' })).toThrow(
      CurrencyMismatchError,
    )
  })
})

describe('range after rounding', () => {
  const carry = `${'9'.repeat(300)}.5`

  it('rejects a rounding carry into a 301st integer digit for round and rescale', () => {
    const money = createMoney(carry, usdFourPlaces)
    expect(() => roundMoney(money, { decimalPlaces: 0, mode: 'halfUp' })).toThrow('[internal] Decimal result out of range')
    expect(() => rescaleMoney(money, usd, { decimalPlaces: 0, mode: 'up' })).toThrow('[internal] Decimal result out of range')
    expect(text(roundMoney(money, { decimalPlaces: 0, mode: 'down' }))).toBe('9'.repeat(300))
  })
})

describe('rescaleMoney', () => {
  it('moves an amount to the same code with other decimal places', () => {
    const widened = rescaleMoney(createMoney('1.23', usd), usdFourPlaces, { decimalPlaces: 4, mode: 'halfUp' })
    expect(text(widened)).toBe('1.23')
    expect(widened.currency).toBe(usdFourPlaces)
    const narrowed = rescaleMoney(createMoney('1.2345', usdFourPlaces), usd, { decimalPlaces: 2, mode: 'down' })
    expect(text(narrowed)).toBe('1.23')
  })

  it('rejects a target with another code', () => {
    expect(() => rescaleMoney(createMoney(1, usd), eur, { decimalPlaces: 2, mode: 'halfUp' })).toThrow(
      CurrencyMismatchError,
    )
  })
})
