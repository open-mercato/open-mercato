import { z } from 'zod'
import { round } from '../calculations'
import type {
  TaxCalculationStatus,
  TaxInfoLike,
  TaxJurisdictionAmount,
  TaxProviderCalculateResult,
  TaxProviderMessage,
} from './types'

const amount = z.number().finite()
const nullableRate = z.number().finite().nullable()

export const taxJurisdictionAmountSchema = z.object({
  jurisdictionCode: z.string().nullable().default(null),
  jurisdictionName: z.string().nullable().default(null),
  jurisdictionType: z
    .enum(['country', 'state', 'county', 'city', 'special', 'other'])
    .default('other'),
  taxName: z.string().nullable().default(null),
  rate: nullableRate.default(null),
  taxableAmount: amount.default(0),
  taxAmount: amount.default(0),
  exemptAmount: amount.default(0),
})

export const taxProviderMessageSchema = z.object({
  level: z.enum(['info', 'warning', 'error']),
  code: z.string().min(1),
  text: z.string(),
})

export const taxTransactionStateSchema = z.object({
  reference: z.string().nullable().default(null),
  state: z.enum(['estimate', 'recorded', 'committed', 'voided', 'not_supported']).default('estimate'),
  externalUrl: z.string().nullable().optional(),
  updatedAt: z.string().optional(),
})

const taxProviderLineResultSchema = z.object({
  lineId: z.string().min(1),
  taxAmount: amount,
  taxableAmount: amount.default(0),
  exemptAmount: amount.default(0),
  rate: nullableRate.default(null),
  details: z.array(taxJurisdictionAmountSchema).default([]),
})

const taxProviderChargeResultSchema = z.object({
  chargeId: z.string().min(1),
  taxAmount: amount,
  taxableAmount: amount.default(0),
  rate: nullableRate.default(null),
  details: z.array(taxJurisdictionAmountSchema).default([]),
})

/**
 * What a provider is allowed to return. Unknown top level keys are stripped
 * rather than rejected, so a provider written against a later contract version
 * still calculates here instead of failing into the fallback path.
 */
export const taxProviderResultSchema = z.object({
  status: z.enum(['calculated', 'exempt', 'unsupported']),
  lines: z.array(taxProviderLineResultSchema),
  charges: z.array(taxProviderChargeResultSchema).default([]),
  totals: z.object({
    taxTotal: amount,
    taxableTotal: amount,
    exemptTotal: amount,
  }),
  breakdown: z.array(taxJurisdictionAmountSchema).default([]),
  transaction: taxTransactionStateSchema.optional(),
  messages: z.array(taxProviderMessageSchema).default([]),
  calculatedAt: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
})

export const taxInfoReconciliationSchema = z.object({
  providerTotal: amount,
  lineSum: amount,
  delta: amount,
  appliedToLineId: z.string().nullable(),
})

export const taxInfoFailureSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  at: z.string(),
  providerKey: z.string(),
})

/**
 * The persisted `tax_info` document. It carries amounts, rates, jurisdictions,
 * references and messages only — never an address, a customer identity or a
 * credential — which is what keeps the column out of the encryption maps.
 */
export const taxInfoSchema = z.object({
  version: z.literal(1),
  providerKey: z.string().min(1),
  status: z.enum(['calculated', 'exempt', 'fallback', 'external']),
  calculatedAt: z.string(),
  intent: z.enum(['estimate', 'record']),
  totals: z.object({
    taxTotal: amount,
    taxableTotal: amount,
    exemptTotal: amount,
  }),
  breakdown: z.array(taxJurisdictionAmountSchema).default([]),
  lines: z.array(taxProviderLineResultSchema).default([]),
  charges: z.array(taxProviderChargeResultSchema.extend({ kind: z.string() })).default([]),
  transaction: taxTransactionStateSchema,
  reconciliation: taxInfoReconciliationSchema.nullable().default(null),
  messages: z.array(taxProviderMessageSchema).default([]),
  failure: taxInfoFailureSchema.nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).default({}),
})

export type TaxInfo = z.infer<typeof taxInfoSchema>
export type TaxProviderResultParsed = z.infer<typeof taxProviderResultSchema>

export function roundTaxAmount(value: number): number {
  return round(value)
}

function roundJurisdictions(details: TaxJurisdictionAmount[]): TaxJurisdictionAmount[] {
  return details.map((detail) => ({
    ...detail,
    rate: detail.rate === null ? null : round(detail.rate),
    taxableAmount: round(detail.taxableAmount),
    taxAmount: round(detail.taxAmount),
    exemptAmount: round(detail.exemptAmount),
  }))
}

/**
 * Parses a provider result and rounds every amount to the four decimals the
 * numeric columns carry. Returns `null` when the provider returned something
 * the contract does not describe; the caller treats that as a failure and falls
 * back to the default provider.
 */
export function normalizeTaxProviderResult(
  value: unknown
): TaxProviderResultParsed | null {
  const parsed = taxProviderResultSchema.safeParse(value)
  if (!parsed.success) return null
  const result = parsed.data
  return {
    ...result,
    lines: result.lines.map((line) => ({
      ...line,
      taxAmount: round(line.taxAmount),
      taxableAmount: round(line.taxableAmount),
      exemptAmount: round(line.exemptAmount),
      rate: line.rate === null ? null : round(line.rate),
      details: roundJurisdictions(line.details),
    })),
    charges: result.charges.map((charge) => ({
      ...charge,
      taxAmount: round(charge.taxAmount),
      taxableAmount: round(charge.taxableAmount),
      rate: charge.rate === null ? null : round(charge.rate),
      details: roundJurisdictions(charge.details),
    })),
    totals: {
      taxTotal: round(result.totals.taxTotal),
      taxableTotal: round(result.totals.taxableTotal),
      exemptTotal: round(result.totals.exemptTotal),
    },
    breakdown: roundJurisdictions(result.breakdown),
  }
}

export function parseTaxInfo(value: unknown): TaxInfo | null {
  const parsed = taxInfoSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export type BuildTaxInfoParams = {
  providerKey: string
  status: TaxCalculationStatus
  intent: TaxInfoLike['intent']
  result: TaxProviderResultParsed | null
  chargeKinds: Record<string, string>
  reconciliation?: TaxInfoLike['reconciliation']
  messages?: TaxProviderMessage[]
  failure?: TaxInfoLike['failure']
  calculatedAt?: string
}

/**
 * Assembles the persisted document from a normalized provider result. A
 * fallback carries no provider result, so the totals come out as zeros and the
 * amounts the engine computed stay on the lines themselves.
 */
export function buildTaxInfo(params: BuildTaxInfoParams): TaxInfo {
  const { result } = params
  const calculatedAt = params.calculatedAt ?? result?.calculatedAt ?? new Date().toISOString()
  const messages = [...(result?.messages ?? []), ...(params.messages ?? [])]
  return taxInfoSchema.parse({
    version: 1,
    providerKey: params.providerKey,
    status: params.status,
    calculatedAt,
    intent: params.intent,
    totals: result?.totals ?? { taxTotal: 0, taxableTotal: 0, exemptTotal: 0 },
    breakdown: result?.breakdown ?? [],
    lines: result?.lines ?? [],
    charges: (result?.charges ?? []).map((charge) => ({
      ...charge,
      kind: params.chargeKinds[charge.chargeId] ?? 'custom',
    })),
    transaction: result?.transaction ?? { reference: null, state: 'estimate' },
    reconciliation: params.reconciliation ?? null,
    messages,
    failure: params.failure ?? null,
    metadata: result?.metadata ?? {},
  })
}

export function isTaxProviderCalculateResult(
  value: unknown
): value is TaxProviderCalculateResult {
  return taxProviderResultSchema.safeParse(value).success
}
