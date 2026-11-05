export const CATALOG_PRICE_MAX_INTEGER_DIGITS = 12
export const CATALOG_PRICE_MAX_FRACTION_DIGITS = 4

export type CatalogPriceAmountValidationReason =
  | 'invalid_format'
  | 'not_finite'
  | 'negative'
  | 'too_many_integer_digits'
  | 'too_many_fraction_digits'

export type CatalogPriceAmountValidationResult =
  | { ok: true; numeric: number }
  | { ok: false; reason: CatalogPriceAmountValidationReason }

function normalizeCatalogPriceRawValue(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return String(value)
  }
  if (typeof value !== 'string') return null
  const normalized = value.trim().replace(/\s+/g, '')
  return normalized.length ? normalized : null
}

export function validateCatalogPriceAmountInput(
  value: unknown,
): CatalogPriceAmountValidationResult {
  const raw = normalizeCatalogPriceRawValue(value)
  if (!raw) return { ok: false, reason: 'invalid_format' }
  if (raw.startsWith('-')) return { ok: false, reason: 'negative' }
  if (!/^\d+(?:\.\d+)?$/.test(raw)) {
    return { ok: false, reason: 'invalid_format' }
  }

  const numeric = Number(raw)
  if (!Number.isFinite(numeric)) return { ok: false, reason: 'not_finite' }
  if (numeric < 0) return { ok: false, reason: 'negative' }

  const [integerPartRaw, fractionPart = ''] = raw.split('.')
  const integerPart = integerPartRaw.replace(/^0+(?=\d)/, '')
  if (integerPart.length > CATALOG_PRICE_MAX_INTEGER_DIGITS) {
    return { ok: false, reason: 'too_many_integer_digits' }
  }
  if (fractionPart.length > CATALOG_PRICE_MAX_FRACTION_DIGITS) {
    return { ok: false, reason: 'too_many_fraction_digits' }
  }

  return { ok: true, numeric }
}

export function isCatalogPriceAmountInputValid(value: unknown): boolean {
  return validateCatalogPriceAmountInput(value).ok
}

export function getCatalogPriceAmountValidationMessage(): string {
  return `Price must be a valid non-negative amount with at most ${CATALOG_PRICE_MAX_INTEGER_DIGITS} digits before the decimal point and ${CATALOG_PRICE_MAX_FRACTION_DIGITS} decimal places.`
}
