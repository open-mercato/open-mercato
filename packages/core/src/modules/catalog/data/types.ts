import type { CustomFieldDefinition } from '@open-mercato/shared/modules/entities'

export type CatalogAttributeDefinition = CustomFieldDefinition & {
  scope?: 'product' | 'variant' | 'shared'
  required?: boolean
  defaultValue?: unknown
}

export type CatalogAttributeSchema = {
  version?: number
  definitions: CatalogAttributeDefinition[]
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
