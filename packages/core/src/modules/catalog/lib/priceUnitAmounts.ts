import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type {
  CalculateTaxInput,
  TaxCalculationResult,
  TaxCalculationService,
} from '@open-mercato/core/modules/sales/services/taxCalculationService'
import {
  DEFAULT_AMOUNT_DECIMAL_PLACES,
  FX_DECIMAL_PLACES,
  countDecimalPlaces,
  decimalToNumber,
  decimalToString,
  divideDecimals,
  isDecimalInput,
  resolveExactDecimal,
  roundDecimal,
  toDecimal,
  type DecimalValue,
} from '@open-mercato/shared/lib/decimal'
import { tryResolve } from './tryResolve'

type ServiceResolver = { resolve: <R = unknown>(name: string) => R }

function roundRate(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function normalizeRate(value: number | string): number {
  const numeric = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(numeric) || numeric < 0) return 0
  return numeric
}

function toAmountPair(value: DecimalValue): { value: number; exact: string } {
  return { value: decimalToNumber(value), exact: decimalToString(value) }
}

/** Mirrors `DefaultTaxCalculationService` exactly, for when the sales module is disabled. */
export function calculateUnitAmountsLocally(
  input: Pick<CalculateTaxInput, 'amount' | 'amountExact' | 'amountDecimalPlaces' | 'mode' | 'taxRate'>,
): TaxCalculationResult {
  const exactInput = resolveExactDecimal(input.amountExact, Number.isFinite(input.amount) ? input.amount : null)
  const amount = toDecimal(exactInput ?? 0)
  const rate = input.taxRate === undefined || input.taxRate === null ? null : normalizeRate(input.taxRate)
  const fraction = rate === null ? toDecimal(0) : divideDecimals(rate, 100, FX_DECIMAL_PLACES)
  const multiplier = fraction.plus(1)
  const enteredPlaces =
    typeof input.amountExact === 'string' && isDecimalInput(input.amountExact) && toDecimal(input.amountExact).eq(amount)
      ? countDecimalPlaces(amount)
      : 0
  const decimalPlaces = Math.max(input.amountDecimalPlaces ?? DEFAULT_AMOUNT_DECIMAL_PLACES, enteredPlaces)
  const netAmount =
    input.mode === 'net'
      ? amount
      : fraction.gt(0)
        ? roundDecimal(divideDecimals(amount, multiplier, FX_DECIMAL_PLACES), decimalPlaces)
        : amount
  const grossAmount = input.mode === 'net' ? roundDecimal(amount.times(multiplier), decimalPlaces) : amount
  const net = toAmountPair(netAmount)
  const gross = toAmountPair(grossAmount)
  const tax = toAmountPair(grossAmount.minus(netAmount))
  return {
    netAmount: net.value,
    netAmountExact: net.exact,
    grossAmount: gross.value,
    grossAmountExact: gross.exact,
    taxAmount: tax.value,
    taxAmountExact: tax.exact,
    taxRate: rate === null ? null : roundRate(rate),
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
