import { buildPriceFilters } from '../prices/route'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

describe('catalog prices route helpers', () => {
  it('builds filters for all supported fields', async () => {
    const filters = await buildPriceFilters({
      productId: 'prod',
      variantId: 'variant',
      offerId: 'offer',
      channelId: 'channel',
      currencyCode: ' usd ',
      priceKindId: 'pk1',
      kind: 'sale',
      userId: 'user',
      userGroupId: 'user-group',
      customerId: 'customer',
      customerGroupId: 'customer-group',
    } as any)

    expect(filters).toEqual({
      product_id: { $eq: 'prod' },
      variant_id: { $eq: 'variant' },
      offer_id: { $eq: 'offer' },
      channel_id: { $eq: 'channel' },
      currency_code: { $eq: 'USD' },
      price_kind_id: { $eq: 'pk1' },
      kind: { $eq: 'sale' },
      user_id: { $eq: 'user' },
      user_group_id: { $eq: 'user-group' },
      customer_id: { $eq: 'customer' },
      customer_group_id: { $eq: 'customer-group' },
    })
  })
})
