/** @jest-environment node */

import { E } from '#generated/entities.ids.generated'
import {
  attachLocationLabelsToListItems,
  attachVariantLabelsToListItems,
  attachWarehouseLabelsToListItems,
} from '../listEnrichers'

type QueryStub = {
  query: jest.Mock
}

function createQueryEngine(
  rows: Array<Record<string, unknown> & { id: string }>,
): QueryStub {
  return {
    query: jest.fn(async () => ({
      items: rows,
      page: 1,
      pageSize: rows.length,
      total: rows.length,
    })),
  }
}

function createCtx(queryEngine: QueryStub) {
  return {
    auth: { tenantId: 'tenant-1', orgId: 'org-1', sub: 'user-1' },
    selectedOrganizationId: 'org-1',
    organizationIds: ['org-1'],
    container: {
      resolve: (name: string) => {
        if (name === 'queryEngine') return queryEngine
        throw new Error(`Unexpected resolve: ${name}`)
      },
    },
  } as unknown as Parameters<typeof attachWarehouseLabelsToListItems>[1]
}

describe('attachWarehouseLabelsToListItems', () => {
  it('decorates items with warehouse_name / warehouse_code via batched lookup', async () => {
    const queryEngine = createQueryEngine([
      { id: 'wh-1', name: 'Main DC', code: 'MAIN' },
      { id: 'wh-2', name: 'Returns', code: 'RET' },
    ])
    const payload = {
      items: [
        { id: 'loc-1', warehouse_id: 'wh-1' },
        { id: 'loc-2', warehouse_id: 'wh-2' },
        { id: 'loc-3', warehouse_id: 'wh-1' },
      ],
    }

    await attachWarehouseLabelsToListItems(payload, createCtx(queryEngine))

    expect(queryEngine.query).toHaveBeenCalledTimes(1)
    expect(queryEngine.query).toHaveBeenCalledWith(
      E.wms.warehouse,
      expect.objectContaining({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        organizationIds: ['org-1'],
        filters: { id: { $in: ['wh-1', 'wh-2'] } },
        fields: ['id', 'name', 'code'],
      }),
    )
    expect(payload.items[0]).toMatchObject({ warehouse_name: 'Main DC', warehouse_code: 'MAIN' })
    expect(payload.items[1]).toMatchObject({ warehouse_name: 'Returns', warehouse_code: 'RET' })
    expect(payload.items[2]).toMatchObject({ warehouse_name: 'Main DC', warehouse_code: 'MAIN' })
  })

  it('does nothing when items array is empty', async () => {
    const queryEngine = createQueryEngine([])
    await attachWarehouseLabelsToListItems({ items: [] }, createCtx(queryEngine))
    expect(queryEngine.query).not.toHaveBeenCalled()
  })

  it('does nothing when no row carries a warehouse_id', async () => {
    const queryEngine = createQueryEngine([])
    const payload = { items: [{ id: 'loc-1' }, { id: 'loc-2', warehouse_id: '' }] as Array<Record<string, unknown>> }
    await attachWarehouseLabelsToListItems(payload, createCtx(queryEngine))
    expect(queryEngine.query).not.toHaveBeenCalled()
  })

  it('preserves existing warehouse_name set by an upstream enricher', async () => {
    const queryEngine = createQueryEngine([{ id: 'wh-1', name: 'Main DC', code: 'MAIN' }])
    const payload = {
      items: [
        { id: 'loc-1', warehouse_id: 'wh-1', warehouse_name: 'Custom Label' },
      ],
    }
    await attachWarehouseLabelsToListItems(payload, createCtx(queryEngine))
    expect(payload.items[0]).toMatchObject({ warehouse_name: 'Custom Label', warehouse_code: 'MAIN' })
  })

  it('skips silently when queryEngine.query throws', async () => {
    const queryEngine: QueryStub = {
      query: jest.fn(async () => {
        throw new Error('query engine offline')
      }),
    }
    const payload = { items: [{ id: 'loc-1', warehouse_id: 'wh-1' }] }
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await attachWarehouseLabelsToListItems(payload, createCtx(queryEngine))
      expect(payload.items[0]).not.toHaveProperty('warehouse_name')
      expect(consoleSpy).toHaveBeenCalled()
    } finally {
      consoleSpy.mockRestore()
    }
  })
})

describe('attachLocationLabelsToListItems', () => {
  it('decorates location_id, location_from_id and location_to_id with code/type', async () => {
    const queryEngine = createQueryEngine([
      { id: 'loc-A', code: 'A1', type: 'bin' },
      { id: 'loc-B', code: 'B1', type: 'staging' },
      { id: 'loc-C', code: 'C1', type: 'dock' },
    ])
    const payload = {
      items: [
        { id: 'm-1', location_from_id: 'loc-A', location_to_id: 'loc-B' },
        { id: 'm-2', location_id: 'loc-C' },
      ] as Array<Record<string, unknown>>,
    }

    await attachLocationLabelsToListItems(payload, createCtx(queryEngine))

    expect(queryEngine.query).toHaveBeenCalledTimes(1)
    expect(queryEngine.query).toHaveBeenCalledWith(
      E.wms.warehouse_location,
      expect.objectContaining({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        filters: { id: { $in: ['loc-A', 'loc-B', 'loc-C'] } },
        fields: ['id', 'code', 'type'],
      }),
    )

    expect(payload.items[0]).toMatchObject({
      location_from_code: 'A1',
      location_from_type: 'bin',
      location_to_code: 'B1',
      location_to_type: 'staging',
    })
    expect(payload.items[1]).toMatchObject({
      location_code: 'C1',
      location_type: 'dock',
    })
  })

  it('does nothing when no row carries any location FK', async () => {
    const queryEngine = createQueryEngine([])
    await attachLocationLabelsToListItems(
      { items: [{ id: 'm-1' }, { id: 'm-2', location_id: '' }] as Array<Record<string, unknown>> },
      createCtx(queryEngine),
    )
    expect(queryEngine.query).not.toHaveBeenCalled()
  })
})

describe('attachVariantLabelsToListItems', () => {
  it('decorates items with variant_name, variant_sku, catalog_product_id', async () => {
    const queryEngine = createQueryEngine([
      { id: 'var-1', name: 'Red - L', sku: 'RED-L', product_id: 'prod-1' },
      { id: 'var-2', name: null, sku: 'BLUE-S', product_id: 'prod-2' },
    ])
    const payload = {
      items: [
        { id: 'b-1', catalog_variant_id: 'var-1' },
        { id: 'b-2', catalog_variant_id: 'var-2' },
      ] as Array<Record<string, unknown>>,
    }

    await attachVariantLabelsToListItems(payload, createCtx(queryEngine))

    expect(queryEngine.query).toHaveBeenCalledWith(
      E.catalog.catalog_product_variant,
      expect.objectContaining({
        filters: { id: { $in: ['var-1', 'var-2'] } },
        fields: ['id', 'name', 'sku', 'product_id'],
      }),
    )
    expect(payload.items[0]).toMatchObject({
      variant_name: 'Red - L',
      variant_sku: 'RED-L',
      catalog_product_id: 'prod-1',
    })
    expect(payload.items[1]).toMatchObject({
      variant_name: null,
      variant_sku: 'BLUE-S',
      catalog_product_id: 'prod-2',
    })
  })

  it('preserves existing variant_name set by an upstream enricher', async () => {
    const queryEngine = createQueryEngine([
      { id: 'var-1', name: 'Looked-up', sku: 'X', product_id: 'p' },
    ])
    const payload = {
      items: [
        { id: 'b-1', catalog_variant_id: 'var-1', variant_name: 'Custom' },
      ] as Array<Record<string, unknown>>,
    }
    await attachVariantLabelsToListItems(payload, createCtx(queryEngine))
    expect(payload.items[0]).toMatchObject({
      variant_name: 'Custom',
      variant_sku: 'X',
      catalog_product_id: 'p',
    })
  })
})
