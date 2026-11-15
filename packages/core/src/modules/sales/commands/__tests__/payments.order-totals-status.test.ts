/** @jest-environment node */

import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesOrder } from '../../data/entities'
import { paymentCountsTowardOrderBalance, recomputeOrderPaymentTotals } from '../payments'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn().mockResolvedValue(null),
  findWithDecryption: jest.fn().mockResolvedValue([]),
}))

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

type PaymentFixture = {
  id: string
  status: string | null
  amount: string
  capturedAmount?: string
  refundedAmount?: string
}

function buildOrder() {
  return {
    id: ORDER_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    grandTotalGrossAmount: '100',
    paidTotalAmount: '0',
    refundedTotalAmount: '0',
    outstandingAmount: '100',
  } as unknown as SalesOrder
}

function buildPayment(fixture: PaymentFixture) {
  return {
    capturedAmount: '0',
    refundedAmount: '0',
    ...fixture,
  }
}

function mockLedger(payments: PaymentFixture[], options: { withAllocations: boolean }) {
  const paymentRows = payments.map(buildPayment)
  const allocationRows = options.withAllocations
    ? paymentRows.map((payment) => ({ payment: { id: payment.id }, amount: payment.amount }))
    : []
  ;(findWithDecryption as jest.Mock)
    .mockResolvedValueOnce(allocationRows)
    .mockResolvedValueOnce(paymentRows)
}

describe('paymentCountsTowardOrderBalance (#7082)', () => {
  it.each(['failed', 'canceled', 'cancelled', ' Failed ', 'CANCELED'])('excludes a %p payment', (status) => {
    expect(paymentCountsTowardOrderBalance({ status })).toBe(false)
  })

  it.each([null, 'pending', 'authorized', 'captured', 'received', 'refunded', 'custom_status'])(
    'keeps counting a %p payment',
    (status) => {
      expect(paymentCountsTowardOrderBalance({ status })).toBe(true)
    },
  )
})

describe('recomputeOrderPaymentTotals — payment status (#7082)', () => {
  const em = {} as never

  beforeEach(() => {
    ;(findWithDecryption as jest.Mock).mockReset()
  })

  it('ignores allocations of a failed payment while counting allocations of a captured one', async () => {
    ;(findWithDecryption as jest.Mock)
      .mockResolvedValueOnce([
        { payment: { id: 'p-1' }, amount: '100' },
        { payment: { id: 'p-2' }, amount: '30' },
      ])
      .mockResolvedValueOnce([
        buildPayment({ id: 'p-1', status: 'failed', amount: '100' }),
        buildPayment({ id: 'p-2', status: 'received', amount: '30' }),
      ])
    const order = buildOrder()

    const totals = await recomputeOrderPaymentTotals(em, order)

    expect(totals).toEqual({ paidTotalAmount: 30, refundedTotalAmount: 0, outstandingAmount: 70 })
  })

  describe.each([
    ['with allocations', true],
    ['without allocations', false],
  ])('%s', (_label, withAllocations) => {
    it.each(['failed', 'canceled'])('leaves the balance untouched for a %s payment', async (status) => {
      mockLedger([{ id: 'p-1', status, amount: '100', refundedAmount: '10' }], { withAllocations })
      const order = buildOrder()

      const totals = await recomputeOrderPaymentTotals(em, order)

      expect(totals).toEqual({ paidTotalAmount: 0, refundedTotalAmount: 0, outstandingAmount: 100 })
      expect(order.paidTotalAmount).toBe('0')
      expect(order.outstandingAmount).toBe('100')
    })

    it('counts only the settling payments when failed and captured payments are mixed', async () => {
      mockLedger(
        [
          { id: 'p-1', status: 'failed', amount: '100' },
          { id: 'p-2', status: 'captured', amount: '60', capturedAmount: '60' },
          { id: 'p-3', status: null, amount: '15' },
        ],
        { withAllocations },
      )
      const order = buildOrder()

      const totals = await recomputeOrderPaymentTotals(em, order)

      expect(totals).toEqual({ paidTotalAmount: 75, refundedTotalAmount: 0, outstandingAmount: 25 })
    })

    it('keeps counting pending and statusless payments as before', async () => {
      mockLedger(
        [
          { id: 'p-1', status: 'pending', amount: '40' },
          { id: 'p-2', status: null, amount: '60' },
        ],
        { withAllocations },
      )
      const order = buildOrder()

      const totals = await recomputeOrderPaymentTotals(em, order)

      expect(totals).toEqual({ paidTotalAmount: 100, refundedTotalAmount: 0, outstandingAmount: 0 })
    })
  })
})
