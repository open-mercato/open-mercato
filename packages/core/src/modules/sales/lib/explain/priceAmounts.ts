export const PRICE_COMPARISON_SCALE = 4
export const PRICE_DISPLAY_MIN_FRACTION_DIGITS = 2

const DECIMAL_TEXT_PATTERN = /^([+-]?)(\d*)(?:\.(\d*))?$/
const NUMBER_TEXT_FRACTION_DIGITS = PRICE_COMPARISON_SCALE + 8
const ZERO = BigInt(0)
const HALF_UNIT = BigInt(5)
const TEN = BigInt(10)

function toDecimalText(value: unknown): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(NUMBER_TEXT_FRACTION_DIGITS) : null
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string') return value.trim()
  return null
}

/**
 * Converts a decimal amount (numeric string as stored in `numeric(…, 4)` columns, or a
 * number from a snapshot) into integer units of 10^-4, rounded half away from zero, so
 * amounts that differ only in trailing zeros or float noise compare equal. Returns null
 * for anything that is not a plain decimal.
 */
export function toScaledAmount(value: unknown): bigint | null {
  const text = toDecimalText(value)
  if (!text) return null
  const match = DECIMAL_TEXT_PATTERN.exec(text)
  if (!match) return null
  const [, sign, integerDigits = '', fractionDigits = ''] = match
  if (!integerDigits && !fractionDigits) return null
  const guardDigits = `${fractionDigits}${'0'.repeat(PRICE_COMPARISON_SCALE + 1)}`.slice(0, PRICE_COMPARISON_SCALE + 1)
  const rounded = (BigInt(`${integerDigits || '0'}${guardDigits}`) + HALF_UNIT) / TEN
  if (rounded === ZERO) return ZERO
  return sign === '-' ? -rounded : rounded
}

export function compareScaledAmounts(left: bigint, right: bigint): -1 | 0 | 1 {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/** Formats scaled units as a plain decimal with 2 to 4 fraction digits (`19.99`, `17.50`, `0.1250`). */
export function formatScaledAmount(units: bigint): string {
  const negative = units < ZERO
  const digits = (negative ? -units : units).toString().padStart(PRICE_COMPARISON_SCALE + 1, '0')
  const integerPart = digits.slice(0, digits.length - PRICE_COMPARISON_SCALE)
  let fractionPart = digits.slice(digits.length - PRICE_COMPARISON_SCALE)
  while (fractionPart.length > PRICE_DISPLAY_MIN_FRACTION_DIGITS && fractionPart.endsWith('0')) {
    fractionPart = fractionPart.slice(0, -1)
  }
  return `${negative ? '-' : ''}${integerPart}.${fractionPart}`
}
