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

export const CATALOG_GTU_CODES = [
  'GTU_01',
  'GTU_02',
  'GTU_03',
  'GTU_04',
  'GTU_05',
  'GTU_06',
  'GTU_07',
  'GTU_08',
  'GTU_09',
  'GTU_10',
  'GTU_11',
  'GTU_12',
  'GTU_13',
] as const

export type CatalogGtuCode = (typeof CATALOG_GTU_CODES)[number]

export const CATALOG_EXCISE_CATEGORIES = [
  'alcohol',
  'tobacco',
  'energy_drink',
  'fuel',
  'other',
] as const

export type CatalogExciseCategory = (typeof CATALOG_EXCISE_CATEGORIES)[number]

export const CATALOG_HAZMAT_PACKING_GROUPS = ['I', 'II', 'III'] as const

export type CatalogHazmatPackingGroup = (typeof CATALOG_HAZMAT_PACKING_GROUPS)[number]

export const CATALOG_GTIN_TYPES = ['ean13', 'ean8', 'upc', 'isbn', 'asin', 'mpn'] as const

export type CatalogGtinType = (typeof CATALOG_GTIN_TYPES)[number]

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

export const CATALOG_SERVICE_WORK_TARGET_TYPES = [
  'staff_team',
  'staff_role',
  'staff_member',
  'resource',
  'resource_type',
  'generic',
] as const

export type CatalogServiceWorkTargetType = (typeof CATALOG_SERVICE_WORK_TARGET_TYPES)[number]

export const CATALOG_SERVICE_WORK_ALLOCATION_MODES = ['ratio', 'fixed_hours'] as const

export type CatalogServiceWorkAllocationMode = (typeof CATALOG_SERVICE_WORK_ALLOCATION_MODES)[number]
