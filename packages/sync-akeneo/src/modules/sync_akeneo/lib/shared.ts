import type { DataMapping, FieldMapping } from '@open-mercato/core/modules/data_sync/lib/adapter'

export type AkeneoEntityType = 'categories' | 'attributes' | 'products'

export type AkeneoProductFieldKey =
  | 'title'
  | 'subtitle'
  | 'description'
  | 'sku'
  | 'barcode'
  | 'weight'
  | 'variantName'

export type AkeneoCustomFieldTarget = 'product' | 'variant'

export type AkeneoCustomFieldKind =
  | 'text'
  | 'multiline'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'select'

export type AkeneoCustomFieldMapping = {
  attributeCode: string
  fieldKey: string
  target: AkeneoCustomFieldTarget
  kind?: AkeneoCustomFieldKind | null
  skip?: boolean
}

export type AkeneoPriceMapping = {
  attributeCode: string
  priceKindCode: string
  localChannelCode: string
  akeneoChannel?: string | null
}

export type AkeneoMediaTarget = 'product' | 'variant'
export type AkeneoMediaKind = 'image' | 'file'

export type AkeneoMediaMapping = {
  attributeCode: string
  target: AkeneoMediaTarget
  kind: AkeneoMediaKind
}

export type AkeneoFieldsetMapping = {
  sourceType: 'family' | 'familyVariant'
  sourceCode: string
  target: 'product' | 'variant'
  fieldsetCode: string
  fieldsetLabel: string
  description?: string | null
}

export type AkeneoReconciliationSettings = {
  deactivateMissingCategories: boolean
  deactivateMissingProducts: boolean
  deactivateMissingAttributes: boolean
  deleteMissingOffers: boolean
  deleteMissingPrices: boolean
  deleteMissingMedia: boolean
  deleteMissingAttachments: boolean
}

export type AkeneoProductMappingSettings = {
  locale: string
  channel: string | null
  channels: string[]
  importAllChannels: boolean
  fieldMap: Record<AkeneoProductFieldKey, string>
  customFieldMappings: AkeneoCustomFieldMapping[]
  priceMappings: AkeneoPriceMapping[]
  mediaMappings: AkeneoMediaMapping[]
  fieldsetMappings: AkeneoFieldsetMapping[]
  createMissingChannels: boolean
  syncAssociations: boolean
  reconciliation: AkeneoReconciliationSettings
}

export type AkeneoCategoryMappingSettings = {
  locale: string
}

export type AkeneoAttributeMappingSettings = {
  includeTextAttributes: boolean
  includeNumericAttributes: boolean
  familyCodeFilter: string[]
}

export type AkeneoMappingSettings = {
  products?: AkeneoProductMappingSettings
  categories?: AkeneoCategoryMappingSettings
  attributes?: AkeneoAttributeMappingSettings
}

export type AkeneoDataMapping = DataMapping & {
  settings?: AkeneoMappingSettings
}

export type AkeneoCredentialShape = {
  apiUrl: string
  clientId: string
  clientSecret: string
  username: string
  password: string
}

export type AkeneoValueEntry = {
  locale?: string | null
  scope?: string | null
  data?: unknown
  attribute_type?: string
}

export type AkeneoValues = Record<string, AkeneoValueEntry[]>

export type AkeneoProduct = {
  uuid: string
  identifier?: string | null
  enabled?: boolean
  family?: string | null
  categories?: string[]
  parent?: string | null
  values?: AkeneoValues
  associations?: Record<string, {
    products?: string[]
    product_models?: string[]
    groups?: string[]
  }>
  quantified_associations?: Record<string, {
    products?: Array<{ identifier?: string | null; uuid?: string | null; quantity?: number | string | null }>
    product_models?: Array<{ identifier?: string | null; code?: string | null; quantity?: number | string | null }>
  }>
  updated?: string
}

export type AkeneoProductModel = {
  code: string
  family?: string | null
  categories?: string[]
  parent?: string | null
  family_variant?: string | null
  values?: AkeneoValues
  updated?: string
}

export type AkeneoCategory = {
  code: string
  parent?: string | null
  labels?: Record<string, string>
  updated?: string
}

export type AkeneoAttribute = {
  code: string
  type: string
  localizable?: boolean
  scopable?: boolean
  labels?: Record<string, string>
  group?: string | null
  group_labels?: Record<string, string>
  is_required_for_completeness?: boolean
  unique?: boolean
  useable_as_grid_filter?: boolean
  max_characters?: number | null
  validation_rule?: string | null
  validation_regexp?: string | null
  decimals_allowed?: boolean
  negative_allowed?: boolean
  minimum_value?: number | string | null
  maximum_value?: number | string | null
  metric_family?: string | null
  default_metric_unit?: string | null
  reference_data_name?: string | null
  wysiwyg_enabled?: boolean
  is_textarea?: boolean
}

export type AkeneoAttributeOption = {
  code: string
  labels?: Record<string, string>
}

export type AkeneoFamily = {
  code: string
  labels?: Record<string, string>
  attributes?: string[]
  attribute_requirements?: Record<string, string[]>
  attribute_as_label?: string | null
  attribute_as_image?: string | null
}

export type AkeneoFamilyVariant = {
  code: string
  labels?: Record<string, string>
  variant_attribute_sets?: Array<{
    level?: number
    axes?: string[]
    attributes?: string[]
  }>
}

export type AkeneoChannel = {
  code: string
  labels?: Record<string, string>
  locales?: string[]
}

export type AkeneoLocale = {
  code: string
  labels?: Record<string, string>
  enabled?: boolean
}

export function buildDefaultReconciliationSettings(): AkeneoReconciliationSettings {
  return {
    deactivateMissingCategories: true,
    deactivateMissingProducts: true,
    deactivateMissingAttributes: true,
    deleteMissingOffers: true,
    deleteMissingPrices: true,
    deleteMissingMedia: true,
    deleteMissingAttachments: true,
  }
}

export function buildDefaultAkeneoMapping(entityType: AkeneoEntityType): AkeneoDataMapping {
  if (entityType === 'categories') {
    return {
      entityType,
      matchStrategy: 'externalId',
      fields: [{ externalField: 'labels', localField: 'name', required: true }],
      settings: {
        categories: {
          locale: 'en_US',
        },
      },
    }
  }

  if (entityType === 'attributes') {
    return {
      entityType,
      matchStrategy: 'externalId',
      fields: [
        { externalField: 'family.attributes', localField: 'optionSchema.options' },
      ],
      settings: {
        attributes: {
          includeTextAttributes: true,
          includeNumericAttributes: true,
          familyCodeFilter: [],
        },
      },
    }
  }

  const defaultProducts: AkeneoProductMappingSettings = {
    locale: 'en_US',
    channel: null,
    channels: [],
    importAllChannels: true,
    fieldMap: {
      title: 'name',
      subtitle: 'subtitle',
      description: 'description',
      sku: 'sku',
      barcode: 'ean',
      weight: 'weight',
      variantName: 'name',
    },
    customFieldMappings: [],
    priceMappings: [
      {
        attributeCode: 'price',
        priceKindCode: 'regular',
        akeneoChannel: 'ecommerce',
        localChannelCode: 'web',
      },
      {
        attributeCode: 'sale_price',
        priceKindCode: 'sale',
        akeneoChannel: 'ecommerce',
        localChannelCode: 'web',
      },
    ],
    mediaMappings: [
      {
        attributeCode: 'main_image',
        target: 'product',
        kind: 'image',
      },
      {
        attributeCode: 'packshot',
        target: 'variant',
        kind: 'image',
      },
      {
        attributeCode: 'size_chart',
        target: 'product',
        kind: 'file',
      },
    ],
    fieldsetMappings: [],
    createMissingChannels: true,
    syncAssociations: true,
    reconciliation: buildDefaultReconciliationSettings(),
  }

  return {
    entityType: 'products',
    matchStrategy: 'externalId',
    fields: buildProductFieldMappings(defaultProducts),
    settings: {
      products: defaultProducts,
    },
  }
}

export function normalizeAkeneoMapping(entityType: AkeneoEntityType, raw: Record<string, unknown> | null | undefined): AkeneoDataMapping {
  const fallback = buildDefaultAkeneoMapping(entityType)
  if (!raw) return fallback

  const fields = Array.isArray(raw.fields)
    ? raw.fields.filter((field): field is FieldMapping => {
        if (!field || typeof field !== 'object') return false
        const candidate = field as FieldMapping
        return typeof candidate.externalField === 'string' && typeof candidate.localField === 'string'
      })
    : fallback.fields

  const settings = normalizeAkeneoSettings(entityType, raw.settings, fallback.settings)

  return {
    entityType,
    matchStrategy: typeof raw.matchStrategy === 'string' ? raw.matchStrategy as DataMapping['matchStrategy'] : fallback.matchStrategy,
    matchField: typeof raw.matchField === 'string' ? raw.matchField : fallback.matchField,
    fields: fields.length > 0 ? fields : fallback.fields,
    settings,
  }
}

export function buildProductFieldMappings(settings: AkeneoProductMappingSettings): FieldMapping[] {
  return [
    { externalField: settings.fieldMap.title, localField: 'title', required: true },
    { externalField: settings.fieldMap.subtitle, localField: 'subtitle' },
    { externalField: settings.fieldMap.description, localField: 'description' },
    { externalField: settings.fieldMap.sku, localField: 'sku' },
    { externalField: settings.fieldMap.barcode, localField: 'barcode' },
    { externalField: settings.fieldMap.weight, localField: 'weight' },
    { externalField: settings.fieldMap.variantName, localField: 'variantName' },
  ]
}

export function labelFromLocalizedRecord(labels: Record<string, string> | null | undefined, preferredLocale: string | null | undefined, fallback: string): string {
  if (!labels || typeof labels !== 'object') return fallback
  const locale = typeof preferredLocale === 'string' && preferredLocale.trim().length > 0
    ? preferredLocale.trim()
    : null
  if (locale && typeof labels[locale] === 'string' && labels[locale].trim().length > 0) {
    return labels[locale].trim()
  }
  for (const value of Object.values(labels)) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return fallback
}

export function slugifyAkeneoCode(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 150)
}

export function buildAkeneoFieldsetCode(target: 'product' | 'variant', sourceCode: string | null): string | null {
  if (!sourceCode) return null
  const slug = slugifyAkeneoCode(`akeneo-${target}-${sourceCode}`).replace(/-/g, '_')
  return slug.length > 0 ? slug.slice(0, 80) : null
}

export function safeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function dedupeStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(
    values
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  ))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function normalizeCustomFieldMappings(value: unknown): AkeneoCustomFieldMapping[] {
  if (!Array.isArray(value)) return []
  const normalized: AkeneoCustomFieldMapping[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const attributeCode = readTrimmedString(entry.attributeCode)
    const fieldKey = readTrimmedString(entry.fieldKey)
    const target = entry.target === 'variant' ? 'variant' : entry.target === 'product' ? 'product' : null
    const kind = entry.kind === 'text'
      || entry.kind === 'multiline'
      || entry.kind === 'integer'
      || entry.kind === 'float'
      || entry.kind === 'boolean'
      || entry.kind === 'select'
      ? entry.kind
      : undefined
    const skip = typeof entry.skip === 'boolean' ? entry.skip : false
    if (!attributeCode || !fieldKey || !target) continue
    normalized.push({ attributeCode, fieldKey, target, kind, skip })
  }
  return normalized
}

function normalizePriceMappings(value: unknown): AkeneoPriceMapping[] {
  if (!Array.isArray(value)) return []
  const normalized: AkeneoPriceMapping[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const attributeCode = readTrimmedString(entry.attributeCode)
    const priceKindCode = readTrimmedString(entry.priceKindCode)
    const localChannelCode = readTrimmedString(entry.localChannelCode)
    const akeneoChannel = readTrimmedString(entry.akeneoChannel)
    if (!attributeCode || !priceKindCode || !localChannelCode) continue
    normalized.push({ attributeCode, priceKindCode, localChannelCode, akeneoChannel })
  }
  return normalized
}

function normalizeMediaMappings(value: unknown): AkeneoMediaMapping[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (!isRecord(entry)) return null
      const attributeCode = readTrimmedString(entry.attributeCode)
      const target = entry.target === 'variant' ? 'variant' : entry.target === 'product' ? 'product' : null
      const kind = entry.kind === 'file' ? 'file' : entry.kind === 'image' ? 'image' : null
      if (!attributeCode || !target || !kind) return null
      return { attributeCode, target, kind }
    })
    .filter((entry): entry is AkeneoMediaMapping => Boolean(entry))
}

function normalizeFieldsetMappings(value: unknown): AkeneoFieldsetMapping[] {
  if (!Array.isArray(value)) return []
  const normalized: AkeneoFieldsetMapping[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const sourceType = entry.sourceType === 'familyVariant'
      ? 'familyVariant'
      : entry.sourceType === 'family'
        ? 'family'
        : null
    const sourceCode = readTrimmedString(entry.sourceCode)
    const target = entry.target === 'variant' ? 'variant' : entry.target === 'product' ? 'product' : null
    const fieldsetCode = readTrimmedString(entry.fieldsetCode)
    const fieldsetLabel = readTrimmedString(entry.fieldsetLabel)
    const description = readTrimmedString(entry.description)
    if (!sourceType || !sourceCode || !target || !fieldsetCode || !fieldsetLabel) continue
    normalized.push({
      sourceType,
      sourceCode,
      target,
      fieldsetCode,
      fieldsetLabel,
      description,
    })
  }
  return normalized
}

function normalizeReconciliationSettings(value: unknown, fallback: AkeneoReconciliationSettings): AkeneoReconciliationSettings {
  if (!isRecord(value)) return fallback
  return {
    deactivateMissingCategories: typeof value.deactivateMissingCategories === 'boolean'
      ? value.deactivateMissingCategories
      : fallback.deactivateMissingCategories,
    deactivateMissingProducts: typeof value.deactivateMissingProducts === 'boolean'
      ? value.deactivateMissingProducts
      : fallback.deactivateMissingProducts,
    deactivateMissingAttributes: typeof value.deactivateMissingAttributes === 'boolean'
      ? value.deactivateMissingAttributes
      : fallback.deactivateMissingAttributes,
    deleteMissingOffers: typeof value.deleteMissingOffers === 'boolean'
      ? value.deleteMissingOffers
      : fallback.deleteMissingOffers,
    deleteMissingPrices: typeof value.deleteMissingPrices === 'boolean'
      ? value.deleteMissingPrices
      : fallback.deleteMissingPrices,
    deleteMissingMedia: typeof value.deleteMissingMedia === 'boolean'
      ? value.deleteMissingMedia
      : fallback.deleteMissingMedia,
    deleteMissingAttachments: typeof value.deleteMissingAttachments === 'boolean'
      ? value.deleteMissingAttachments
      : fallback.deleteMissingAttachments,
  }
}

function normalizeAkeneoSettings(
  entityType: AkeneoEntityType,
  raw: unknown,
  fallback: AkeneoMappingSettings | undefined,
): AkeneoMappingSettings | undefined {
  if (!fallback) return undefined
  if (!isRecord(raw)) return fallback

  const normalized: AkeneoMappingSettings = { ...fallback }

  if (entityType === 'products') {
    const productsRaw = isRecord(raw.products) ? raw.products : {}
    const fallbackProducts = fallback.products ?? buildDefaultAkeneoMapping('products').settings?.products
    if (fallbackProducts) {
      normalized.products = {
        locale: readTrimmedString(productsRaw.locale) ?? fallbackProducts.locale,
        channel: readTrimmedString(productsRaw.channel) ?? fallbackProducts.channel,
        channels: Array.isArray(productsRaw.channels)
          ? dedupeStrings(productsRaw.channels as Array<string | null | undefined>)
          : dedupeStrings([
              readTrimmedString(productsRaw.channel),
              ...(fallbackProducts.channels ?? []),
            ]),
        importAllChannels: typeof productsRaw.importAllChannels === 'boolean'
          ? productsRaw.importAllChannels
          : fallbackProducts.importAllChannels,
        fieldMap: {
          title: readTrimmedString(productsRaw.fieldMap && isRecord(productsRaw.fieldMap) ? productsRaw.fieldMap.title : undefined) ?? fallbackProducts.fieldMap.title,
          subtitle: readTrimmedString(productsRaw.fieldMap && isRecord(productsRaw.fieldMap) ? productsRaw.fieldMap.subtitle : undefined) ?? fallbackProducts.fieldMap.subtitle,
          description: readTrimmedString(productsRaw.fieldMap && isRecord(productsRaw.fieldMap) ? productsRaw.fieldMap.description : undefined) ?? fallbackProducts.fieldMap.description,
          sku: readTrimmedString(productsRaw.fieldMap && isRecord(productsRaw.fieldMap) ? productsRaw.fieldMap.sku : undefined) ?? fallbackProducts.fieldMap.sku,
          barcode: readTrimmedString(productsRaw.fieldMap && isRecord(productsRaw.fieldMap) ? productsRaw.fieldMap.barcode : undefined) ?? fallbackProducts.fieldMap.barcode,
          weight: readTrimmedString(productsRaw.fieldMap && isRecord(productsRaw.fieldMap) ? productsRaw.fieldMap.weight : undefined) ?? fallbackProducts.fieldMap.weight,
          variantName: readTrimmedString(productsRaw.fieldMap && isRecord(productsRaw.fieldMap) ? productsRaw.fieldMap.variantName : undefined) ?? fallbackProducts.fieldMap.variantName,
        },
        customFieldMappings: normalizeCustomFieldMappings(productsRaw.customFieldMappings ?? fallbackProducts.customFieldMappings),
        priceMappings: normalizePriceMappings(productsRaw.priceMappings ?? fallbackProducts.priceMappings),
        mediaMappings: normalizeMediaMappings(productsRaw.mediaMappings ?? fallbackProducts.mediaMappings),
        fieldsetMappings: normalizeFieldsetMappings(productsRaw.fieldsetMappings ?? fallbackProducts.fieldsetMappings),
        createMissingChannels: typeof productsRaw.createMissingChannels === 'boolean'
          ? productsRaw.createMissingChannels
          : fallbackProducts.createMissingChannels,
        syncAssociations: typeof productsRaw.syncAssociations === 'boolean'
          ? productsRaw.syncAssociations
          : fallbackProducts.syncAssociations,
        reconciliation: normalizeReconciliationSettings(productsRaw.reconciliation, fallbackProducts.reconciliation),
      }
    }
  }

  if (entityType === 'categories') {
    const categoriesRaw = isRecord(raw.categories) ? raw.categories : {}
    const fallbackCategories = fallback.categories ?? buildDefaultAkeneoMapping('categories').settings?.categories
    if (fallbackCategories) {
      normalized.categories = {
        locale: readTrimmedString(categoriesRaw.locale) ?? fallbackCategories.locale,
      }
    }
  }

  if (entityType === 'attributes') {
    const attributesRaw = isRecord(raw.attributes) ? raw.attributes : {}
    const fallbackAttributes = fallback.attributes ?? buildDefaultAkeneoMapping('attributes').settings?.attributes
    if (fallbackAttributes) {
      normalized.attributes = {
        includeTextAttributes: typeof attributesRaw.includeTextAttributes === 'boolean'
          ? attributesRaw.includeTextAttributes
          : fallbackAttributes.includeTextAttributes,
        includeNumericAttributes: typeof attributesRaw.includeNumericAttributes === 'boolean'
          ? attributesRaw.includeNumericAttributes
          : fallbackAttributes.includeNumericAttributes,
        familyCodeFilter: Array.isArray(attributesRaw.familyCodeFilter)
          ? dedupeStrings(attributesRaw.familyCodeFilter as Array<string | null | undefined>)
          : fallbackAttributes.familyCodeFilter,
      }
    }
  }

  return normalized
}
