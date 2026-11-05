// Exact arithmetic for the `numeric(19,4)` amounts the ledger API returns as
// strings. A JS `number` holds 15–16 significant digits, a `numeric(19,4)`
// holds 19, so summing or formatting through `Number` silently drops the
// last digits of large amounts. Everything here works on `bigint` units of
// 1/10 000 instead.

export const AMOUNT_SCALE_DIGITS = 4
const SCALE = BigInt(10000)

const AMOUNT_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/

/**
 * Parses a decimal string into units of 1/10 000. Anything that is not a
 * plain decimal (empty, `NaN`, exponent form) counts as zero, so one bad
 * value cannot take the whole page down.
 */
export function parseAmountUnits(value: string | null | undefined): bigint {
  const match = typeof value === 'string' ? AMOUNT_PATTERN.exec(value.trim()) : null
  if (!match) return BigInt(0)
  const [, sign, whole, fraction = ''] = match
  const fractionUnits = fraction.padEnd(AMOUNT_SCALE_DIGITS, '0').slice(0, AMOUNT_SCALE_DIGITS)
  const units = BigInt(whole) * SCALE + BigInt(fractionUnits)
  return sign ? -units : units
}

function decimalSeparator(locale?: string): string {
  const part = new Intl.NumberFormat(locale).formatToParts(1.1).find((entry) => entry.type === 'decimal')
  return part?.value ?? '.'
}

/**
 * Formats units of 1/10 000 for display in `locale`: at least two and at most
 * four decimals, digits grouped the way the locale groups them.
 */
export function formatAmountUnits(units: bigint, locale?: string): string {
  const negative = units < BigInt(0)
  const absolute = negative ? -units : units
  const whole = absolute / SCALE
  const fraction = (absolute % SCALE).toString().padStart(AMOUNT_SCALE_DIGITS, '0').replace(/0+$/, '').padEnd(2, '0')
  const wholeText = whole.toLocaleString(locale)
  return `${negative ? '-' : ''}${wholeText}${decimalSeparator(locale)}${fraction}`
}

/** An amount string for display; zero renders as an empty string (a blank cell). */
export function formatAmountOrBlank(value: string | null | undefined, locale?: string): string {
  const units = parseAmountUnits(value)
  return units === BigInt(0) ? '' : formatAmountUnits(units, locale)
}

export function sumAmountUnits(values: Array<string | null | undefined>): bigint {
  return values.reduce<bigint>((sum, value) => sum + parseAmountUnits(value), BigInt(0))
}
