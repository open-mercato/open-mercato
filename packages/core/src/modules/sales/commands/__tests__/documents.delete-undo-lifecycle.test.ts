/** @jest-environment node */

// #8268 review Major 2: `deleteOrderCommand`'s undo hard-recreates the order row from its
// snapshot (`restoreOrderGraph`). Before this fix, `previousStatus` was read off the
// freshly-created row AFTER its status was already set to the snapshot's own status, so it
// always equalled `nextStatus` and `emitOrderLifecycleEventsForTransition` silently skipped
// firing `sales.order.confirmed` — the one event `customer_groups:order-confirmed-credit-reinstate`
// and `promotions:order-confirmed-usage-reinstate` need to reverse what the delete handler's
// `sales.order.deleted` release/revert subscribers already did. This proves undo now emits
// that confirmation whenever the restored order is `confirmed`.

import { asValue, createContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'

jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    sales: {
      sales_order: 'sales.sales_order',
      sales_order_line: 'sales.sales_order_line',
      sales_order_adjustment: 'sales.sales_order_adjustment',
    },
  },
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(async () => ({})),
}))

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({
  setRecordCustomFields: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/helpers'),
  emitCrudSideEffects: jest.fn(async () => undefined),
  emitCrudUndoSideEffects: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
  findOneWithDecryption: jest.fn(async (em: FakeEm, entity: unknown, where: unknown, options?: unknown) =>
    em.findOne(entity, where, options),
  ),
}))

const emitSalesEventMock = jest.fn(async () => undefined)
jest.mock('../../events', () => ({ emitSalesEvent: emitSalesEventMock }))

const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORG_ID = '33333333-3333-4333-8333-333333333333'

type FakeEm = {
  findOne: jest.Mock
  find: jest.Mock
  create: jest.Mock
  persist: jest.Mock
  flush: jest.Mock
  nativeDelete: jest.Mock
  getUnitOfWork: jest.Mock
  getReference: jest.Mock
  transactional: (cb: (tx: FakeEm) => Promise<void>) => Promise<void>
  fork: () => FakeEm
}

function createFakeEm(): FakeEm {
  const em: FakeEm = {
    // The order row genuinely no longer exists — both `lockOrderForUndo`'s lookup and
    // `restoreOrderGraph`'s own lookup must see it as gone, forcing the from-scratch
    // recreate path this regression targets.
    findOne: jest.fn(async () => null),
    find: jest.fn(async () => []),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    nativeDelete: jest.fn(async () => 0),
    getUnitOfWork: jest.fn(() => ({ unsetIdentity: jest.fn() })),
    getReference: jest.fn(),
    transactional: async (cb) => { await cb(em) },
    fork: () => em,
  }
  return em
}

function buildOrderSnapshot(status: string) {
  return {
    order: {
      id: ORDER_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      orderNumber: 'ORDER-1001',
      statusEntryId: null,
      status,
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
      deliveryWindowId: null,
      deliveryWindowCode: null,
      paymentMethodId: null,
      paymentMethodCode: null,
      channelId: null,
      placedAt: null,
      expectedDeliveryAt: null,
      dueAt: null,
      comments: null,
      internalNotes: null,
      shippingMethodSnapshot: null,
      deliveryWindowSnapshot: null,
      paymentMethodSnapshot: null,
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
      totalsSnapshot: null,
      lineItemCount: 0,
    },
    lines: [],
    adjustments: [],
    addresses: [],
    notes: [],
    tags: [],
    shipments: [],
    payments: [],
  }
}

function buildLogEntry(status: string) {
  return { payload: { undo: { before: buildOrderSnapshot(status) } } }
}

function buildCtx(em: FakeEm): CommandRuntimeContext {
  const container = createContainer()
  container.register({ em: asValue(em), dataEngine: asValue({}) })
  return {
    container,
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
    request: new Request('https://example.test/api/sales/orders', { method: 'DELETE' }),
  } as unknown as CommandRuntimeContext
}

describe('sales.orders.delete undo — lifecycle events on a from-scratch recreate', () => {
  beforeAll(async () => {
    await import('../documents')
  })

  beforeEach(() => {
    emitSalesEventMock.mockClear()
  })

  it('emits sales.order.confirmed so credit/promotion reinstate subscribers can reverse the delete release', async () => {
    const em = createFakeEm()
    const handler = commandRegistry.get('sales.orders.delete')!

    await handler.undo!({ logEntry: buildLogEntry('confirmed') as any, ctx: buildCtx(em) })

    expect(emitSalesEventMock).toHaveBeenCalledWith(
      'sales.order.confirmed',
      expect.objectContaining({ orderId: ORDER_ID, previousStatus: null, status: 'confirmed' }),
    )
  })

  it('does not emit a lifecycle event for a restored order that was never confirmed/cancelled', async () => {
    const em = createFakeEm()
    const handler = commandRegistry.get('sales.orders.delete')!

    await handler.undo!({ logEntry: buildLogEntry('draft') as any, ctx: buildCtx(em) })

    expect(emitSalesEventMock).not.toHaveBeenCalled()
  })
})
