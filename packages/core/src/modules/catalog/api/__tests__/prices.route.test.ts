import { buildPriceFilters } from '../prices/route'

describe('catalog prices route helpers', () => {
  it('builds filters for all supported fields', async () => {
    const filters = await buildPriceFilters({
      productId: 'prod',
      variantId: 'variant',
      offerId: 'offer',
      channelId: 'channel',
      currencyCode: ' usd ',
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
      kind: { $eq: 'sale' },
      user_id: { $eq: 'user' },
      user_group_id: { $eq: 'user-group' },
      customer_id: { $eq: 'customer' },
      customer_group_id: { $eq: 'customer-group' },
    })
  })
})
