import BigConstructor from 'big.js'
import type { Big, BigSource } from 'big.js'
import { z } from 'zod'
import { ISO_4217_MINOR_UNITS } from './isoCurrencyMinorUnits'

export type DecimalValue = Big
export type DecimalInput = string | number | Big

export const FX_DECIMAL_PLACES = 50
export const MIN_SIGNIFICANT_DIGITS = 17
export const DEFAULT_AMOUNT_DECIMAL_PLACES = 4

const ROUND_HALF_UP = 1

const Decimal = BigConstructor()
Decimal.DP = FX_DECIMAL_PLACES
Decimal.RM = ROUND_HALF_UP

/**
 * Largest exponent accepted in a decimal string, and the lowest decimal position
 * a digit may sit at (`1e-1000`). Expanding `1e-100000000` to plain notation
 * would allocate a 100M-character string, so anything beyond this bound (far
 * past any real money or FX value) is rejected as invalid input.
 */
export const MAX_DECIMAL_EXPONENT = 1000

/**
 * Most significant digits a decimal input may carry. Arithmetic cost grows with
 * the digit count, so longer inputs are rejected as invalid.
 */
export const MAX_DECIMAL_SIGNIFICANT_DIGITS = 1000

/**
 * Most integer digits a decimal input may carry (`|value| < 1e300`), so the
 * legacy float copy of an accepted value is always finite.
 */
export const MAX_DECIMAL_INTEGER_DIGITS = 300

const DECIMAL_STRING_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)(?:e([+-]?\d+))?$/i
const NON_ZERO_DIGIT_PATTERN = /[1-9]/

function isDecimalString(value: string): boolean {
  const match = DECIMAL_STRING_PATTERN.exec(value)
  if (!match) return false
  const exponent = match[3] === undefined ? 0 : Number(match[3])
  if (Math.abs(exponent) > MAX_DECIMAL_EXPONENT) return false
  const [integerPart, fractionPart = ''] = match[1].split('.')
  const digits = `${integerPart}${fractionPart}`
  const firstSignificant = digits.search(NON_ZERO_DIGIT_PATTERN)
  if (firstSignificant === -1) return true
  let lastSignificant = digits.length - 1
  while (digits[lastSignificant] === '0') lastSignificant -= 1
  const unitsIndex = integerPart.length - 1 + exponent
  return (
    lastSignificant - firstSignificant < MAX_DECIMAL_SIGNIFICANT_DIGITS &&
    unitsIndex - firstSignificant < MAX_DECIMAL_INTEGER_DIGITS &&
    unitsIndex - lastSignificant >= -MAX_DECIMAL_EXPONENT
  )
}

function isDecimalNumber(value: number): boolean {
  return Number.isFinite(value) && isDecimalString(String(value))
}

export function isDecimalInput(value: unknown): value is DecimalInput {
  if (typeof value === 'number') return isDecimalNumber(value)
  if (typeof value === 'string') return isDecimalString(value.trim())
  return value instanceof BigConstructor
}

export function toDecimal(value: DecimalInput): DecimalValue {
  if (typeof value === 'number') {
    if (!isDecimalNumber(value)) throw new Error(`[internal] Invalid decimal value: ${value}`)
    return new Decimal(value)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!isDecimalString(trimmed)) throw new Error(`[internal] Invalid decimal value: ${value.slice(0, 50)}`)
    return new Decimal(trimmed.startsWith('+') ? trimmed.slice(1) : trimmed)
  }
  return new Decimal(value as BigSource)
}

export function parseDecimal(value: unknown): DecimalValue | null {
  if (value === null || value === undefined || value === '') return null
  if (!isDecimalInput(value)) return null
  return toDecimal(value)
}

export function decimalToString(value: DecimalInput): string {
  return toDecimal(value).toFixed()
}

export function addDecimals(left: DecimalInput, right: DecimalInput): DecimalValue {
  return toDecimal(left).plus(toDecimal(right))
}

export function subtractDecimals(left: DecimalInput, right: DecimalInput): DecimalValue {
  return toDecimal(left).minus(toDecimal(right))
}

export function multiplyDecimals(left: DecimalInput, right: DecimalInput): DecimalValue {
  return toDecimal(left).times(toDecimal(right))
}

export function sumDecimals(values: DecimalInput[]): DecimalValue {
  return values.reduce<DecimalValue>((total, value) => total.plus(toDecimal(value)), new Decimal(0))
}

/**
 * Divides with at least `decimalPlaces` decimals and never fewer than
 * MIN_SIGNIFICANT_DIGITS significant digits, so a quotient is never less
 * precise than the same division done on a JS `number`.
 */
export function divideDecimals(
  dividend: DecimalInput,
  divisor: DecimalInput,
  decimalPlaces: number = FX_DECIMAL_PLACES,
): DecimalValue {
  const left = toDecimal(dividend)
  const right = toDecimal(divisor)
  if (right.eq(0)) throw new Error('[internal] Division by zero')
  if (left.eq(0)) return new Decimal(0)
  const significantDecimalPlaces = MIN_SIGNIFICANT_DIGITS - (left.e - right.e)
  const previousDecimalPlaces = Decimal.DP
  Decimal.DP = Math.max(decimalPlaces, significantDecimalPlaces, 0)
  try {
    return left.div(right)
  } finally {
    Decimal.DP = previousDecimalPlaces
  }
}

export function roundDecimal(value: DecimalInput, decimalPlaces: number): DecimalValue {
  return toDecimal(value).round(decimalPlaces, ROUND_HALF_UP)
}

export function compareDecimals(left: DecimalInput, right: DecimalInput): -1 | 0 | 1 {
  return toDecimal(left).cmp(toDecimal(right)) as -1 | 0 | 1
}

export function decimalsEqual(left: DecimalInput, right: DecimalInput): boolean {
  return compareDecimals(left, right) === 0
}

export function isZeroDecimal(value: DecimalInput): boolean {
  return toDecimal(value).eq(0)
}

export function isNegativeDecimal(value: DecimalInput): boolean {
  return toDecimal(value).lt(0)
}

export function absDecimal(value: DecimalInput): DecimalValue {
  return toDecimal(value).abs()
}

export function negateDecimal(value: DecimalInput): DecimalValue {
  return toDecimal(value).neg()
}

export function minDecimal(...values: DecimalInput[]): DecimalValue {
  return values.map(toDecimal).reduce((lowest, value) => (value.lt(lowest) ? value : lowest))
}

export function maxDecimal(...values: DecimalInput[]): DecimalValue {
  return values.map(toDecimal).reduce((highest, value) => (value.gt(highest) ? value : highest))
}

export function countDecimalPlaces(value: DecimalInput): number {
  const fraction = decimalToString(value).split('.')[1]
  return fraction ? fraction.length : 0
}

/** Plain decimal string with at least `minDecimalPlaces` decimals (`12.5` -> `12.50`), never cut. */
export function padDecimalPlaces(value: DecimalInput, minDecimalPlaces: number): string {
  const decimal = toDecimal(value)
  return decimal.toFixed(Math.max(minDecimalPlaces, countDecimalPlaces(decimal)))
}

export function decimalToNumber(value: DecimalInput): number {
  return Number(decimalToString(value))
}

/**
 * Whether `exact` is the decimal the validated `legacy` number stands for. A value
 * that underflows to zero (`-1e-400`) must itself be zero, so it cannot slip past
 * a sign or range check made on the number.
 */
function matchesLegacyNumber(exact: DecimalValue, legacy: number): boolean {
  if (decimalToNumber(exact) !== legacy) return false
  return legacy !== 0 || exact.eq(0)
}

/**
 * Picks the exact decimal string for a dual `number` + `<field>Exact` pair.
 * The exact value wins unless the legacy `number` was changed on its own
 * (e.g. by a hook unaware of the exact field) - then the number is used.
 */
export function resolveExactDecimal(exact: unknown, legacy: unknown): string | null {
  const exactDecimal = parseDecimal(exact)
  const legacyDecimal = parseDecimal(legacy)
  if (exactDecimal && (typeof legacy !== 'number' || matchesLegacyNumber(exactDecimal, legacy))) {
    return decimalToString(exactDecimal)
  }
  return legacyDecimal ? decimalToString(legacyDecimal) : null
}

export type WithExactAmounts<T, K extends string> = T & { [P in K as `${P}Exact`]?: string | null }

function exactCandidate(source: Record<string, unknown>, field: string, value: unknown): unknown {
  if (typeof value !== 'number') return value
  const rawValue = source[field]
  return typeof rawValue === 'number' ? source[`${field}Exact`] ?? rawValue : rawValue
}

/**
 * Adds `<field>Exact` strings next to number fields a zod schema coerced, taken
 * from the raw input so digits beyond float precision survive the parse. When the
 * raw field is already a number (an API route parsed the body before the command),
 * the `<field>Exact` string that route attached is used instead, and only while it
 * matches that number. A parsed `null` (or a parsed non-number) is never paired
 * with a raw value, so it cannot smuggle unvalidated input past the schema.
 */
export function withExactAmounts<T extends object, K extends string>(
  parsed: T,
  raw: unknown,
  fields: readonly K[],
): WithExactAmounts<T, K> {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const values = parsed as Record<string, unknown>
  const exact: Record<string, string | null> = {}
  for (const field of fields) {
    const value = values[field]
    if (value === undefined) continue
    exact[`${field}Exact`] = resolveExactDecimal(exactCandidate(source, field, value), value)
  }
  return { ...parsed, ...exact } as WithExactAmounts<T, K>
}

/**
 * Applies `withExactAmounts` to each item of the `key` list, pairing parsed and raw
 * items by index. Lets an API route keep exact digits for nested lines.
 */
export function withExactListAmounts<T extends object, K extends string>(
  parsedItems: readonly T[] | null | undefined,
  raw: unknown,
  key: string,
  fields: readonly K[],
): WithExactAmounts<T, K>[] | undefined {
  if (!parsedItems) return undefined
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[key] : undefined
  const rawItems = Array.isArray(source) ? source : []
  return parsedItems.map((item, index) => withExactAmounts(item, rawItems[index], fields))
}

/**
 * Tolerance for comparing money amounts rounded to `decimalPlaces`: half a
 * minor unit of a 2-decimal currency at the default 4 places (0.005), scaled
 * down with higher precision and never wider than that default.
 */
export function amountComparisonTolerance(decimalPlaces: number = DEFAULT_AMOUNT_DECIMAL_PLACES): DecimalValue {
  return toDecimal(`5e-${Math.max(decimalPlaces, DEFAULT_AMOUNT_DECIMAL_PLACES) - 1}`)
}

export function resolveAmountDecimalPlaces(currencyDecimalPlaces?: number | null): number {
  if (typeof currencyDecimalPlaces !== 'number' || !Number.isInteger(currencyDecimalPlaces) || currencyDecimalPlaces < 0) {
    return DEFAULT_AMOUNT_DECIMAL_PLACES
  }
  return Math.max(DEFAULT_AMOUNT_DECIMAL_PLACES, currencyDecimalPlaces)
}

let isoCurrencyCodes: Set<string> | null | undefined

function resolveIsoCurrencyCodes(): Set<string> | null {
  if (isoCurrencyCodes !== undefined) return isoCurrencyCodes
  try {
    isoCurrencyCodes = typeof Intl.supportedValuesOf === 'function' ? new Set(Intl.supportedValuesOf('currency')) : null
  } catch {
    isoCurrencyCodes = null
  }
  return isoCurrencyCodes
}

/**
 * Decimal places `Intl.NumberFormat` displays for `currencyCode`, or `null` when
 * the runtime does not know the code. These are CLDR display digits, not ISO 4217
 * minor units (HUF, COP and IDR display 0 digits but have 2 minor units), and may
 * change with the ICU version, so use them to format amounts, never to validate
 * or round stored ones. `Intl.NumberFormat` accepts any well-formed code (ETH,
 * XYZ) and reports 2 digits for it, so only codes listed by
 * `Intl.supportedValuesOf` count.
 */
export function resolveCurrencyDisplayDecimalPlaces(currencyCode?: string | null): number | null {
  if (!currencyCode) return null
  const code = currencyCode.toUpperCase()
  const knownCodes = resolveIsoCurrencyCodes()
  if (knownCodes && !knownCodes.has(code)) return null
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions()
      .maximumFractionDigits ?? null
  } catch {
    return null
  }
}

/**
 * ISO 4217 minor units (decimal places) of `currencyCode`, or `null` when the code
 * is unknown. Active ISO 4217 codes are read from a static table, so the result
 * does not depend on the ICU version; other codes the runtime supports fall back
 * to their `Intl.NumberFormat` digits.
 */
export function resolveIsoCurrencyDecimalPlaces(currencyCode?: string | null): number | null {
  if (!currencyCode) return null
  const code = currencyCode.toUpperCase()
  if (Object.hasOwn(ISO_4217_MINOR_UNITS, code)) return ISO_4217_MINOR_UNITS[code]
  return resolveCurrencyDisplayDecimalPlaces(code)
}

/**
 * Whether a raw money input may reach a number-coercing schema: blank strings and
 * non-numeric values are left to that schema, numbers and strings must be decimals
 * within the size caps, so an oversized value is rejected instead of turning into 0.
 */
export function isWithinDecimalCaps(value: unknown): boolean {
  if (typeof value === 'string' && value.trim().length === 0) return true
  if (typeof value !== 'string' && typeof value !== 'number') return true
  return isDecimalInput(value)
}

export function withDecimalCaps<T extends z.ZodType>(schema: T, message?: string) {
  return z.unknown().refine(isWithinDecimalCaps, message === undefined ? undefined : { message }).pipe(schema)
}

const decimalInputSchema = z.union([z.string(), z.number()]).refine(isDecimalInput, {
  message: 'invalidDecimal',
})

export const decimalStringSchema = decimalInputSchema.transform((value) => decimalToString(value))

export const nonNegativeDecimalStringSchema = decimalStringSchema.refine(
  (value) => !isNegativeDecimal(value),
  { message: 'decimalMustBeNonNegative' },
)

export const positiveDecimalStringSchema = decimalStringSchema.refine(
  (value) => toDecimal(value).gt(0),
  { message: 'decimalMustBePositive' },
)
