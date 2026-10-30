/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string) => key }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (em: { find: (...args: unknown[]) => unknown }, entity: unknown, where: unknown) =>
    em.find(entity, where),
}))

import { SalesPayment, SalesShipment, type SalesOrder } from '../../data/entities'
import {
  assertOrderCanBeCancelled,
  isBlockingShipment,
  isCancelledOrderStatus,
  resolveHeldPaymentAmount,
} from '../orderCancellationGuard'

const order = { id: 'order-1', tenantId: 'tenant-1', organizationId: 'org-1' } as SalesOrder

function makeEm(shipments: Array<Record<string, unknown>>, payments: Array<Record<string, unknown>>) {
  return {
    find: jest.fn(async (entity: unknown) => {
      if (entity === SalesShipment) return shipments
      if (entity === SalesPayment) return payments
      return []
    }),
  } as never
}

describe('order cancellation guard (issue #4054)', () => {
  it('recognizes both cancelled spellings', () => {
    expect(isCancelledOrderStatus('canceled')).toBe(true)
    expect(isCancelledOrderStatus(' cancelled ')).toBe(true)
    expect(isCancelledOrderStatus('confirmed')).toBe(false)
    expect(isCancelledOrderStatus(null)).toBe(false)
  })

  it('treats only cancelled and returned shipments as non-blocking', () => {
    expect(isBlockingShipment({ status: 'canceled' })).toBe(false)
    expect(isBlockingShipment({ status: 'returned' })).toBe(false)
    expect(isBlockingShipment({ status: 'shipped' })).toBe(true)
    expect(isBlockingShipment({ status: 'pending' })).toBe(true)
    expect(isBlockingShipment({ status: null })).toBe(true)
  })

  it('counts captured or received money net of refunds, and ignores pending, failed and cancelled payments', () => {
    expect(resolveHeldPaymentAmount({ status: 'captured', amount: '100', capturedAmount: '80', refundedAmount: '30' })).toBe(50)
    expect(resolveHeldPaymentAmount({ status: 'received', amount: '100', capturedAmount: '0', refundedAmount: '0' })).toBe(100)
    expect(resolveHeldPaymentAmount({ status: 'refunded', amount: '100', capturedAmount: '100', refundedAmount: '100' })).toBe(0)
    expect(resolveHeldPaymentAmount({ status: 'pending', amount: '100' })).toBe(0)
    expect(resolveHeldPaymentAmount({ status: 'failed', amount: '100' })).toBe(0)
    expect(resolveHeldPaymentAmount({ status: 'canceled', amount: '100' })).toBe(0)
  })

  it('blocks when the pending shipment of the same request is live, even with no stored shipments', async () => {
    await expect(
      assertOrderCanBeCancelled(makeEm([], []), order, { shipment: { status: 'shipped' } }),
    ).rejects.toMatchObject({ status: 409, body: { error: 'sales.orders.errors.cancel_has_shipments' } })
  })

  it('lets a pending update replace the stored state of the same shipment', async () => {
    await expect(
      assertOrderCanBeCancelled(makeEm([{ id: 's-1', status: 'shipped' }], []), order, {
        shipment: { id: 's-1', status: 'canceled' },
      }),
    ).resolves.toBeUndefined()
  })

  it('blocks when the payment the same request creates holds money', async () => {
    await expect(
      assertOrderCanBeCancelled(makeEm([], []), order, {
        payment: { status: 'received', amount: 25, capturedAmount: 0, refundedAmount: 0 },
      }),
    ).rejects.toMatchObject({ status: 409, body: { error: 'sales.orders.errors.cancel_has_payments' } })
  })

  it('lets a pending refund on the same payment clear the block', async () => {
    await expect(
      assertOrderCanBeCancelled(
        makeEm([], [{ id: 'p-1', status: 'captured', amount: '40', capturedAmount: '40', refundedAmount: '0' }]),
        order,
        { payment: { id: 'p-1', status: 'refunded', amount: '40', capturedAmount: '40', refundedAmount: '40' } },
      ),
    ).resolves.toBeUndefined()
  })
})
