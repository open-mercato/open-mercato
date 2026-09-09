/**
 * Minimal exact decimal arithmetic for application-side aggregation of PostgreSQL `numeric`
 * columns. The SQL path sums money in `numeric` and converts once, so the application path must
 * not accumulate in binary floating point — `0.1 + 0.2` would drift the totals of encrypted group
 * sources away from the plaintext ones (#4622).
 *
 * A value is stored as scaled integer `units` plus a decimal `scale`, so `12.34` is
 * `{ units: 1234n, scale: 2 }`. Conversion to `number` happens only at the response boundary.
 */

export type ExactDecimal = {
  units: bigint
  scale: number
}

const DECIMAL_PATTERN = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/

export const EXACT_DECIMAL_ZERO: ExactDecimal = { units: 0n, scale: 0 }

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent)
}

/**
 * Parses a `numeric` column value. The PostgreSQL driver hands these over as strings to preserve
 * precision, so the string form is authoritative; numbers and bigints are accepted for callers that
 * already hold a JavaScript value. Returns `null` for anything that is not a finite decimal.
 */
export function parseExactDecimal(raw: unknown): ExactDecimal | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'bigint') return { units: raw, scale: 0 }

  let text: string
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null
    text = String(raw)
  } else if (typeof raw === 'string') {
    text = raw.trim()
  } else {
    return null
  }

  if (!text) return null

  const match = DECIMAL_PATTERN.exec(text)
  if (!match) return null

  const [, sign, intPart = '', fracPart = '', exponentPart] = match
  if (!intPart && !fracPart) return null

  const digits = `${intPart}${fracPart}`
  let units = BigInt(digits)
  let scale = fracPart.length

  if (exponentPart) {
    scale -= Number(exponentPart)
    if (scale < 0) {
      units *= pow10(-scale)
      scale = 0
    }
  }

  if (sign === '-') units = -units
  return { units, scale }
}

function rescale(value: ExactDecimal, scale: number): bigint {
  return scale === value.scale ? value.units : value.units * pow10(scale - value.scale)
}

export function addExactDecimal(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  const scale = Math.max(left.scale, right.scale)
  return { units: rescale(left, scale) + rescale(right, scale), scale }
}

export function compareExactDecimal(left: ExactDecimal, right: ExactDecimal): number {
  const scale = Math.max(left.scale, right.scale)
  const leftUnits = rescale(left, scale)
  const rightUnits = rescale(right, scale)
  if (leftUnits === rightUnits) return 0
  return leftUnits < rightUnits ? -1 : 1
}

export function exactDecimalToString(value: ExactDecimal): string {
  const negative = value.units < 0n
  const digits = (negative ? -value.units : value.units).toString().padStart(value.scale + 1, '0')
  const boundary = digits.length - value.scale
  const integerPart = digits.slice(0, boundary)
  const fractionPart = value.scale > 0 ? digits.slice(boundary) : ''
  return `${negative ? '-' : ''}${integerPart}${fractionPart ? `.${fractionPart}` : ''}`
}

/** Response-boundary conversion: the only place where the exact value becomes a binary float. */
export function exactDecimalToNumber(value: ExactDecimal): number {
  return Number(exactDecimalToString(value))
}
