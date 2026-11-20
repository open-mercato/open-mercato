import { buildExchangeRatePayload, validateExchangeRateForm } from '../../modules/currencies/lib/exchangeRateFormConfig'
import { resolveCatalogPriceAmount } from '../../modules/sales/components/documents/lineItemUtils'
import type { AdjustmentRowData, AdjustmentSubmitPayload } from '../../modules/sales/components/documents/AdjustmentDialog'
import type { ConvertedSums } from '../../modules/customers/lib/dealsMetrics'
import type { CatalogPriceAmountValidationResult } from '../../modules/catalog/lib/priceValidation'

export function legacyValidatedRate(values: Record<string, unknown>, translate: (key: string) => string): number {
  const rate: number = validateExchangeRateForm(values, translate).rate
  return rate
}

export function legacyExchangeRatePayload(values: Record<string, unknown>) {
  return buildExchangeRatePayload(values, {
    fromCode: 'EUR',
    toCode: 'USD',
    rate: 1.25,
    date: new Date('2026-10-29T00:00:00.000Z'),
    source: 'Manual',
  })
}

export const legacyCatalogAmount: number | null = resolveCatalogPriceAmount(10, null, 'net')

export async function legacyAdjustmentTotal(payload: AdjustmentSubmitPayload): Promise<number> {
  return (payload.amountNet ?? 0) + (payload.amountGross ?? 0)
}

export const legacyAdjustmentRow: AdjustmentRowData = {
  id: 'adjustment-1',
  label: 'Discount',
  code: null,
  kind: 'discount',
  calculatorKey: null,
  rate: null,
  amountNet: 5,
  amountGross: 6.15,
  currencyCode: 'USD',
  position: 0,
}

export const legacyConvertedSums: ConvertedSums = { total: 0, convertedAll: true, missingRateCurrencies: [] }

export const legacyPriceValidation: CatalogPriceAmountValidationResult = { ok: true, numeric: 1 }
