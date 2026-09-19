import { round } from '../calculations'
import { registerTaxProvider } from './registry'
import type {
  TaxCalculationRequest,
  TaxJurisdictionAmount,
  TaxProvider,
  TaxProviderCalculateResult,
  TaxProviderChargeResult,
  TaxProviderLineResult,
} from './types'

export const TABLE_RATES_PROVIDER_KEY = 'table-rates'

export function jurisdiction(overrides: Partial<TaxJurisdictionAmount>): TaxJurisdictionAmount {
  return {
    jurisdictionCode: null,
    jurisdictionName: null,
    jurisdictionType: 'other',
    taxName: null,
    rate: null,
    taxableAmount: 0,
    taxAmount: 0,
    exemptAmount: 0,
    ...overrides,
  }
}

/**
 * Sums the per line and per charge jurisdiction rows into the document level
 * breakdown, keyed by jurisdiction code and rate so two lines taxed by the same
 * jurisdiction land in one row.
 */
export function summarizeBreakdown(
  entries: Array<TaxProviderLineResult | TaxProviderChargeResult>
): TaxJurisdictionAmount[] {
  const byKey = new Map<string, TaxJurisdictionAmount>()
  for (const entry of entries) {
    for (const detail of entry.details) {
      const key = `${detail.jurisdictionCode ?? ''}|${detail.jurisdictionType}|${detail.taxName ?? ''}|${detail.rate ?? ''}`
      const existing = byKey.get(key)
      if (existing) {
        existing.taxableAmount = round(existing.taxableAmount + detail.taxableAmount)
        existing.taxAmount = round(existing.taxAmount + detail.taxAmount)
        existing.exemptAmount = round(existing.exemptAmount + detail.exemptAmount)
      } else {
        byKey.set(key, { ...detail })
      }
    }
  }
  return Array.from(byKey.values())
}

export function documentTotals(
  lines: TaxProviderLineResult[],
  charges: TaxProviderChargeResult[]
): TaxProviderCalculateResult['totals'] {
  let taxTotal = 0
  let taxableTotal = 0
  let exemptTotal = 0
  for (const line of lines) {
    taxTotal += line.taxAmount
    taxableTotal += line.taxableAmount
    exemptTotal += line.exemptAmount
  }
  for (const charge of charges) {
    taxTotal += charge.taxAmount
    taxableTotal += charge.taxableAmount
  }
  return {
    taxTotal: round(taxTotal),
    taxableTotal: round(taxableTotal),
    exemptTotal: round(exemptTotal),
  }
}

/**
 * The built in default. It is an identity over the calculation engine's own per
 * line math: every amount it returns is the amount the engine already computed,
 * so an organization that never selects a provider keeps every figure it had
 * before this contract existed. It adds provenance, not arithmetic.
 */
function calculateTableRates(request: TaxCalculationRequest): TaxProviderCalculateResult {
  const lines: TaxProviderLineResult[] = request.lines.map((line) => {
    const taxAmount = round(line.taxAmount)
    const taxableAmount = round(line.amountNet)
    return {
      lineId: line.id,
      taxAmount,
      taxableAmount,
      exemptAmount: 0,
      rate: line.taxRate,
      // A table rate carries no jurisdiction identity, so a zero-tax line would
      // contribute a row that says nothing. It stays out of the breakdown.
      details:
        taxAmount === 0
          ? []
          : [
              jurisdiction({
                jurisdictionCode: line.taxRateId,
                jurisdictionType: 'other',
                rate: line.taxRate,
                taxableAmount,
                taxAmount,
              }),
            ],
    }
  })

  const charges: TaxProviderChargeResult[] = request.charges.map((charge) => {
    const taxAmount = round(charge.taxAmount)
    const taxableAmount = round(charge.amountNet)
    return {
      chargeId: charge.id,
      taxAmount,
      taxableAmount,
      rate: charge.taxRate,
      details:
        taxAmount === 0
          ? []
          : [
              jurisdiction({
                jurisdictionType: 'other',
                rate: charge.taxRate,
                taxableAmount,
                taxAmount,
              }),
            ],
    }
  })

  return {
    status: 'calculated',
    lines,
    charges,
    totals: documentTotals(lines, charges),
    breakdown: summarizeBreakdown([...lines, ...charges]),
    transaction: { reference: null, state: 'estimate' },
    messages: [],
  }
}

export const tableRatesTaxProvider: TaxProvider = {
  key: TABLE_RATES_PROVIDER_KEY,
  label: 'Default (Tax rates)',
  description: 'Uses the tax rates configured in the Tax rates section.',
  // Every figure it returns is one the engine already computed, so the catalog
  // read the other providers need would buy this one nothing.
  needsProductFacts: false,
  calculate: ({ request }) => calculateTableRates(request),
}

export const defaultTaxProviders: TaxProvider[] = [tableRatesTaxProvider]

export function registerDefaultTaxProviders() {
  defaultTaxProviders.forEach((provider) => registerTaxProvider(provider))
}
