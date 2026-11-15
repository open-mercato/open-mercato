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
    const compact = raw.replace(/[\s'’ʼ]/g, '').replace(/^\+/, '')
    const separators = compact.match(/[.,]/g) ?? []
    const hasDecimal = separators.length === 1 || (compact.includes(',') && compact.includes('.'))
    const decimalIndex = hasDecimal ? Math.max(compact.lastIndexOf(','), compact.lastIndexOf('.')) : -1
    const integerPart = (hasDecimal ? compact.slice(0, decimalIndex) : compact).replace(/[.,]/g, '') || '0'
    const fractionPart = hasDecimal ? compact.slice(decimalIndex + 1) : ''
    const normalized = `${integerPart}${fractionPart ? `.${fractionPart}` : ''}`
    if (!validateCatalogPriceAmountInput(normalized).ok || parseLocaleNumber(raw, locale) === null) {
      fieldErrors[field] = t('catalog.prices.form.errors.invalidAmount')
    } else {
      const canonicalInteger = integerPart.replace(/^0+(?=\d)/, '')
      const canonicalFraction = fractionPart.replace(/0+$/, '')
      amounts[field] = `${canonicalInteger}${canonicalFraction ? `.${canonicalFraction}` : ''}`
    }
  }
  if (Object.keys(fieldErrors).length) {
    throw createCrudFormError(t('catalog.prices.form.errors.invalidAmount'), fieldErrors)
  }
  return amounts
}
