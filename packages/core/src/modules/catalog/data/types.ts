import type { CustomFieldDefinition } from '@open-mercato/shared/modules/entities'

export const CATALOG_PRODUCT_TYPES = [
  'simple',
  'configurable',
  'virtual',
  'downloadable',
  'bundle',
  'grouped',
] as const

export type CatalogProductType = (typeof CATALOG_PRODUCT_TYPES)[number]

export const CATALOG_CONFIGURABLE_PRODUCT_TYPES = ['configurable', 'virtual', 'downloadable'] as const

export const CATALOG_SUBPRODUCT_PRODUCT_TYPES = ['bundle', 'grouped'] as const

export type CatalogConfigurableProductType = (typeof CATALOG_CONFIGURABLE_PRODUCT_TYPES)[number]

export const CATALOG_PRODUCT_RELATION_TYPES = ['bundle', 'grouped'] as const

export type CatalogProductRelationType = (typeof CATALOG_PRODUCT_RELATION_TYPES)[number]

export type CatalogAttributeDefinition = Omit<CustomFieldDefinition, 'defaultValue'> & {
  scope?: 'product' | 'variant' | 'shared'
  required?: boolean
  defaultValue?: unknown
}

export type CatalogAttributeSchema = {
  version?: number
  name?: string | null
  definitions: CatalogAttributeDefinition[]
}

export type CatalogAttributeSchemaSource = {
  id: string
  name: string
  code?: string | null
  description?: string | null
  schema: CatalogAttributeSchema | null
}

export type CatalogAttributeValues = Record<string, unknown>

export type CatalogProductOptionChoice = {
  code: string
  label?: string | null
}

export type CatalogProductOptionDefinition = {
  code: string
  label: string
  description?: string | null
  inputType: 'select' | 'text' | 'textarea' | 'number'
  isRequired?: boolean
  isMultiple?: boolean
  choices?: CatalogProductOptionChoice[]
}

export type CatalogProductOptionSchema = {
  version?: number
  name?: string | null
  description?: string | null
  options: CatalogProductOptionDefinition[]
}

export type CatalogOfferContent = {
  title?: string | null
  description?: string | null
  attributesOverride?: CatalogAttributeValues | null
}

export type CatalogOfferLocalizedContent = Record<string, CatalogOfferContent>

export type CatalogPricingScope = {
  channelId?: string | null
  offerId?: string | null
  userId?: string | null
  userGroupId?: string | null
  customerId?: string | null
  customerGroupId?: string | null
}

export const CATALOG_PRICE_DISPLAY_MODES = ['including-tax', 'excluding-tax'] as const

export type CatalogPriceDisplayMode = (typeof CATALOG_PRICE_DISPLAY_MODES)[number]
