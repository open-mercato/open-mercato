import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type {
  CalculateTaxInput,
  TaxCalculationResult,
  TaxCalculationService,
} from '@open-mercato/core/modules/sales/services/taxCalculationService'
import { tryResolve } from './tryResolve'

type ServiceResolver = { resolve: <R = unknown>(name: string) => R }

function roundToFourDecimals(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function normalizeRate(value: number | string): number {
  const numeric = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(numeric) || numeric < 0) return 0
  return numeric
}

export function calculateUnitAmountsLocally(
  input: Pick<CalculateTaxInput, 'amount' | 'mode' | 'taxRate'>,
): TaxCalculationResult {
  const rate = input.taxRate === undefined || input.taxRate === null ? null : normalizeRate(input.taxRate)
  const fraction = (rate ?? 0) / 100
  const netAmount = input.mode === 'net' ? input.amount : fraction > 0 ? input.amount / (1 + fraction) : input.amount
  const grossAmount = input.mode === 'net' ? input.amount * (1 + fraction) : input.amount
  return {
    netAmount: roundToFourDecimals(netAmount),
    grossAmount: roundToFourDecimals(grossAmount),
    taxAmount: roundToFourDecimals(grossAmount - netAmount),
    taxRate: rate === null ? null : roundToFourDecimals(rate),
  }
}

export async function calculatePriceUnitAmounts(
  container: ServiceResolver,
  input: CalculateTaxInput,
): Promise<TaxCalculationResult> {
  const taxCalculationService = tryResolve<TaxCalculationService>(container, 'taxCalculationService')
  if (taxCalculationService) return taxCalculationService.calculateUnitAmounts(input)
  if (input.taxRateId) {
    const { translate } = await resolveTranslations()
    throw new CrudHttpError(400, {
      error: translate('catalog.prices.errors.taxClassUnavailable', 'Tax classes are not available.'),
    })
  }
  return calculateUnitAmountsLocally(input)
}
