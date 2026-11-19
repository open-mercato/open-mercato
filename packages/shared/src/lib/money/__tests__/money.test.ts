import { beforeAll, describe, expect, it } from '@jest/globals'
import { toDecimal } from '../../decimal'
import { CurrencyMismatchError } from '../errors'
import {
  absMoney,
  addMoney,
  allocateMoney,
  compareMoney,
  convertMoney,
  createMoney,
  divideMoney,
  isNegativeMoney,
  isPositiveMoney,
  isZeroMoney,
  maxMoney,
  minMoney,
  moneyEquals,
  multiplyMoney,
  negateMoney,
  rescaleMoney,
  roundMoney,
  subtractMoney,
  sumMoney,
  zeroMoney,
} from '../money'
import { snapshotMoney, serializeMoney } from '../serialization'
import type { Currency, Money } from '../types'
import { currencyOf } from './helpers'

let usd: Currency
let usdFourPlaces: Currency
let eur: Currency

beforeAll(async () => {
  usd = await currencyOf('USD')
  usdFourPlaces = await currencyOf('USD', { USD: { decimalPlaces: 4 } })
  eur = await currencyOf('EUR')
})

const text = (money: Money) => money.amount.toFixed()

describe('Money arithmetic', () => {
  it('creates exact amounts without rounding', () => {
    expect(text(createMoney('12.345678901234567890123', usd))).toBe('12.345678901234567890123')
    expect(createMoney(10, usd).currency).toBe(usd)
    expect(text(zeroMoney(usd))).toBe('0')
  })

  it('rejects invalid and oversized amounts', () => {
    expect(() => createMoney('abc', usd)).toThrow('[internal]')
    expect(() => createMoney('1e5000', usd)).toThrow('[internal]')
    expect(() => createMoney(Number.NaN, usd)).toThrow('[internal]')
  })

  it('adds and subtracts exactly', () => {
    expect(text(addMoney(createMoney('0.1', usd), createMoney('0.2', usd)))).toBe('0.3')
    expect(text(subtractMoney(createMoney('0.3', usd), createMoney('0.1', usd)))).toBe('0.2')
  })

  it('throws on arithmetic across different codes or decimal places', () => {
    expect(() => addMoney(createMoney(1, usd), createMoney(1, eur))).toThrow(CurrencyMismatchError)
    expect(() => subtractMoney(createMoney(1, usd), createMoney(1, usdFourPlaces))).toThrow(CurrencyMismatchError)
    expect(() => compareMoney(createMoney(1, usd), createMoney(1, eur))).toThrow(CurrencyMismatchError)
    expect(() => sumMoney(usd, [createMoney(1, eur)])).toThrow(CurrencyMismatchError)
    expect(() => minMoney(createMoney(1, usd), createMoney(1, eur))).toThrow(CurrencyMismatchError)
  })

  it('works as reduce and map callbacks', () => {
    const lines = ['19.99', '0.01', '5.005'].map((amount) => createMoney(amount, usd))
    expect(text(lines.reduce(addMoney, zeroMoney(usd)))).toBe('25.005')
    expect(text(sumMoney(usd, lines))).toBe('25.005')
    expect(text(sumMoney(usd, []))).toBe('0')
    expect(lines.map((line) => multiplyMoney(line, 3)).map(text)).toEqual(['59.97', '0.03', '15.015'])
  })

  it('multiplies, negates and takes the absolute value exactly', () => {
    expect(text(multiplyMoney(createMoney('1.1', usd), '1.1'))).toBe('1.21')
    expect(text(negateMoney(createMoney('2.5', usd)))).toBe('-2.5')
    expect(text(absMoney(createMoney('-2.5', usd)))).toBe('2.5')
    expect(isNegativeMoney(negateMoney(zeroMoney(usd)))).toBe(false)
    expect(negateMoney(zeroMoney(usd)).amount.s).toBe(1)
  })

  it('compares and sorts', () => {
    const values = ['3', '-1', '2.5'].map((amount) => createMoney(amount, usd))
    expect([...values].sort(compareMoney).map(text)).toEqual(['-1', '2.5', '3'])
    expect(compareMoney(createMoney('1.0', usd), createMoney('1', usd))).toBe(0)
    expect(text(minMoney(...values))).toBe('-1')
    expect(text(maxMoney(...values))).toBe('3')
    expect(() => minMoney()).toThrow('[internal]')
    expect(() => maxMoney()).toThrow('[internal]')
  })

  it('checks equality without throwing across currencies', () => {
    expect(moneyEquals(createMoney('1.50', usd), createMoney('1.5', usd))).toBe(true)
    expect(moneyEquals(createMoney('1', usd), createMoney('1', eur))).toBe(false)
    expect(moneyEquals(createMoney('1', usd), createMoney('1', usdFourPlaces))).toBe(false)
  })

  it('reports the sign', () => {
    expect(isZeroMoney(createMoney('0.00', usd))).toBe(true)
    expect(isPositiveMoney(createMoney('0.01', usd))).toBe(true)
    expect(isNegativeMoney(createMoney('-0.01', usd))).toBe(true)
    expect(isPositiveMoney(zeroMoney(usd))).toBe(false)
  })
})

describe('Money immutability', () => {
  it('rejects writes to the amount digits, sign, currency and amount reference', () => {
    const money = createMoney('12.34', usd)
    expect(() => {
      ;(money.amount.c as number[])[0] = 9
    }).toThrow(TypeError)
    expect(() => {
      ;(money.amount as { s: number }).s = -1
    }).toThrow(TypeError)
    expect(() => {
      ;(money.currency as { decimalPlaces: number }).decimalPlaces = 4
    }).toThrow(TypeError)
    expect(() => {
      ;(money as { amount: unknown }).amount = toDecimal(99)
    }).toThrow(TypeError)
    expect(text(money)).toBe('12.34')
    expect(money.currency.decimalPlaces).toBe(2)
  })

  it('owns a copy of a Big the caller still holds', () => {
    const big = toDecimal('12.34')
    const money = createMoney(big, usd)
    big.c[0] = 9
    big.s = -1
    expect(text(money)).toBe('12.34')
  })

  it('runs every operation on deep-frozen inputs and leaves them unchanged', async () => {
    const jpy = await currencyOf('JPY')
    const usdTenPlaces = await currencyOf('USD', { USD: { decimalPlaces: 10 } })
    const left = createMoney('-10.25', usd)
    const right = createMoney('3.10', usd)
    const operations: Array<() => unknown> = [
      () => addMoney(left, right),
      () => subtractMoney(left, right),
      () => sumMoney(usd, [left, right]),
      () => multiplyMoney(left, right.amount),
      () => divideMoney(left, right.amount, { decimalPlaces: 2, mode: 'halfEven' }),
      () => roundMoney(left, { decimalPlaces: 1, mode: 'halfUp' }),
      () => negateMoney(left),
      () => absMoney(left),
      () => allocateMoney(left, [right.amount, 1, '0.5'], { decimalPlaces: 2 }),
      () => convertMoney(left, right.amount, jpy, { decimalPlaces: 0, mode: 'down' }),
      () => rescaleMoney(left, usdTenPlaces, { decimalPlaces: 10, mode: 'up' }),
      () => compareMoney(left, right),
      () => moneyEquals(left, right),
      () => minMoney(left, right),
      () => maxMoney(left, right),
      () => isZeroMoney(left),
      () => isNegativeMoney(left),
      () => isPositiveMoney(left),
      () => serializeMoney(left),
      () => snapshotMoney(left),
    ]
    for (const operation of operations) {
      expect(operation).not.toThrow()
    }
    expect(text(left)).toBe('-10.25')
    expect(text(right)).toBe('3.1')
    expect(Object.isFrozen(left.amount.c)).toBe(true)
  })
})
