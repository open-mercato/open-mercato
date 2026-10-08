import {
  CRUD_FORM_EXTENSION_SURFACES,
  DATA_TABLE_EXTENSION_SURFACES,
} from '@open-mercato/shared/modules/widgets/extension-points'
import {
  BACKEND_ACCESS_DENIED_AFTER_INJECTION_SPOT_ID,
  CrudFormInjectionSpots,
  DataTableInjectionSpots,
  VERSION_HISTORY_ENTRY_AFTER_INJECTION_SPOT_ID,
} from '../spotIds'

describe('standard extension point spot IDs', () => {
  it('keeps every bound DataTable suffix aligned with the runtime helper', () => {
    const tableId = 'catalog.products.list'
    const boundSuffixes = DATA_TABLE_EXTENSION_SURFACES
      .filter((surface) => surface.bound && surface.suffix)
      .map((surface) => surface.suffix)

    expect(boundSuffixes).toEqual([
      'header',
      'footer',
      'toolbar',
      'search-trailing',
      'columns',
      'row-actions',
      'bulk-actions',
      'filters',
    ])
    expect(DataTableInjectionSpots.emptyState(tableId)).toBe('data-table:catalog.products.list:empty-state')
  })

  it('keeps bound CrudForm spots distinct from helper-only spots', () => {
    const entityId = 'catalog.product'
    const boundKeys = CRUD_FORM_EXTENSION_SURFACES
      .filter((surface) => surface.bound)
      .map((surface) => surface.key)

    expect(boundKeys).toEqual(['base', 'header', 'fields', 'replacement'])
    expect(CrudFormInjectionSpots.base(entityId)).toBe('crud-form:catalog.product')
    expect(CrudFormInjectionSpots.header(entityId)).toBe('crud-form:catalog.product:header')
    expect(CrudFormInjectionSpots.fields(entityId)).toBe('crud-form:catalog.product:fields')
  })

  it('keeps the insights host spot ids frozen', () => {
    expect(BACKEND_ACCESS_DENIED_AFTER_INJECTION_SPOT_ID).toBe('backend:access-denied:after')
    expect(VERSION_HISTORY_ENTRY_AFTER_INJECTION_SPOT_ID).toBe('version-history:entry:after')
  })
})
