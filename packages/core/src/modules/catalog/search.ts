import type { SearchBuildContext, SearchIndexSource, SearchModuleConfig, SearchResultPresenter } from '@open-mercato/shared/modules/search'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

const CATALOG_PRODUCTS_URL = '/backend/catalog/products'
const CATALOG_CATEGORIES_URL = '/backend/catalog/categories'
const CATALOG_CONFIG_URL = '/backend/config/catalog'

function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function pickText(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    const text = normalizeText(candidate)
    if (text) return text
  }
  return null
}

function readRecordText(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const text = normalizeText(record[key])
    if (text) return text
  }
  return null
}

function formatSubtitle(...parts: Array<unknown>): string | undefined {
  const text = parts
    .map((part) => normalizeText(part))
    .filter((value): value is string => Boolean(value))
  if (!text.length) return undefined
  return text.join(' · ')
}

function snippet(value: unknown, maxLength = 140): string | undefined {
  const text = normalizeText(value)
  if (!text) return undefined
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 3)}...`
}

function appendLine(lines: string[], label: string, value: unknown) {
  if (value === null || value === undefined) return
  const text = Array.isArray(value)
    ? value.map((item) => normalizeText(item)).filter(Boolean).join(', ')
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value)
  if (!text.trim()) return
  lines.push(`${label}: ${text}`)
}

function friendlyLabel(input: string): string {
  return input
    .replace(/^cf:/, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, (_match, firstChar, secondChar) => `${firstChar} ${secondChar}`)
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function appendCustomFieldLines(lines: string[], customFields: Record<string, unknown>) {
  for (const [key, value] of Object.entries(customFields)) {
    if (value === null || value === undefined) continue
    appendLine(lines, friendlyLabel(key), value)
  }
}

function buildIndexSource(
  ctx: SearchBuildContext,
  presenter: SearchResultPresenter,
  lines: string[],
): SearchIndexSource | null {
  appendCustomFieldLines(lines, ctx.customFields)
  if (!lines.length) return null
  return {
    text: lines,
    presenter,
    checksumSource: { record: ctx.record, customFields: ctx.customFields },
  }
}

function buildProductUrl(productId: string | null): string | null {
  if (!productId) return null
  return `${CATALOG_PRODUCTS_URL}/${encodeURIComponent(productId)}`
}

function buildVariantUrl(productId: string | null, variantId: string | null): string | null {
  if (!productId || !variantId) return null
  return `${CATALOG_PRODUCTS_URL}/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`
}

function buildCategoryUrl(categoryId: string | null): string | null {
  if (!categoryId) return null
  return `${CATALOG_CATEGORIES_URL}/${encodeURIComponent(categoryId)}/edit`
}

function resolveProductId(record: Record<string, unknown>): string | null {
  // Check direct FK fields first
  const directId = readRecordText(record, 'product_id', 'productId')
  if (directId) return directId
  // Check if product is a string (FK value)
  const product = record.product
  if (typeof product === 'string') return product
  // Check if product is an object with id
  if (product && typeof product === 'object') {
    const productObj = product as Record<string, unknown>
    return readRecordText(productObj, 'id')
  }
  return null
}

function buildProductPresenter(
  translate: TranslateFn,
  record: Record<string, unknown>,
): SearchResultPresenter {
  const label = translate('catalog.search.badge.product', 'Product')
  const title = pickText(
    readRecordText(record, 'title'),
    readRecordText(record, 'sku'),
    readRecordText(record, 'handle'),
    readRecordText(record, 'id'),
  ) ?? label
  const isActive = record.is_active ?? record.isActive
  const statusText = isActive === false ? translate('catalog.search.status.inactive', 'Inactive') : null
  const subtitle = formatSubtitle(
    readRecordText(record, 'subtitle'),
    readRecordText(record, 'sku'),
    readRecordText(record, 'product_type', 'productType'),
    statusText,
  ) ?? snippet(readRecordText(record, 'description'))
  return { title, subtitle, icon: 'package', badge: label }
}

function buildVariantPresenter(
  translate: TranslateFn,
  record: Record<string, unknown>,
): SearchResultPresenter {
  const label = translate('catalog.search.badge.variant', 'Variant')
  const isDefault = record.is_default ?? record.isDefault
  const defaultLabel = isDefault ? translate('catalog.search.variant.default', 'Default') : null
  const title = pickText(
    readRecordText(record, 'name'),
    readRecordText(record, 'sku'),
    defaultLabel,
    readRecordText(record, 'id'),
  ) ?? label
  const isActive = record.is_active ?? record.isActive
  const statusText = isActive === false ? translate('catalog.search.status.inactive', 'Inactive') : null
  const subtitle = formatSubtitle(
    readRecordText(record, 'sku'),
    readRecordText(record, 'barcode'),
    defaultLabel,
    statusText,
  )
  return { title, subtitle, icon: 'box', badge: label }
}

function buildCategoryPresenter(
  translate: TranslateFn,
  record: Record<string, unknown>,
): SearchResultPresenter {
  const label = translate('catalog.search.badge.category', 'Category')
  const title = pickText(
    readRecordText(record, 'name'),
    readRecordText(record, 'slug'),
    readRecordText(record, 'id'),
  ) ?? label
  const isActive = record.is_active ?? record.isActive
  const statusText = isActive === false ? translate('catalog.search.status.inactive', 'Inactive') : null
  const subtitle = formatSubtitle(
    readRecordText(record, 'tree_path', 'treePath'),
    readRecordText(record, 'slug'),
    statusText,
  ) ?? snippet(readRecordText(record, 'description'))
  return { title, subtitle, icon: 'folder-tree', badge: label }
}

function buildOfferPresenter(
  translate: TranslateFn,
  record: Record<string, unknown>,
  channelName?: string | null,
): SearchResultPresenter {
  const label = translate('catalog.search.badge.offer', 'Channel Offer')
  const channelLabel = channelName ?? readRecordText(record, 'channel_name', 'channelName')
  const title = pickText(
    readRecordText(record, 'title'),
    readRecordText(record, 'id'),
  ) ?? label
  const titleWithChannel = channelLabel ? `${title} · ${channelLabel}` : title
  const isActive = record.is_active ?? record.isActive
  const statusText = isActive === false ? translate('catalog.search.status.inactive', 'Inactive') : null
  const subtitle = formatSubtitle(statusText) ?? snippet(readRecordText(record, 'description'))
  return { title: titleWithChannel, subtitle, icon: 'store', badge: label }
}

function buildTagPresenter(
  translate: TranslateFn,
  record: Record<string, unknown>,
): SearchResultPresenter {
  const label = translate('catalog.search.badge.tag', 'Tag')
  const title = pickText(
    readRecordText(record, 'label'),
    readRecordText(record, 'slug'),
    readRecordText(record, 'id'),
  ) ?? label
  const subtitle = formatSubtitle(readRecordText(record, 'slug'))
  return { title, subtitle, icon: 'tag', badge: label }
}

function buildPriceKindPresenter(
  translate: TranslateFn,
  record: Record<string, unknown>,
): SearchResultPresenter {
  const label = translate('catalog.search.badge.priceKind', 'Price Kind')
  const title = pickText(
    readRecordText(record, 'title'),
    readRecordText(record, 'code'),
    readRecordText(record, 'id'),
  ) ?? label
  const displayMode = readRecordText(record, 'display_mode', 'displayMode')
  const isPromotion = record.is_promotion ?? record.isPromotion
  const promotionLabel = isPromotion ? translate('catalog.search.priceKind.promotion', 'Promotion') : null
  const displayModeLabel = displayMode === 'including-tax'
    ? translate('catalog.search.priceKind.includingTax', 'Incl. tax')
    : displayMode === 'excluding-tax'
      ? translate('catalog.search.priceKind.excludingTax', 'Excl. tax')
      : null
  const subtitle = formatSubtitle(
    readRecordText(record, 'code'),
    displayModeLabel,
    promotionLabel,
  )
  return { title, subtitle, icon: 'dollar-sign', badge: label }
}

function buildOptionSchemaPresenter(
  translate: TranslateFn,
  record: Record<string, unknown>,
): SearchResultPresenter {
  const label = translate('catalog.search.badge.optionSchema', 'Option Schema')
  const title = pickText(
    readRecordText(record, 'name'),
    readRecordText(record, 'code'),
    readRecordText(record, 'id'),
  ) ?? label
  const isActive = record.is_active ?? record.isActive
  const statusText = isActive === false ? translate('catalog.search.status.inactive', 'Inactive') : null
  const subtitle = formatSubtitle(
    readRecordText(record, 'code'),
    statusText,
  ) ?? snippet(readRecordText(record, 'description'))
  return { title, subtitle, icon: 'settings', badge: label }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'catalog:catalog_product',
      enabled: true,
      priority: 10,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Title', record.title)
        appendLine(lines, 'Subtitle', record.subtitle)
        appendLine(lines, 'Description', record.description)
        appendLine(lines, 'SKU', record.sku)
        appendLine(lines, 'Handle', record.handle)
        appendLine(lines, 'Product type', record.product_type ?? record.productType)
        appendLine(lines, 'Base unit', record.default_unit ?? record.defaultUnit)
        appendLine(lines, 'Default sales unit', record.default_sales_unit ?? record.defaultSalesUnit)
        appendLine(
          lines,
          'Default sales quantity',
          record.default_sales_unit_quantity ?? record.defaultSalesUnitQuantity,
        )
        appendLine(lines, 'UoM rounding mode', record.uom_rounding_mode ?? record.uomRoundingMode)
        appendLine(lines, 'UoM rounding scale', record.uom_rounding_scale ?? record.uomRoundingScale)
        appendLine(lines, 'Unit price enabled', record.unit_price_enabled ?? record.unitPriceEnabled)
        appendLine(
          lines,
          'Unit price reference unit',
          record.unit_price_reference_unit ?? record.unitPriceReferenceUnit,
        )
        appendLine(
          lines,
          'Unit price base quantity',
          record.unit_price_base_quantity ?? record.unitPriceBaseQuantity,
        )
        return buildIndexSource(ctx, buildProductPresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildProductPresenter(translate, ctx.record)
      },
      resolveUrl: async (ctx) => buildProductUrl(readRecordText(ctx.record, 'id')),
      fieldPolicy: {
        searchable: [
          'title',
          'subtitle',
          'description',
          'sku',
          'handle',
          'product_type',
          'default_unit',
          'default_sales_unit',
          'unit_price_reference_unit',
        ],
        excluded: ['metadata', 'dimensions', 'tax_rate_id'],
      },
    },
    {
      entityId: 'catalog:catalog_product_variant',
      enabled: true,
      priority: 8,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.name)
        appendLine(lines, 'SKU', record.sku)
        appendLine(lines, 'Barcode', record.barcode)
        appendLine(lines, 'Option values', record.option_values ?? record.optionValues)
        return buildIndexSource(ctx, buildVariantPresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildVariantPresenter(translate, ctx.record)
      },
      resolveUrl: async (ctx) => {
        const productId = resolveProductId(ctx.record)
        const variantId = readRecordText(ctx.record, 'id')
        return buildVariantUrl(productId, variantId)
      },
      fieldPolicy: {
        searchable: ['name', 'sku', 'barcode'],
        excluded: ['metadata', 'dimensions', 'option_values', 'tax_rate_id'],
      },
    },
    {
      entityId: 'catalog:catalog_product_category',
      enabled: true,
      priority: 7,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.name)
        appendLine(lines, 'Slug', record.slug)
        appendLine(lines, 'Description', record.description)
        appendLine(lines, 'Path', record.tree_path ?? record.treePath)
        return buildIndexSource(ctx, buildCategoryPresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildCategoryPresenter(translate, ctx.record)
      },
      resolveUrl: async (ctx) => buildCategoryUrl(readRecordText(ctx.record, 'id')),
      fieldPolicy: {
        searchable: ['name', 'slug', 'description', 'tree_path'],
        excluded: ['metadata', 'ancestor_ids', 'child_ids', 'descendant_ids'],
      },
    },
    {
      entityId: 'catalog:catalog_offer',
      enabled: true,
      priority: 7,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Title', record.title)
        appendLine(lines, 'Description', record.description)
        appendLine(lines, 'Channel', record.channel_id ?? record.channelId)
        return buildIndexSource(ctx, buildOfferPresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildOfferPresenter(translate, ctx.record)
      },
      resolveUrl: async (ctx) => {
        const productId = resolveProductId(ctx.record)
        return buildProductUrl(productId)
      },
      fieldPolicy: {
        searchable: ['title', 'description'],
        excluded: ['metadata'],
      },
    },
    {
      entityId: 'catalog:catalog_product_tag',
      enabled: true,
      priority: 5,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Label', record.label)
        appendLine(lines, 'Slug', record.slug)
        return buildIndexSource(ctx, buildTagPresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildTagPresenter(translate, ctx.record)
      },
      resolveUrl: async () => CATALOG_PRODUCTS_URL,
      fieldPolicy: {
        searchable: ['label', 'slug'],
      },
    },
    {
      entityId: 'catalog:catalog_price_kind',
      enabled: true,
      priority: 4,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Title', record.title)
        appendLine(lines, 'Code', record.code)
        appendLine(lines, 'Display mode', record.display_mode ?? record.displayMode)
        appendLine(lines, 'Currency', record.currency_code ?? record.currencyCode)
        return buildIndexSource(ctx, buildPriceKindPresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildPriceKindPresenter(translate, ctx.record)
      },
      resolveUrl: async () => CATALOG_CONFIG_URL,
      fieldPolicy: {
        searchable: ['title', 'code'],
      },
    },
    {
      entityId: 'catalog:catalog_product_unit_conversion',
      enabled: true,
      priority: 3,
      buildSource: async (ctx) => {
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Unit code', record.unit_code ?? record.unitCode)
        appendLine(lines, 'To base factor', record.to_base_factor ?? record.toBaseFactor)
        appendLine(lines, 'Sort order', record.sort_order ?? record.sortOrder)
        const isActive = record.is_active ?? record.isActive
        appendLine(lines, 'Active', isActive)
        return lines.length
          ? { text: lines, checksumSource: { record: ctx.record, customFields: ctx.customFields } }
          : null
      },
      resolveUrl: async (ctx) => {
        const productId = resolveProductId(ctx.record)
        return buildProductUrl(productId)
      },
      fieldPolicy: {
        searchable: ['unit_code'],
      },
    },
    {
      entityId: 'catalog:catalog_option_schema_template',
      enabled: true,
      priority: 4,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.name)
        appendLine(lines, 'Code', record.code)
        appendLine(lines, 'Description', record.description)
        return buildIndexSource(ctx, buildOptionSchemaPresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildOptionSchemaPresenter(translate, ctx.record)
      },
      resolveUrl: async () => CATALOG_CONFIG_URL,
      fieldPolicy: {
        searchable: ['name', 'code', 'description'],
        excluded: ['schema', 'metadata'],
      },
    },
  ],
}

export default searchConfig
export const config = searchConfig
