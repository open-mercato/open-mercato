import { parseLocaleNumber } from '@open-mercato/shared/lib/number'

/**
 * Parses the warranty auto-approve limit a user typed. Both `,` and `.` are
 * accepted as the decimal separator so Polish `150,5` is 150.5, not 1505
 * (issue #9430). Returns null for blank input; callers treat that as "no limit".
 * Negative or unparseable values also return null so the form can show an error
 * instead of silently saving a different amount.
 */
export function parseAutoApproveMaxAmount(input: string, locale?: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const parsed = parseLocaleNumber(trimmed, locale)
  if (parsed === null || !Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}
