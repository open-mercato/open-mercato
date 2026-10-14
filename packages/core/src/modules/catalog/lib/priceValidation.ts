import { decimalToNumber, decimalToString, isDecimalInput } from '@open-mercato/shared/lib/decimal'

/** @deprecated Prices are no longer limited in integer digits. */
export const CATALOG_PRICE_MAX_INTEGER_DIGITS = 12
/** @deprecated Prices are no longer limited in decimal places. */
export const CATALOG_PRICE_MAX_FRACTION_DIGITS = 4

export type CatalogPriceAmountValidationReason =
  | 'invalid_format'
  | 'not_finite'
  | 'negative'
  | 'too_many_integer_digits'
  | 'too_many_fraction_digits'

export type CatalogPriceAmountValidationResult =
  | { ok: true; numeric: number; exact: string }
  | { ok: false; reason: CatalogPriceAmountValidationReason }

function normalizeCatalogPriceRawValue(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!isDecimalInput(value)) return null
    return decimalToString(value)
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
  if (!/^\d+(?:\.\d+)?$/.test(raw) || !isDecimalInput(raw)) {
    return { ok: false, reason: 'invalid_format' }
  }

  const exact = decimalToString(raw)
  return { ok: true, numeric: decimalToNumber(exact), exact }
}

export function isCatalogPriceAmountInputValid(value: unknown): boolean {
  return validateCatalogPriceAmountInput(value).ok
}

export const CATALOG_PRICE_AMOUNT_VALIDATION_MESSAGE_KEY = 'catalog.prices.validation.amountInvalid'

/** i18n key of the price amount validation message; translate it with `t()` before display. */
export function getCatalogPriceAmountValidationMessage(): string {
  return CATALOG_PRICE_AMOUNT_VALIDATION_MESSAGE_KEY
}
