/** @jest-environment node */

/**
 * `applyDocumentUpdate` groups each method id with its code and snapshot. A
 * PATCH that sends only the code or only the snapshot must change only that
 * field: the method id, the method relation and the other sibling stay as they
 * were. Sending the id (a new one or null) still re-derives code and snapshot.
 */

import { createContainer, asValue, InjectionMode } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { SalesOrder, SalesQuote, SalesShippingMethod } from '../../data/entities'
import '../documents'
import type { DocumentUpdateInput } from '../documents'
import { DefaultSalesCalculationService } from '../../services/salesCalculationService'
import { createSalesDocumentLockKyselyFixture } from './salesDocumentLockFixture'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string) => key,
  }),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/crud/cache')
  return {
    ...actual,
    invalidateCrudCache: jest.fn(),
  }
})

const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const QUOTE_ID = '44444444-4444-4444-8444-444444444444'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const TENANT_ID = '33333333-3333-4333-8333-333333333333'
const SHIPPING_METHOD_ID = '88888888-8888-4888-8888-888888888888'
const NEXT_SHIPPING_METHOD_ID = '66666666-6666-4666-8666-666666666666'
const PAYMENT_METHOD_ID = '99999999-9999-4999-8999-999999999999'

const SHIPPING_METHOD = { id: SHIPPING_METHOD_ID, code: 'flat_rate' }
const SHIPPING_SNAPSHOT = { id: SHIPPING_METHOD_ID, code: 'flat_rate', name: 'Flat rate' }
const PAYMENT_METHOD = { id: PAYMENT_METHOD_ID, code: 'on_account' }
const PAYMENT_SNAPSHOT = { id: PAYMENT_METHOD_ID, code: 'on_account', name: 'On account' }

const NEXT_SHIPPING_METHOD = {
  id: NEXT_SHIPPING_METHOD_ID,
  code: 'express',
  name: 'Express',
  description: null,
  carrierCode: null,
  providerKey: null,
  serviceLevel: null,
  estimatedTransitDays: null,
  baseRateNet: '0',
  baseRateGross: '0',
  currencyCode: 'USD',
  metadata: null,
}

type StoredDocument = Record<string, unknown>

function makeDocument(id: string, extra: StoredDocument = {}): StoredDocument {
  return {
    id,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
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
    shippingMethodId: SHIPPING_METHOD_ID,
    shippingMethod: SHIPPING_METHOD,
    shippingMethodCode: 'flat_rate',
    shippingMethodSnapshot: SHIPPING_SNAPSHOT,
    paymentMethodId: PAYMENT_METHOD_ID,
    paymentMethod: PAYMENT_METHOD,
    paymentMethodCode: 'on_account',
    paymentMethodSnapshot: PAYMENT_SNAPSHOT,
    comments: null,
    metadata: null,
    deletedAt: null,
    ...extra,
  }
}

function makeOrder() {
  return makeDocument(ORDER_ID, {
    orderNumber: 'O-1',
    internalNotes: null,
    paymentStatus: 'pending',
    paymentStatusEntryId: null,
    fulfillmentStatus: 'unfulfilled',
    fulfillmentStatusEntryId: null,
    exchangeRate: '1.0',
  })
}

function makeQuote() {
  return makeDocument(QUOTE_ID, { quoteNumber: 'Q-1' })
}

function makeEm(document: StoredDocument, entityClass: unknown) {
  const em = {
    findOne: jest.fn(async (requested: unknown, where: { id?: string }) => {
      if (requested === entityClass) return document
      if (requested === SalesShippingMethod && where?.id === NEXT_SHIPPING_METHOD_ID) {
        return NEXT_SHIPPING_METHOD
      }
      return null
    }),
    find: jest.fn(async () => []),
    create: jest.fn((_entityClass: unknown, data: unknown) => data),
    persist: jest.fn(),
    remove: jest.fn(),
    nativeDelete: jest.fn(async () => 0),
    getReference: jest.fn((_entityClass: unknown, id: string) => ({ id })),
    flush: jest.fn(async () => {}),
    begin: jest.fn(async () => {}),
    getKysely: () => createSalesDocumentLockKyselyFixture(String(document.id)),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    fork: (): unknown => em,
  }
  return em
}

function makeCtx(em: unknown): CommandRuntimeContext {
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({
    em: asValue(em),
    salesCalculationService: asValue(new DefaultSalesCalculationService(null)),
    dataEngine: asValue({ markOrmEntityChange: jest.fn() }),
  })
  return {
    container,
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
  } as unknown as CommandRuntimeContext
}

async function runUpdate(
  commandId: 'sales.orders.update' | 'sales.quotes.update',
  document: StoredDocument,
  entityClass: unknown,
  input: Record<string, unknown>,
) {
  const handler = commandRegistry.get<DocumentUpdateInput, { order: SalesOrder }>(commandId)
  expect(handler).toBeTruthy()
  await handler!.execute(
    { id: document.id, ...input } as unknown as DocumentUpdateInput,
    makeCtx(makeEm(document, entityClass)),
  )
  return document
}

function updateOrder(input: Record<string, unknown>) {
  return runUpdate('sales.orders.update', makeOrder(), SalesOrder, input)
}

describe('applyDocumentUpdate — method id, code and snapshot are written independently', () => {
  it('sending only shippingMethodCode changes the code and keeps the method id and snapshot', async () => {
    const order = await updateOrder({ shippingMethodCode: 'express' })

    expect(order.shippingMethodCode).toBe('express')
    expect(order.shippingMethodId).toBe(SHIPPING_METHOD_ID)
    expect(order.shippingMethod).toBe(SHIPPING_METHOD)
    expect(order.shippingMethodSnapshot).toBe(SHIPPING_SNAPSHOT)
  })

  it('sending only shippingMethodSnapshot changes the snapshot and keeps the method id and code', async () => {
    const snapshot = { note: 'carrier retry' }
    const order = await updateOrder({ shippingMethodSnapshot: snapshot })

    expect(order.shippingMethodSnapshot).toEqual(snapshot)
    expect(order.shippingMethodId).toBe(SHIPPING_METHOD_ID)
    expect(order.shippingMethod).toBe(SHIPPING_METHOD)
    expect(order.shippingMethodCode).toBe('flat_rate')
  })

  it('sending only paymentMethodCode changes the code and keeps the method id and snapshot', async () => {
    const order = await updateOrder({ paymentMethodCode: 'invoice' })

    expect(order.paymentMethodCode).toBe('invoice')
    expect(order.paymentMethodId).toBe(PAYMENT_METHOD_ID)
    expect(order.paymentMethod).toBe(PAYMENT_METHOD)
    expect(order.paymentMethodSnapshot).toBe(PAYMENT_SNAPSHOT)
  })

  it('sending only paymentMethodSnapshot changes the snapshot and keeps the method id and code', async () => {
    const snapshot = { note: 'terms updated' }
    const order = await updateOrder({ paymentMethodSnapshot: snapshot })

    expect(order.paymentMethodSnapshot).toEqual(snapshot)
    expect(order.paymentMethodId).toBe(PAYMENT_METHOD_ID)
    expect(order.paymentMethod).toBe(PAYMENT_METHOD)
    expect(order.paymentMethodCode).toBe('on_account')
  })

  it('sending shippingMethodCode and shippingMethodSnapshot without an id keeps the method id', async () => {
    const snapshot = { code: 'express' }
    const order = await updateOrder({ shippingMethodCode: 'express', shippingMethodSnapshot: snapshot })

    expect(order.shippingMethodCode).toBe('express')
    expect(order.shippingMethodSnapshot).toEqual(snapshot)
    expect(order.shippingMethodId).toBe(SHIPPING_METHOD_ID)
    expect(order.shippingMethod).toBe(SHIPPING_METHOD)
  })

  it('a quote update with only shippingMethodCode keeps the quote shipping method id', async () => {
    const quote = await runUpdate('sales.quotes.update', makeQuote(), SalesQuote, {
      shippingMethodCode: 'express',
    })

    expect(quote.shippingMethodCode).toBe('express')
    expect(quote.shippingMethodId).toBe(SHIPPING_METHOD_ID)
    expect(quote.shippingMethodSnapshot).toBe(SHIPPING_SNAPSHOT)
  })

  it('an explicit shippingMethodId: null still clears the method, its code and its snapshot', async () => {
    const order = await updateOrder({ shippingMethodId: null })

    expect(order.shippingMethodId).toBeNull()
    expect(order.shippingMethod).toBeNull()
    expect(order.shippingMethodCode).toBeNull()
    expect(order.shippingMethodSnapshot).toBeNull()
    expect(order.paymentMethodId).toBe(PAYMENT_METHOD_ID)
  })

  it('a new shippingMethodId re-derives the code and snapshot from the selected method', async () => {
    const order = await updateOrder({ shippingMethodId: NEXT_SHIPPING_METHOD_ID })

    expect(order.shippingMethodId).toBe(NEXT_SHIPPING_METHOD_ID)
    expect(order.shippingMethod).toBe(NEXT_SHIPPING_METHOD)
    expect(order.shippingMethodCode).toBe('express')
    expect(order.shippingMethodSnapshot).toEqual(
      expect.objectContaining({ id: NEXT_SHIPPING_METHOD_ID, code: 'express', name: 'Express' }),
    )
  })
})
