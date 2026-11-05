/**
 * Input sanitizers for the deal create form's numeric fields. They guarantee the
 * underlying state only ever holds a valid numeric string (or empty), so non-numeric
 * input can never reach the zod schema and surface a raw "expected number" type error.
 */

/** Keep only digits and a single decimal point; strips letters, signs, and extra dots. */
export function sanitizeAmount(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot === -1) return cleaned
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
}

/** Digits only, clamped to 0–100, so probability is always a valid percentage. */
export function sanitizeProbability(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  return String(Math.min(100, Number(digits)))
}
