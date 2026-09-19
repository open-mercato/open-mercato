import { z } from 'zod'
import { round } from '../calculations'
import { registerTaxProvider } from './registry'
import { documentTotals, jurisdiction, summarizeBreakdown } from './taxProviders'
import type {
  TaxCalculationRequest,
  TaxJurisdictionAmount,
  TaxProvider,
  TaxProviderCalculateResult,
  TaxProviderChargeResult,
  TaxProviderLineResult,
} from './types'

/**
 * A second tax provider that exists only so the Playwright acceptance suite has
 * something other than the default to select. It is NOT a product provider: it
 * is registered exclusively when `OM_INTEGRATION_TEST` is set, so no
 * development or production instance ever lists it, and it ships no i18n keys,
 * no documentation and no user-facing label beyond the plain English one below.
 *
 * The unit suite imports the provider object directly and registers it in the
 * test, which is why the implementation lives here rather than in a
 * `__tests__` folder the running server could not import.
 */
export const INTEGRATION_TEST_TAX_PROVIDER_KEY = 'integration-test-rate'

export const integrationTestTaxSettingsSchema = z.object({
  rate: z.coerce.number().min(0).max(100).default(0),
  jurisdictionName: z.string().trim().max(120).optional(),
  jurisdictionCode: z.string().trim().max(60).optional(),
  secondaryRate: z.coerce.number().min(0).max(100).default(0),
  secondaryJurisdictionName: z.string().trim().max(120).optional(),
  secondaryJurisdictionCode: z.string().trim().max(60).optional(),
  simulateFailure: z.enum(['none', 'throw', 'timeout']).default('none'),
})

export type IntegrationTestTaxSettings = z.infer<typeof integrationTestTaxSettingsSchema>

function integrationTestJurisdictions(
  settings: IntegrationTestTaxSettings,
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
 * A single rate with an optional second jurisdiction — enough to prove that a
 * selected provider replaces the engine's table rate math end to end.
 * `simulateFailure` exists only to exercise the fallback path.
 */
async function calculateIntegrationTestRate(
  request: TaxCalculationRequest,
  rawSettings: Record<string, unknown>,
  signal: AbortSignal
): Promise<TaxProviderCalculateResult> {
  const parsed = integrationTestTaxSettingsSchema.safeParse(rawSettings ?? {})
  const settings = parsed.success ? parsed.data : integrationTestTaxSettingsSchema.parse({})

  if (settings.simulateFailure === 'throw') {
    throw new Error('[internal] integration test tax provider simulated failure')
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
    const { details, taxAmount, rate } = integrationTestJurisdictions(settings, taxableAmount)
    return { lineId: line.id, taxAmount, taxableAmount, exemptAmount: 0, rate, details }
  })

  const charges: TaxProviderChargeResult[] = request.charges.map((charge) => {
    const taxableAmount = round(charge.amountNet)
    const { details, taxAmount, rate } = integrationTestJurisdictions(settings, taxableAmount)
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

export const integrationTestTaxProvider: TaxProvider = {
  key: INTEGRATION_TEST_TAX_PROVIDER_KEY,
  label: 'Integration test rate',
  description: 'Test only. Applies one rate to the whole document, with an optional second jurisdiction.',
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
        description: 'Exercises the fallback path.',
        options: [
          { value: 'none', label: 'None' },
          { value: 'throw', label: 'Throw' },
          { value: 'timeout', label: 'Timeout' },
        ],
      },
    ],
    schema: integrationTestTaxSettingsSchema,
  },
  calculate: ({ request, settings, signal }) => calculateIntegrationTestRate(request, settings, signal),
}

export function registerIntegrationTestTaxProvider() {
  return registerTaxProvider(integrationTestTaxProvider)
}
