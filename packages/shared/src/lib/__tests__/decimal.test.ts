import { z } from 'zod'
import {
  addDecimals,
  amountComparisonTolerance,
  compareDecimals,
  decimalStringSchema,
  decimalToString,
  divideDecimals,
  isDecimalInput,
  MAX_DECIMAL_INTEGER_DIGITS,
  MAX_DECIMAL_SIGNIFICANT_DIGITS,
  maxDecimal,
  minDecimal,
  multiplyDecimals,
  nonNegativeDecimalStringSchema,
  padDecimalPlaces,
  parseDecimal,
  positiveDecimalStringSchema,
  resolveAmountDecimalPlaces,
  resolveExactDecimal,
  resolveCurrencyDisplayDecimalPlaces,
  resolveIsoCurrencyDecimalPlaces,
  roundDecimal,
  subtractDecimals,
  sumDecimals,
  toDecimal,
  withExactAmounts,
  withDecimalCaps,
  withExactListAmounts,
} from '../decimal'
import { ISO_4217_MINOR_UNITS } from '../isoCurrencyMinorUnits'

describe('decimal', () => {
  it('adds without float drift', () => {
    expect(decimalToString(addDecimals('0.1', '0.2'))).toBe('0.3')
    expect(decimalToString(addDecimals(0.1, 0.2))).toBe('0.3')
  })

  it('keeps 18+ decimal places exactly', () => {
    const wei = '0.000000000000000001'
    expect(decimalToString(multiplyDecimals(wei, 3))).toBe('0.000000000000000003')
    expect(decimalToString(addDecimals('123456789012345678901234567890', wei))).toBe(
      '123456789012345678901234567890.000000000000000001',
    )
    expect(decimalToString(subtractDecimals('1', '0.0000000000000000000000000001'))).toBe(
      '0.9999999999999999999999999999',
    )
  })

  it('never outputs exponent notation or padding', () => {
    expect(decimalToString('1e-7')).toBe('0.0000001')
    expect(decimalToString(1e21)).toBe('1000000000000000000000')
    expect(decimalToString('40.0000')).toBe('40')
    expect(decimalToString('-0')).toBe('0')
    expect(decimalToString(' +12.50 ')).toBe('12.5')
  })

  it('divides with at least the requested decimal places', () => {
    expect(decimalToString(divideDecimals(1, 3, 20))).toBe('0.33333333333333333333')
    expect(decimalToString(divideDecimals(10, 4, 4))).toBe('2.5')
  })

  it('keeps at least 17 significant digits in a quotient', () => {
    const quotient = decimalToString(divideDecimals('1', '30000000000000000000000000000000000000000000000000000000000', 4))
    const significant = quotient.replace(/^0\.0*/, '')
    expect(significant.length).toBeGreaterThanOrEqual(17)
    expect(divideDecimals('1', '7', 0).toFixed().replace('.', '').length).toBeGreaterThanOrEqual(17)
  })

  it('rejects division by zero', () => {
    expect(() => divideDecimals(1, 0)).toThrow()
  })

  it('rounds half away from zero', () => {
    expect(decimalToString(roundDecimal('2.5', 0))).toBe('3')
    expect(decimalToString(roundDecimal('-2.5', 0))).toBe('-3')
    expect(decimalToString(roundDecimal('1.23455', 4))).toBe('1.2346')
  })

  it('compares, sums and picks extremes', () => {
    expect(compareDecimals('1.10', '1.1')).toBe(0)
    expect(compareDecimals('0.000000000000000002', '0.000000000000000001')).toBe(1)
    expect(decimalToString(sumDecimals(['0.1', '0.2', 0.3]))).toBe('0.6')
    expect(decimalToString(sumDecimals([]))).toBe('0')
    expect(decimalToString(minDecimal('3', '-1', '2'))).toBe('-1')
    expect(decimalToString(maxDecimal('3', '-1', '2'))).toBe('3')
  })

  it('rejects exponents that would expand into huge strings', () => {
    expect(parseDecimal('1e-100000000')).toBeNull()
    expect(parseDecimal('1e100000000')).toBeNull()
    expect(() => toDecimal('1e-1001')).toThrow()
    expect(decimalStringSchema.safeParse('1e-100000000').success).toBe(false)
    expect(decimalToString('1e-20')).toBe('0.00000000000000000001')
  })

  it('caps the significant digits of an input', () => {
    const longest = '1'.repeat(MAX_DECIMAL_SIGNIFICANT_DIGITS)
    expect(isDecimalInput(`0.${longest}`)).toBe(true)
    expect(isDecimalInput(`0.${longest}1`)).toBe(false)
    expect(isDecimalInput(`0.${longest}000`)).toBe(true)
    expect(decimalStringSchema.safeParse(`0.${'9'.repeat(MAX_DECIMAL_SIGNIFICANT_DIGITS + 1)}`).success).toBe(false)
  })

  it('caps the magnitude so the float copy stays finite', () => {
    const largest = '9'.repeat(MAX_DECIMAL_INTEGER_DIGITS)
    expect(isDecimalInput(largest)).toBe(true)
    expect(Number.isFinite(Number(largest))).toBe(true)
    expect(isDecimalInput(`1${'0'.repeat(MAX_DECIMAL_INTEGER_DIGITS)}`)).toBe(false)
    expect(isDecimalInput('9.99e299')).toBe(true)
    expect(isDecimalInput('1e300')).toBe(false)
    expect(isDecimalInput('0.01e301')).toBe(true)
    expect(isDecimalInput('0.01e302')).toBe(false)
    expect(isDecimalInput(1e300)).toBe(false)
    expect(parseDecimal(Number.MAX_VALUE)).toBeNull()
    expect(() => toDecimal(1e300)).toThrow()
    expect(decimalStringSchema.safeParse('1e300').success).toBe(false)
  })

  it('caps how far below the decimal point a digit may sit', () => {
    expect(isDecimalInput('1e-1000')).toBe(true)
    expect(isDecimalInput('1.5e-1000')).toBe(false)
    expect(isDecimalInput(`0.${'0'.repeat(999)}1`)).toBe(true)
    expect(isDecimalInput(`0.${'0'.repeat(20000)}1`)).toBe(false)
    expect(isDecimalInput(`0.${'0'.repeat(20000)}`)).toBe(true)
  })

  it('parses loosely and validates strictly', () => {
    expect(parseDecimal(null)).toBeNull()
    expect(parseDecimal('')).toBeNull()
    expect(parseDecimal('abc')).toBeNull()
    expect(parseDecimal(Number.NaN)).toBeNull()
    expect(decimalToString(parseDecimal('12.3400')!)).toBe('12.34')
    expect(() => toDecimal('1,5')).toThrow()
    expect(() => toDecimal(Number.POSITIVE_INFINITY)).toThrow()
  })

  it('pads to a minimum number of decimals without cutting digits', () => {
    expect(padDecimalPlaces('12.5', 2)).toBe('12.50')
    expect(padDecimalPlaces('12', 0)).toBe('12')
    expect(padDecimalPlaces('0.000000000000000001', 2)).toBe('0.000000000000000001')
  })

  it('resolves amount precision with a 4 decimal floor', () => {
    expect(resolveAmountDecimalPlaces(2)).toBe(4)
    expect(resolveAmountDecimalPlaces(8)).toBe(8)
    expect(resolveAmountDecimalPlaces(18)).toBe(18)
    expect(resolveAmountDecimalPlaces(null)).toBe(4)
    expect(resolveAmountDecimalPlaces(-1)).toBe(4)
  })

  it('resolves ISO currency digits', () => {
    expect(resolveIsoCurrencyDecimalPlaces('USD')).toBe(2)
    expect(resolveIsoCurrencyDecimalPlaces('JPY')).toBe(0)
    expect(resolveIsoCurrencyDecimalPlaces('kwd')).toBe(3)
    expect(resolveIsoCurrencyDecimalPlaces(null)).toBeNull()
  })

  it('resolves ISO 4217 minor units from the static table, not Intl display digits', () => {
    expect(resolveIsoCurrencyDecimalPlaces('HUF')).toBe(2)
    expect(resolveIsoCurrencyDecimalPlaces('COP')).toBe(2)
    expect(resolveIsoCurrencyDecimalPlaces('IDR')).toBe(2)
    expect(resolveIsoCurrencyDecimalPlaces('huf')).toBe(2)
    expect(resolveIsoCurrencyDecimalPlaces('IQD')).toBe(3)
    expect(resolveIsoCurrencyDecimalPlaces('BHD')).toBe(3)
    expect(resolveIsoCurrencyDecimalPlaces('CLF')).toBe(4)
    expect(resolveIsoCurrencyDecimalPlaces('UYW')).toBe(4)
    expect(resolveIsoCurrencyDecimalPlaces('ISK')).toBe(0)
    expect(resolveIsoCurrencyDecimalPlaces('VND')).toBe(0)
  })

  it('returns null for ISO codes without a minor unit', () => {
    expect(resolveIsoCurrencyDecimalPlaces('XAU')).toBeNull()
    expect(resolveIsoCurrencyDecimalPlaces('XDR')).toBeNull()
    expect(resolveIsoCurrencyDecimalPlaces('XXX')).toBeNull()
    expect(resolveIsoCurrencyDecimalPlaces('HRK')).toBeNull()
    expect(resolveIsoCurrencyDecimalPlaces('DEM')).toBeNull()
  })

  it('lists every ISO 4217 code, current and withdrawn', () => {
    expect(Object.keys(ISO_4217_MINOR_UNITS)).toHaveLength(307)
    expect(Object.keys(ISO_4217_MINOR_UNITS).filter((code) => ISO_4217_MINOR_UNITS[code] !== null)).toHaveLength(165)
    expect(ISO_4217_MINOR_UNITS).toHaveProperty('XCG', 2)
    expect(ISO_4217_MINOR_UNITS).toHaveProperty('ANG', null)
  })

  it('resolves Intl display digits for display only', () => {
    expect(resolveCurrencyDisplayDecimalPlaces('USD')).toBe(2)
    expect(resolveCurrencyDisplayDecimalPlaces('jpy')).toBe(0)
    expect(resolveCurrencyDisplayDecimalPlaces('KWD')).toBe(3)
    expect(resolveCurrencyDisplayDecimalPlaces('ETH')).toBeNull()
    expect(resolveCurrencyDisplayDecimalPlaces(null)).toBeNull()
  })

  it('returns null for codes Intl formats but does not know', () => {
    expect(resolveIsoCurrencyDecimalPlaces('ETH')).toBeNull()
    expect(resolveIsoCurrencyDecimalPlaces('BTC')).toBeNull()
    expect(resolveIsoCurrencyDecimalPlaces('XYZ')).toBeNull()
    expect(resolveIsoCurrencyDecimalPlaces('XYZW')).toBeNull()
  })

  it('never widens the amount tolerance past the default precision', () => {
    expect(decimalToString(amountComparisonTolerance())).toBe('0.005')
    expect(decimalToString(amountComparisonTolerance(8))).toBe('0.0000005')
    expect(decimalToString(amountComparisonTolerance(2))).toBe('0.005')
    expect(decimalToString(amountComparisonTolerance(1))).toBe('0.005')
    expect(decimalToString(amountComparisonTolerance(0))).toBe('0.005')
  })

  it('validates decimal strings with zod', () => {
    expect(decimalStringSchema.parse(12.5)).toBe('12.5')
    expect(decimalStringSchema.parse('0.000000000000000000000001')).toBe('0.000000000000000000000001')
    expect(decimalStringSchema.safeParse('abc').success).toBe(false)
    expect(decimalStringSchema.safeParse(Number.NaN).success).toBe(false)
    expect(nonNegativeDecimalStringSchema.safeParse('-1').success).toBe(false)
    expect(nonNegativeDecimalStringSchema.parse('0')).toBe('0')
    expect(positiveDecimalStringSchema.safeParse('0').success).toBe(false)
    expect(positiveDecimalStringSchema.parse('0.1')).toBe('0.1')
  })
})

describe('resolveExactDecimal', () => {
  it('prefers the exact string while the legacy number still matches it', () => {
    expect(resolveExactDecimal('0.000000000000000000123', 1.23e-19)).toBe('0.000000000000000000123')
    expect(resolveExactDecimal('12345678901234567890.1', Number('12345678901234567890.1'))).toBe('12345678901234567890.1')
  })

  it('falls back to the legacy number once it was changed on its own', () => {
    expect(resolveExactDecimal('10.123456789', 12)).toBe('12')
  })

  it('rejects exact values that underflow to zero', () => {
    expect(resolveExactDecimal('-1e-400', -0)).toBe('0')
    expect(resolveExactDecimal('1e-400', 0)).toBe('0')
    expect(resolveExactDecimal('0.000', 0)).toBe('0')
  })

  it('handles missing values', () => {
    expect(resolveExactDecimal(null, 5)).toBe('5')
    expect(resolveExactDecimal('7.5', undefined)).toBe('7.5')
    expect(resolveExactDecimal(undefined, null)).toBeNull()
    expect(resolveExactDecimal('abc', 'def')).toBeNull()
  })
})

describe('withExactAmounts', () => {
  it('keeps raw string digits next to the coerced numbers', () => {
    const raw = { amount: '0.123456789012345678901', other: 'x', fee: 5 }
    const parsed = { amount: Number(raw.amount), other: 'x', fee: 5, missing: undefined as number | undefined }
    const result = withExactAmounts(parsed, raw, ['amount', 'fee', 'missing'] as const)
    expect(result.amountExact).toBe('0.123456789012345678901')
    expect(result.feeExact).toBe('5')
    expect('missingExact' in result).toBe(false)
    expect(result.amount).toBe(parsed.amount)
  })

  it('reads the exact string a route attached once the raw field is a number', () => {
    const exactValue = '0.123456789012345678901'
    const routeOutput = { amount: Number(exactValue), amountExact: exactValue }
    const result = withExactAmounts({ amount: Number(exactValue) }, routeOutput, ['amount'] as const)
    expect(result.amountExact).toBe(exactValue)
  })

  it('ignores an attached exact string that does not match the number', () => {
    const result = withExactAmounts({ amount: 12 }, { amount: 12, amountExact: '99.5' }, ['amount'] as const)
    expect(result.amountExact).toBe('12')
  })

  it('never pairs a parsed null with a raw exact string', () => {
    const raw = { defaultCreditLimit: null, defaultCreditLimitExact: '-1000' }
    const result = withExactAmounts({ defaultCreditLimit: null }, raw, ['defaultCreditLimit'] as const)
    expect(result.defaultCreditLimitExact).toBeNull()
    const coerced = withExactAmounts({ amount: null }, { amount: '', amountExact: '-1000' }, ['amount'] as const)
    expect(coerced.amountExact).toBeNull()
  })

  it('reads a raw exact string only when the raw field is a number', () => {
    const missingRaw = withExactAmounts({ amount: 0 }, { amountExact: '-1000' }, ['amount'] as const)
    expect(missingRaw.amountExact).toBe('0')
    const parsedString = withExactAmounts({ amount: '5' }, { amount: 5, amountExact: '-1000' }, ['amount'] as const)
    expect(parsedString.amountExact).toBe('5')
  })
})

describe('withExactListAmounts', () => {
  it('pairs parsed and raw list items by index', () => {
    const raw = { lines: [{ price: '1.000000000000000001' }, { price: 2 }] }
    const parsed = [{ price: Number('1.000000000000000001') }, { price: 2 }]
    const result = withExactListAmounts(parsed, raw, 'lines', ['price'] as const)
    expect(result?.map((line) => line.priceExact)).toEqual(['1.000000000000000001', '2'])
    expect(withExactListAmounts(undefined, raw, 'lines', ['price'] as const)).toBeUndefined()
  })

  it('never pairs a parsed null item with a raw exact string', () => {
    const raw = { lines: [{ price: null, priceExact: '-1000' }] }
    const result = withExactListAmounts([{ price: null }], raw, 'lines', ['price'] as const)
    expect(result?.[0].priceExact).toBeNull()
  })
})

describe('withDecimalCaps', () => {
  const schema = withDecimalCaps(z.coerce.number().min(0), 'amount_invalid')

  it('rejects oversized decimals before coercion', () => {
    expect(schema.safeParse(1e305).success).toBe(false)
    expect(schema.safeParse('1e305').success).toBe(false)
    expect(schema.safeParse(`0.${'1'.repeat(1001)}`).success).toBe(false)
  })

  it('leaves valid, blank and non-numeric input to the wrapped schema', () => {
    expect(schema.parse('12.5')).toBe(12.5)
    expect(schema.parse('')).toBe(0)
    expect(schema.safeParse(-1).success).toBe(false)
  })
})
