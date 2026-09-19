import type { z } from 'zod'
import type {
  SalesAdjustmentDraft,
  SalesCalculationContext,
  SalesDocumentCalculationResult,
  SalesDocumentKind,
  SalesLineCalculationResult,
  SalesLineKind,
} from '../types'

export type ProviderSettingFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'select'
  | 'url'
  | 'secret'
  | 'json'

export type ProviderSettingField = {
  key: string
  label: string
  type: ProviderSettingFieldType
  required?: boolean
  description?: string
  placeholder?: string
  options?: Array<{ value: string; label: string }>
}

export type ProviderSettingsDefinition = {
  fields?: ProviderSettingField[]
  schema?: z.ZodTypeAny
  defaults?: Record<string, unknown>
}

export type ProviderAdjustment = {
  kind?: SalesAdjustmentDraft['kind']
  code?: string | null
  label?: string | null
  amountNet: number
  amountGross?: number | null
  currencyCode?: string | null
  metadata?: Record<string, unknown> | null
}

export type ProviderAdjustmentResult = {
  adjustments: ProviderAdjustment[]
  metadata?: Record<string, unknown>
}

export type ShippingMethodContext = {
  id?: string | null
  code?: string | null
  name?: string | null
  providerKey?: string | null
  currencyCode?: string | null
  baseRateNet?: number | null
  baseRateGross?: number | null
  metadata?: Record<string, unknown> | null
  providerSettings?: Record<string, unknown> | null
}

export type PaymentMethodContext = {
  id?: string | null
  code?: string | null
  name?: string | null
  providerKey?: string | null
  terms?: string | null
  metadata?: Record<string, unknown> | null
  providerSettings?: Record<string, unknown> | null
}

export type ShippingMetrics = {
  itemCount: number
  totalWeight: number
  totalVolume: number
  subtotalNet: number
  subtotalGross: number
}

export type ShippingProviderCalculateInput = {
  method: ShippingMethodContext
  settings: Record<string, unknown>
  document: SalesDocumentCalculationResult
  lines: SalesLineCalculationResult[]
  context: SalesCalculationContext
  metrics: ShippingMetrics
}

export type PaymentProviderCalculateInput = {
  method: PaymentMethodContext
  settings: Record<string, unknown>
  document: SalesDocumentCalculationResult
  lines: SalesLineCalculationResult[]
  context: SalesCalculationContext
}

export type ShippingProvider = {
  key: string
  label: string
  description?: string
  settings?: ProviderSettingsDefinition
  calculate?: (
    input: ShippingProviderCalculateInput
  ) => ProviderAdjustmentResult | null | Promise<ProviderAdjustmentResult | null>
}

export type PaymentProvider = {
  key: string
  label: string
  description?: string
  settings?: ProviderSettingsDefinition
  calculate?: (
    input: PaymentProviderCalculateInput
  ) => ProviderAdjustmentResult | null | Promise<ProviderAdjustmentResult | null>
}

/**
 * Tax provider contract.
 *
 * A tax provider is selected per organization and runs once per document
 * recalculation, after the shipping and payment stages, on a request assembled
 * from the whole document. The built in `table-rates` provider reproduces the
 * calculation engine's own per line math, so an organization without a
 * selection keeps every amount it had before this contract existed.
 *
 * Spec: .ai/specs/2026-09-19-pluggable-tax-providers.md
 */

/** `record` documents are meant to be recorded with the engine; `estimate` documents are not. */
export type TaxDocumentIntent = 'estimate' | 'record'

/** What the provider says about a calculation it performed. */
export type TaxProviderResultStatus = 'calculated' | 'exempt' | 'unsupported'

/** What core persisted, including the outcomes a provider cannot report itself. */
export type TaxCalculationStatus = 'calculated' | 'exempt' | 'fallback' | 'external'

export type TaxAddress = {
  line1: string | null
  line2: string | null
  buildingNumber: string | null
  flatNumber: string | null
  city: string | null
  region: string | null
  postalCode: string | null
  country: string | null
  latitude: number | null
  longitude: number | null
}

export type TaxCustomerExemption = {
  isExempt: boolean
  code: string | null
  certificateNumber: string | null
}

export type TaxCustomer = {
  id: string
  kind: 'person' | 'company' | null
  code: string
  displayName: string | null
  taxId: string | null
  taxIdType: string | null
  exemption: TaxCustomerExemption | null
}

export type TaxRequestLine = {
  id: string
  lineNumber: number
  kind: SalesLineKind
  productId: string | null
  productVariantId: string | null
  sku: string | null
  name: string | null
  description: string | null
  quantity: number
  unitPriceNet: number
  amountNet: number
  amountGross: number
  discountAmount: number
  /**
   * The tax the calculation engine already derived for this line from its own
   * table rate. A provider that computes its own figures ignores it; the built
   * in `table-rates` provider returns it verbatim, which is what makes it an
   * exact identity over the engine (a rate alone cannot reproduce a line that
   * carried an explicit tax amount or whose tax came from the gross delta).
   */
  taxAmount: number
  taxIncluded: boolean
  taxRateId: string | null
  taxRate: number | null
  taxClassificationCode: string | null
  /** The provider tax code the catalog carries, such as an Avalara tax code. */
  taxCode: string | null
  /** `false` when the catalog marks the product as not taxable; `true` by default. */
  isTaxable: boolean
  hsCode: string | null
  /** Reserved for per line destinations; always `null` in this version. */
  shipTo: TaxAddress | null
  metadata: Record<string, unknown>
}

export type TaxRequestCharge = {
  id: string
  kind: SalesAdjustmentDraft['kind']
  code: string | null
  label: string | null
  amountNet: number
  amountGross: number
  taxRate: number | null
  /** The tax portion the engine already derived for this charge (`gross - net`). */
  taxAmount: number
  calculatorKey: string | null
}

export type TaxCalculationRequest = {
  documentKind: SalesDocumentKind
  documentId: string | null
  documentNumber: string | null
  documentDate: string
  intent: TaxDocumentIntent
  currencyCode: string
  organizationId: string
  tenantId: string
  channelId: string | null
  customer: TaxCustomer | null
  addresses: {
    shipFrom: TaxAddress | null
    shipTo: TaxAddress | null
    billTo: TaxAddress | null
  }
  lines: TaxRequestLine[]
  charges: TaxRequestCharge[]
  totals: {
    subtotalNetAmount: number
    discountTotalAmount: number
    shippingNetAmount: number
  }
  /** Free bag for provider specific inputs (purchase order number, reference code). */
  metadata: Record<string, unknown>
}

export type TaxJurisdictionAmount = {
  jurisdictionCode: string | null
  jurisdictionName: string | null
  jurisdictionType: 'country' | 'state' | 'county' | 'city' | 'special' | 'other'
  taxName: string | null
  rate: number | null
  taxableAmount: number
  taxAmount: number
  exemptAmount: number
}

export type TaxProviderLineResult = {
  lineId: string
  taxAmount: number
  taxableAmount: number
  exemptAmount: number
  rate: number | null
  details: TaxJurisdictionAmount[]
}

export type TaxProviderChargeResult = {
  chargeId: string
  taxAmount: number
  taxableAmount: number
  rate: number | null
  details: TaxJurisdictionAmount[]
}

export type TaxTransactionState = {
  reference: string | null
  state: 'estimate' | 'recorded' | 'committed' | 'voided' | 'not_supported'
  externalUrl?: string | null
  updatedAt?: string
}

export type TaxProviderMessage = {
  level: 'info' | 'warning' | 'error'
  code: string
  text: string
}

export type TaxProviderCalculateResult = {
  status: TaxProviderResultStatus
  lines: TaxProviderLineResult[]
  charges?: TaxProviderChargeResult[]
  totals: {
    taxTotal: number
    taxableTotal: number
    exemptTotal: number
  }
  breakdown?: TaxJurisdictionAmount[]
  transaction?: TaxTransactionState
  messages?: TaxProviderMessage[]
  calculatedAt?: string
  /** Stored verbatim; must contain neither secrets nor personal data. */
  metadata?: Record<string, unknown>
}

export type TaxProviderCalculateInput = {
  request: TaxCalculationRequest
  settings: Record<string, unknown>
  /** Decrypted credentials for the provider's `integrationId`; `{}` when it declares none. */
  credentials: Record<string, unknown>
  context: SalesCalculationContext
  /** Aborted when the configured timeout elapses; providers pass it to their HTTP client. */
  signal: AbortSignal
}

export type TaxTransactionLifecycleInput = {
  request: TaxCalculationRequest
  tax: TaxInfoLike
  settings: Record<string, unknown>
  credentials: Record<string, unknown>
  signal: AbortSignal
}

/**
 * The persisted tax document as the lifecycle sees it. The authoritative shape
 * is the zod schema `taxInfoSchema` in `./taxInfo`; this alias keeps the
 * contract types free of a runtime import.
 */
export type TaxInfoLike = {
  version: 1
  providerKey: string
  status: TaxCalculationStatus
  calculatedAt: string
  intent: TaxDocumentIntent
  totals: { taxTotal: number; taxableTotal: number; exemptTotal: number }
  breakdown: TaxJurisdictionAmount[]
  lines: TaxProviderLineResult[]
  charges: Array<TaxProviderChargeResult & { kind: string }>
  transaction: TaxTransactionState
  reconciliation: {
    providerTotal: number
    lineSum: number
    delta: number
    appliedToLineId: string | null
  } | null
  messages: TaxProviderMessage[]
  failure: { code: string; message: string; at: string; providerKey: string } | null
  metadata: Record<string, unknown>
}

export type TaxProviderCapabilities = {
  commit?: boolean
  adjust?: boolean
  void?: boolean
  /** Opts the provider into a commit request when an invoice is created. */
  recordsInvoices?: boolean
}

export type TaxProvider = {
  key: string
  label: string
  description?: string
  /** Non secret options only; `secret` fields are dropped at registration. */
  settings?: ProviderSettingsDefinition
  /** `IntegrationDefinition.id` whose credentials core resolves for this provider. */
  integrationId?: string
  /**
   * Whether core reads the catalog tax facts (`TaxProductFacts`) before the
   * calculation. Declaring `true` buys at most two batched catalog queries per
   * document; declaring `false` keeps the document on the cheap path. Left
   * undeclared, core loads them for every provider except the built in default,
   * which is how the contract behaved before providers could say.
   */
  needsProductFacts?: boolean
  capabilities?: TaxProviderCapabilities
  /** Returning `null` declines the document; core falls back to the default provider. */
  calculate: (
    input: TaxProviderCalculateInput
  ) => Promise<TaxProviderCalculateResult | null> | TaxProviderCalculateResult | null
  commit?: (input: TaxTransactionLifecycleInput) => Promise<TaxTransactionState>
  adjust?: (input: TaxTransactionLifecycleInput) => Promise<TaxTransactionState>
  void?: (input: TaxTransactionLifecycleInput) => Promise<TaxTransactionState>
}

export type TaxProviderSelection = {
  providerKey: string
  settings: Record<string, unknown>
  integrationId: string | null
  integrationEnabled: boolean
}

/**
 * Everything the tax stage needs that only the command layer can look up. It is
 * assembled before `calculateDocumentTotals` and placed under
 * `context.metadata.tax`; `resolveCredentials` is a closure, so it survives the
 * hook and vanishes in `JSON.stringify`.
 */
export type TaxDocumentContext = {
  document: {
    kind: SalesDocumentKind
    id: string | null
    number: string | null
    date: string
    channelId: string | null
    intent: TaxDocumentIntent
  }
  customer: TaxCustomer | null
  addresses: {
    shipFrom: TaxAddress | null
    shipTo: TaxAddress | null
    billTo: TaxAddress | null
  }
  /** Product tax facts keyed by both product id and variant id. */
  productFacts: Record<string, TaxProductFacts>
  selection: TaxProviderSelection
  resolveCredentials: () => Promise<Record<string, unknown>>
  timeoutMs: number
  totalsMode: 'computed' | 'external'
  metadata: Record<string, unknown>
}

/**
 * The catalog tax facts a line does not carry itself, read once per document
 * and keyed by both product id and variant id. A variant value wins over the
 * parent product's; `isTaxable` is `true` unless the catalog says otherwise,
 * which is the column default on both tables.
 */
export type TaxProductFacts = {
  sku: string | null
  taxRateId: string | null
  /** The Polish compliance classification (`catalog_products.tax_classification_code`). */
  taxClassificationCode: string | null
  /** The provider tax code (`tax_code`), such as an Avalara tax code. */
  taxCode: string | null
  /** `false` when the catalog marks the product or variant as not taxable. */
  isTaxable: boolean
  hsCode: string | null
}
