import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesOrder } from '@open-mercato/core/modules/sales/data/entities'
import { createShopifyImporter } from '../lib/importer'
import type { ShopifyOrderNode } from '../lib/types'

jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))
jest.mock('@open-mercato/core/modules/catalog/data/entities', () => ({
  CatalogPriceKind: class CatalogPriceKind {},
  CatalogProduct: class CatalogProduct {},
  CatalogProductPrice: class CatalogProductPrice {},
  CatalogProductVariant: class CatalogProductVariant {},
}))
jest.mock('@open-mercato/core/modules/customers/data/entities', () => ({
  CustomerEntity: class CustomerEntity {},
}))
jest.mock('@open-mercato/core/modules/sales/data/entities', () => ({ SalesOrder: class SalesOrder {} }))
jest.mock('@open-mercato/core/modules/dictionaries/data/entities', () => ({
  Dictionary: class Dictionary {},
  DictionaryEntry: class DictionaryEntry {},
}))

const scope = { organizationId: 'org', tenantId: 'tenant' }
const money = (amount: string) => ({ amount, currencyCode: 'EUR' })
const order: ShopifyOrderNode = {
  id: 'gid://shopify/Order/1',
  name: '#1',
  email: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  currencyCode: 'EUR',
  taxesIncluded: false,
  displayFinancialStatus: 'PAID',
  displayFulfillmentStatus: null,
  customerId: null,
  total: money('100.00'),
  subtotal: money('100.00'),
  totalDiscounts: null,
  totalShipping: null,
  totalTax: null,
  shippingLines: [],
  lines: [{
    id: 'gid://shopify/LineItem/1',
    title: 'Product',
    sku: null,
    quantity: 1,
    variantId: null,
    originalUnitPrice: money('100.00'),
    discountedUnitPrice: money('100.00'),
    discountTotal: null,
    taxTotal: null,
    taxRate: null,
    totalPrice: money('100.00'),
  }],
}

describe('Shopify imported payments', () => {
  let localId: string | null
  let execute: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    localId = null
    execute = jest.fn(async (id: string) => ({
      result: id === 'sales.orders.create' ? { orderId: 'order-1' } : { paymentId: 'payment-1' },
    }))
    const em = {
      fork: () => em,
      findOne: jest.fn(async () => null),
    }
    const mapping = {
      lookupLocalId: jest.fn(async () => localId),
      storeExternalIdMapping: jest.fn(async () => { localId = 'order-1' }),
    }
    const container = {
      resolve(key: string) {
        if (key === 'em') return em
        if (key === 'externalIdMappingService') return mapping
        if (key === 'commandBus') return { execute }
        throw new Error(`[internal] Unexpected service ${key}`)
      },
    }
    jest.mocked(createRequestContainer).mockResolvedValue(container as never)
    jest.mocked(findOneWithDecryption).mockImplementation(async (_em, entity) => (
      entity === SalesOrder && localId ? { id: localId, customerEntityId: null } : null
    ) as never)
  })

  it.each([
    ['PARTIALLY_PAID', '30.00', '0.00', 30, 0],
    ['PARTIALLY_REFUNDED', '100.00', '50.00', 100, 50],
    ['REFUNDED', '100.00', '100.00', 100, 100],
    ['PAID', '100.00', '0.00', 100, 0],
  ])('records source captured/refunded amounts for %s without duplicate payments', async (
    displayFinancialStatus, received, refunded, capturedAmount, refundedAmount,
  ) => {
    const importer = await createShopifyImporter(scope)
    const sourceOrder = {
      ...order,
      displayFinancialStatus,
      totalReceived: money(received),
      totalRefunded: money(refunded),
    }
    expect((await importer.upsertOrder(sourceOrder)).action).toBe('create')
    expect(execute).toHaveBeenCalledWith('sales.payments.create', expect.objectContaining({
      input: expect.objectContaining({
        ...scope,
        orderId: 'order-1',
        amount: capturedAmount,
        capturedAmount,
        refundedAmount,
        currencyCode: 'EUR',
      }),
    }))
    expect((await importer.upsertOrder(sourceOrder)).action).toBe('skip')
    expect(execute.mock.calls.filter(([id]) => id === 'sales.payments.create')).toHaveLength(1)
  })

  it('does not manufacture a payment for an unpaid order', async () => {
    const importer = await createShopifyImporter(scope)
    await importer.upsertOrder({ ...order, displayFinancialStatus: 'PENDING', totalReceived: money('0.00') })
    expect(execute.mock.calls.map(([id]) => id)).toEqual(['sales.orders.create'])
  })

  it('keeps PAID imports compatible when the source has no payment aggregates', async () => {
    const importer = await createShopifyImporter(scope)
    await importer.upsertOrder(order)
    expect(execute).toHaveBeenCalledWith('sales.payments.create', expect.objectContaining({
      input: expect.objectContaining({ amount: 100, capturedAmount: 100, refundedAmount: 0 }),
    }))
  })
})
