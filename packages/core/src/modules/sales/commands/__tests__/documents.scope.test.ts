/** @jest-environment node */

/**
 * Tests that all findWithDecryption(SalesDocumentAddress, ...) calls include
 * organizationId and tenantId filters, preventing cross-tenant data leaks.
 *
 * Fixed in: packages/core/src/modules/sales/commands/documents.ts
 *   - loadQuoteSnapshot (line ~1179)
 *   - loadOrderSnapshot (line ~1435)
 *   - deleteQuoteCommand.execute (line ~4497)
 *   - deleteOrderCommand.execute (line ~5424)
 *   - convertQuoteToOrderCommand (line ~5801)
 */

import { createContainer, asValue, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  SalesQuote,
  SalesQuoteLine,
  SalesQuoteAdjustment,
  SalesOrder,
  SalesOrderLine,
  SalesOrderAdjustment,
  SalesShipment,
  SalesPayment,
  SalesPaymentAllocation,
  SalesDocumentAddress,
  SalesNote,
  SalesDocumentTagAssignment,
} from '../../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string) => key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
  findOneWithDecryption: jest.fn(async () => null),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(async () => ({})),
}))

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const QUOTE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ORDER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function makeQuote(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: QUOTE_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    quoteNumber: 'Q-1',
    status: null,
    statusEntryId: null,
    customerEntityId: null,
    customerContactId: null,
    customerSnapshot: null,
    billingAddressId: null,
    shippingAddressId: null,
    billingAddressSnapshot: null,
    shippingAddressSnapshot: null,
    currencyCode: 'USD',
    exchangeRate: null,
    taxStrategyKey: null,
    discountStrategyKey: null,
    taxInfo: null,
    shippingMethodId: null,
    shippingMethodCode: null,
    shippingMethodSnapshot: null,
    deliveryWindowId: null,
    deliveryWindowCode: null,
    paymentMethodId: null,
    paymentMethodCode: null,
    paymentMethodSnapshot: null,
    channelId: null,
    placedAt: null,
    expectedDeliveryAt: null,
    dueAt: null,
    comments: null,
    internalNotes: null,
    metadata: null,
    customFieldSetId: null,
    subtotalNetAmount: '0',
    subtotalGrossAmount: '0',
    discountTotalAmount: '0',
    taxTotalAmount: '0',
    shippingNetAmount: '0',
    shippingGrossAmount: '0',
    surchargeTotalAmount: '0',
    grandTotalNetAmount: '0',
    grandTotalGrossAmount: '0',
    lineItemCount: 0,
    totalsSnapshot: null,
    deletedAt: null,
    ...overrides,
  }
}

function makeOrder(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: ORDER_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    orderNumber: 'O-1',
    status: null,
    statusEntryId: null,
    fulfillmentStatusEntryId: null,
    fulfillmentStatus: null,
    paymentStatusEntryId: null,
    paymentStatus: null,
    customerEntityId: null,
    customerContactId: null,
    customerSnapshot: null,
    billingAddressId: null,
    shippingAddressId: null,
    billingAddressSnapshot: null,
    shippingAddressSnapshot: null,
    currencyCode: 'USD',
    exchangeRate: null,
    taxStrategyKey: null,
    discountStrategyKey: null,
    taxInfo: null,
    shippingMethodId: null,
    shippingMethodCode: null,
    shippingMethodSnapshot: null,
    deliveryWindowId: null,
    deliveryWindowCode: null,
    paymentMethodId: null,
    paymentMethodCode: null,
    paymentMethodSnapshot: null,
    channelId: null,
    placedAt: null,
    expectedDeliveryAt: null,
    dueAt: null,
    comments: null,
    internalNotes: null,
    metadata: null,
    customFieldSetId: null,
    subtotalNetAmount: '0',
    subtotalGrossAmount: '0',
    discountTotalAmount: '0',
    taxTotalAmount: '0',
    shippingNetAmount: '0',
    shippingGrossAmount: '0',
    surchargeTotalAmount: '0',
    grandTotalNetAmount: '0',
    grandTotalGrossAmount: '0',
    paidTotalAmount: '0',
    refundedTotalAmount: '0',
    outstandingAmount: '0',
    lineItemCount: 0,
    totalsSnapshot: null,
    deletedAt: null,
    ...overrides,
  }
}

function makeEmForQuote(quote: ReturnType<typeof makeQuote>) {
  const findMock = jest.fn(async (entityClass: unknown) => {
    return []
  })
  const em: any = {
    findOne: jest.fn(async (entityClass: unknown) => {
      if (entityClass === SalesQuote) return quote
      return null
    }),
    find: findMock,
    nativeDelete: jest.fn(async () => 0),
    remove: jest.fn(),
    flush: jest.fn(async () => {}),
    fork: function () { return this },
  }
  return { em, findMock }
}

function makeEmForOrder(order: ReturnType<typeof makeOrder>) {
  const findMock = jest.fn(async (entityClass: unknown) => {
    return []
  })
  const em: any = {
    findOne: jest.fn(async (entityClass: unknown) => {
      if (entityClass === SalesOrder) return order
      return null
    }),
    find: findMock,
    nativeDelete: jest.fn(async () => 0),
    remove: jest.fn(),
    flush: jest.fn(async () => {}),
    fork: function () { return this },
  }
  return { em, findMock }
}

function makeCtx(em: unknown, organizationId: string, tenantId: string) {
  const dataEngine = { markOrmEntityChange: jest.fn() }
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({
    em: asValue(em),
    dataEngine: asValue(dataEngine),
    salesDocumentNumberGenerator: asValue({ generate: jest.fn(async () => ({ number: 'N-1' })) }),
  })
  return {
    container,
    dataEngine,
    auth: { tenantId, orgId: organizationId, sub: 'user-1' },
    selectedOrganizationId: organizationId,
    organizationScope: null,
    organizationIds: null,
  }
}

/**
 * Filter findWithDecryption mock calls where the entity class is SalesDocumentAddress.
 * findWithDecryption signature: (em, entityName, where, options?, scope?)
 * so entityName is args[1] and where is args[2].
 */
function addressDecryptionCalls() {
  return (findWithDecryption as jest.Mock).mock.calls.filter(
    ([, entityClass]) => entityClass === SalesDocumentAddress,
  )
}

describe('SalesDocumentAddress query scoping', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  beforeEach(() => {
    (findWithDecryption as jest.Mock).mockClear()
  })

  describe('deleteQuoteCommand.execute — scopes SalesDocumentAddress by quote tenant', () => {
    it('passes organizationId from quote to findWithDecryption(SalesDocumentAddress)', async () => {
      const quote = makeQuote()
      const { em } = makeEmForQuote(quote)
      const ctx = makeCtx(em, ORG_ID, TENANT_ID)

      const handler = commandRegistry.get('sales.quotes.delete')
      expect(handler).toBeTruthy()

      await handler!.execute({ id: QUOTE_ID }, ctx as any)

      const calls = addressDecryptionCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0][2]).toMatchObject({
        documentId: QUOTE_ID,
        documentKind: 'quote',
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
      })
    })

    it('uses the quote organizationId, not a hard-coded value', async () => {
      const differentOrg = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
      const differentTenant = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
      const quote = makeQuote({ organizationId: differentOrg, tenantId: differentTenant })
      const { em } = makeEmForQuote(quote)
      const ctx = makeCtx(em, differentOrg, differentTenant)

      const handler = commandRegistry.get('sales.quotes.delete')
      await handler!.execute({ id: QUOTE_ID }, ctx as any)

      const calls = addressDecryptionCalls()
      expect(calls[0][2]).toMatchObject({
        organizationId: differentOrg,
        tenantId: differentTenant,
      })
    })
  })

  describe('deleteOrderCommand.execute — scopes SalesDocumentAddress by order tenant', () => {
    it('passes organizationId from order to findWithDecryption(SalesDocumentAddress)', async () => {
      const order = makeOrder()
      const { em } = makeEmForOrder(order)
      const ctx = makeCtx(em, ORG_ID, TENANT_ID)

      const handler = commandRegistry.get('sales.orders.delete')
      expect(handler).toBeTruthy()

      await handler!.execute({ id: ORDER_ID }, ctx as any)

      const calls = addressDecryptionCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0][2]).toMatchObject({
        documentId: ORDER_ID,
        documentKind: 'order',
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
      })
    })

    it('uses the order organizationId, not a hard-coded value', async () => {
      const differentOrg = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
      const differentTenant = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
      const order = makeOrder({ organizationId: differentOrg, tenantId: differentTenant })
      const { em } = makeEmForOrder(order)
      const ctx = makeCtx(em, differentOrg, differentTenant)

      const handler = commandRegistry.get('sales.orders.delete')
      await handler!.execute({ id: ORDER_ID }, ctx as any)

      const calls = addressDecryptionCalls()
      expect(calls[0][2]).toMatchObject({
        organizationId: differentOrg,
        tenantId: differentTenant,
      })
    })
  })

  describe('loadQuoteSnapshot (via deleteQuoteCommand.prepare) — scopes SalesDocumentAddress', () => {
    it('findWithDecryption(SalesDocumentAddress) includes organizationId and tenantId from quote', async () => {
      const quote = makeQuote()
      const { em } = makeEmForQuote(quote)
      const ctx = makeCtx(em, ORG_ID, TENANT_ID)

      const handler = commandRegistry.get('sales.quotes.delete')
      expect(handler).toBeTruthy()

      await handler!.prepare({ id: QUOTE_ID }, ctx as any)

      const calls = addressDecryptionCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0][2]).toMatchObject({
        documentId: QUOTE_ID,
        documentKind: 'quote',
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
      })
    })
  })

  describe('loadOrderSnapshot (via deleteOrderCommand.prepare) — scopes SalesDocumentAddress', () => {
    it('findWithDecryption(SalesDocumentAddress) includes organizationId and tenantId from order', async () => {
      const order = makeOrder()
      const { em } = makeEmForOrder(order)
      const ctx = makeCtx(em, ORG_ID, TENANT_ID)

      const handler = commandRegistry.get('sales.orders.delete')
      expect(handler).toBeTruthy()

      await handler!.prepare({ id: ORDER_ID }, ctx as any)

      const calls = addressDecryptionCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0][2]).toMatchObject({
        documentId: ORDER_ID,
        documentKind: 'order',
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
      })
    })
  })
})
