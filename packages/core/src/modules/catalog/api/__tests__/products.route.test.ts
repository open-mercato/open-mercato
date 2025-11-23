import { parseIdList, buildProductFilters, buildPricingContext } from '../products/route'
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
    const offerRows = [
      { id: 'offer-1', product: 'prod-1' },
      { id: 'offer-2', product: { id: 'prod-2' } },
    ]
    const forkedEm = { find: jest.fn().mockResolvedValue(offerRows) }
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

    expect(forkedEm.find).toHaveBeenCalled()
    expect(buildCustomFieldFiltersFromQuery).toHaveBeenCalledWith({
      entityIds: expect.any(Array),
      query: expect.any(Object),
      em,
      tenantId: 'tenant-1',
      fieldset: 'fashion',
    })
    expect(filters.$or).toBeDefined()
    expect(filters.status_entry_id).toEqual({ $eq: 'status' })
    expect(filters.is_active).toBe(true)
    expect(filters.is_configurable).toBe(false)
    expect(filters.id).toEqual({ $in: ['prod-1', 'prod-2'] })
    expect((filters as any).custom).toEqual({ $eq: 'value' })
  })

  it('falls back to sentinel id when restricted products exclude the requested record', async () => {
    const forkedEm = { find: jest.fn().mockResolvedValue([{ product: 'prod-allowed' }]) }
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
})
