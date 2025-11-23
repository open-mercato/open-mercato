import { buildSearchFilters, decorateChannelsWithOfferCounts, parseIdList } from '../channels/route'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

describe('sales channels route helpers', () => {
  it('parses UUID lists and discards invalid entries', () => {
    expect(parseIdList('11111111-1111-4111-8111-111111111111, invalid, 22222222-2222-4222-8222-222222222222')).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ])
    expect(parseIdList(undefined)).toEqual([])
  })

  it('builds search filters with sanitized terms and flags', () => {
    const filters = buildSearchFilters({
      search: ' Flash % ',
      ids: '11111111-1111-4111-8111-111111111111,00000000-0000-4000-8000-000000000000',
      isActive: 'false',
    } as any)

    expect(filters.id).toEqual({ $in: ['11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-000000000000'] })
    expect(filters.$or).toEqual([
      { name: { $ilike: '%Flash \\%%' } },
      { code: { $ilike: '%Flash \\%%' } },
      { description: { $ilike: '%Flash \\%%' } },
    ])
    expect(filters.is_active).toBe(false)
  })

  it('decorates listed channels with aggregated offer counts', async () => {
    const items = [{ id: 'ch-1' }, { id: 'ch-2' }, { id: null as any }]
    const offers = [
      { id: 'offer-1', channelId: 'ch-1' },
      { id: 'offer-2', channelId: 'ch-1' },
      { id: 'offer-3', channelId: 'ch-3' },
    ]
    const em = { find: jest.fn().mockResolvedValue(offers) }
    const ctx = { container: { resolve: jest.fn().mockReturnValue(em) } } as any

    await decorateChannelsWithOfferCounts({ items }, ctx)

    expect(items[0].offerCount).toBe(2)
    expect(items[1].offerCount).toBe(0)
    expect(em.find).toHaveBeenCalledWith(expect.any(Function), { channelId: { $in: ['ch-1', 'ch-2'] }, deletedAt: null }, expect.any(Object))
  })
})
