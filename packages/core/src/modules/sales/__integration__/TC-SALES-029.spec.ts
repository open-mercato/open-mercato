import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

/**
 * TC-SALES-029: Order GET payment-total read-back contract (issue #2397).
 *
 * Issue #2397 documents a read-back data-fidelity gap (no crash): the payment
 * command (`POST /api/sales/payments`) returns the authoritative settlement
 * totals, while `GET /api/sales/orders?id=` recomputes display totals and
 * reports `paidTotalAmount` / `outstandingAmount` from the stored order column.
 *
 * Per the issue's Test Contract, this test locks in two guarantees that hold
 * against current behavior and document the contract the order GET should
 * eventually honor in full:
 *   1. The payment command response is authoritative and internally consistent:
 *      outstanding = grandTotalGross - paid + refunded.
 *   2. The order GET read-back never violates the non-negativity invariants
 *      (paidTotalAmount >= 0, outstandingAmount >= 0) and never reports an
 *      outstanding amount above the order's grand total.
 *
 * Decimal `data:read` fields are serialized by the API as fixed-scale strings
 * (e.g. "40.0000"), so numeric assertions parse with Number().
 */

type JsonRecord = Record<string, unknown>

async function readJson(response: APIResponse): Promise<JsonRecord> {
  const raw = await response.text()
  if (!raw) return {}
  try {
    return JSON.parse(raw) as JsonRecord
  } catch {
    return {}
  }
}

function num(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim().length) return Number(value)
  return Number.NaN
}

async function readOrder(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<JsonRecord> {
  const response = await apiRequest(request, 'GET', `/api/sales/orders?id=${encodeURIComponent(id)}`, { token })
  expect(response.status(), 'GET /api/sales/orders?id should be 200').toBe(200)
  const body = await readJson(response)
  const items = Array.isArray(body.items) ? (body.items as JsonRecord[]) : []
  return items[0] ?? {}
}

test.describe('TC-SALES-029: order GET payment-total read-back contract (#2397)', () => {
  test('command totals are authoritative and the order GET read-back honors non-negativity invariants', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let orderId: string | null = null
    let paymentId: string | null = null

    try {
      // Create an order with a single $100 line so payment math is meaningful.
      const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD', customerReference: `READBACK-${stamp}` },
      })
      expect(orderResponse.status(), 'POST /api/sales/orders should be 201').toBe(201)
      orderId = (await readJson(orderResponse)).id as string
      expect(orderId, 'order create should return id').toBeTruthy()

      const lineResponse = await apiRequest(request, 'POST', '/api/sales/order-lines', {
        token,
        data: {
          orderId,
          currencyCode: 'USD',
          quantity: 1,
          name: `READBACK line ${stamp}`,
          unitPriceNet: 100,
          unitPriceGross: 100,
        },
      })
      expect(lineResponse.status(), 'POST /api/sales/order-lines should be 201').toBe(201)

      // Record a $40 payment.
      const paymentResponse = await apiRequest(request, 'POST', '/api/sales/payments', {
        token,
        data: { orderId, amount: 40, currencyCode: 'USD', paymentReference: `READBACK-PAY-${stamp}` },
      })
      expect(paymentResponse.status(), 'POST /api/sales/payments should be 201').toBe(201)
      const paymentBody = await readJson(paymentResponse)
      paymentId = typeof paymentBody.id === 'string' ? paymentBody.id : null
      expect(paymentId, 'payment create should return id').toBeTruthy()

      // (1) The payment command response is the authoritative settlement source
      // and is internally consistent: outstanding = grand - paid + refunded.
      const commandTotals = (paymentBody.orderTotals ?? {}) as JsonRecord
      const commandPaid = num(commandTotals.paidTotalAmount)
      const commandRefunded = num(commandTotals.refundedTotalAmount)
      const commandOutstanding = num(commandTotals.outstandingAmount)
      expect(commandPaid, 'command paidTotalAmount should equal the payment').toBe(40)
      expect(commandRefunded, 'command refundedTotalAmount should be 0').toBe(0)
      expect(commandOutstanding, 'command outstandingAmount = 100 grand - 40 paid').toBe(60)
      expect(commandPaid).toBeGreaterThanOrEqual(0)
      expect(commandOutstanding).toBeGreaterThanOrEqual(0)

      // (2) The order GET read-back recomputes display totals. It must never
      // violate the non-negativity invariants nor report an outstanding amount
      // above the grand total. This is the contract #2397 documents: the read
      // model should eventually equal the authoritative command totals, but
      // today we assert only the invariants it is guaranteed to uphold.
      const order = await readOrder(request, token, orderId!)
      const grand = num(order.grandTotalGrossAmount)
      const paid = num(order.paidTotalAmount)
      const refunded = num(order.refundedTotalAmount)
      const outstanding = num(order.outstandingAmount)
      expect(grand, 'order grand total should reflect the single $100 line').toBe(100)
      expect(paid, 'read-back paidTotalAmount must be non-negative').toBeGreaterThanOrEqual(0)
      expect(refunded, 'read-back refundedTotalAmount must be non-negative').toBeGreaterThanOrEqual(0)
      expect(outstanding, 'read-back outstandingAmount must be non-negative').toBeGreaterThanOrEqual(0)
      expect(outstanding, 'read-back outstanding never exceeds the grand total').toBeLessThanOrEqual(grand)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/payments', paymentId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
