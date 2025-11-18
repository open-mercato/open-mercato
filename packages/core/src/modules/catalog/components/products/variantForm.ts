"use client"

import type { ProductMediaItem } from './ProductMediaManager'
import { createLocalId } from './productForm'

export type OptionDefinition = {
  id: string
  code: string
  label: string
  values: Array<{ id: string; label: string }>
}

export type VariantPriceDraft = {
  priceKindId: string
  priceId?: string
  amount: string
  currencyCode?: string | null
  displayMode: 'including-tax' | 'excluding-tax'
}

export type VariantFormValues = {
  name: string
  sku: string
  barcode: string
  isDefault: boolean
  isActive: boolean
  optionValues: Record<string, string>
  metadata?: Record<string, unknown> | null
  mediaDraftId: string
  mediaItems: ProductMediaItem[]
  defaultMediaId: string | null
  defaultMediaUrl: string
  prices: Record<string, VariantPriceDraft>
  taxRateId: string | null
  customFieldsetCode?: string | null
}

export const VARIANT_BASE_VALUES: VariantFormValues = {
  name: '',
  sku: '',
  barcode: '',
  isDefault: false,
  isActive: true,
  optionValues: {},
  metadata: {},
  mediaDraftId: '',
  mediaItems: [],
  defaultMediaId: null,
  defaultMediaUrl: '',
  prices: {},
  taxRateId: null,
  customFieldsetCode: null,
}

export const createVariantInitialValues = (): VariantFormValues => ({
  ...VARIANT_BASE_VALUES,
  mediaDraftId: createLocalId(),
})

export function normalizeOptionSchema(raw: unknown): OptionDefinition[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry) => normalizeOptionDefinition(entry))
    .filter((entry): entry is OptionDefinition => !!entry)
}

function normalizeOptionDefinition(entry: unknown): OptionDefinition | null {
  if (!entry || typeof entry !== 'object') return null
  const code = extractString((entry as any).code) || createLocalId()
  const label = extractString((entry as any).label) || code
  const values = Array.isArray((entry as any).values)
    ? (entry as any).values
        .map((value: any) => {
          const id = extractString(value?.id) || createLocalId()
          const valueLabel = extractString(value?.label) || id
          return { id, label: valueLabel }
        })
        .filter((value): value is { id: string; label: string } => !!value.label.length)
    : []
  return {
    id: extractString((entry as any).id) || createLocalId(),
    code,
    label,
    values,
  }
}

function extractString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function buildVariantMetadata(values: VariantFormValues): Record<string, unknown> {
  const metadata = typeof values.metadata === 'object' && values.metadata ? { ...values.metadata } : {}
  return metadata
}
