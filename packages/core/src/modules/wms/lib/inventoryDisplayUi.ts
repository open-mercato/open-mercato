import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { parseInventoryQuantity } from './inventoryMutationUi'

export type InventoryDisplayTranslator = TranslateFn

const MOVEMENT_TYPE_FALLBACKS: Record<string, string> = {
  receipt: 'Receive',
  return_receive: 'Receive',
  adjust: 'Adjust',
  transfer: 'Move',
  pick: 'Allocate',
  pack: 'Allocate',
  cycle_count: 'Reconcile',
  putaway: 'Putaway',
  ship: 'Ship',
}

const RESERVATION_SOURCE_TYPE_FALLBACKS: Record<string, string> = {
  order: 'Sales order',
  transfer: 'Transfer',
  manual: 'Manual',
}

const REFERENCE_TYPE_FALLBACKS: Record<string, string> = {
  po: 'Purchase order',
  so: 'Sales order',
  transfer: 'Transfer',
  manual: 'Manual',
  qc: 'Quality control',
  rma: 'RMA',
}

const RESERVATION_STATUS_FALLBACKS: Record<string, string> = {
  active: 'Active',
  released: 'Released',
  fulfilled: 'Fulfilled',
}

const ROTATION_STRATEGY_FALLBACKS: Record<string, string> = {
  fifo: 'FIFO',
  lifo: 'LIFO',
  fefo: 'FEFO',
}

export function createInventoryQuantityFormatter(locale: string): Intl.NumberFormat {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })
}

export function formatInventoryQuantity(
  value: string | number | null | undefined,
  formatter: Intl.NumberFormat,
): string {
  return formatter.format(parseInventoryQuantity(value))
}

export function createInventoryDateTimeFormatter(
  locale: string,
  options: Intl.DateTimeFormatOptions = {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  },
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, options)
}

export function formatInventoryDateTime(
  value: string | null | undefined,
  formatter: Intl.DateTimeFormat,
): string {
  if (!value?.trim()) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return formatter.format(date)
}

export function inventoryMovementTypeLabel(type: string, t: InventoryDisplayTranslator): string {
  const normalized = type.trim()
  if (!normalized) return '—'
  return t(
    `wms.backend.dashboard.activity.types.${normalized}`,
    MOVEMENT_TYPE_FALLBACKS[normalized] ?? normalized,
  )
}

export function inventoryReservationSourceTypeLabel(
  sourceType: string,
  t: InventoryDisplayTranslator,
): string {
  const normalized = sourceType.trim()
  if (!normalized) return '—'
  return t(
    `wms.backend.inventory.sourceTypes.${normalized}`,
    RESERVATION_SOURCE_TYPE_FALLBACKS[normalized] ?? normalized,
  )
}

export function inventoryReferenceTypeLabel(
  referenceType: string,
  t: InventoryDisplayTranslator,
): string {
  const normalized = referenceType.trim()
  if (!normalized) return '—'
  return t(
    `wms.backend.inventory.referenceTypes.${normalized}`,
    REFERENCE_TYPE_FALLBACKS[normalized] ?? normalized,
  )
}

export function inventoryReservationStatusLabel(status: string, t: InventoryDisplayTranslator): string {
  const normalized = status.trim()
  if (!normalized) return '—'
  return t(
    `wms.backend.inventory.reservationStatuses.${normalized}`,
    RESERVATION_STATUS_FALLBACKS[normalized] ?? normalized,
  )
}

export function inventoryRotationStrategyLabel(strategy: string, t: InventoryDisplayTranslator): string {
  const normalized = strategy.trim()
  if (!normalized) return '—'
  return t(
    `wms.widgets.catalog.inventoryProfile.strategy.${normalized}`,
    ROTATION_STRATEGY_FALLBACKS[normalized] ?? normalized,
  )
}

export function formatCatalogProductLabel(row: {
  product_title?: string | null
  product_sku?: string | null
  catalog_product_id?: string | null
}): string {
  const title = (row.product_title ?? '').trim()
  const sku = (row.product_sku ?? '').trim()
  if (title && sku) return `${title} (${sku})`
  if (title) return title
  if (sku) return sku
  return row.catalog_product_id?.trim() || '—'
}

export function formatCatalogVariantLabel(row: {
  variant_name?: string | null
  variant_sku?: string | null
  catalog_variant_id?: string | null
}): string {
  const name = (row.variant_name ?? '').trim()
  const sku = (row.variant_sku ?? '').trim()
  if (name && sku) return `${name} (${sku})`
  if (name) return name
  if (sku) return sku
  return row.catalog_variant_id?.trim() || '—'
}

export function formatReservationSourceLabel(
  row: {
    source_type?: string | null
    source_id?: string | null
    source_label?: string | null
  },
  t: InventoryDisplayTranslator,
): string {
  const sourceType = row.source_type?.trim()
  if (!sourceType) return '—'
  const typeLabel = inventoryReservationSourceTypeLabel(sourceType, t)
  const sourceLabel = row.source_label?.trim()
  if (sourceLabel) return `${typeLabel} · ${sourceLabel}`
  return typeLabel
}
