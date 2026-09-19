import { z } from 'zod'
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
export const FIXED_RATE_PROVIDER_KEY = 'fixed-rate'

function jurisdiction(overrides: Partial<TaxJurisdictionAmount>): TaxJurisdictionAmount {
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
function summarizeBreakdown(
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

function documentTotals(
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

export const fixedRateSettingsSchema = z.object({
  rate: z.coerce.number().min(0).max(100).default(0),
  jurisdictionName: z.string().trim().max(120).optional(),
  jurisdictionCode: z.string().trim().max(60).optional(),
  secondaryRate: z.coerce.number().min(0).max(100).default(0),
  secondaryJurisdictionName: z.string().trim().max(120).optional(),
  secondaryJurisdictionCode: z.string().trim().max(60).optional(),
  simulateFailure: z.enum(['none', 'throw', 'timeout']).default('none'),
})

export type FixedRateSettings = z.infer<typeof fixedRateSettingsSchema>

function fixedRateJurisdictions(
  settings: FixedRateSettings,
  taxableAmount: number
): { details: TaxJurisdictionAmount[]; taxAmount: number; rate: number } {
  const details: TaxJurisdictionAmount[] = []
  let taxAmount = 0
  const primaryRate = settings.rate / 100
  if (settings.rate > 0) {
    const amount = round(taxableAmount * primaryRate)
    taxAmount += amount
    details.push(
      jurisdiction({
        jurisdictionCode: settings.jurisdictionCode ?? null,
        jurisdictionName: settings.jurisdictionName ?? null,
        jurisdictionType: 'state',
        taxName: settings.jurisdictionName ?? null,
        rate: settings.rate,
        taxableAmount: round(taxableAmount),
        taxAmount: amount,
      })
    )
  }
  const secondaryRate = settings.secondaryRate / 100
  if (settings.secondaryRate > 0) {
    const amount = round(taxableAmount * secondaryRate)
    taxAmount += amount
    details.push(
      jurisdiction({
        jurisdictionCode: settings.secondaryJurisdictionCode ?? null,
        jurisdictionName: settings.secondaryJurisdictionName ?? null,
        jurisdictionType: 'city',
        taxName: settings.secondaryJurisdictionName ?? null,
        rate: settings.secondaryRate,
        taxableAmount: round(taxableAmount),
        taxAmount: amount,
      })
    )
  }
  return { details, taxAmount: round(taxAmount), rate: settings.rate + settings.secondaryRate }
}

function exemptEntries(request: TaxCalculationRequest): TaxProviderCalculateResult {
  const lines: TaxProviderLineResult[] = request.lines.map((line) => ({
    lineId: line.id,
    taxAmount: 0,
    taxableAmount: round(line.amountNet),
    exemptAmount: round(line.amountNet),
    rate: 0,
    details: [],
  }))
  const charges: TaxProviderChargeResult[] = request.charges.map((charge) => ({
    chargeId: charge.id,
    taxAmount: 0,
    taxableAmount: round(charge.amountNet),
    rate: 0,
    details: [],
  }))
  const totals = documentTotals(lines, charges)
  return {
    status: 'exempt',
    lines,
    charges,
    totals: { ...totals, exemptTotal: totals.taxableTotal },
    breakdown: [],
    transaction: { reference: null, state: 'estimate' },
    messages: [
      {
        level: 'info',
        code: 'customer_exempt',
        text: 'The customer is marked tax exempt, so no tax was charged.',
      },
    ],
  }
}

/**
 * A single rate with an optional second jurisdiction. It is a real provider for
 * a single state seller and the test double every acceptance scenario needs;
 * `simulateFailure` exists only to exercise the fallback path.
 */
async function calculateFixedRate(
  request: TaxCalculationRequest,
  rawSettings: Record<string, unknown>,
  signal: AbortSignal
): Promise<TaxProviderCalculateResult> {
  const parsed = fixedRateSettingsSchema.safeParse(rawSettings ?? {})
  const settings = parsed.success ? parsed.data : fixedRateSettingsSchema.parse({})

  if (settings.simulateFailure === 'throw') {
    throw new Error('[internal] fixed-rate tax provider simulated failure')
  }
  if (settings.simulateFailure === 'timeout') {
    // Resolves only when the stage's timeout aborts the signal, which is exactly
    // the path the fallback acceptance test needs to exercise.
    await new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve()
        return
      }
      signal.addEventListener('abort', () => resolve(), { once: true })
    })
  }

  if (request.customer?.exemption?.isExempt) return exemptEntries(request)

  const lines: TaxProviderLineResult[] = request.lines.map((line) => {
    const taxableAmount = round(line.amountNet)
    const { details, taxAmount, rate } = fixedRateJurisdictions(settings, taxableAmount)
    return { lineId: line.id, taxAmount, taxableAmount, exemptAmount: 0, rate, details }
  })

  const charges: TaxProviderChargeResult[] = request.charges.map((charge) => {
    const taxableAmount = round(charge.amountNet)
    const { details, taxAmount, rate } = fixedRateJurisdictions(settings, taxableAmount)
    return { chargeId: charge.id, taxAmount, taxableAmount, rate, details }
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
  label: 'Table rates',
  description:
    'Applies the tax rate stored on each line, exactly as the calculation engine does. Selected when no other provider is.',
  calculate: ({ request }) => calculateTableRates(request),
}

export const fixedRateTaxProvider: TaxProvider = {
  key: FIXED_RATE_PROVIDER_KEY,
  label: 'Fixed rate',
  description: 'Applies one rate to the whole document, with an optional second jurisdiction.',
  settings: {
    fields: [
      { key: 'rate', label: 'Rate (%)', type: 'number', required: true },
      { key: 'jurisdictionName', label: 'Jurisdiction name', type: 'text' },
      { key: 'jurisdictionCode', label: 'Jurisdiction code', type: 'text' },
      { key: 'secondaryRate', label: 'Secondary rate (%)', type: 'number' },
      { key: 'secondaryJurisdictionName', label: 'Secondary jurisdiction name', type: 'text' },
      { key: 'secondaryJurisdictionCode', label: 'Secondary jurisdiction code', type: 'text' },
      {
        key: 'simulateFailure',
        label: 'Simulate failure (testing only)',
        type: 'select',
        description: 'Exercises the fallback path. Leave at "none" outside a test environment.',
        options: [
          { value: 'none', label: 'None' },
          { value: 'throw', label: 'Throw' },
          { value: 'timeout', label: 'Timeout' },
        ],
      },
    ],
    schema: fixedRateSettingsSchema,
  },
  calculate: ({ request, settings, signal }) => calculateFixedRate(request, settings, signal),
}

export const defaultTaxProviders: TaxProvider[] = [tableRatesTaxProvider, fixedRateTaxProvider]

export function registerDefaultTaxProviders() {
  defaultTaxProviders.forEach((provider) => registerTaxProvider(provider))
}
