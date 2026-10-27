import { z } from 'zod'

const makeCrudRouteMock = jest.fn(() => ({
  GET: jest.fn(),
  POST: jest.fn(),
  PUT: jest.fn(),
  DELETE: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: (...args: unknown[]) => makeCrudRouteMock(...(args as [])),
}))

import { makeSalesLineRoute } from '../makeSalesLineRoute'

const fieldConstants = {
  id: 'id',
  order_id: 'order_id',
  line_number: 'line_number',
  kind: 'kind',
  status_entry_id: 'status_entry_id',
  status: 'status',
  product_id: 'product_id',
  product_variant_id: 'product_variant_id',
  catalog_snapshot: 'catalog_snapshot',
  name: 'name',
  description: 'description',
  comment: 'comment',
  organization_id: 'organization_id',
  tenant_id: 'tenant_id',
  quantity: 'quantity',
  quantity_unit: 'quantity_unit',
  normalized_quantity: 'normalized_quantity',
  normalized_unit: 'normalized_unit',
  uom_snapshot: 'uom_snapshot',
  currency_code: 'currency_code',
  unit_price_net: 'unit_price_net',
  unit_price_gross: 'unit_price_gross',
  discount_amount: 'discount_amount',
  discount_percent: 'discount_percent',
  tax_rate: 'tax_rate',
  tax_amount: 'tax_amount',
  total_net_amount: 'total_net_amount',
  total_gross_amount: 'total_gross_amount',
  configuration: 'configuration',
  promotion_code: 'promotion_code',
  promotion_snapshot: 'promotion_snapshot',
  metadata: 'metadata',
  custom_field_set_id: 'custom_field_set_id',
  created_at: 'created_at',
  updated_at: 'updated_at',
}

function buildRoute() {
  makeCrudRouteMock.mockClear()
  makeSalesLineRoute({
    entity: class SalesOrderLine {},
    entityId: 'sales:sales_order_line',
    fieldConstants,
    parentFkColumn: 'order_id',
    parentFkParam: 'orderId',
    createSchema: z.object({ orderId: z.string().uuid() }),
    features: { view: 'sales.orders.view', manage: 'sales.orders.manage' },
    commandPrefix: 'sales.orders.lines',
    openApi: { resourceName: 'Order line', description: 'an order line' },
  })
  return makeCrudRouteMock.mock.calls.at(-1)?.[0] as unknown as {
    list: { defaultSort?: { field: string; dir?: string }; tiebreakSortField?: string; sortFieldMap: Record<string, string> }
  }
}

describe('makeSalesLineRoute sorting', () => {
  it('defaults the list to line_number ascending instead of the random uuid primary key', () => {
    const { list } = buildRoute()

    expect(list.defaultSort).toEqual({ field: 'lineNumber', dir: 'asc' })
    expect(list.sortFieldMap[list.defaultSort!.field]).toBe('line_number')
  })

  it('breaks ties on id so equal line numbers keep a stable order', () => {
    const { list } = buildRoute()

    expect(list.tiebreakSortField).toBe('id')
    expect(list.sortFieldMap[list.tiebreakSortField!]).toBe('id')
  })
})
