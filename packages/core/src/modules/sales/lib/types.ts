import type { EventBus } from '@open-mercato/events'
import type { ReferenceUnitCode } from '@open-mercato/shared/lib/units/unitCodes'
import type { SalesAdjustmentKind, SalesDocumentKind, SalesLineKind } from '../data/entities'

export type { SalesAdjustmentKind, SalesDocumentKind, SalesLineKind }

export type NumericLike = number | string

export type SalesLineUomSnapshot = {
  version: 1
  productId: string | null
  productVariantId: string | null
  baseUnitCode: string | null
  enteredUnitCode: string | null
  enteredQuantity: string
  toBaseFactor: string
  normalizedQuantity: string
  rounding: {
    mode: 'half_up' | 'down' | 'up'
    scale: number
  }
  source: {
    conversionId: string | null
    resolvedAt: string
  }
  unitPriceReference?: {
    enabled: boolean
    referenceUnitCode: ReferenceUnitCode | null
    baseQuantity: string | null
    grossPerReference?: string | null
    netPerReference?: string | null
  }
}

/**
 * How a caller-supplied `discountAmount` should be read: as a rate per unit, or
 * as the total for the whole line. Persisted rows always hold a line total —
 * see `discountAmountFromStoredRow`, which is a separate signal on purpose.
 */
export type SalesLineDiscountBasis = 'unit' | 'line'

export type SalesLineSnapshot = {
  id?: string
  lineNumber?: number
  kind: SalesLineKind
  productId?: string | null
  productVariantId?: string | null
  name?: string | null
  description?: string | null
  comment?: string | null
  quantity: number
  quantityUnit?: string | null
  normalizedQuantity?: number | null
  normalizedUnit?: string | null
  uomSnapshot?: SalesLineUomSnapshot | null
  currencyCode: string
  /** Float copy of `unitPriceNetExact`; prefer the exact field. */
  unitPriceNet?: number | null
  unitPriceNetExact?: string | null
  /** Float copy of `unitPriceGrossExact`; prefer the exact field. */
  unitPriceGross?: number | null
  unitPriceGrossExact?: string | null
  /** Float copy of `discountAmountExact`; prefer the exact field. */
  discountAmount?: number | null
  discountAmountExact?: string | null
  /**
   * Caller-supplied ONLY. How to interpret a supplied `discountAmount`.
   * Omitted means 'unit', which is the meaning the API has always documented.
   * Entity-to-snapshot mappers MUST NOT set this: a populated value is what
   * makes this a reliable *caller* signal.
   */
  discountAmountBasis?: SalesLineDiscountBasis | null
  /**
   * Set by entity-to-snapshot mappers ONLY. Marks `discountAmount` as
   * reconstructed from a persisted row, so it is a line total and is NOT a
   * caller assertion. Never persisted; never accepted from a request.
   */
  discountAmountFromStoredRow?: boolean
  discountPercent?: number | null
  taxRate?: number | null
  /** Float copy of `taxAmountExact`; prefer the exact field. */
  taxAmount?: number | null
  taxAmountExact?: string | null
  /**
   * Set by entity-to-snapshot mappers ONLY. Marks `totalNetAmount` /
   * `totalGrossAmount` as reconstructed from a persisted row, so they are the
   * engine's own previous output rather than a caller assertion. That is what
   * keeps the #5644 reconciliation a *caller* signal: a stored net is expected
   * to diverge on a row the discount contract heals on the next pass. Never
   * persisted; never accepted from a request.
   */
  totalsFromStoredRow?: boolean
  /** Float copy of `totalNetAmountExact`; prefer the exact field. */
  totalNetAmount?: number | null
  totalNetAmountExact?: string | null
  /** Float copy of `totalGrossAmountExact`; prefer the exact field. */
  totalGrossAmount?: number | null
  totalGrossAmountExact?: string | null
  configuration?: Record<string, unknown> | null
  promotionCode?: string | null
  metadata?: Record<string, unknown> | null
  customFieldSetId?: string | null
  customFields?: Record<string, unknown> | null
}

export type SalesAdjustmentDraft = {
  id?: string
  scope: 'order' | 'line'
  kind: SalesAdjustmentKind
  code?: string | null
  label?: string | null
  calculatorKey?: string | null
  promotionId?: string | null
  rate?: number | null
  /** Float copy of `amountNetExact`; prefer the exact field. */
  amountNet?: number | null
  amountNetExact?: string | null
  /** Float copy of `amountGrossExact`; prefer the exact field. */
  amountGross?: number | null
  amountGrossExact?: string | null
  currencyCode?: string | null
  metadata?: Record<string, unknown> | null
  customFields?: Record<string, unknown> | null
  position?: number | null
}

export const SALES_DOCUMENT_AMOUNT_FIELDS = [
  'subtotalNetAmount',
  'subtotalGrossAmount',
  'discountTotalAmount',
  'taxTotalAmount',
  'shippingNetAmount',
  'shippingGrossAmount',
  'surchargeTotalAmount',
  'grandTotalNetAmount',
  'grandTotalGrossAmount',
  'paidTotalAmount',
  'refundedTotalAmount',
  'outstandingAmount',
] as const

export type SalesDocumentAmountField = (typeof SALES_DOCUMENT_AMOUNT_FIELDS)[number]

/**
 * Document totals. Every `number` field is a float copy of its `<field>Exact`
 * decimal string, which carries the exact value - prefer the exact fields.
 */
export type SalesDocumentAmounts = {
  subtotalNetAmount: number
  subtotalGrossAmount: number
  discountTotalAmount: number
  taxTotalAmount: number
  shippingNetAmount?: number
  shippingGrossAmount?: number
  surchargeTotalAmount?: number
  grandTotalNetAmount: number
  grandTotalGrossAmount: number
  paidTotalAmount?: number
  refundedTotalAmount?: number
  outstandingAmount?: number
} & { [K in SalesDocumentAmountField as `${K}Exact`]?: string }

export const SALES_LINE_RESULT_AMOUNT_FIELDS = ['netAmount', 'grossAmount', 'taxAmount', 'discountAmount'] as const

/**
 * Line result. Every amount `number` is a float copy of its `<field>Exact`
 * decimal string, which carries the exact value - prefer the exact fields.
 */
export type SalesLineCalculationResult = {
  line: SalesLineSnapshot
  netAmount: number
  netAmountExact?: string
  grossAmount: number
  grossAmountExact?: string
  taxAmount: number
  taxAmountExact?: string
  discountAmount: number
  discountAmountExact?: string
  /** Decimal places the line's amounts were rounded to (the currency precision). */
  amountDecimalPlaces?: number
  adjustments: SalesAdjustmentDraft[]
}

export type SalesDocumentCalculationResult = {
  kind: SalesDocumentKind
  currencyCode: string
  lines: SalesLineCalculationResult[]
  adjustments: SalesAdjustmentDraft[]
  totals: SalesDocumentAmounts
  metadata: Record<string, unknown>
}

export type SalesLineCalculationHook = (params: {
  documentKind: SalesDocumentKind
  line: SalesLineSnapshot
  context: SalesCalculationContext
  current: SalesLineCalculationResult
}) => SalesLineCalculationResult | Promise<SalesLineCalculationResult>

export type SalesTotalsCalculationHook = (params: {
  documentKind: SalesDocumentKind
  lines: SalesLineCalculationResult[]
  existingAdjustments: SalesAdjustmentDraft[]
  context: SalesCalculationContext
  current: SalesDocumentCalculationResult
  eventBus?: EventBus | null
}) => SalesDocumentCalculationResult | Promise<SalesDocumentCalculationResult>

export type SalesCalculationContext = {
  tenantId: string
  organizationId: string
  currencyCode: string
  /**
   * Decimal places amounts are rounded to after a division. Resolve it with
   * `resolveCurrencyAmountDecimalPlaces`; defaults to 4 when omitted.
   */
  amountDecimalPlaces?: number
  metadata?: Record<string, unknown>
  resolve?: <T>(name: string) => T
}

export type CalculateLineOptions = {
  documentKind: SalesDocumentKind
  line: SalesLineSnapshot
  context: SalesCalculationContext
  eventBus?: EventBus | null
}

export type CalculateDocumentOptions = {
  documentKind: SalesDocumentKind
  lines: SalesLineSnapshot[]
  adjustments?: SalesAdjustmentDraft[]
  context: SalesCalculationContext
  existingTotals?: {
    paidTotalAmount?: number | null
    paidTotalAmountExact?: string | null
    refundedTotalAmount?: number | null
    refundedTotalAmountExact?: string | null
  }
  eventBus?: EventBus | null
}
