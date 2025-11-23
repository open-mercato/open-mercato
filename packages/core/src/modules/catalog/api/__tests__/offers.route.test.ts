import { CatalogProduct, CatalogProductPrice } from '../../data/entities'
import { buildOfferFilters, decorateOffersWithDetails, normalizeSearch } from '../offers/route'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

describe('catalog offers route helpers', () => {
  it('normalizes search input consistently', () => {
    expect(normalizeSearch('  Summer  ')).toBe('Summer')
    expect(normalizeSearch('')).toBeNull()
    expect(normalizeSearch(undefined)).toBeNull()
  })

  it('builds offer filters for combinations of query params', () => {
    const filters = buildOfferFilters({
      productId: 'prod-1',
      channelIds: '11111111-1111-4111-8111-111111111111,not-a-uuid',
      search: ' flash % ',
      isActive: 'true',
    } as any)

    expect(filters.product_id).toEqual({ $eq: 'prod-1' })
    expect(filters.channel_id).toEqual({ $in: ['11111111-1111-4111-8111-111111111111'] })
    expect(filters.$or).toEqual([
      { title: { $ilike: '%flash \\%%' } },
      { description: { $ilike: '%flash \\%%' } },
    ])
    expect(filters.is_active).toBe(true)
  })

  it('decorates offer items with product, prices and fallback channel price', async () => {
    const items: any[] = [
      { id: 'offer-1', productId: 'prod-1' },
      { id: 'offer-2', productId: 'prod-2' },
    ]
    const productRows = [
      { id: 'prod-1', title: 'Sneakers', defaultMediaId: 'media-1', defaultMediaUrl: 'cdn/setup/1.jpg', sku: 'SKU-1' },
      { id: 'prod-2', title: 'Hat', sku: null },
    ]
    const offerPriceRows = [
      {
        id: 'price-1',
        offer: 'offer-1',
        currencyCode: 'USD',
        unitPriceNet: 100,
        unitPriceGross: 120,
        priceKind: { id: 'kind-1', code: 'retail', title: 'Retail', displayMode: 'including-tax' },
        minQuantity: 1,
        maxQuantity: 5,
      },
      {
        id: 'price-2',
        offer: { id: 'offer-1' },
        currencyCode: 'USD',
        unitPriceNet: 95,
        unitPriceGross: 114,
        priceKind: { id: 'kind-3', code: 'promo', title: 'Promo', displayMode: 'excluding-tax' },
      },
      {
        id: 'price-3',
        offer: { id: 'offer-2' },
        currencyCode: 'USD',
        unitPriceNet: 80,
        unitPriceGross: 96,
        priceKind: { id: 'kind-2', code: 'wholesale', title: 'Wholesale', displayMode: 'excluding-tax' },
      },
    ]
    const fallbackPriceRows = [
      {
        id: 'fallback-1',
        product: { id: 'prod-1' },
        offer: null,
        channelId: 'channel-1',
        currencyCode: 'USD',
        unitPriceNet: 90,
        unitPriceGross: 108,
        priceKind: { displayMode: 'excluding-tax' },
      },
      {
        id: 'fallback-2',
        product: { id: 'prod-1' },
        offer: null,
        channelId: null,
        currencyCode: 'USD',
        unitPriceNet: 95,
        unitPriceGross: 114,
        priceKind: { displayMode: 'including-tax' },
      },
    ]
    const em = {
      find: jest.fn(async (entity, where) => {
        if (entity === CatalogProduct) {
          return productRows
        }
        if (entity === CatalogProductPrice) {
          if (where && 'offer' in where && where.offer !== null) {
            return offerPriceRows
          }
          const hasFallbackTargets = Boolean((where as any)?.$or || (where as any)?.$and)
          if (hasFallbackTargets) {
            return fallbackPriceRows
          }
        }
        return []
      }),
    }
    const ctx = { query: { channelId: 'channel-1' }, container: { resolve: jest.fn().mockReturnValue(em) } } as any

    await decorateOffersWithDetails(items, ctx)

    expect(items[0].product).toEqual({
      id: 'prod-1',
      title: 'Sneakers',
      defaultMediaId: 'media-1',
      defaultMediaUrl: 'cdn/setup/1.jpg',
      sku: 'SKU-1',
    })
    expect(items[0].prices).toHaveLength(2)
    expect(items[0].prices[0]).toEqual(
      expect.objectContaining({
        priceKindCode: 'retail',
        currencyCode: 'USD',
        unitPriceNet: 100,
        displayMode: 'including-tax',
      }),
    )
    expect(items[0].prices[1]).toEqual(
      expect.objectContaining({
        priceKindCode: 'promo',
        unitPriceNet: 95,
        displayMode: 'excluding-tax',
      }),
    )
    expect(items[0].productDefaultPrices).toEqual([
      expect.objectContaining({
        currencyCode: 'USD',
        unitPriceNet: 95,
        unitPriceGross: 114,
        displayMode: 'including-tax',
      }),
    ])
    expect(items[0].productChannelPrice).toEqual(expect.objectContaining({
      currencyCode: 'USD',
      unitPriceNet: 95,
      unitPriceGross: 114,
      displayMode: 'including-tax',
    }))
    expect(items[1].prices).toHaveLength(1)
    expect(items[1].productDefaultPrices).toEqual([])
    expect(items[1].productChannelPrice).toBeNull()
    expect(em.find).toHaveBeenCalledWith(CatalogProduct, expect.any(Object), expect.any(Object))
    expect(em.find).toHaveBeenCalledWith(
      CatalogProductPrice,
      expect.objectContaining({ offer: { $in: ['offer-1', 'offer-2'] } }),
      expect.objectContaining({ populate: ['priceKind'] }),
    )
  })
})
