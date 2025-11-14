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

export const CATALOG_PRODUCT_RELATION_TYPES = ['bundle', 'grouped'] as const

export type CatalogProductRelationType = (typeof CATALOG_PRODUCT_RELATION_TYPES)[number]

export type CatalogAttributeDefinition = Omit<CustomFieldDefinition, 'defaultValue'> & {
  scope?: 'product' | 'variant' | 'shared'
  required?: boolean
  defaultValue?: unknown
}

export type CatalogAttributeSchema = {
  version?: number
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
