/** @jest-environment node */

/**
 * `sales.orders.update` honours the command-bus `beforeTransactionalWrite` hook inside its
 * own transaction, after the order row lock and before any write. Callers that must
 * validate a precondition atomically with the update (promotions' refusal policy re-checks
 * its lifecycle lock there, #8268 re-review Finding 2) rely on both guarantees: the hook
 * sees the locked row, and a hook failure rolls the whole update back.
 */

import { createContainer, asValue, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { SalesOrder } from '../../data/entities'
import type { DocumentUpdateInput } from '../documents'
import { createSalesDocumentLockKyselyFixture } from './salesDocumentLockFixture'
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

function makeOrder() {
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
  }
}

function makeEm(order: Record<string, unknown>, timeline: string[]) {
  const lockFixture = createSalesDocumentLockKyselyFixture(ORDER_ID)
  const lockQuery = lockFixture.selectFrom()
  const originalExecuteTakeFirst = lockQuery.executeTakeFirst
  lockQuery.executeTakeFirst = async () => {
    timeline.push('row-lock')
    return originalExecuteTakeFirst()
  }
  const em: Record<string, unknown> = {
    getKysely: () => lockFixture,
    findOne: jest.fn(async (requested: unknown, where: { id?: string; tenantId?: string } | undefined) => {
      if (requested === SalesOrder) return order
      if (requested === DictionaryEntry) {
        const value = DICTIONARY_ENTRIES[where?.id ?? '']
        return value ? { id: where?.id, value, tenantId: where?.tenantId } : null
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
    begin: jest.fn(async () => {
      timeline.push('begin')
    }),
    commit: jest.fn(async () => {
      timeline.push('commit')
    }),
    rollback: jest.fn(async () => {
      timeline.push('rollback')
    }),
  }
  em.fork = () => em
  return em
}

function makeCtx(em: unknown, beforeTransactionalWrite: (em: unknown, input?: unknown) => Promise<void>) {
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
    beforeTransactionalWrite,
  } as never
}

function updateHandler() {
  const handler = commandRegistry.get<DocumentUpdateInput, { order: SalesOrder }>('sales.orders.update')
  if (!handler) throw new Error('[internal] sales.orders.update is not registered')
  return handler
}

describe('sales.orders.update — beforeTransactionalWrite hook', () => {
  it('runs the hook inside the transaction, after the order row lock and before the status write', async () => {
    const timeline: string[] = []
    const order = makeOrder()
    const em = makeEm(order, timeline)
    const hook = jest.fn(async (hookEm: unknown, input?: unknown) => {
      timeline.push(`hook:${order.status}`)
      expect(hookEm).toBe(em)
      expect(input).toEqual(expect.objectContaining({ id: ORDER_ID, statusEntryId: CANCELED_ENTRY_ID }))
    })

    await updateHandler().execute({ id: ORDER_ID, statusEntryId: CANCELED_ENTRY_ID }, makeCtx(em, hook))

    expect(hook).toHaveBeenCalledTimes(1)
    expect(timeline.indexOf('begin')).toBeLessThan(timeline.indexOf('row-lock'))
    expect(timeline.indexOf('row-lock')).toBeLessThan(timeline.indexOf('hook:confirmed'))
    expect(timeline.indexOf('hook:confirmed')).toBeLessThan(timeline.indexOf('commit'))
    expect(order.status).toBe('canceled')
  })

  it('rolls the whole update back when the hook rejects', async () => {
    const timeline: string[] = []
    const order = makeOrder()
    const em = makeEm(order, timeline)
    const hookError = new Error('[internal] precondition no longer holds')

    await expect(
      updateHandler().execute(
        { id: ORDER_ID, statusEntryId: CANCELED_ENTRY_ID },
        makeCtx(em, async () => {
          throw hookError
        }),
      ),
    ).rejects.toBe(hookError)

    expect(order.status).toBe('confirmed')
    expect(timeline).toContain('rollback')
    expect(timeline).not.toContain('commit')
  })
})
