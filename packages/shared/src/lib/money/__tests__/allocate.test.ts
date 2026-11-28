import { beforeAll, describe, expect, it } from '@jest/globals'
import type { DecimalInput } from '../../decimal'
import { InvalidAllocationError } from '../errors'
import { allocateMoney, createMoney, moneyEquals, sumMoney } from '../money'
import type { Currency, Money } from '../types'
import { currencyOf } from './helpers'

let usd: Currency
let jpy: Currency

beforeAll(async () => {
  usd = await currencyOf('USD')
  jpy = await currencyOf('JPY')
})

const texts = (parts: Money[]) => parts.map((part) => part.amount.toFixed())

function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
}

describe('allocateMoney', () => {
  it('gives leftover units to the largest exact remainders, ties to the lower index', () => {
    expect(texts(allocateMoney(createMoney('0.10', usd), [1, 1, 1], { decimalPlaces: 2 }))).toEqual([
      '0.04',
      '0.03',
      '0.03',
    ])
    expect(texts(allocateMoney(createMoney('0.05', usd), [3, 7], { decimalPlaces: 2 }))).toEqual(['0.02', '0.03'])
    expect(texts(allocateMoney(createMoney('100', usd), [1, 1, 1], { decimalPlaces: 2 }))).toEqual([
      '33.34',
      '33.33',
      '33.33',
    ])
  })

  it('supports decimal ratios', () => {
    expect(texts(allocateMoney(createMoney('10.01', usd), [0.5, '0.25', '0.25'], { decimalPlaces: 2 }))).toEqual([
      '5.01',
      '2.5',
      '2.5',
    ])
    expect(texts(allocateMoney(createMoney('1', usd), ['0.333', '0.667'], { decimalPlaces: 2 }))).toEqual([
      '0.33',
      '0.67',
    ])
  })

  it('splits negative totals into non-positive parts', () => {
    const parts = allocateMoney(createMoney('-0.10', usd), [1, 1, 1], { decimalPlaces: 2 })
    expect(texts(parts)).toEqual(['-0.04', '-0.03', '-0.03'])
    expect(moneyEquals(sumMoney(usd, parts), createMoney('-0.10', usd))).toBe(true)
  })

  it('never gives a unit to a zero ratio', () => {
    expect(texts(allocateMoney(createMoney('0.03', usd), [0, 1, 0, 1], { decimalPlaces: 2 }))).toEqual([
      '0',
      '0.02',
      '0',
      '0.01',
    ])
  })

  it('allocates in whole units when decimal places are zero', () => {
    expect(texts(allocateMoney(createMoney(1000, jpy), [1, 2, 3], { decimalPlaces: 0 }))).toEqual(['167', '333', '500'])
  })

  it('keeps intermediate units uncapped so representable shares of large totals allocate', () => {
    const total = createMoney('1e299', usd)
    const parts = allocateMoney(total, [1, 1], { decimalPlaces: 2 })
    expect(texts(parts)).toEqual([`5${'0'.repeat(298)}`, `5${'0'.repeat(298)}`])
    expect(moneyEquals(sumMoney(usd, parts), total)).toBe(true)
    const odd = createMoney(`${'9'.repeat(299)}.99`, usd)
    const thirds = allocateMoney(odd, [1, 1, 1], { decimalPlaces: 2 })
    expect(moneyEquals(sumMoney(usd, thirds), odd)).toBe(true)
  })

  it('handles ratios with up to 50 decimals exactly', () => {
    const total = createMoney('0.15', usd)
    expect(texts(allocateMoney(total, [1, '1e-50'], { decimalPlaces: 2 }))).toEqual(['0.15', '0'])
    const long = allocateMoney(total, [1, `0.${'1'.repeat(50)}`], { decimalPlaces: 2 })
    expect(moneyEquals(sumMoney(usd, long), total)).toBe(true)
  })

  it('keeps the exact integer work bounded for many high-precision ratios', () => {
    const ratios = Array.from({ length: 1000 }, (_unused, index) => `${'9'.repeat(49)}${index % 10}.${'7'.repeat(50)}`)
    const started = Date.now()
    const total = createMoney(`${'9'.repeat(299)}.99`, usd)
    const parts = allocateMoney(total, ratios, { decimalPlaces: 2 })
    expect(Date.now() - started).toBeLessThan(5000)
    expect(moneyEquals(sumMoney(usd, parts), total)).toBe(true)
  })

  it('always sums exactly to the total', () => {
    const random = seededRandom(42)
    for (let run = 0; run < 200; run += 1) {
      const decimalPlaces = Math.floor(random() * 5)
      const units = Math.floor(random() * 2_000_000) - 1_000_000
      const total = createMoney((units / 10 ** decimalPlaces).toFixed(decimalPlaces), usd)
      const count = 1 + Math.floor(random() * 7)
      const ratios: DecimalInput[] = Array.from({ length: count }, () => (random() * 10).toFixed(Math.floor(random() * 4)))
      if (ratios.every((ratio) => Number(ratio) === 0)) ratios[0] = 1
      const parts = allocateMoney(total, ratios, { decimalPlaces })
      expect(parts).toHaveLength(count)
      expect(moneyEquals(sumMoney(usd, parts), total)).toBe(true)
      for (const part of parts) {
        expect(part.amount.toFixed().split('.')[1]?.length ?? 0).toBeLessThanOrEqual(decimalPlaces)
        if (total.amount.gte(0)) expect(part.amount.gte(0)).toBe(true)
        else expect(part.amount.lte(0)).toBe(true)
      }
    }
  })

  it.each<[string, DecimalInput[], number]>([
    ['an amount with more decimals than allowed', [1, 1], 1],
    ['empty ratios', [], 2],
    ['a negative ratio', [1, -1], 2],
    ['all-zero ratios', [0, '0.0'], 2],
    ['a non-decimal ratio', [1, 'abc'], 2],
    ['invalid decimal places', [1, 1], -1],
    ['fractional decimal places', [1, 1], 1.5],
    ['a ratio with more than 50 decimals', [1, `0.${'1'.repeat(51)}`], 2],
    ['a ratio with 300 decimals', [1, `0.${'1'.repeat(300)}`], 2],
    ['a ratio below the 50th decimal place', [1, '1e-400'], 2],
    ['more than 1000 ratios', Array.from({ length: 1001 }, () => 1), 2],
    ['a ratio with more than 50 integer digits', [1, `1${'0'.repeat(50)}`], 2],
  ])('rejects %s', (_label, ratios, decimalPlaces) => {
    expect(() => allocateMoney(createMoney('0.15', usd), ratios, { decimalPlaces })).toThrow(InvalidAllocationError)
  })
})
