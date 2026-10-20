import { orderCreateSchema } from '@open-mercato/core/modules/sales/data/validators'
import {
  buildOrderCommandInput,
  mapShopifyPaymentStatusValue,
  resolveLineTaxRate,
  splitPersonName,
} from '../lib/map'
import type { ShopifyCustomerNode, ShopifyOrderLineNode, ShopifyOrderNode } from '../lib/types'

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

const baseLine = (overrides: Partial<ShopifyOrderLineNode> = {}): ShopifyOrderLineNode => ({
  id: 'gid://shopify/LineItem/1',
  title: 'Beans',
  sku: 'BEAN',
  quantity: 1,
  variantId: 'gid://shopify/ProductVariant/9',
  originalUnitPrice: { amount: '123.00', currencyCode: 'EUR' },
  discountedUnitPrice: { amount: '123.00', currencyCode: 'EUR' },
  discountTotal: null,
  taxTotal: { amount: '23.00', currencyCode: 'EUR' },
  taxRate: 23,
  totalPrice: { amount: '123.00', currencyCode: 'EUR' },
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

describe('resolveLineTaxRate', () => {
  it('prefers Shopify ratePercentage and otherwise derives from amounts', () => {
    expect(resolveLineTaxRate(baseLine({ taxRate: 23 }), true)).toBe(23)
    expect(resolveLineTaxRate(baseLine({ taxRate: null }), true)).toBe(23)
    expect(resolveLineTaxRate(baseLine({
      taxRate: null,
      taxTotal: { amount: '8.00', currencyCode: 'USD' },
      totalPrice: { amount: '100.00', currencyCode: 'USD' },
    },), false)).toBe(8)
  })
})

describe('mapShopifyPaymentStatusValue', () => {
  it('maps PAID to received', () => {
    expect(mapShopifyPaymentStatusValue('PAID')).toBe('received')
    expect(mapShopifyPaymentStatusValue('AUTHORIZED')).toBe('authorized')
    expect(mapShopifyPaymentStatusValue(null)).toBeNull()
  })
})

describe('buildOrderCommandInput', () => {
  const order: ShopifyOrderNode = {
    id: 'gid://shopify/Order/10',
    name: '#1001',
    email: 'cafe@example.com',
    createdAt: '2026-10-01T00:00:00.000Z',
    currencyCode: 'eur',
    taxesIncluded: true,
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'UNFULFILLED',
    customerId: 'gid://shopify/Customer/1',
    total: { amount: '12.00', currencyCode: 'EUR' },
    subtotal: { amount: '12.00', currencyCode: 'EUR' },
    totalDiscounts: { amount: '0.00', currencyCode: 'EUR' },
    totalShipping: { amount: '0.00', currencyCode: 'EUR' },
    totalTax: { amount: '0.00', currencyCode: 'EUR' },
    shippingLines: [],
    lines: [
      {
        id: 'gid://shopify/LineItem/1',
        title: 'Beans',
        sku: 'BEAN',
        quantity: 2,
        variantId: 'gid://shopify/ProductVariant/9',
        originalUnitPrice: { amount: '6.00', currencyCode: 'EUR' },
        discountedUnitPrice: { amount: '6.00', currencyCode: 'EUR' },
        discountTotal: null,
        taxTotal: null,
        taxRate: null,
        totalPrice: { amount: '12.00', currencyCode: 'EUR' },
      },
      {
        id: 'gid://shopify/LineItem/2',
        title: 'Removed',
        sku: null,
        quantity: 0,
        variantId: null,
        originalUnitPrice: null,
        discountedUnitPrice: null,
        discountTotal: null,
        taxTotal: null,
        taxRate: null,
        totalPrice: null,
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

  it('sends taxRate for tax-inclusive lines so net is derived correctly (#7395)', () => {
    const taxed: ShopifyOrderNode = {
      ...order,
      total: { amount: '123.00', currencyCode: 'EUR' },
      subtotal: { amount: '123.00', currencyCode: 'EUR' },
      totalTax: { amount: '23.00', currencyCode: 'EUR' },
      lines: [baseLine()],
    }
    const input = buildOrderCommandInput({
      scope: { organizationId, tenantId },
      order: taxed,
      customerEntityId: personId,
      catalogByVariantId: new Map([
        ['gid://shopify/ProductVariant/9', { productId, variantId }],
      ]),
      paymentStatusEntryId: '66666666-6666-4666-8666-666666666666',
    })
    const lines = input.lines as Array<Record<string, unknown>>
    expect(lines[0]).toMatchObject({
      priceMode: 'gross',
      unitPriceGross: 123,
      taxRate: 23,
      taxAmount: 23,
      totalGrossAmount: 123,
    })
    expect(input.paymentStatusEntryId).toBe('66666666-6666-4666-8666-666666666666')
    expect(orderCreateSchema.parse(input).lines?.[0]).toMatchObject({ taxRate: 23 })
  })

  it('maps line discounts, shipping, and tax-exclusive prices', () => {
    const discounted: ShopifyOrderNode = {
      ...order,
      taxesIncluded: false,
      total: { amount: '88.00', currencyCode: 'EUR' },
      subtotal: { amount: '80.00', currencyCode: 'EUR' },
      totalDiscounts: { amount: '20.00', currencyCode: 'EUR' },
      totalShipping: { amount: '8.00', currencyCode: 'EUR' },
      totalTax: { amount: '0.00', currencyCode: 'EUR' },
      shippingLines: [{
        id: 'gid://shopify/ShippingLine/1',
        title: 'Standard',
        originalPrice: { amount: '8.00', currencyCode: 'EUR' },
        discountedPrice: { amount: '8.00', currencyCode: 'EUR' },
        taxTotal: null,
        taxRate: null,
      }],
      lines: [{
        id: 'gid://shopify/LineItem/1',
        title: 'Beans',
        sku: 'BEAN',
        quantity: 1,
        variantId: 'gid://shopify/ProductVariant/9',
        originalUnitPrice: { amount: '100.00', currencyCode: 'EUR' },
        discountedUnitPrice: { amount: '80.00', currencyCode: 'EUR' },
        discountTotal: { amount: '20.00', currencyCode: 'EUR' },
        taxTotal: { amount: '0.00', currencyCode: 'EUR' },
        taxRate: null,
        totalPrice: { amount: '80.00', currencyCode: 'EUR' },
      }],
    }
    const input = buildOrderCommandInput({
      scope: { organizationId, tenantId },
      order: discounted,
      customerEntityId: personId,
      catalogByVariantId: new Map([
        ['gid://shopify/ProductVariant/9', { productId, variantId }],
      ]),
    })
    const lines = input.lines as Array<Record<string, unknown>>
    expect(lines[0]).toMatchObject({
      priceMode: 'net',
      unitPriceNet: 100,
      discountAmount: 20,
      discountAmountBasis: 'line',
    })
    const adjustments = input.adjustments as Array<Record<string, unknown>>
    expect(adjustments).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'shipping', amountNet: 8, label: 'Standard' }),
    ]))
    expect(orderCreateSchema.parse(input).adjustments).toHaveLength(1)
  })

  it('maps taxed shipping with net/gross split (#7396)', () => {
    const withShippingTax: ShopifyOrderNode = {
      ...order,
      taxesIncluded: false,
      total: { amount: '118.80', currencyCode: 'USD' },
      subtotal: { amount: '100.00', currencyCode: 'USD' },
      totalShipping: { amount: '10.00', currencyCode: 'USD' },
      totalTax: { amount: '8.80', currencyCode: 'USD' },
      currencyCode: 'USD',
      shippingLines: [{
        id: 'gid://shopify/ShippingLine/1',
        title: 'Standard',
        originalPrice: { amount: '10.00', currencyCode: 'USD' },
        discountedPrice: { amount: '10.00', currencyCode: 'USD' },
        taxTotal: { amount: '0.80', currencyCode: 'USD' },
        taxRate: 8,
      }],
      lines: [baseLine({
        originalUnitPrice: { amount: '100.00', currencyCode: 'USD' },
        discountedUnitPrice: { amount: '100.00', currencyCode: 'USD' },
        taxTotal: { amount: '8.00', currencyCode: 'USD' },
        taxRate: 8,
        totalPrice: { amount: '100.00', currencyCode: 'USD' },
      })],
    }
    const input = buildOrderCommandInput({
      scope: { organizationId, tenantId },
      order: withShippingTax,
      customerEntityId: personId,
      catalogByVariantId: new Map([
        ['gid://shopify/ProductVariant/9', { productId, variantId }],
      ]),
    })
    const adjustments = input.adjustments as Array<Record<string, unknown>>
    expect(adjustments[0]).toMatchObject({
      kind: 'shipping',
      amountNet: 10,
      amountGross: 10.8,
      metadata: expect.objectContaining({ taxRate: 8 }),
    })
    const lines = input.lines as Array<Record<string, unknown>>
    expect(lines[0]).toMatchObject({ priceMode: 'net', taxRate: 8, taxAmount: 8 })
  })

  it('does not double-count a free-shipping discount as an order discount', () => {
    const freeShip: ShopifyOrderNode = {
      ...order,
      taxesIncluded: false,
      totalDiscounts: { amount: '8.00', currencyCode: 'EUR' },
      totalShipping: { amount: '0.00', currencyCode: 'EUR' },
      shippingLines: [{
        id: 'gid://shopify/ShippingLine/1',
        title: 'Standard',
        originalPrice: { amount: '8.00', currencyCode: 'EUR' },
        discountedPrice: { amount: '0.00', currencyCode: 'EUR' },
        taxTotal: null,
        taxRate: null,
      }],
      lines: [{
        id: 'gid://shopify/LineItem/1',
        title: 'Beans',
        sku: 'BEAN',
        quantity: 1,
        variantId: 'gid://shopify/ProductVariant/9',
        originalUnitPrice: { amount: '80.00', currencyCode: 'EUR' },
        discountedUnitPrice: { amount: '80.00', currencyCode: 'EUR' },
        discountTotal: null,
        taxTotal: null,
        taxRate: null,
        totalPrice: { amount: '80.00', currencyCode: 'EUR' },
      }],
    }
    const input = buildOrderCommandInput({
      scope: { organizationId, tenantId },
      order: freeShip,
      customerEntityId: personId,
      catalogByVariantId: new Map([
        ['gid://shopify/ProductVariant/9', { productId, variantId }],
      ]),
    })
    const adjustments = (input.adjustments as Array<Record<string, unknown>> | undefined) ?? []
    expect(adjustments.find((adj) => adj.kind === 'discount')).toBeUndefined()
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
