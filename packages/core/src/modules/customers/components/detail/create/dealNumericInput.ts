/**
 * Input sanitizers for the deal create form's numeric fields. They guarantee the
 * underlying state only ever holds a valid numeric string (or empty), so non-numeric
 * input can never reach the zod schema and surface a raw "expected number" type error.
 */

const DOT_GROUPED_AMOUNT = /^\d{1,3}(\.\d{3})+,/

function usesDecimalComma(locale: string | undefined): boolean {
  if (!locale) return false
  const decimal = new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === 'decimal')
  return decimal?.value === ','
}

/**
 * Keep only digits and a single decimal point; strips letters, signs, and extra dots.
 * A comma is the decimal separator where the locale writes it that way (`12,50` is 12.50
 * in Polish) and a grouping separator everywhere else (`1,250` is 1250 in English).
 */
export function sanitizeAmount(raw: string, locale?: string): string {
  const stripped = raw.replace(/[^\d.,]/g, '')
  const normalized = usesDecimalComma(locale)
    ? (DOT_GROUPED_AMOUNT.test(stripped) ? stripped.replace(/\./g, '') : stripped).replace(/,/g, '.')
    : stripped.replace(/,/g, '')
  const firstDot = normalized.indexOf('.')
  if (firstDot === -1) return normalized
  return normalized.slice(0, firstDot + 1) + normalized.slice(firstDot + 1).replace(/\./g, '')
}

/** Digits only, clamped to 0–100, so probability is always a valid percentage. */
export function sanitizeProbability(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  return String(Math.min(100, Number(digits)))
}
