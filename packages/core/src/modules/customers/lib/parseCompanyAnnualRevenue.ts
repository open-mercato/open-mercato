import { parseLocaleNumber } from '@open-mercato/shared/lib/number'

/**
 * Parses a user-typed company annual-revenue amount, accepting both `,` and `.`
 * as the decimal separator (issue #9430). Returns null for blank, negative,
 * unparseable, or more-than-two-decimal input — never a silently changed value.
 */
export function parseCompanyAnnualRevenue(raw: string, locale?: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const parsed = parseLocaleNumber(trimmed, locale)
  if (parsed === null || !Number.isFinite(parsed) || parsed < 0) return null
  const cents = parsed * 100
  const rounded = Math.round(cents)
  if (Math.abs(cents - rounded) > 1e-6) return null
  return rounded / 100
}
