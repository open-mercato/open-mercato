import { normalizeLocaleNumberInput } from '@open-mercato/shared/lib/number'

const PLAIN_DECIMAL = /^\+?(\d*)(?:\.(\d*))?$/

/**
 * Parses a user-typed company annual-revenue amount, accepting both `,` and `.`
 * as the decimal separator (issue #9430). Returns the exact canonical decimal
 * string (`'1234.56'`) for the `numeric(16,2)` column, or null for blank,
 * negative, unparseable, exponent, or more-than-two-decimal input — never a
 * silently changed value.
 *
 * Precision is checked on the normalized decimal digits, not on a float, so
 * large valid amounts such as `10000000000.03` are not rejected by
 * floating-point residue after scaling.
 */
export function parseCompanyAnnualRevenue(raw: string, locale?: string): string | null {
  const normalized = normalizeLocaleNumberInput(raw, locale)
  if (normalized === null) return null
  const match = PLAIN_DECIMAL.exec(normalized)
  if (!match) return null
  const integerDigits = match[1]
  const fractionDigits = (match[2] ?? '').replace(/0+$/, '')
  if (fractionDigits.length > 2) return null
  const integerPart = integerDigits.replace(/^0+(?=\d)/, '') || '0'
  return fractionDigits ? `${integerPart}.${fractionDigits}` : integerPart
}
