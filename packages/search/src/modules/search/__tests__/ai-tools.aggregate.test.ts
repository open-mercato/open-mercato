import { aiTools } from '../ai-tools'

const aggregateTool = aiTools.find((t) => t.name === 'search_aggregate')
if (!aggregateTool) throw new Error('search_aggregate tool not found in aiTools — was it renamed?')

function makeCtx(queryResult: { items: unknown[]; total: number }) {
  const mockQuery = jest.fn().mockResolvedValue(queryResult)
  const ctx = {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: null,
    userFeatures: ['search.view'],
    isSuperAdmin: false,
    container: {
      resolve: (_name: string) => ({ query: mockQuery }),
    },
  }
  return { ctx, mockQuery }
}

describe('search_aggregate tool', () => {
  it('sends pageSize: 100 to the query engine', async () => {
    const { ctx, mockQuery } = makeCtx({ items: [], total: 0 })

    await aggregateTool.handler({ entityType: 'customers:customer_deal', groupBy: 'status', limit: 20 }, ctx)

    expect(mockQuery).toHaveBeenCalledWith(
      'customers:customer_deal',
      expect.objectContaining({
        page: { page: 1, pageSize: 100 },
      }),
    )
  })

  it('groups returned items by the specified field', async () => {
    const items = [
      { status: 'open' },
      { status: 'open' },
      { status: 'closed' },
      { status: null },
    ]
    const { ctx } = makeCtx({ items, total: 4 })

    const result = await aggregateTool.handler(
      { entityType: 'customers:customer_deal', groupBy: 'status', limit: 20 },
      ctx,
    ) as { buckets: Array<{ value: string | null; count: number; percentage: number }>; total: number }

    expect(result.total).toBe(4)
    const open = result.buckets.find((b) => b.value === 'open')
    const closed = result.buckets.find((b) => b.value === 'closed')
    const nullBucket = result.buckets.find((b) => b.value === null)
    expect(open?.count).toBe(2)
    expect(closed?.count).toBe(1)
    expect(nullBucket?.count).toBe(1)
  })

  it('respects the limit on returned buckets', async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ category: `cat-${i}` }))
    const { ctx } = makeCtx({ items, total: 10 })

    const result = await aggregateTool.handler(
      { entityType: 'catalog:product', groupBy: 'category', limit: 3 },
      ctx,
    ) as { buckets: unknown[] }

    expect(result.buckets.length).toBe(3)
  })

  it('computes percentage against the sampled item count', async () => {
    const items = [{ status: 'open' }, { status: 'open' }, { status: 'closed' }]
    const { ctx } = makeCtx({ items, total: 1000 }) // DB total irrelevant; sample is 3
    const result = await aggregateTool.handler(
      { entityType: 'customers:customer_deal', groupBy: 'status', limit: 20 },
      ctx,
    ) as { buckets: Array<{ value: string; percentage: number }> }
    const open = result.buckets.find((b) => b.value === 'open')
    expect(open?.percentage).toBeCloseTo(66.67, 1)
  })

  it('returns buckets sorted by count descending', async () => {
    const items = [
      { status: 'closed' },
      { status: 'open' }, { status: 'open' }, { status: 'open' },
      { status: 'pending' }, { status: 'pending' },
    ]
    const { ctx } = makeCtx({ items, total: 6 })
    const result = await aggregateTool.handler(
      { entityType: 'customers:customer_deal', groupBy: 'status', limit: 20 },
      ctx,
    ) as { buckets: Array<{ value: string; count: number }> }
    expect(result.buckets.map((b) => b.value)).toEqual(['open', 'pending', 'closed'])
  })

  it('returns empty buckets for empty result set', async () => {
    const { ctx } = makeCtx({ items: [], total: 0 })
    const result = await aggregateTool.handler(
      { entityType: 'customers:customer_deal', groupBy: 'status', limit: 20 },
      ctx,
    ) as { total: number; buckets: unknown[] }
    expect(result.total).toBe(0)
    expect(result.buckets).toEqual([])
  })

  it('throws when tenantId is missing', async () => {
    const { ctx } = makeCtx({ items: [], total: 0 })
    const noTenantCtx = { ...ctx, tenantId: null }

    await expect(
      aggregateTool.handler({ entityType: 'customers:customer_deal', groupBy: 'status', limit: 20 }, noTenantCtx),
    ).rejects.toThrow('Tenant context is required')
  })
})
