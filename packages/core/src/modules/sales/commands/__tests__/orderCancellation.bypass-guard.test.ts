/** @jest-environment node */

/**
 * Regression test for issue #4054: the payment and shipment dialogs can change the order
 * status in the same request (`documentStatusEntryId`), so cancelling through them must hit
 * the same cancellation guard as `sales.orders.update`, with the payment or shipment the
 * request itself writes taken into account.
 */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ locale: 'en', dict: {}, t: (key: string) => key, translate: (key: string) => key }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn().mockResolvedValue(null),
  findWithDecryption: jest.fn().mockResolvedValue([]),
}))
jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({ loadCustomFieldValues: jest.fn().mockResolvedValue({}) }))
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({ emitCrudSideEffects: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@open-mercato/shared/lib/crud/cache', () => ({ invalidateCrudCache: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({ setRecordCustomFields: jest.fn().mockResolvedValue(undefined) }))
jest.mock('../../../notifications/lib/notificationService', () => ({
  resolveNotificationService: jest.fn().mockReturnValue({ createForFeature: jest.fn().mockResolvedValue(undefined) }),
}))
jest.mock('../../notifications', () => ({ notificationTypes: [] }))

const CANCELED_ENTRY_ID = '99999999-9999-4999-8999-999999999999'
const SHIPPED_ENTRY_ID = '88888888-8888-4888-8888-888888888888'
const RECEIVED_ENTRY_ID = '77777777-7777-4777-8777-777777777777'

jest.mock('../../lib/dictionaries', () => ({
  resolveDictionaryEntryValue: jest.fn(async (_em: unknown, id: string | null) => {
    if (id === '99999999-9999-4999-8999-999999999999') return 'canceled'
    if (id === '88888888-8888-4888-8888-888888888888') return 'shipped'
    if (id === '77777777-7777-4777-8777-777777777777') return 'received'
    return null
  }),
}))

const assertOrderCanBeCancelledMock = jest.fn()
jest.mock('../../lib/orderCancellationGuard', () => {
  const actual = jest.requireActual('../../lib/orderCancellationGuard')
  return {
    ...actual,
    assertOrderCanBeCancelled: (...args: unknown[]) => assertOrderCanBeCancelledMock(...args),
  }
})

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const PAYMENT_ID = 'dddddddd-dddd-4ddd-9ddd-dddddddddddd'
const SHIPMENT_ID = 'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee'

function makeOrder() {
  return {
    id: ORDER_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    status: 'confirmed',
    currencyCode: 'USD',
    paidTotalAmount: '0',
    refundedTotalAmount: '0',
    grandTotalGrossAmount: '100',
    deletedAt: null,
  }
}

function buildTx() {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data, id: 'new-id' })),
    persist: jest.fn(),
    remove: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    getReference: jest.fn((_entity: unknown, id: unknown) => ({ id })),
  }
}

function buildCtx() {
  const tx = buildTx()
  const em = { ...buildTx(), transactional: jest.fn(async (callback: (trx: unknown) => Promise<unknown>) => callback(tx)) }
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return { fork: jest.fn().mockReturnValue(em) }
      return {}
    }),
  }
  return {
    container,
    auth: { tenantId: TENANT_ID, orgId: ORG_ID },
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
    request: {} as Request,
    organizationScope: null,
  } as never
}

const scope = { tenantId: TENANT_ID, organizationId: ORG_ID }

describe('order cancellation through payment and shipment commands (issue #4054)', () => {
  beforeAll(async () => {
    await import('../payments')
    await import('../shipments')
  })

  beforeEach(() => {
    assertOrderCanBeCancelledMock.mockReset()
    assertOrderCanBeCancelledMock.mockRejectedValue(new CrudHttpError(409, { error: 'blocked' }))
    ;(findOneWithDecryption as jest.Mock).mockReset()
  })

  it('guards sales.payments.create, counting the payment being recorded', async () => {
    const order = makeOrder()
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(order)
    const run = commandRegistry.get('sales.payments.create')!.execute!(
      { ...scope, orderId: ORDER_ID, amount: 40, currencyCode: 'USD', statusEntryId: RECEIVED_ENTRY_ID, documentStatusEntryId: CANCELED_ENTRY_ID },
      buildCtx(),
    )
    await expect(run).rejects.toMatchObject({ status: 409 })
    expect(assertOrderCanBeCancelledMock).toHaveBeenCalledWith(
      expect.anything(),
      order,
      { payment: expect.objectContaining({ status: 'received', amount: 40 }) },
    )
    expect(order.status).toBe('confirmed')
  })

  it('guards sales.payments.update with the payment state after the update', async () => {
    const order = makeOrder()
    const payment = {
      id: PAYMENT_ID,
      ...scope,
      order,
      status: 'captured',
      amount: '40',
      capturedAmount: '40',
      refundedAmount: '0',
    }
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(payment)
    const run = commandRegistry.get('sales.payments.update')!.execute!(
      { ...scope, id: PAYMENT_ID, refundedAmount: 40, documentStatusEntryId: CANCELED_ENTRY_ID },
      buildCtx(),
    )
    await expect(run).rejects.toMatchObject({ status: 409 })
    expect(assertOrderCanBeCancelledMock).toHaveBeenCalledWith(
      expect.anything(),
      order,
      { payment: expect.objectContaining({ id: PAYMENT_ID, status: 'captured', capturedAmount: '40', refundedAmount: 40 }) },
    )
  })

  it('guards sales.shipments.create, counting the shipment being created', async () => {
    const order = makeOrder()
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(order)
    const run = commandRegistry.get('sales.shipments.create')!.execute!(
      { ...scope, orderId: ORDER_ID, statusEntryId: SHIPPED_ENTRY_ID, documentStatusEntryId: CANCELED_ENTRY_ID, items: [] },
      buildCtx(),
    )
    await expect(run).rejects.toMatchObject({ status: 409 })
    expect(assertOrderCanBeCancelledMock).toHaveBeenCalledWith(expect.anything(), order, { shipment: { status: 'shipped' } })
    expect(order.status).toBe('confirmed')
  })

  it('guards sales.shipments.update with the shipment status after the update', async () => {
    const order = makeOrder()
    const shipment = { id: SHIPMENT_ID, ...scope, order, status: 'shipped', deletedAt: null }
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(shipment)
    const run = commandRegistry.get('sales.shipments.update')!.execute!(
      { ...scope, id: SHIPMENT_ID, documentStatusEntryId: CANCELED_ENTRY_ID },
      buildCtx(),
    )
    await expect(run).rejects.toMatchObject({ status: 409 })
    expect(assertOrderCanBeCancelledMock).toHaveBeenCalledWith(
      expect.anything(),
      order,
      { shipment: { id: SHIPMENT_ID, status: 'shipped' } },
    )
  })

  it('does not run the guard when the payment does not change the order status', async () => {
    const order = makeOrder()
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(order)
    await commandRegistry.get('sales.payments.create')!.execute!(
      { ...scope, orderId: ORDER_ID, amount: 40, currencyCode: 'USD' },
      buildCtx(),
    ).catch(() => undefined)
    expect(assertOrderCanBeCancelledMock).not.toHaveBeenCalled()
  })
})
