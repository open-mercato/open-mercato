/**
 * Value comparison used by the record-lock conflict diff.
 *
 * The conflict dialog lists a field only when the value the user is submitting
 * differs from the value the incoming write stored. Both sides of that
 * comparison come from different layers: the mutation payload carries what the
 * form serialized (`980`, a JSON number), while action-log snapshots carry what
 * the database returned for a `numeric(p, s)` column (`'980.0000'`, a string).
 * A strict comparison reads that formatting difference as a change and shows
 * the user "the record was changed" with a single row whose two values are the
 * same number written two ways (#5985).
 *
 * `valuesEqual` therefore compares decimal-looking scalars by value. The
 * canonicalization is textual, not `Number(...)`-based, so integers wider than
 * IEEE-754 double precision never collapse into each other.
 */

export function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function toIsoDate(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return value.toISOString()
  }
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

const DECIMAL_TOKEN_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/

/**
 * Canonical form of a decimal scalar (`'980.0000'`, `980`, `'+0980.'` →
 * `'980'`), or `null` when the value is not a plain decimal literal.
 *
 * Deliberately narrow: booleans, `null`, empty strings, exponent notation and
 * hex literals all return `null` so they keep falling through to strict
 * equality instead of being coerced into numbers.
 */
export function canonicalizeDecimalToken(value: unknown): string | null {
  let raw: string
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    raw = String(value)
  } else if (typeof value === 'string') {
    raw = value.trim()
  } else {
    return null
  }
  if (!DECIMAL_TOKEN_PATTERN.test(raw)) return null

  const isNegative = raw.startsWith('-')
  const unsigned = raw.replace(/^[+-]/, '')
  const [integerPart = '', fractionPart = ''] = unsigned.split('.')
  const integerDigits = integerPart.replace(/^0+(?=\d)/, '') || '0'
  const fractionDigits = fractionPart.replace(/0+$/, '')
  const magnitude = fractionDigits ? `${integerDigits}.${fractionDigits}` : integerDigits
  if (magnitude === '0') return '0'
  return isNegative ? `-${magnitude}` : magnitude
}

function decimalValuesEqual(a: unknown, b: unknown): boolean {
  const left = canonicalizeDecimalToken(a)
  if (left === null) return false
  const right = canonicalizeDecimalToken(b)
  if (right === null) return false
  return left === right
}

export function valuesEqual(a: unknown, b: unknown, seen?: Set<unknown>): boolean {
  if (Object.is(a, b)) return true

  if (a instanceof Date || b instanceof Date) {
    const left = toIsoDate(a)
    const right = toIsoDate(b)
    return left !== null && right !== null && left === right
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let index = 0; index < a.length; index += 1) {
      if (!valuesEqual(a[index], b[index], seen)) return false
    }
    return true
  }

  if (isRecordValue(a) && isRecordValue(b)) {
    if (!seen) seen = new Set()
    if (seen.has(a) || seen.has(b)) return false
    seen.add(a)
    seen.add(b)
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    if (aKeys.length !== bKeys.length) return false
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false
      if (!valuesEqual(a[key], b[key], seen)) return false
    }
    return true
  }

  return decimalValuesEqual(a, b)
}
