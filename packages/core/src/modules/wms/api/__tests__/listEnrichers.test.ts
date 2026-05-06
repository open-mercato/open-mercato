/** @jest-environment node */

import { E } from '#generated/entities.ids.generated'
import { attachWarehouseLabelsToListItems } from '../listEnrichers'

type QueryStub = {
  query: jest.Mock
}

function createQueryEngine(rows: Array<{ id: string; name?: string | null; code?: string | null }>): QueryStub {
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
