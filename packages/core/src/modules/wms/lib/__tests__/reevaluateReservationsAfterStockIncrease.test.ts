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
        items: [{ id: 'order-1', status: 'confirmed', fulfillment_status: 'unfulfilled' }],
      })
      .mockResolvedValueOnce({
        items: [{ id: 'line-1', order_id: 'order-1', product_variant_id: 'variant-1' }],
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
      expect.stringContaining('sales_order'),
      expect.objectContaining({
        filters: { status: { $eq: 'confirmed' } },
      }),
    )
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('sales_order_line'),
      expect.objectContaining({
        filters: {
          product_variant_id: { $eq: 'variant-1' },
          order_id: { $in: ['order-1'] },
        },
      }),
    )
  })

  it('does not scan lifetime line history for non-confirmed orders', async () => {
    const execute = jest.fn(async () => ({ result: {} }))
    const query = jest.fn(async (entity: string) => {
      if (String(entity).includes('sales_order') && !String(entity).includes('sales_order_line')) {
        // Open-set query returns only currently confirmed orders (none here).
        return { items: [] }
      }
      throw new Error('sales_order_line must not be queried when no reservable orders exist')
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
    expect(query.mock.calls.every(([entity]) => !String(entity).includes('sales_order_line'))).toBe(
      true,
    )
  })

  it('skips confirmed-but-terminal fulfillment orders during re-evaluation', async () => {
    const execute = jest.fn(async () => ({ result: {} }))
    const query = jest.fn().mockResolvedValueOnce({
      items: [
        { id: 'fulfilled-1', status: 'confirmed', fulfillment_status: 'fulfilled' },
        { id: 'cancelled-1', status: 'confirmed', fulfillment_status: 'cancelled' },
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
    expect(query.mock.calls.every(([entity]) => !String(entity).includes('sales_order_line'))).toBe(
      true,
    )
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

  it('paginates confirmed orders beyond a single 500-row page and skips historical line scans', async () => {
    const execute = jest.fn(async () => ({ result: {} }))
    const orderPageSize = 500
    const page1Orders = Array.from({ length: orderPageSize }, (_, index) => ({
      id: `order-page-1-${index}`,
      status: 'confirmed',
      fulfillment_status: 'unfulfilled',
    }))
    const query = jest.fn(
      async (
        entity: string,
        options: {
          page?: { page?: number; pageSize?: number }
          filters?: Record<string, unknown>
        },
      ) => {
        if (String(entity).includes('sales_order') && !String(entity).includes('sales_order_line')) {
          // Candidate discovery pages confirmed orders by status.
          if ((options.filters as { status?: unknown } | undefined)?.status) {
            const page = options.page?.page ?? 1
            expect(options.filters).toEqual({ status: { $eq: 'confirmed' } })
            expect(options.page?.pageSize).toBe(orderPageSize)
            if (page === 1) return { items: page1Orders }
            if (page === 2) {
              return {
                items: [
                  { id: 'order-page-2', status: 'confirmed', fulfillment_status: 'unfulfilled' },
                ],
              }
            }
            return { items: [] }
          }
          // Per-order load inside reserveInventoryForConfirmedOrder.
          const orderId = (options.filters as { id?: { $eq?: string } } | undefined)?.id?.$eq
          return {
            items: orderId
              ? [{ id: orderId, order_number: `SO-${orderId}`, status: 'confirmed' }]
              : [],
          }
        }
        if (String(entity).includes('sales_order_line')) {
          const orderIds = (options.filters?.order_id as { $in?: string[] } | undefined)?.$in
          // Candidate intersection: only the last order on page 1 and page-2 order.
          if (Array.isArray(orderIds)) {
            const matching = orderIds
              .filter((id) => id === `order-page-1-${orderPageSize - 1}` || id === 'order-page-2')
              .map((id) => ({
                id: `line-${id}`,
                order_id: id,
                product_variant_id: 'variant-1',
              }))
            return { items: matching }
          }
          // Per-order lines inside reserveInventoryForConfirmedOrder.
          const singleOrderId = (options.filters?.order_id as { $eq?: string } | undefined)?.$eq
          if (typeof singleOrderId === 'string') {
            return {
              items: [
                {
                  id: `line-${singleOrderId}`,
                  kind: 'product',
                  product_variant_id: 'variant-1',
                  quantity: '1',
                  line_number: 1,
                  order_id: singleOrderId,
                },
              ],
            }
          }
          return { items: [] }
        }
        return { items: [] }
      },
    )

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

    const candidateOrderQueries = query.mock.calls.filter(
      ([entity, options]) =>
        String(entity).includes('sales_order') &&
        !String(entity).includes('sales_order_line') &&
        Boolean((options as { filters?: { status?: unknown } }).filters?.status),
    )
    expect(candidateOrderQueries).toHaveLength(2)
    expect(candidateOrderQueries[0][1]).toEqual(
      expect.objectContaining({ page: { page: 1, pageSize: orderPageSize } }),
    )
    expect(candidateOrderQueries[1][1]).toEqual(
      expect.objectContaining({ page: { page: 2, pageSize: orderPageSize } }),
    )

    const candidateLineFilters = query.mock.calls
      .filter(([entity, options]) => {
        if (!String(entity).includes('sales_order_line')) return false
        const orderFilter = (options as { filters?: { order_id?: { $in?: string[] } } }).filters
          ?.order_id
        return Array.isArray(orderFilter?.$in)
      })
      .map(([, options]) => (options as { filters?: { order_id?: { $in?: string[] }; product_variant_id?: unknown } }).filters)
    expect(candidateLineFilters).toHaveLength(2)
    expect(candidateLineFilters[0]?.order_id?.$in).toHaveLength(orderPageSize)
    expect(candidateLineFilters[1]?.order_id?.$in).toEqual(['order-page-2'])
    expect(
      candidateLineFilters.every(
        (filters) =>
          filters?.product_variant_id != null && Array.isArray(filters?.order_id?.$in),
      ),
    ).toBe(true)
  })

  it('continues to later order pages when a mid-run line lookup fails', async () => {
    const execute = jest.fn(async () => ({ result: {} }))
    const orderPageSize = 500
    const page1Orders = Array.from({ length: orderPageSize }, (_, index) => ({
      id: `order-page-1-${index}`,
      status: 'confirmed',
      fulfillment_status: 'unfulfilled',
    }))
    const query = jest.fn(
      async (
        entity: string,
        options: {
          page?: { page?: number; pageSize?: number }
          filters?: Record<string, unknown>
        },
      ) => {
        if (String(entity).includes('sales_order') && !String(entity).includes('sales_order_line')) {
          if ((options.filters as { status?: unknown } | undefined)?.status) {
            const page = options.page?.page ?? 1
            if (page === 1) return { items: page1Orders }
            if (page === 2) {
              return {
                items: [
                  { id: 'order-page-2', status: 'confirmed', fulfillment_status: 'unfulfilled' },
                ],
              }
            }
            return { items: [] }
          }
          return { items: [] }
        }
        if (String(entity).includes('sales_order_line')) {
          const orderIds = (options.filters?.order_id as { $in?: string[] } | undefined)?.$in ?? []
          if (orderIds.includes('order-page-1-0')) {
            throw new Error('transient sales order line lookup failure')
          }
          return {
            items: orderIds
              .filter((id) => id === 'order-page-2')
              .map((id) => ({
                id: `line-${id}`,
                order_id: id,
                product_variant_id: 'variant-1',
              })),
          }
        }
        return { items: [] }
      },
    )

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

    const candidateOrderQueries = query.mock.calls.filter(
      ([entity, options]) =>
        String(entity).includes('sales_order') &&
        !String(entity).includes('sales_order_line') &&
        Boolean((options as { filters?: { status?: unknown } }).filters?.status),
    )
    expect(candidateOrderQueries).toHaveLength(2)
    expect(candidateOrderQueries[1][1]).toEqual(
      expect.objectContaining({ page: { page: 2, pageSize: orderPageSize } }),
    )
    // Page-2 line lookup succeeds but reserve no-ops without stock; page-1 line lookup failed.
    expect(execute).not.toHaveBeenCalled()
  })
})
