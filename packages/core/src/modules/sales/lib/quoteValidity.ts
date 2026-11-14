export const DEFAULT_QUOTE_VALID_FOR_DAYS = 14
export const MAX_QUOTE_VALID_FOR_DAYS = 365
const MS_PER_DAY = 24 * 60 * 60 * 1000

export function normalizeQuoteValidityDays(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_QUOTE_VALID_FOR_DAYS
    ? value
    : DEFAULT_QUOTE_VALID_FOR_DAYS
}

export function resolveDefaultValidForDays(
  validUntil: string | null | undefined,
  defaultDays = DEFAULT_QUOTE_VALID_FOR_DAYS,
): number {
  const fallback = normalizeQuoteValidityDays(defaultDays)
  if (!validUntil) return fallback
  const target = new Date(validUntil)
  if (Number.isNaN(target.getTime())) return fallback
  const daysRemaining = Math.ceil((target.getTime() - Date.now()) / MS_PER_DAY)
  if (daysRemaining < 1) return fallback
  return Math.min(daysRemaining, MAX_QUOTE_VALID_FOR_DAYS)
}
