import { z } from 'zod'
import type { CatalogProductOptionSchema } from '../../data/types'
import type { ProductMediaItem } from './ProductMediaManager'

export type PriceKindSummary = {
  id: string
  code: string
  title: string
  currencyCode: string | null
  displayMode: 'including-tax' | 'excluding-tax'
}

export type PriceKindApiPayload = {
  id?: string | number
  code?: string
  title?: string
  currencyCode?: string | null
  currency_code?: string | null
  displayMode?: string | null
  display_mode?: string | null
}

export type TaxRateSummary = {
  id: string
  name: string
  code: string | null
  rate: number | null
  isDefault: boolean
}

export type ProductOptionInput = {
  id: string
  title: string
  values: Array<{ id: string; label: string }>
}

export type VariantPriceValue = {
  amount: string
}

export type VariantDraft = {
  id: string
  title: string
  sku: string
  isDefault: boolean
  taxRateId: string | null
  manageInventory: boolean
  allowBackorder: boolean
  hasInventoryKit: boolean
  optionValues: Record<string, string>
  prices: Record<string, VariantPriceValue>
}

export type ProductFormValues = {
  title: string
  subtitle: string
  handle: string
  description: string
  useMarkdown: boolean
  taxRateId: string | null
  mediaDraftId: string
  mediaItems: ProductMediaItem[]
  defaultMediaId: string | null
  defaultMediaUrl: string
  hasVariants: boolean
  options: ProductOptionInput[]
  variants: VariantDraft[]
  metadata?: Record<string, unknown> | null
  customFieldsetCode?: string | null
  categoryIds: string[]
  channelIds: string[]
  tags: string[]
  optionSchemaId?: string | null
}

export const productFormSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  subtitle: z.string().optional(),
  handle: z
    .string()
    .trim()
    .regex(/^[a-z0-9\-_]*$/, 'Handle must include lowercase letters, digits, hyphen, or underscore')
    .max(150)
    .optional(),
  description: z.string().optional(),
  useMarkdown: z.boolean().optional(),
  taxRateId: z.string().uuid().nullable().optional(),
  hasVariants: z.boolean().optional(),
  mediaDraftId: z.string().optional(),
  mediaItems: z.any().optional(),
  defaultMediaId: z.string().uuid().nullable().optional(),
  defaultMediaUrl: z.string().trim().max(500).nullable().optional(),
  options: z.any().optional(),
  variants: z.any().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  customFieldsetCode: z.string().optional(),
  categoryIds: z.array(z.string().uuid()).optional(),
  channelIds: z.array(z.string().uuid()).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).optional(),
  optionSchemaId: z.string().uuid().nullable().optional(),
})

export const PRODUCT_FORM_STEPS = ['general', 'organize', 'variants'] as const

export const BASE_INITIAL_VALUES: ProductFormValues = {
  title: '',
  subtitle: '',
  handle: '',
  description: '',
  useMarkdown: false,
  mediaDraftId: '',
  mediaItems: [],
  defaultMediaId: null,
  defaultMediaUrl: '',
  taxRateId: null,
  hasVariants: false,
  options: [],
  variants: [],
  metadata: {},
  customFieldsetCode: null,
  categoryIds: [],
  channelIds: [],
  tags: [],
  optionSchemaId: null,
}

export const createInitialProductFormValues = (): ProductFormValues => ({
  ...BASE_INITIAL_VALUES,
  mediaDraftId: createLocalId(),
  variants: [createVariantDraft(null, { isDefault: true })],
})

export const createVariantDraft = (
  productTaxRateId: string | null,
  overrides: Partial<VariantDraft> = {},
): VariantDraft => ({
  id: createLocalId(),
  title: 'Default variant',
  sku: '',
  isDefault: false,
  taxRateId: productTaxRateId ?? null,
  manageInventory: false,
  allowBackorder: false,
  hasInventoryKit: false,
  optionValues: {},
  prices: {},
  ...overrides,
})

export const buildOptionValuesKey = (optionValues?: Record<string, string>): string => {
  if (!optionValues) return ''
  return Object.keys(optionValues)
    .sort()
    .map((key) => `${key}:${optionValues[key] ?? ''}`)
    .join('|')
}

export const haveSameOptionValues = (
  current: Record<string, string> | undefined,
  next: Record<string, string>,
): boolean => {
  const a = current ?? {}
  const keys = new Set([...Object.keys(a), ...Object.keys(next)])
  for (const key of keys) {
    if ((a[key] ?? '') !== (next[key] ?? '')) return false
  }
  return true
}

export const normalizePriceKindSummary = (input: PriceKindApiPayload | undefined | null): PriceKindSummary | null => {
  if (!input) return null
  const getString = (value: unknown): string | null => {
    if (typeof value === 'string' && value.trim().length) return value.trim()
    if (typeof value === 'number' || typeof value === 'bigint') return String(value)
    return null
  }
  const id = getString(input.id)
  const code = getString(input.code)
  const title = getString(input.title)
  if (!id || !code || !title) return null
  const currency = getString(input.currencyCode) ?? getString(input.currency_code)
  const displayRaw = getString(input.displayMode) ?? getString(input.display_mode)
  const displayMode: PriceKindSummary['displayMode'] =
    displayRaw === 'including-tax' ? 'including-tax' : 'excluding-tax'
  return {
    id,
    code,
    title,
    currencyCode: currency,
    displayMode,
  }
}

export const formatTaxRateLabel = (rate: TaxRateSummary): string => {
  const extras: string[] = []
  if (typeof rate.rate === 'number' && Number.isFinite(rate.rate)) {
    extras.push(`${rate.rate}%`)
  }
  if (rate.code) {
    extras.push(rate.code.toUpperCase())
  }
  if (!extras.length) return rate.name
  return `${rate.name} • ${extras.join(' · ')}`
}

export const slugify = (input: string): string => {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function createLocalId(): string {
  return Math.random().toString(36).slice(2, 10)
}

export function buildOptionSchemaDefinition(
  options: ProductOptionInput[] | undefined,
  name: string
): CatalogProductOptionSchema | null {
  const list = Array.isArray(options) ? options : []
  if (!list.length) return null
  const normalizedName = name && name.trim().length ? name.trim() : 'Product options'
  const schemaOptions = list
    .map((option) => {
      const title = option.title?.trim() || ''
      const code = slugify(title || option.id || createLocalId())
      const values = Array.isArray(option.values) ? option.values : []
      return {
        code: code || slugify(createLocalId()),
        label: title || code || 'Option',
        inputType: 'select' as const,
        choices: values
          .map((value) => {
            const label = value.label?.trim() || ''
            const valueCode = slugify(label || value.id || createLocalId())
            if (!label && !valueCode) return null
            return {
              code: valueCode || slugify(createLocalId()),
              label: label || valueCode || 'Choice',
            }
          })
          .filter((entry): entry is { code: string; label: string } => !!entry),
      }
    })
    .filter((entry) => entry.label.trim().length)
  if (!schemaOptions.length) return null
  return {
    version: 1,
    name: normalizedName,
    options: schemaOptions,
  }
}

export function convertSchemaToProductOptions(
  schema: CatalogProductOptionSchema | null | undefined
): ProductOptionInput[] {
  if (!schema || !Array.isArray(schema.options)) return []
  return schema.options.map((option) => ({
    id: createLocalId(),
    title: option.label ?? option.code ?? 'Option',
    values: Array.isArray(option.choices)
      ? option.choices.map((choice) => ({
          id: createLocalId(),
          label: choice.label ?? choice.code ?? '',
        }))
      : [],
  }))
}
