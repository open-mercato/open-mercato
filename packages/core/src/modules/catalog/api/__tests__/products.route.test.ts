import {
  parseIdList,
  buildProductFilters,
  buildPricingContext,
  scoreProductSearchRelevance,
} from '../products/route'
import { parseBooleanFlag, sanitizeSearchTerm } from '../helpers'
import { buildCustomFieldFiltersFromQuery } from '@open-mercato/shared/lib/crud/custom-fields'

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  buildCustomFieldFiltersFromQuery: jest.fn(),
  extractAllCustomFieldEntries: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

describe('catalog products route helpers', () => {
  beforeEach(() => {
    ;(buildCustomFieldFiltersFromQuery as jest.Mock).mockResolvedValue({ custom: { $eq: 'value' } })
  })

  it('sanitizes search terms and parses identifiers', () => {
    expect(sanitizeSearchTerm('  shoes_% ')).toBe('shoes')
    expect(parseBooleanFlag('true')).toBe(true)
    expect(parseBooleanFlag('unknown')).toBeUndefined()
    expect(parseIdList('id1,not-a-uuid')).toHaveLength(0)
    expect(parseIdList('11111111-1111-4111-8111-111111111111, 22222222-2222-4222-8222-222222222222')).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ])
  })

  it('builds pricing context with sensible defaults and fallbacks', () => {
    const ctx = buildPricingContext({ quantity: 'not-a-number', priceDate: 'invalid', channelId: null } as any, 'channel-fallback')
    expect(ctx.quantity).toBe(1)
    expect(ctx.channelId).toBe('channel-fallback')
    expect(ctx.date).toBeInstanceOf(Date)
  })

  it('builds product filters and merges offer + custom field context', async () => {
    const productRows = [
      { id: 'prod-1' },
      { id: 'prod-2' },
      { id: 'prod-3' },
    ]
    const offerRows = [
      { id: 'offer-1', product: 'prod-1' },
      { id: 'offer-2', product: { id: 'prod-2' } },
    ]
    const forkedEm = {
      find: jest
        .fn()
        .mockResolvedValueOnce(productRows)
        .mockResolvedValueOnce(offerRows),
    }
    const em = { fork: () => forkedEm }
    const container = { resolve: jest.fn().mockReturnValue(em) }
    const filters = await buildProductFilters(
      {
        search: '  luxe_% ',
        status: ' status ',
        isActive: 'true',
        configurable: 'false',
        channelIds: '11111111-1111-4111-8111-111111111111',
        customFieldset: ' fashion ',
      } as any,
      { container, auth: { tenantId: 'tenant-1' } } as any,
    )

    expect(forkedEm.find).toHaveBeenCalledTimes(2)
    expect(buildCustomFieldFiltersFromQuery).toHaveBeenCalledWith({
      entityIds: expect.any(Array),
      query: expect.any(Object),
      em,
      tenantId: 'tenant-1',
      fieldset: 'fashion',
    })
    expect(filters.status_entry_id).toEqual({ $eq: 'status' })
    expect(filters.is_active).toBe(true)
    expect(filters.is_configurable).toBe(false)
    expect(filters.id).toEqual({ $in: ['prod-1', 'prod-2'] })
    expect((filters as any).custom).toEqual({ $eq: 'value' })
  })

  it('dispatches independent filter prequeries concurrently and intersects them (issue #3179)', async () => {
    const expectedConcurrent = 4
    let dispatched = 0
    let releaseBarrier: () => void = () => {}
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve
    })

    const rowsForWhere = (where: any) => {
      if (where?.$or) return [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]
      if (where?.channelId) return [{ id: 'o2', product: 'p2' }, { id: 'o3', product: 'p3' }, { id: 'o4', product: 'p4' }]
      if (where?.category) return [{ id: 'a2', product: 'p2' }, { id: 'a3', product: 'p3' }]
      if (where?.tag) return [{ id: 't3', product: { id: 'p3' } }]
      return []
    }

    // Each query parks on a shared barrier that only releases once every
    // independent prequery has been dispatched. Sequential awaits can never
    // reach that count, so this resolves only when they run concurrently.
    const find = jest.fn().mockImplementation(async (_entity: unknown, where: any) => {
      dispatched += 1
      if (dispatched >= expectedConcurrent) releaseBarrier()
      await barrier
      return rowsForWhere(where)
    })
    const forkedEm = { find }
    const em = { fork: () => forkedEm }
    const container = { resolve: jest.fn().mockReturnValue(em) }
    ;(buildCustomFieldFiltersFromQuery as jest.Mock).mockResolvedValueOnce({})

    let timer: ReturnType<typeof setTimeout> | undefined
    const guard = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('filter prequeries were awaited sequentially, not dispatched concurrently')),
        1000,
      )
    })

    try {
      const filters = await Promise.race([
        buildProductFilters(
          {
            search: 'widget',
            channelIds: '11111111-1111-4111-8111-111111111111',
            categoryIds: '22222222-2222-4222-8222-222222222222',
            tagIds: '33333333-3333-4333-8333-333333333333',
          } as any,
          { container, auth: { tenantId: 'tenant-1' } } as any,
        ),
        guard,
      ])

      expect(find).toHaveBeenCalledTimes(expectedConcurrent)
      // search {p1,p2,p3} ∩ channel {p2,p3,p4} ∩ category {p2,p3} ∩ tag {p3} = {p3}
      expect(filters.id).toEqual({ $eq: 'p3' })
    } finally {
      if (timer) clearTimeout(timer)
      releaseBarrier()
    }
  })

  it('falls back to sentinel id when restricted products exclude the requested record', async () => {
    const forkedEm = {
      find: jest.fn().mockResolvedValue([{ product: 'prod-allowed' }]),
    }
    const em = { fork: () => forkedEm }
    const container = { resolve: jest.fn().mockReturnValue(em) }
    ;(buildCustomFieldFiltersFromQuery as jest.Mock).mockResolvedValueOnce({})

    const filters = await buildProductFilters(
      {
        id: 'prod-requested',
        channelIds: '11111111-1111-4111-8111-111111111111',
      } as any,
      { container, auth: { tenantId: 'tenant-1' } } as any,
    )

    expect(filters.id).toEqual({ $eq: '00000000-0000-0000-0000-000000000000' })
  })

  it('scores obvious product title and sku matches by relevance', () => {
    expect(scoreProductSearchRelevance('aurora', 'Aurora', 'AU-01')).toBe(0)
    expect(scoreProductSearchRelevance('aurora', 'Northern Lights', 'aurora')).toBe(1)
    expect(scoreProductSearchRelevance('aurora', 'Aurora Borealis', 'AB-01')).toBe(2)
    expect(scoreProductSearchRelevance('aurora', 'Northern Lights', 'AURORA-SKU')).toBe(3)
    expect(scoreProductSearchRelevance('aurora', 'Polar Aurora Light', 'NL-01')).toBe(4)
    expect(scoreProductSearchRelevance('aurora', 'Northern Lights', 'SKU-AURORA-01')).toBe(5)
    expect(scoreProductSearchRelevance('aurora', 'Borealis', 'NL-01')).toBe(6)
  })

  it('supports case-insensitive title matching for issue 1350 scenarios', () => {
    const ranked = [
      { title: 'Alpha', sku: 'SKU-A' },
      { title: 'Aurora', sku: 'AU-01' },
      { title: 'Northern Lights', sku: 'AURORA-SKU' },
      { title: 'Aurora Borealis', sku: 'AB-01' },
    ]
      .map((entry) => ({
        ...entry,
        score: scoreProductSearchRelevance('aurora', entry.title, entry.sku),
      }))
      .sort((left, right) => {
        if (left.score !== right.score) return left.score - right.score
        return left.title.localeCompare(right.title)
      })

    expect(ranked.map((entry) => entry.title)).toEqual([
      'Aurora',
      'Aurora Borealis',
      'Northern Lights',
      'Alpha',
    ])
  })
})
