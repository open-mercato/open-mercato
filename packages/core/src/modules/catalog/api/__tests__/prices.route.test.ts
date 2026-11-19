import { withExactAmounts } from '@open-mercato/shared/lib/decimal'
import { priceCreateSchema } from '../../data/validators'
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

  it('keeps every digit from the route parse through the command parse', () => {
    const raw = {
      organizationId: '00000000-0000-4000-8000-000000000003',
      tenantId: '00000000-0000-4000-8000-000000000004',
      productId: '00000000-0000-4000-8000-000000000001',
      priceKindId: '00000000-0000-4000-8000-000000000002',
      currencyCode: 'ETH',
      unitPriceNet: '12345678901234.123456789012345678',
      unitPriceGross: 5,
    }
    const fields = ['unitPriceNet', 'unitPriceGross'] as const
    const routeInput = withExactAmounts(priceCreateSchema.parse(raw), raw, fields)
    expect(routeInput.unitPriceNet).toBe(12345678901234.123)

    const commandInput = withExactAmounts(priceCreateSchema.parse(routeInput), routeInput, fields)
    expect(commandInput.unitPriceNetExact).toBe('12345678901234.123456789012345678')
    expect(commandInput.unitPriceGrossExact).toBe('5')
  })
})
