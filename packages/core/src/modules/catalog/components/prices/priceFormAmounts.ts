import { parseLocaleNumber } from '@open-mercato/shared/lib/number'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { validateCatalogPriceAmountInput } from '../../lib/priceValidation'
import type { PriceFormValues } from './priceFormFields'

export function normalizePriceFormAmounts(
  values: Pick<PriceFormValues, 'unitPriceNet' | 'unitPriceGross'>,
  locale: string,
  t: (key: string, fallback?: string) => string,
): { unitPriceNet?: string; unitPriceGross?: string } {
  const amounts: { unitPriceNet?: string; unitPriceGross?: string } = {}
  const fieldErrors: Record<string, string> = {}
  for (const field of ['unitPriceNet', 'unitPriceGross'] as const) {
    const raw = values[field]?.trim()
    if (!raw) continue
    const parsed = parseLocaleNumber(raw, locale)
    if (parsed === null || !validateCatalogPriceAmountInput(String(parsed)).ok) {
      fieldErrors[field] = t('catalog.prices.form.errors.invalidAmount')
    } else {
      amounts[field] = String(parsed)
    }
  }
  if (Object.keys(fieldErrors).length) {
    throw createCrudFormError(t('catalog.prices.form.errors.invalidAmount'), fieldErrors)
  }
  return amounts
}
