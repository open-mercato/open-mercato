/** @jest-environment node */

type CapturedListOptions = { sortFieldMap?: Record<string, unknown> }

const capturedListOptions: CapturedListOptions[] = []

jest.mock('@open-mercato/shared/lib/crud/factory', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/crud/factory')
  return {
    ...actual,
    makeCrudRoute: (options: { list?: CapturedListOptions }) => {
      capturedListOptions.push(options.list ?? {})
      return actual.makeCrudRoute(options)
    },
  }
})

function loadSortFieldMap(load: () => unknown): Record<string, unknown> {
  const before = capturedListOptions.length
  load()
  const list = capturedListOptions[before]
  expect(list).toBeDefined()
  return list?.sortFieldMap ?? {}
}

const cases: Array<{ name: string; load: () => unknown; expected: Record<string, string> }> = [
  {
    name: 'warehouses',
    load: () => require('../warehouses/route'),
    expected: {
      name: 'name',
      code: 'code',
      city: 'city',
      country: 'country',
      is_primary: 'is_primary',
      is_active: 'is_active',
    },
  },
  {
    name: 'locations',
    load: () => require('../locations/route'),
    expected: { code: 'code', type: 'type', capacity_units: 'capacity_units', is_active: 'is_active' },
  },
  {
    name: 'inventory profiles',
    load: () => require('../inventory-profiles/route'),
    expected: {
      catalog_product_id: 'catalog_product_id',
      catalog_variant_id: 'catalog_variant_id',
      default_uom: 'default_uom',
      defaultStrategy: 'default_strategy',
      reorderPoint: 'reorder_point',
      safetyStock: 'safety_stock',
    },
  },
  {
    name: 'inventory reservations',
    load: () => require('../inventory/reservations/route'),
    expected: {
      catalog_variant_id: 'catalog_variant_id',
      warehouse_id: 'warehouse_id',
      quantity: 'quantity',
      source_type: 'source_type',
      status: 'status',
    },
  },
  {
    name: 'inventory movements',
    load: () => require('../inventory/movements/route'),
    expected: {
      type: 'type',
      catalog_variant_id: 'catalog_variant_id',
      warehouse_id: 'warehouse_id',
      quantity: 'quantity',
      reference_type: 'reference_type',
      performed_at: 'performed_at',
    },
  },
  {
    name: 'putaway tasks',
    load: () => require('../putaway-tasks/route'),
    expected: { status: 'status', quantity: 'quantity', serial: 'serial_number', createdAt: 'created_at' },
  },
]

describe('wms list routes accept every sort key their DataTables send (#9548)', () => {
  it.each(cases)('$name sortFieldMap covers the UI column ids', ({ load, expected }) => {
    const sortFieldMap = loadSortFieldMap(load)
    for (const [key, column] of Object.entries(expected)) {
      expect(Object.hasOwn(sortFieldMap, key)).toBe(true)
      expect(sortFieldMap[key]).toBe(column)
    }
  })
})
