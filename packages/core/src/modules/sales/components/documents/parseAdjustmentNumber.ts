import { parseLocaleNumber } from '@open-mercato/shared/lib/number'

/**
 * Parses a user-typed adjustment amount or rate. Both `,` and `.` are accepted
 * as the decimal separator so Polish `15,99` is 15.99, not 15 or NaN (issue #9430).
 * API/entity numbers pass through unchanged and must not be locale-parsed first.
 */
export function parseAdjustmentNumber(value: unknown, locale?: string): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  if (!value.trim()) return null
  return parseLocaleNumber(value, locale)
}
