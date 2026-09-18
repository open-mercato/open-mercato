import fs from 'node:fs'
import path from 'node:path'
import { formatEntityId, resolveEntityTypeLabel } from '../entityTypeLabel'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

function loadModuleDictionary(relativeI18nDir: string): Record<string, string> {
  const filePath = path.join(__dirname, relativeI18nDir, 'en.json')
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

describe('formatEntityId', () => {
  it('humanizes module · entity', () => {
    expect(formatEntityId('customers:customer_person_profile')).toBe('Customers · Customer Person Profile')
  })
  it('humanizes a bare segment', () => {
    expect(formatEntityId('messages')).toBe('Messages')
  })
})

describe('resolveEntityTypeLabel', () => {
  const t: TranslateFn = (key, fallbackOrParams) =>
    key === 'search.entityType.sales.sales_order'
      ? 'Order'
      : (typeof fallbackOrParams === 'string' ? fallbackOrParams : key)

  it('returns the translated label when a key exists', () => {
    expect(resolveEntityTypeLabel(t, 'sales:sales_order')).toBe('Order')
  })
  it('falls back to the humanized string for unknown entity types', () => {
    expect(resolveEntityTypeLabel(t, 'thirdparty:widget_thing')).toBe('Thirdparty · Widget Thing')
  })
})

// Regression coverage for https://github.com/open-mercato/open-mercato/issues/6006:
// wms, eudr and documents shipped no `search.entityType.<module>.<entity>` keys,
// so their chips silently fell back to a humanized id instead of the real label.
// This loads each module's real `en.json` (not a mock) so a missing/renamed key
// fails here instead of only being visible in the rendered UI.
describe('resolveEntityTypeLabel against the real module dictionaries', () => {
  const merged: Record<string, string> = {
    ...loadModuleDictionary('../../../../../../../core/src/modules/wms/i18n'),
    ...loadModuleDictionary('../../../../../../../core/src/modules/eudr/i18n'),
    ...loadModuleDictionary('../../../../../../../documents/src/modules/documents/i18n'),
  }
  const t: TranslateFn = (key, fallbackOrParams) =>
    key in merged ? merged[key] : (typeof fallbackOrParams === 'string' ? fallbackOrParams : key)

  it.each([
    ['wms:warehouse', 'Warehouse'],
    ['wms:warehouse_location', 'Location'],
    ['wms:product_inventory_profile', 'Inventory profile'],
    ['wms:inventory_lot', 'Inventory lot'],
    ['eudr:eudr_due_diligence_statement', 'DDS statement'],
    ['eudr:eudr_plot', 'Plot'],
    ['eudr:eudr_evidence_submission', 'Evidence submission'],
    ['documents:document', 'Document'],
  ])('resolves %s to its localized label, not a humanized fallback', (entityId, expectedLabel) => {
    const resolved = resolveEntityTypeLabel(t, entityId)
    expect(resolved).toBe(expectedLabel)
    expect(resolved).not.toBe(formatEntityId(entityId))
  })
})
