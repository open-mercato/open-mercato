import { orderCreateSchema } from '@open-mercato/core/modules/sales/data/validators'
import { buildOrderCommandInput, splitPersonName } from '../lib/map'
import type { ShopifyCustomerNode, ShopifyOrderNode } from '../lib/types'

const organizationId = '11111111-1111-4111-8111-111111111111'
const tenantId = '22222222-2222-4222-8222-222222222222'
const personId = '33333333-3333-4333-8333-333333333333'
const productId = '44444444-4444-4444-8444-444444444444'
const variantId = '55555555-5555-4555-8555-555555555555'

const customer = (overrides: Partial<ShopifyCustomerNode> = {}): ShopifyCustomerNode => ({
  id: 'gid://shopify/Customer/1',
  firstName: null,
  lastName: null,
  displayName: null,
  email: null,
  phone: null,
  ...overrides,
})

describe('splitPersonName', () => {
  it('keeps explicit first and last names', () => {
    expect(splitPersonName(customer({ firstName: 'Ada', lastName: 'Lovelace', displayName: 'Ada L.' }))).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
      displayName: 'Ada L.',
    })
  })

  it('splits a display name and falls back to the email local part', () => {
    expect(splitPersonName(customer({ displayName: 'Grace Hopper' })).lastName).toBe('Hopper')
    expect(splitPersonName(customer({ email: 'cafe@example.com' }))).toMatchObject({
      firstName: 'cafe',
      lastName: 'Customer',
    })
  })
})

describe('buildOrderCommandInput', () => {
  const order: ShopifyOrderNode = {
    id: 'gid://shopify/Order/10',
    name: '#1001',
    email: 'cafe@example.com',
    createdAt: '2026-10-01T00:00:00.000Z',
    currencyCode: 'eur',
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'UNFULFILLED',
    customerId: 'gid://shopify/Customer/1',
    total: { amount: '12.00', currencyCode: 'EUR' },
    lines: [
      {
        id: 'gid://shopify/LineItem/1',
        title: 'Beans',
        sku: 'BEAN',
        quantity: 2,
        variantId: 'gid://shopify/ProductVariant/9',
        unitPrice: { amount: '6.00', currencyCode: 'EUR' },
      },
      {
        id: 'gid://shopify/LineItem/2',
        title: 'Removed',
        sku: null,
        quantity: 0,
        variantId: null,
        unitPrice: null,
      },
    ],
  }

  it('builds a gross order line and drops zero quantities', () => {
    const input = buildOrderCommandInput({
      scope: { organizationId, tenantId },
      order,
      customerEntityId: personId,
      catalogByVariantId: new Map([
        ['gid://shopify/ProductVariant/9', { productId, variantId }],
      ]),
    })
    expect(input.currencyCode).toBe('EUR')
    expect(input.orderNumber).toBe('1001')
    expect(input.customerEntityId).toBe(personId)
    const lines = input.lines as Array<Record<string, unknown>>
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      productId,
      productVariantId: variantId,
      quantity: 2,
      unitPriceGross: 6,
      priceMode: 'gross',
    })
    expect(orderCreateSchema.parse(input).lines).toHaveLength(1)
  })

  it('rejects an order with no importable lines', () => {
    expect(() => buildOrderCommandInput({
      scope: { organizationId, tenantId },
      order: { ...order, lines: [] },
      customerEntityId: null,
      catalogByVariantId: new Map(),
    })).toThrow('no importable lines')
  })
})
