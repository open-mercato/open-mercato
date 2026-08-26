/** @jest-environment node */

jest.mock('../salesOrderWarehouseAssignment', () => ({
  loadExplicitWarehouseIdForOrder: jest.fn().mockResolvedValue(null),
}))

jest.mock('../../events', () => ({
  emitWmsEvent: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn().mockResolvedValue([]),
  findOneWithDecryption: jest.fn().mockResolvedValue(null),
}))

import { reevaluateReservationsAfterStockIncrease } from '../salesOrderInventoryAutomation'

describe('reevaluateReservationsAfterStockIncrease', () => {
  it('no-ops when the sales inventory toggle is disabled', async () => {
    const execute = jest.fn()
    await reevaluateReservationsAfterStockIncrease(
      {
        catalogVariantId: 'variant-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
      {
        resolve: (name: string) => {
          if (name === 'featureTogglesService') {
            return {
              getBoolConfig: jest.fn().mockResolvedValue({ ok: true, value: false }),
            }
          }
          if (name === 'em') {
            return { fork: () => ({}), persist: jest.fn(), create: jest.fn(), flush: jest.fn() }
          }
          if (name === 'commandBus') return { execute }
          if (name === 'queryEngine') {
            return { query: jest.fn() }
          }
          throw new Error(`Unexpected resolve: ${name}`)
        },
      },
    )
    expect(execute).not.toHaveBeenCalled()
  })

  it('re-runs reservation for confirmed orders that include the received variant', async () => {
    const execute = jest.fn(async () => ({ result: {} }))
    const query = jest
      .fn()
      .mockResolvedValueOnce({
        items: [{ id: 'line-1', order_id: 'order-1', product_variant_id: 'variant-1' }],
      })
      .mockResolvedValueOnce({
        items: [{ id: 'order-1', status: 'confirmed', fulfillment_status: 'unfulfilled' }],
      })
      .mockResolvedValueOnce({
        items: [{ id: 'order-1', order_number: 'SO-1' }],
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'line-1',
            kind: 'product',
            product_variant_id: 'variant-1',
            quantity: '2',
            line_number: 1,
          },
        ],
      })

    await reevaluateReservationsAfterStockIncrease(
      {
        catalogVariantId: 'variant-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
      {
        resolve: (name: string) => {
          if (name === 'featureTogglesService') {
            return {
              getBoolConfig: jest.fn().mockResolvedValue({ ok: true, value: true }),
            }
          }
          if (name === 'em') {
            return { fork: () => ({}), persist: jest.fn(), create: jest.fn(), flush: jest.fn() }
          }
          if (name === 'commandBus') return { execute }
          if (name === 'queryEngine') return { query }
          throw new Error(`Unexpected resolve: ${name}`)
        },
      },
    )

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('sales_order_line'),
      expect.objectContaining({
        filters: { product_variant_id: { $eq: 'variant-1' } },
      }),
    )
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('sales_order'),
      expect.objectContaining({
        filters: { id: { $in: ['order-1'] } },
      }),
    )
  })

  it('skips non-confirmed orders during re-evaluation', async () => {
    const execute = jest.fn(async () => ({ result: {} }))
    const query = jest
      .fn()
      .mockResolvedValueOnce({
        items: [
          { id: 'line-1', order_id: 'draft-1', product_variant_id: 'variant-1' },
          { id: 'line-2', order_id: 'cancelled-1', product_variant_id: 'variant-1' },
        ],
      })
      .mockResolvedValueOnce({
        items: [
          { id: 'draft-1', status: 'draft', fulfillment_status: null },
          { id: 'cancelled-1', status: 'cancelled', fulfillment_status: null },
        ],
      })

    await reevaluateReservationsAfterStockIncrease(
      {
        catalogVariantId: 'variant-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
      {
        resolve: (name: string) => {
          if (name === 'featureTogglesService') {
            return {
              getBoolConfig: jest.fn().mockResolvedValue({ ok: true, value: true }),
            }
          }
          if (name === 'em') {
            return { fork: () => ({}), persist: jest.fn(), create: jest.fn(), flush: jest.fn() }
          }
          if (name === 'commandBus') return { execute }
          if (name === 'queryEngine') return { query }
          throw new Error(`Unexpected resolve: ${name}`)
        },
      },
    )

    expect(execute).not.toHaveBeenCalled()
  })

  it('swallows query-engine failures when sales peers are absent', async () => {
    await expect(
      reevaluateReservationsAfterStockIncrease(
        {
          catalogVariantId: 'variant-1',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
        },
        {
          resolve: (name: string) => {
            if (name === 'featureTogglesService') {
              return {
                getBoolConfig: jest.fn().mockResolvedValue({ ok: true, value: true }),
              }
            }
            if (name === 'em') {
              return { fork: () => ({}), persist: jest.fn(), create: jest.fn(), flush: jest.fn() }
            }
            if (name === 'queryEngine') {
              throw new Error('sales module absent')
            }
            throw new Error(`Unexpected resolve: ${name}`)
          },
        },
      ),
    ).resolves.toBeUndefined()
  })

  it('paginates sales order lines beyond a single 500-row page', async () => {
    const execute = jest.fn(async () => ({ result: {} }))
    const linePageSize = 500
    const page1Lines = Array.from({ length: linePageSize }, (_, index) => ({
      id: `line-p1-${index}`,
      order_id: 'order-page-1',
      product_variant_id: 'variant-1',
    }))
    const query = jest.fn(async (entity: string, options: { page?: { page?: number; pageSize?: number } }) => {
      if (String(entity).includes('sales_order_line')) {
        const page = options.page?.page ?? 1
        if (page === 1) {
          expect(options.page?.pageSize).toBe(linePageSize)
          return { items: page1Lines }
        }
        if (page === 2) {
          return {
            items: [
              {
                id: 'line-p2-0',
                order_id: 'order-page-2',
                product_variant_id: 'variant-1',
              },
            ],
          }
        }
        return { items: [] }
      }
      if (String(entity).includes('sales_order')) {
        const ids = (options as { filters?: { id?: { $in?: string[] } } }).filters?.id?.$in ?? []
        return {
          items: ids.map((id) => ({
            id,
            status: 'draft',
            fulfillment_status: null,
          })),
        }
      }
      return { items: [] }
    })

    await reevaluateReservationsAfterStockIncrease(
      {
        catalogVariantId: 'variant-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
      {
        resolve: (name: string) => {
          if (name === 'featureTogglesService') {
            return {
              getBoolConfig: jest.fn().mockResolvedValue({ ok: true, value: true }),
            }
          }
          if (name === 'em') {
            return { fork: () => ({}), persist: jest.fn(), create: jest.fn(), flush: jest.fn() }
          }
          if (name === 'commandBus') return { execute }
          if (name === 'queryEngine') return { query }
          throw new Error(`Unexpected resolve: ${name}`)
        },
      },
    )

    const lineQueries = query.mock.calls.filter(([entity]) => String(entity).includes('sales_order_line'))
    expect(lineQueries).toHaveLength(2)
    expect(lineQueries[0][1]).toEqual(
      expect.objectContaining({ page: { page: 1, pageSize: linePageSize } }),
    )
    expect(lineQueries[1][1]).toEqual(
      expect.objectContaining({ page: { page: 2, pageSize: linePageSize } }),
    )

    const orderIdFilters = query.mock.calls
      .filter(([entity]) => String(entity).includes('sales_order') && !String(entity).includes('sales_order_line'))
      .map(([, options]) => (options as { filters?: { id?: { $in?: string[] } } }).filters?.id?.$in ?? [])
    expect(orderIdFilters).toEqual(expect.arrayContaining([['order-page-1'], ['order-page-2']]))
    expect(execute).not.toHaveBeenCalled()
  })

  it('continues to later line pages when a mid-run order lookup fails', async () => {
    const execute = jest.fn(async () => ({ result: {} }))
    const linePageSize = 500
    const page1Lines = Array.from({ length: linePageSize }, (_, index) => ({
      id: `line-p1-${index}`,
      order_id: 'order-page-1',
      product_variant_id: 'variant-1',
    }))
    const query = jest.fn(async (entity: string, options: { page?: { page?: number; pageSize?: number } }) => {
      if (String(entity).includes('sales_order_line')) {
        const page = options.page?.page ?? 1
        if (page === 1) {
          return { items: page1Lines }
        }
        if (page === 2) {
          return {
            items: [
              {
                id: 'line-p2-0',
                order_id: 'order-page-2',
                product_variant_id: 'variant-1',
              },
            ],
          }
        }
        return { items: [] }
      }
      if (String(entity).includes('sales_order') && !String(entity).includes('sales_order_line')) {
        const ids = (options as { filters?: { id?: { $in?: string[] } } }).filters?.id?.$in ?? []
        if (ids.includes('order-page-1')) {
          throw new Error('transient sales order lookup failure')
        }
        return {
          items: ids.map((id) => ({
            id,
            status: 'draft',
            fulfillment_status: null,
          })),
        }
      }
      return { items: [] }
    })

    await reevaluateReservationsAfterStockIncrease(
      {
        catalogVariantId: 'variant-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
      {
        resolve: (name: string) => {
          if (name === 'featureTogglesService') {
            return {
              getBoolConfig: jest.fn().mockResolvedValue({ ok: true, value: true }),
            }
          }
          if (name === 'em') {
            return { fork: () => ({}), persist: jest.fn(), create: jest.fn(), flush: jest.fn() }
          }
          if (name === 'commandBus') return { execute }
          if (name === 'queryEngine') return { query }
          throw new Error(`Unexpected resolve: ${name}`)
        },
      },
    )

    const lineQueries = query.mock.calls.filter(([entity]) => String(entity).includes('sales_order_line'))
    expect(lineQueries).toHaveLength(2)
    expect(lineQueries[1][1]).toEqual(
      expect.objectContaining({ page: { page: 2, pageSize: linePageSize } }),
    )

    const orderIdFilters = query.mock.calls
      .filter(
        ([entity]) =>
          String(entity).includes('sales_order') && !String(entity).includes('sales_order_line'),
      )
      .map(([, options]) => (options as { filters?: { id?: { $in?: string[] } } }).filters?.id?.$in ?? [])
    expect(orderIdFilters).toEqual([['order-page-1'], ['order-page-2']])
    expect(execute).not.toHaveBeenCalled()
  })
})
