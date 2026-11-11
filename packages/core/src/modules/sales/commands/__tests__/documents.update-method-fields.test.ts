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
import { SalesOrder, SalesShippingMethod } from '../../data/entities'
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

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/crud/cache'),
  invalidateCrudCache: jest.fn(),
}))

const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const TENANT_ID = '33333333-3333-4333-8333-333333333333'
const SHIPPING_METHOD_ID = '88888888-8888-4888-8888-888888888888'
const NEXT_SHIPPING_METHOD_ID = '66666666-6666-4666-8666-666666666666'
const PAYMENT_METHOD_ID = '99999999-9999-4999-8999-999999999999'

const SHIPPING_METHOD = { id: SHIPPING_METHOD_ID, code: 'flat_rate' }
const SHIPPING_SNAPSHOT = { id: SHIPPING_METHOD_ID, code: 'flat_rate' }
const PAYMENT_METHOD = { id: PAYMENT_METHOD_ID, code: 'on_account' }
const PAYMENT_SNAPSHOT = { id: PAYMENT_METHOD_ID, code: 'on_account' }
const NEXT_SHIPPING_METHOD = { id: NEXT_SHIPPING_METHOD_ID, code: 'express', name: 'Express', metadata: null }

type StoredDocument = Record<string, unknown>

function makeOrder(): StoredDocument {
  return {
    id: ORDER_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    orderNumber: 'O-1',
    status: null,
    currencyCode: 'USD',
    shippingMethodId: SHIPPING_METHOD_ID,
    shippingMethod: SHIPPING_METHOD,
    shippingMethodCode: 'flat_rate',
    shippingMethodSnapshot: SHIPPING_SNAPSHOT,
    paymentMethodId: PAYMENT_METHOD_ID,
    paymentMethod: PAYMENT_METHOD,
    paymentMethodCode: 'on_account',
    paymentMethodSnapshot: PAYMENT_SNAPSHOT,
    deletedAt: null,
  }
}

function makeEm(order: StoredDocument) {
  const em = {
    findOne: jest.fn(async (requested: unknown, where: { id?: string }) => {
      if (requested === SalesOrder) return order
      if (requested === SalesShippingMethod && where?.id === NEXT_SHIPPING_METHOD_ID) return NEXT_SHIPPING_METHOD
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
    getKysely: () => createSalesDocumentLockKyselyFixture(ORDER_ID),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    fork: (): unknown => em,
  }
  return em
}

async function updateOrder(input: Record<string, unknown>) {
  const order = makeOrder()
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({
    em: asValue(makeEm(order)),
    salesCalculationService: asValue(new DefaultSalesCalculationService(null)),
    dataEngine: asValue({ markOrmEntityChange: jest.fn() }),
  })
  const ctx = {
    container,
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
  } as unknown as CommandRuntimeContext
  const handler = commandRegistry.get<DocumentUpdateInput, { order: SalesOrder }>('sales.orders.update')
  expect(handler).toBeTruthy()
  await handler!.execute({ id: ORDER_ID, ...input } as unknown as DocumentUpdateInput, ctx)
  return order
}

describe('applyDocumentUpdate — method id, code and snapshot are written independently', () => {
  it.each([
    ['shipping', { shippingMethodCode: 'express' }],
    ['shipping', { shippingMethodSnapshot: { note: 'carrier retry' } }],
    ['shipping', { shippingMethodCode: 'express', shippingMethodSnapshot: { code: 'express' } }],
    ['payment', { paymentMethodCode: 'invoice' }],
    ['payment', { paymentMethodSnapshot: { note: 'terms updated' } }],
  ] as const)('a %s update with %j keeps the method and the fields it did not send', async (kind, input) => {
    const expected: StoredDocument = { ...makeOrder(), ...input }
    const order = await updateOrder(input)

    expect(order[`${kind}MethodId`]).toBe(expected[`${kind}MethodId`])
    expect(order[`${kind}Method`]).toBe(expected[`${kind}Method`])
    expect(order[`${kind}MethodCode`]).toEqual(expected[`${kind}MethodCode`])
    expect(order[`${kind}MethodSnapshot`]).toEqual(expected[`${kind}MethodSnapshot`])
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
