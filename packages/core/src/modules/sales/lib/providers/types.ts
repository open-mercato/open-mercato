import type { z } from 'zod'
import type {
  SalesAdjustmentDraft,
  SalesCalculationContext,
  SalesDocumentCalculationResult,
  SalesLineCalculationResult,
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
