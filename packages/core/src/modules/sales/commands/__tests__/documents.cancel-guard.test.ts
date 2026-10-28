/** @jest-environment node */

/**
 * Regression test for issue #4054.
 *
 * Cancelling an order through `sales.orders.update` was a plain status flip, so an
 * order with goods already shipped or money already received could be cancelled
 * without any return or refund bookkeeping. The update now refuses the transition
 * to a cancelled status while a live shipment exists or a payment is not refunded.
 */

import { createContainer, asValue, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { SalesOrder, SalesPayment, SalesShipment } from '../../data/entities'
import type { DocumentUpdateInput } from '../documents'
import '../documents'

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
  return { ...actual, invalidateCrudCache: jest.fn() }
})

const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const TENANT_ID = '33333333-3333-4333-8333-333333333333'
const CANCELED_ENTRY_ID = '55555555-5555-4555-8555-555555555555'
const CONFIRMED_ENTRY_ID = '66666666-6666-4666-8666-666666666666'

const DICTIONARY_ENTRIES: Record<string, string> = {
  [CANCELED_ENTRY_ID]: 'canceled',
  [CONFIRMED_ENTRY_ID]: 'confirmed',
}

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    orderNumber: 'O-1',
    status: 'confirmed',
    statusEntryId: CONFIRMED_ENTRY_ID,
    paidTotalAmount: '0',
    refundedTotalAmount: '0',
    currencyCode: 'USD',
    customerEntityId: null,
    customerContactId: null,
    customerSnapshot: null,
    billingAddressId: null,
    shippingAddressId: null,
    billingAddressSnapshot: null,
    shippingAddressSnapshot: null,
    shippingMethodId: null,
    shippingMethodCode: null,
    shippingMethodSnapshot: null,
    paymentMethodId: null,
    paymentMethodCode: null,
    paymentMethodSnapshot: null,
    comments: null,
    internalNotes: null,
    metadata: null,
    deletedAt: null,
    ...overrides,
  }
}

type Stored = { shipments?: Array<Record<string, unknown>>; payments?: Array<Record<string, unknown>> }

function makeEm(order: Record<string, unknown>, stored: Stored = {}) {
  const em: any = {
    findOne: jest.fn(async (requested: unknown, where: any) => {
      if (requested === SalesOrder) return order
      if (requested === DictionaryEntry) {
        const value = DICTIONARY_ENTRIES[where?.id as string]
        return value ? { id: where.id, value, tenantId: where.tenantId } : null
      }
      return null
    }),
    find: jest.fn(async (requested: unknown) => {
      if (requested === SalesShipment) return stored.shipments ?? []
      if (requested === SalesPayment) return stored.payments ?? []
      return []
    }),
    create: jest.fn((_entityClass: unknown, data: unknown) => data),
    persist: jest.fn(),
    remove: jest.fn(),
    nativeDelete: jest.fn(async () => 0),
    getReference: jest.fn((_entityClass: unknown, id: string) => ({ id })),
    flush: jest.fn(async () => {}),
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    fork: () => em,
  }
  return em
}

function makeCtx(em: unknown) {
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({
    em: asValue(em),
    dataEngine: asValue({ markOrmEntityChange: jest.fn() }),
  })
  return {
    container,
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
  } as any
}

async function runUpdate(order: Record<string, unknown>, stored: Stored, statusEntryId: string) {
  const handler = commandRegistry.get<DocumentUpdateInput, { order: SalesOrder }>('sales.orders.update')
  expect(handler).toBeTruthy()
  const em = makeEm(order, stored)
  const result = handler!.execute({ id: ORDER_ID, statusEntryId } as never, makeCtx(em))
  return { em, result }
}

describe('sales.orders.update — cancellation guard (issue #4054)', () => {
  it('refuses to cancel an order that still has a live shipment', async () => {
    const order = makeOrder()
    const { em, result } = await runUpdate(order, { shipments: [{ id: 's-1', status: 'shipped' }] }, CANCELED_ENTRY_ID)
    await expect(result).rejects.toBeInstanceOf(CrudHttpError)
    await expect(result).rejects.toMatchObject({
      status: 409,
      body: { error: 'sales.orders.errors.cancel_has_shipments' },
    })
    expect(order.status).toBe('confirmed')
    expect(em.find).toHaveBeenCalledWith(SalesShipment, expect.objectContaining({ order: ORDER_ID, deletedAt: null }), expect.anything())
  })

  it('treats a shipment without a status as live', async () => {
    const order = makeOrder()
    const { result } = await runUpdate(order, { shipments: [{ id: 's-1', status: null }] }, CANCELED_ENTRY_ID)
    await expect(result).rejects.toMatchObject({ status: 409 })
  })

  it('refuses to cancel an order with a received payment that was not refunded', async () => {
    const order = makeOrder()
    const { result } = await runUpdate(
      order,
      { payments: [{ id: 'p-1', status: 'received', amount: '120', capturedAmount: '0', refundedAmount: '20' }] },
      CANCELED_ENTRY_ID,
    )
    await expect(result).rejects.toMatchObject({
      status: 409,
      body: { error: 'sales.orders.errors.cancel_has_payments' },
    })
    expect(order.status).toBe('confirmed')
  })

  it('cancels once shipments are cancelled or returned and payments are refunded, failed or pending', async () => {
    const order = makeOrder()
    const { result } = await runUpdate(
      order,
      {
        shipments: [
          { id: 's-1', status: 'canceled' },
          { id: 's-2', status: 'returned' },
        ],
        payments: [
          { id: 'p-1', status: 'captured', amount: '120', capturedAmount: '120', refundedAmount: '120' },
          { id: 'p-2', status: 'failed', amount: '50', capturedAmount: '0', refundedAmount: '0' },
          { id: 'p-3', status: 'pending', amount: '30', capturedAmount: '0', refundedAmount: '0' },
        ],
      },
      CANCELED_ENTRY_ID,
    )
    await expect(result).resolves.toBeTruthy()
    expect(order.status).toBe('canceled')
  })

  it('does not check shipments or payments for a non-cancelling status change', async () => {
    const order = makeOrder({ status: 'draft', statusEntryId: null })
    const { em, result } = await runUpdate(order, { shipments: [{ id: 's-1', status: 'shipped' }] }, CONFIRMED_ENTRY_ID)
    await expect(result).resolves.toBeTruthy()
    expect(em.find).not.toHaveBeenCalledWith(SalesShipment, expect.anything(), expect.anything())
    expect(order.status).toBe('confirmed')
  })
})
