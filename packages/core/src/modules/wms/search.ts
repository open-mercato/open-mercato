import type {
  SearchBuildContext,
  SearchIndexSource,
  SearchModuleConfig,
  SearchResultPresenter,
} from '@open-mercato/shared/modules/search'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'

const WMS_OVERVIEW_URL = '/backend/wms'
const WMS_INVENTORY_URL = '/backend/wms/inventory'
const WMS_CONFIG_URL = '/backend/config/wms'

function pickString(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const trimmed = candidate.trim()
    if (trimmed.length > 0) return trimmed
  }
  return null
}

function appendLine(lines: string[], label: string, value: unknown) {
  if (value === null || value === undefined) return
  const text = Array.isArray(value)
    ? value.map((item) => (item == null ? '' : String(item))).filter(Boolean).join(', ')
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value)
  if (!text.trim()) return
  lines.push(`${label}: ${text}`)
}

function formatSubtitle(...parts: Array<unknown>): string | undefined {
  const values = parts
    .map((part) => (part == null ? '' : String(part)).trim())
    .filter(Boolean)
  if (!values.length) return undefined
  return values.join(' · ')
}

function buildIndexSource(
  ctx: SearchBuildContext,
  presenter: SearchResultPresenter,
  lines: string[],
): SearchIndexSource | null {
  for (const [key, value] of Object.entries(ctx.customFields)) {
    appendLine(lines, key.replace(/^cf:/, ''), value)
  }
  if (!lines.length) return null
  return {
    text: lines,
    presenter,
    checksumSource: { record: ctx.record, customFields: ctx.customFields },
  }
}

function buildWarehousePresenter(
  t: TranslateFn,
  record: Record<string, unknown>,
): SearchResultPresenter {
  const label = t('wms.search.badge.warehouse', 'Warehouse')
  const title = pickString(record.name, record.code, record.id) ?? label
  const subtitle = formatSubtitle(record.code, record.city, record.country)
  return { title, subtitle, icon: 'warehouse', badge: label }
}

function buildLocationPresenter(
  t: TranslateFn,
  record: Record<string, unknown>,
): SearchResultPresenter {
  const label = t('wms.search.badge.location', 'Location')
  const title = pickString(record.code, record.id) ?? label
  const subtitle = formatSubtitle(record.type, record.warehouse_id ?? record.warehouseId)
  return { title, subtitle, icon: 'map-pinned', badge: label }
}

function buildInventoryProfilePresenter(
  t: TranslateFn,
  record: Record<string, unknown>,
): SearchResultPresenter {
  const label = t('wms.search.badge.inventoryProfile', 'Inventory profile')
  const productId = pickString(record.catalog_product_id, record.catalogProductId)
  const variantId = pickString(record.catalog_variant_id, record.catalogVariantId)
  const title = variantId || productId || pickString(record.id) || label
  const subtitle = formatSubtitle(
    record.default_strategy ?? record.defaultStrategy,
    record.default_uom ?? record.defaultUom,
    variantId ? t('wms.search.profile.variantScoped', 'Variant-scoped') : t('wms.search.profile.productScoped', 'Product-scoped'),
  )
  return { title, subtitle, icon: 'boxes', badge: label }
}

function buildLotPresenter(
  t: TranslateFn,
  record: Record<string, unknown>,
): SearchResultPresenter {
  const label = t('wms.search.badge.lot', 'Inventory lot')
  const title = pickString(record.lot_number, record.lotNumber, record.batch_number, record.batchNumber, record.id) ?? label
  const subtitle = formatSubtitle(record.catalog_variant_id ?? record.catalogVariantId, record.status, record.expires_at ?? record.expiresAt)
  return { title, subtitle, icon: 'package-search', badge: label }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: E.wms.warehouse,
      enabled: true,
      priority: 8,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.name)
        appendLine(lines, 'Code', record.code)
        appendLine(lines, 'City', record.city)
        appendLine(lines, 'Country', record.country)
        appendLine(lines, 'Timezone', record.timezone)
        return buildIndexSource(ctx, buildWarehousePresenter(t, record), lines)
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return buildWarehousePresenter(t, ctx.record)
      },
      resolveUrl: async () => WMS_CONFIG_URL,
      fieldPolicy: {
        searchable: ['name', 'code', 'city', 'country', 'timezone'],
      },
    },
    {
      entityId: E.wms.warehouse_location,
      enabled: true,
      priority: 7,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Code', record.code)
        appendLine(lines, 'Type', record.type)
        appendLine(lines, 'Warehouse', record.warehouse_id ?? record.warehouseId)
        appendLine(lines, 'Parent', record.parent_id ?? record.parentId)
        appendLine(lines, 'Capacity units', record.capacity_units ?? record.capacityUnits)
        appendLine(lines, 'Capacity weight', record.capacity_weight ?? record.capacityWeight)
        return buildIndexSource(ctx, buildLocationPresenter(t, record), lines)
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return buildLocationPresenter(t, ctx.record)
      },
      resolveUrl: async () => WMS_CONFIG_URL,
      fieldPolicy: {
        searchable: ['code', 'type', 'warehouse_id', 'parent_id', 'capacity_units', 'capacity_weight'],
      },
    },
    {
      entityId: E.wms.product_inventory_profile,
      enabled: true,
      priority: 8,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Product', record.catalog_product_id ?? record.catalogProductId)
        appendLine(lines, 'Variant', record.catalog_variant_id ?? record.catalogVariantId)
        appendLine(lines, 'Default UOM', record.default_uom ?? record.defaultUom)
        appendLine(lines, 'Strategy', record.default_strategy ?? record.defaultStrategy)
        appendLine(lines, 'Reorder point', record.reorder_point ?? record.reorderPoint)
        appendLine(lines, 'Safety stock', record.safety_stock ?? record.safetyStock)
        appendLine(lines, 'Track lot', record.track_lot ?? record.trackLot)
        appendLine(lines, 'Track serial', record.track_serial ?? record.trackSerial)
        appendLine(lines, 'Track expiration', record.track_expiration ?? record.trackExpiration)
        return buildIndexSource(ctx, buildInventoryProfilePresenter(t, record), lines)
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return buildInventoryProfilePresenter(t, ctx.record)
      },
      resolveUrl: async () => WMS_CONFIG_URL,
      resolveLinks: async () => [{ href: WMS_INVENTORY_URL, label: 'Inventory console', kind: 'secondary' }],
      fieldPolicy: {
        searchable: [
          'catalog_product_id',
          'catalog_variant_id',
          'default_uom',
          'default_strategy',
          'reorder_point',
          'safety_stock',
        ],
      },
    },
    {
      entityId: E.wms.inventory_lot,
      enabled: true,
      priority: 6,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Lot number', record.lot_number ?? record.lotNumber)
        appendLine(lines, 'Batch number', record.batch_number ?? record.batchNumber)
        appendLine(lines, 'SKU', record.sku)
        appendLine(lines, 'Variant', record.catalog_variant_id ?? record.catalogVariantId)
        appendLine(lines, 'Status', record.status)
        appendLine(lines, 'Expires at', record.expires_at ?? record.expiresAt)
        return buildIndexSource(ctx, buildLotPresenter(t, record), lines)
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return buildLotPresenter(t, ctx.record)
      },
      resolveUrl: async () => WMS_OVERVIEW_URL,
      resolveLinks: async () => [{ href: WMS_CONFIG_URL, label: 'WMS configuration', kind: 'secondary' }],
      fieldPolicy: {
        searchable: ['lot_number', 'batch_number', 'sku', 'catalog_variant_id', 'status', 'expires_at'],
      },
    },
  ],
}

export default searchConfig
export const config = searchConfig
