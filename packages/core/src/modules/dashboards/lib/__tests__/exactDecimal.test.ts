/**
 * @jest-environment node
 */
import {
  EXACT_DECIMAL_ZERO,
  addExactDecimal,
  compareExactDecimal,
  exactDecimalToNumber,
  exactDecimalToString,
  parseExactDecimal,
} from '../exactDecimal'

function sum(values: string[]): number {
  return exactDecimalToNumber(
    values.reduce((acc, raw) => {
      const parsed = parseExactDecimal(raw)
      if (!parsed) throw new Error(`[internal] unparsable fixture: ${raw}`)
      return addExactDecimal(acc, parsed)
    }, EXACT_DECIMAL_ZERO),
  )
}

describe('parseExactDecimal', () => {
  test('parses the string form PostgreSQL returns for numeric columns', () => {
    expect(parseExactDecimal('1234.56')).toEqual({ units: 123456n, scale: 2 })
    expect(parseExactDecimal('-0.05')).toEqual({ units: -5n, scale: 2 })
    expect(parseExactDecimal('42')).toEqual({ units: 42n, scale: 0 })
    expect(parseExactDecimal(' 7.10 ')).toEqual({ units: 710n, scale: 2 })
  })

  test('parses numbers and bigints', () => {
    expect(parseExactDecimal(12.5)).toEqual({ units: 125n, scale: 1 })
    expect(parseExactDecimal(10n)).toEqual({ units: 10n, scale: 0 })
  })

  test('parses exponential notation', () => {
    expect(exactDecimalToString(parseExactDecimal('1.5e3')!)).toBe('1500')
    expect(exactDecimalToString(parseExactDecimal('1.5e-3')!)).toBe('0.0015')
  })

  test('rejects values that are not finite decimals', () => {
    expect(parseExactDecimal(null)).toBeNull()
    expect(parseExactDecimal(undefined)).toBeNull()
    expect(parseExactDecimal('')).toBeNull()
    expect(parseExactDecimal('abc')).toBeNull()
    expect(parseExactDecimal('12,5')).toBeNull()
    expect(parseExactDecimal(Number.NaN)).toBeNull()
    expect(parseExactDecimal(Number.POSITIVE_INFINITY)).toBeNull()
    expect(parseExactDecimal({})).toBeNull()
  })
})

describe('addExactDecimal', () => {
  test('sums fractional money without binary floating-point drift', () => {
    expect(sum(['0.1', '0.2'])).toBe(0.3)
    expect(sum(['0.1', '0.2', '0.3'])).toBe(0.6)
    expect(0.1 + 0.2).not.toBe(0.3)
  })

  test('aligns operands of different scales', () => {
    const total = addExactDecimal(parseExactDecimal('1.5')!, parseExactDecimal('2.25')!)
    expect(exactDecimalToString(total)).toBe('3.75')
  })

  test('keeps large fixed-scale amounts exact where a float would round', () => {
    expect(sum(['9007199254740993.01', '0.01'])).toBe(Number('9007199254740993.02'))
    expect(exactDecimalToString(
      addExactDecimal(parseExactDecimal('9007199254740993.01')!, parseExactDecimal('0.01')!),
    )).toBe('9007199254740993.02')
  })
})

describe('compareExactDecimal', () => {
  test('orders values across scales and signs', () => {
    expect(compareExactDecimal(parseExactDecimal('1.10')!, parseExactDecimal('1.1')!)).toBe(0)
    expect(compareExactDecimal(parseExactDecimal('-2')!, parseExactDecimal('0.5')!)).toBe(-1)
    expect(compareExactDecimal(parseExactDecimal('10')!, parseExactDecimal('9.99')!)).toBe(1)
  })
})

describe('exactDecimalToString', () => {
  test('renders values smaller than one with a leading zero', () => {
    expect(exactDecimalToString({ units: 5n, scale: 2 })).toBe('0.05')
    expect(exactDecimalToString({ units: -5n, scale: 2 })).toBe('-0.05')
    expect(exactDecimalToString(EXACT_DECIMAL_ZERO)).toBe('0')
  })
})
