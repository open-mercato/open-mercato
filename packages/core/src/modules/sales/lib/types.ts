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
  uomSnapshot?: SalesLineUomSnapshot | Record<string, unknown> | null
  currencyCode: string
  unitPriceNet?: number | null
  unitPriceGross?: number | null
  discountAmount?: number | null
  discountPercent?: number | null
  taxRate?: number | null
  taxAmount?: number | null
  totalNetAmount?: number | null
  totalGrossAmount?: number | null
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
  amountNet?: number | null
  amountGross?: number | null
  currencyCode?: string | null
  metadata?: Record<string, unknown> | null
  customFields?: Record<string, unknown> | null
  position?: number | null
}

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
}

export type SalesLineCalculationResult = {
  line: SalesLineSnapshot
  netAmount: number
  grossAmount: number
  taxAmount: number
  discountAmount: number
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
    refundedTotalAmount?: number | null
  }
  eventBus?: EventBus | null
}
