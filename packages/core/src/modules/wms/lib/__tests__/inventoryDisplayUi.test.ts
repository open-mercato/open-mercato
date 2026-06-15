import {
  createInventoryQuantityFormatter,
  formatCatalogProductLabel,
  formatCatalogVariantLabel,
  formatInventoryDateTime,
  formatInventoryQuantity,
  formatReservationSourceLabel,
  inventoryMovementTypeLabel,
  inventoryReferenceTypeLabel,
  inventoryReservationSourceTypeLabel,
  inventoryReservationStatusLabel,
} from '../inventoryDisplayUi'

describe('inventoryDisplayUi', () => {
  const t = (key: string, fallback?: string) => fallback ?? key

  it('formats inventory quantities with locale-aware grouping and trimmed decimals', () => {
    const formatter = createInventoryQuantityFormatter('en-US')
    expect(formatInventoryQuantity(5, formatter)).toBe('5')
    expect(formatInventoryQuantity('5.0000', formatter)).toBe('5')
    expect(formatInventoryQuantity('5.25', formatter)).toBe('5.25')
  })

  it('formats inventory date-times and rejects invalid values', () => {
    const formatter = new Intl.DateTimeFormat('en-US', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    const formatted = formatInventoryDateTime('2026-06-15T14:30:00.000Z', formatter)
    expect(formatted).not.toBe('—')
    expect(formatInventoryDateTime(null, formatter)).toBe('—')
    expect(formatInventoryDateTime('not-a-date', formatter)).toBe('—')
  })

  it('builds catalog labels from enriched fields', () => {
    expect(formatCatalogProductLabel({
      product_title: 'Widget',
      product_sku: 'W-1',
      catalog_product_id: 'prod-1',
    })).toBe('Widget (W-1)')
    expect(formatCatalogVariantLabel({
      variant_name: 'Red',
      variant_sku: 'RED-1',
      catalog_variant_id: 'var-1',
    })).toBe('Red (RED-1)')
  })

  it('translates movement, reference, reservation, and source labels', () => {
    expect(inventoryMovementTypeLabel('transfer', t)).toBe('Move')
    expect(inventoryReferenceTypeLabel('so', t)).toBe('Sales order')
    expect(inventoryReservationStatusLabel('active', t)).toBe('Active')
    expect(inventoryReservationSourceTypeLabel('order', t)).toBe('Sales order')
  })

  it('formats reservation source without exposing raw UUIDs', () => {
    expect(formatReservationSourceLabel({
      source_type: 'order',
      source_id: '00000000-0000-4000-8000-000000000001',
      source_label: 'SO-1042',
    }, t)).toBe('Sales order · SO-1042')
    expect(formatReservationSourceLabel({
      source_type: 'manual',
      source_id: '00000000-0000-4000-8000-000000000001',
    }, t)).toBe('Manual')
  })
})
