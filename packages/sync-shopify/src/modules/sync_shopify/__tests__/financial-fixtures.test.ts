import { calculateDocumentTotals } from '@open-mercato/core/modules/sales/lib/calculations'
import { orderCreateSchema } from '@open-mercato/core/modules/sales/data/validators'
import { createShopifyClient } from '../lib/client'
import { createFakeShopifyFetch, FAKE_SHOPIFY_SHOP_DOMAIN } from '../lib/fake-api'
import { buildOrderCommandInput } from '../lib/map'

const scope = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
}

it('calculates the financial regression fixtures through the real client, mapper, and sales engine', async () => {
  const client = createShopifyClient({ shopDomain: FAKE_SHOPIFY_SHOP_DOMAIN, accessToken: 'test' }, {
    fetchImpl: createFakeShopifyFetch(),
  })
  const page = await client.listOrders(null, 25)
  for (const fixture of [
    { id: '9005', net: 90, tax: 20.7, gross: 110.7, paid: 110.7, refunded: 0, outstanding: 0 },
    { id: '9006', net: 100, tax: 23, gross: 123, paid: 40, refunded: 0, outstanding: 83 },
    { id: '9007', net: 50, tax: 11.5, gross: 61.5, paid: 123, refunded: 61.5, outstanding: 0 },
    { id: '9008', net: 0, tax: 0, gross: 0, paid: 123, refunded: 123, outstanding: 0 },
  ]) {
    const order = page.nodes.find((candidate) => candidate.id === `gid://shopify/Order/${fixture.id}`)
    expect(order).toBeDefined()
    const input = orderCreateSchema.parse(buildOrderCommandInput({
      scope,
      order: order!,
      customerEntityId: null,
      catalogByVariantId: new Map(),
    }))
    const result = await calculateDocumentTotals({
      documentKind: 'order',
      lines: input.lines!,
      adjustments: input.adjustments,
      context: { ...scope, currencyCode: 'EUR' },
      existingTotals: { paidTotalAmount: fixture.paid, refundedTotalAmount: fixture.refunded },
    })
    expect(result.totals.grandTotalNetAmount).toBeCloseTo(fixture.net, 4)
    expect(result.totals.taxTotalAmount).toBeCloseTo(fixture.tax, 4)
    expect(result.totals.grandTotalGrossAmount).toBeCloseTo(fixture.gross, 4)
    expect(result.totals.outstandingAmount).toBeCloseTo(fixture.outstanding, 4)
  }
})
