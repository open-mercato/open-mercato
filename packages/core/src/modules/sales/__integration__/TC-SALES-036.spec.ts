import { expect, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

/**
 * TC-SALES-036: Payment partial refund — payment record + order totals.
 *
 * Issue #2459 scenario "TC-SALES-035 — Payment Refund and Reversal Operations" (P1).
 * Renumbered to 036: TC-SALES-030 is already taken (read-model totals, #2455/#2457).
 *
 * A refund is NOT a dedicated route — it is a `PUT /api/sales/payments` with the
 * `refundedAmount` field (the issue's assumed `refundAmount` / refund endpoint do not
 * exist). Create/update return `{ id, orderTotals }`. The order invariant is
 * `outstanding = grand - paid + refunded`, so a refund RAISES outstanding while paid is
 * unchanged (the issue's "paid = initial - refunded" is incorrect). This spec asserts
 * the refunded amount on the payment record itself and the order totals; the order-total
 * read path for fully-paid refunds is covered separately by TC-SALES-030.
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

function listItems(body: JsonRecord): JsonRecord[] {
  return Array.isArray(body.items) ? (body.items as JsonRecord[]) : []
}

function num(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim().length) return Number(value)
  return Number.NaN
}

function refundedAmountOf(payment: JsonRecord): number {
  return num(payment.refundedAmount ?? payment.refunded_amount)
}

test.describe('TC-SALES-036 payment partial refund record', () => {
  test('records a partial refund on the payment and updates order totals', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let orderId: string | null = null
    let paymentId: string | null = null

    try {
      const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD' },
      })
      expect(orderResponse.status()).toBe(201)
      orderId = (await readJson(orderResponse)).id as string

      await apiRequest(request, 'POST', '/api/sales/order-lines', {
        token,
        data: { orderId, currencyCode: 'USD', quantity: 1, name: `Refundable ${stamp}`, unitPriceNet: 100, unitPriceGross: 100 },
      })

      const payResponse = await apiRequest(request, 'POST', '/api/sales/payments', {
        token,
        data: { orderId, amount: 40, paymentReference: `INITIAL-${stamp}`, currencyCode: 'USD' },
      })
      expect(payResponse.status(), 'POST /api/sales/payments should be 201').toBe(201)
      const payBody = await readJson(payResponse)
      paymentId = payBody.id as string
      expect(paymentId).toBeTruthy()
      const paidTotals = (payBody.orderTotals ?? {}) as JsonRecord
      expect(num(paidTotals.paidTotalAmount)).toBe(40)
      expect(num(paidTotals.outstandingAmount)).toBe(60)

      // Partial refund of 20 via PUT (the only refund mechanism).
      const refundResponse = await apiRequest(request, 'PUT', '/api/sales/payments', {
        token,
        data: { id: paymentId, amount: 40, refundedAmount: 20, currencyCode: 'USD' },
      })
      expect(refundResponse.status(), 'PUT /api/sales/payments should be 200').toBe(200)
      const refundTotals = ((await readJson(refundResponse)).orderTotals ?? {}) as JsonRecord
      expect(num(refundTotals.paidTotalAmount)).toBe(40)
      expect(num(refundTotals.refundedTotalAmount)).toBe(20)
      // Refund raises outstanding: 100 - 40 + 20 = 80.
      expect(num(refundTotals.outstandingAmount)).toBe(80)

      // The payment record itself carries the refunded amount. The payments list is
      // filtered by order (the `?id=` filter is not supported on this route).
      const payments = listItems(
        await readJson(await apiRequest(request, 'GET', `/api/sales/payments?orderId=${encodeURIComponent(orderId!)}`, { token })),
      )
      const payment = payments.find((row) => row.id === paymentId) ?? {}
      expect(num(payment.amount)).toBe(40)
      expect(refundedAmountOf(payment)).toBe(20)

      // The order detail read reflects the same paid/refunded/outstanding split.
      const order = listItems(
        await readJson(await apiRequest(request, 'GET', `/api/sales/orders?id=${encodeURIComponent(orderId)}`, { token })),
      )[0] ?? {}
      expect(num(order.paidTotalAmount)).toBe(40)
      expect(num(order.refundedTotalAmount)).toBe(20)
      expect(num(order.outstandingAmount)).toBe(80)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/payments', paymentId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
