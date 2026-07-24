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

const ADJUST_REASON_FALLBACKS: Record<string, string> = {
  damaged: 'Damaged',
  shrinkage: 'Shrinkage',
  found: 'Found stock',
  correction: 'Correction',
  other: 'Other',
}

const MOVE_REASON_FALLBACKS: Record<string, string> = {
  transfer: 'Transfer',
  replenishment: 'Replenishment',
  consolidation: 'Consolidation',
  correction: 'Correction',
  other: 'Other',
}

const RELEASE_REASON_FALLBACKS: Record<string, string> = {
  order_cancelled: 'Order cancelled',
  manual_release: 'Manual release',
  correction: 'Correction',
  other: 'Other',
}

const STABLE_REASON_CODE_PATTERN = /^[a-z][a-z0-9_]*$/

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

function translateStableReasonCode(
  code: string,
  movementType: string | null | undefined,
  t: InventoryDisplayTranslator,
): string | null {
  if (code === 'cycle_count') {
    return t('wms.backend.dashboard.activity.reasons.cycleCount', 'Cycle count')
  }

  const type = (movementType ?? '').trim()
  if (type === 'transfer' && code in MOVE_REASON_FALLBACKS) {
    return t(`wms.backend.inventory.move.reasons.${code}`, MOVE_REASON_FALLBACKS[code])
  }
  if ((type === 'adjust' || type === 'cycle_count') && code in ADJUST_REASON_FALLBACKS) {
    return t(`wms.backend.inventory.adjust.reasons.${code}`, ADJUST_REASON_FALLBACKS[code])
  }
  if (code in ADJUST_REASON_FALLBACKS) {
    return t(`wms.backend.inventory.adjust.reasons.${code}`, ADJUST_REASON_FALLBACKS[code])
  }
  if (code in MOVE_REASON_FALLBACKS) {
    return t(`wms.backend.inventory.move.reasons.${code}`, MOVE_REASON_FALLBACKS[code])
  }
  if (code in RELEASE_REASON_FALLBACKS) {
    return t(`wms.backend.inventory.release.reasons.${code}`, RELEASE_REASON_FALLBACKS[code])
  }
  return null
}

/**
 * Resolve a movement/activity reason for display. Prefers the stable
 * `reasonCode` (re-translated for the current locale) over a free-text
 * `reason` that may have been baked in a different language at write time.
 */
export function inventoryMovementReasonLabel(
  input: {
    reasonCode?: string | null
    reason?: string | null
    movementType?: string | null
  },
  t: InventoryDisplayTranslator,
): string | null {
  const reasonCode = input.reasonCode?.trim() || null
  const reason = input.reason?.trim() || null
  const candidateCode =
    reasonCode ||
    (reason && STABLE_REASON_CODE_PATTERN.test(reason) ? reason : null)

  if (candidateCode) {
    const translated = translateStableReasonCode(candidateCode, input.movementType, t)
    if (translated) return translated
  }

  return reason
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
