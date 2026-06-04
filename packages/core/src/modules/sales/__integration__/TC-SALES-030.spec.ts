import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

/**
 * TC-SALES-030: order/quote read-model totals fidelity.
 *
 * Regression coverage for two defects in the sales calculation pipeline that
 * only surface on the read path (single-document detail read recomputes display
 * totals through the calculation service, where the provider totals calculator
 * rebuilds the document from lines+adjustments):
 *
 *  - #2455: after recording a payment, the order detail read returned the
 *    pre-payment snapshot (paid 0 / outstanding = grand total) because the
 *    rebuild reset the payment totals.
 *  - #2457: a line whose gross already embeds tax (gross > net) but with no
 *    explicit tax rate reported a document tax total of 0.
 *
 * Each `data:read` decimal field is serialized by the API as a fixed-scale
 * string, so numeric assertions parse with Number().
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

async function readSingleDocument(
  request: APIRequestContext,
  token: string,
  resource: 'orders' | 'quotes',
  id: string,
): Promise<JsonRecord> {
  const response = await apiRequest(request, 'GET', `/api/sales/${resource}?id=${encodeURIComponent(id)}`, { token })
  expect(response.status(), `GET /api/sales/${resource}?id should be 200`).toBe(200)
  const body = await readJson(response)
  const items = Array.isArray(body.items) ? (body.items as JsonRecord[]) : []
  return items[0] ?? {}
}

test.describe('TC-SALES-030 sales read-model totals fidelity', () => {
  test('order detail reflects recorded payment in paid/outstanding (#2455)', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null
    let paymentId: string | null = null

    try {
      const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD' },
      })
      expect(orderResponse.status()).toBe(201)
      orderId = (await readJson(orderResponse)).id as string
      expect(orderId).toBeTruthy()

      const lineResponse = await apiRequest(request, 'POST', '/api/sales/order-lines', {
        token,
        data: {
          orderId,
          currencyCode: 'USD',
          quantity: 1,
          name: 'PAY full line',
          unitPriceNet: 1000,
          unitPriceGross: 1000,
        },
      })
      expect(lineResponse.status()).toBe(201)

      const payResponse = await apiRequest(request, 'POST', '/api/sales/payments', {
        token,
        data: { orderId, amount: 1000, currencyCode: 'USD' },
      })
      expect(payResponse.status(), 'POST /api/sales/payments should be 201').toBe(201)
      paymentId = (await readJson(payResponse)).id as string

      const order = await readSingleDocument(request, token, 'orders', orderId!)
      expect(num(order.grandTotalGrossAmount)).toBe(1000)
      expect(num(order.paidTotalAmount)).toBe(1000)
      expect(num(order.refundedTotalAmount)).toBe(0)
      expect(num(order.outstandingAmount)).toBe(0)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/payments', paymentId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('order detail reflects a partial payment (#2455)', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
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
        data: {
          orderId,
          currencyCode: 'USD',
          quantity: 1,
          name: 'PAY partial line',
          unitPriceNet: 200,
          unitPriceGross: 200,
        },
      })

      const payResponse = await apiRequest(request, 'POST', '/api/sales/payments', {
        token,
        data: { orderId, amount: 50, currencyCode: 'USD' },
      })
      expect(payResponse.status()).toBe(201)
      paymentId = (await readJson(payResponse)).id as string

      const order = await readSingleDocument(request, token, 'orders', orderId!)
      expect(num(order.grandTotalGrossAmount)).toBe(200)
      expect(num(order.paidTotalAmount)).toBe(50)
      expect(num(order.outstandingAmount)).toBe(150)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/payments', paymentId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('order detail tax total derives from net/gross delta when rate is absent (#2457)', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null

    try {
      const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD' },
      })
      expect(orderResponse.status()).toBe(201)
      orderId = (await readJson(orderResponse)).id as string

      const lineResponse = await apiRequest(request, 'POST', '/api/sales/order-lines', {
        token,
        data: {
          orderId,
          currencyCode: 'USD',
          quantity: 1,
          name: 'Tax-class priced line',
          unitPriceNet: 100,
          unitPriceGross: 123,
          totalNetAmount: 100,
          totalGrossAmount: 123,
        },
      })
      expect(lineResponse.status()).toBe(201)

      const order = await readSingleDocument(request, token, 'orders', orderId!)
      expect(num(order.subtotalNetAmount)).toBe(100)
      expect(num(order.subtotalGrossAmount)).toBe(123)
      expect(num(order.taxTotalAmount)).toBe(23)
      expect(num(order.grandTotalGrossAmount)).toBe(123)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('quote detail tax total derives from net/gross delta when rate is absent (#2457)', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let quoteId: string | null = null

    try {
      const quoteResponse = await apiRequest(request, 'POST', '/api/sales/quotes', {
        token,
        data: { currencyCode: 'USD' },
      })
      expect(quoteResponse.status()).toBe(201)
      quoteId = (await readJson(quoteResponse)).id as string

      const lineResponse = await apiRequest(request, 'POST', '/api/sales/quote-lines', {
        token,
        data: {
          quoteId,
          currencyCode: 'USD',
          quantity: 1,
          name: 'Tax-class priced quote line',
          unitPriceNet: 100,
          unitPriceGross: 123,
          totalNetAmount: 100,
          totalGrossAmount: 123,
        },
      })
      expect(lineResponse.status()).toBe(201)

      const quote = await readSingleDocument(request, token, 'quotes', quoteId!)
      expect(num(quote.subtotalNetAmount)).toBe(100)
      expect(num(quote.subtotalGrossAmount)).toBe(123)
      expect(num(quote.taxTotalAmount)).toBe(23)
      expect(num(quote.grandTotalGrossAmount)).toBe(123)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    }
  })

  test('payment lifecycle (create/update/delete) keeps order totals consistent (#2455)', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null
    let paymentId: string | null = null

    try {
      const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD' },
      })
      orderId = (await readJson(orderResponse)).id as string
      await apiRequest(request, 'POST', '/api/sales/order-lines', {
        token,
        data: { orderId, currencyCode: 'USD', quantity: 1, name: 'Lifecycle line', unitPriceNet: 100, unitPriceGross: 100 },
      })

      const payResponse = await apiRequest(request, 'POST', '/api/sales/payments', {
        token,
        data: { orderId, amount: 40, currencyCode: 'USD' },
      })
      expect(payResponse.status()).toBe(201)
      paymentId = (await readJson(payResponse)).id as string
      let order = await readSingleDocument(request, token, 'orders', orderId!)
      expect(num(order.paidTotalAmount)).toBe(40)
      expect(num(order.outstandingAmount)).toBe(60)

      // Updating the amount must resync the auto-managed allocation so the
      // recomputed paid total tracks the new amount.
      const updateResponse = await apiRequest(request, 'PUT', '/api/sales/payments', {
        token,
        data: { id: paymentId!, amount: 75, currencyCode: 'USD' },
      })
      expect(updateResponse.status()).toBe(200)
      order = await readSingleDocument(request, token, 'orders', orderId!)
      expect(num(order.paidTotalAmount)).toBe(75)
      expect(num(order.outstandingAmount)).toBe(25)

      // Deleting the payment resets the order to fully outstanding.
      const deleteResponse = await apiRequest(request, 'DELETE', '/api/sales/payments', {
        token,
        data: { id: paymentId! },
      })
      expect(deleteResponse.status()).toBe(200)
      paymentId = null
      order = await readSingleDocument(request, token, 'orders', orderId!)
      expect(num(order.paidTotalAmount)).toBe(0)
      expect(num(order.outstandingAmount)).toBe(100)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/payments', paymentId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('refund increases outstanding (refundedTotalAmount) (#2455)', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null
    let paymentId: string | null = null

    try {
      const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD' },
      })
      orderId = (await readJson(orderResponse)).id as string
      await apiRequest(request, 'POST', '/api/sales/order-lines', {
        token,
        data: { orderId, currencyCode: 'USD', quantity: 1, name: 'Refund line', unitPriceNet: 100, unitPriceGross: 100 },
      })
      const payResponse = await apiRequest(request, 'POST', '/api/sales/payments', {
        token,
        data: { orderId, amount: 100, currencyCode: 'USD' },
      })
      paymentId = (await readJson(payResponse)).id as string

      const updateResponse = await apiRequest(request, 'PUT', '/api/sales/payments', {
        token,
        data: { id: paymentId!, amount: 100, refundedAmount: 30, currencyCode: 'USD' },
      })
      expect(updateResponse.status()).toBe(200)

      const order = await readSingleDocument(request, token, 'orders', orderId!)
      expect(num(order.paidTotalAmount)).toBe(100)
      expect(num(order.refundedTotalAmount)).toBe(30)
      expect(num(order.outstandingAmount)).toBe(30)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/payments', paymentId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('paid total survives an adjustment-driven recompute (#2455)', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null
    let paymentId: string | null = null

    try {
      const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD' },
      })
      orderId = (await readJson(orderResponse)).id as string
      await apiRequest(request, 'POST', '/api/sales/order-lines', {
        token,
        data: { orderId, currencyCode: 'USD', quantity: 1, name: 'Adj line', unitPriceNet: 100, unitPriceGross: 100 },
      })
      const payResponse = await apiRequest(request, 'POST', '/api/sales/payments', {
        token,
        data: { orderId, amount: 100, currencyCode: 'USD' },
      })
      paymentId = (await readJson(payResponse)).id as string

      // Adding a surcharge after the payment changes the grand total; the
      // payment totals must be preserved and outstanding recomputed against the
      // new grand total (not reset to the pre-payment snapshot).
      const adjResponse = await apiRequest(request, 'POST', '/api/sales/order-adjustments', {
        token,
        data: { orderId, scope: 'order', kind: 'surcharge', amountNet: 50, amountGross: 50, currencyCode: 'USD', label: 'Handling' },
      })
      expect(adjResponse.status()).toBe(201)

      const order = await readSingleDocument(request, token, 'orders', orderId!)
      expect(num(order.grandTotalGrossAmount)).toBe(150)
      expect(num(order.surchargeTotalAmount)).toBe(50)
      expect(num(order.paidTotalAmount)).toBe(100)
      expect(num(order.outstandingAmount)).toBe(50)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/payments', paymentId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('order-scoped adjustments aggregate into document totals', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null

    try {
      const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD' },
      })
      orderId = (await readJson(orderResponse)).id as string
      await apiRequest(request, 'POST', '/api/sales/order-lines', {
        token,
        data: { orderId, currencyCode: 'USD', quantity: 1, name: 'Base line', unitPriceNet: 100, unitPriceGross: 100 },
      })

      await apiRequest(request, 'POST', '/api/sales/order-adjustments', {
        token,
        data: { orderId, scope: 'order', kind: 'discount', amountNet: 10, amountGross: 10, currencyCode: 'USD', label: 'Promo' },
      })
      await apiRequest(request, 'POST', '/api/sales/order-adjustments', {
        token,
        data: { orderId, scope: 'order', kind: 'shipping', amountNet: 15, amountGross: 18, currencyCode: 'USD', label: 'Shipping' },
      })

      const order = await readSingleDocument(request, token, 'orders', orderId!)
      expect(num(order.discountTotalAmount)).toBe(10)
      expect(num(order.shippingNetAmount)).toBe(15)
      // 100 base - 10 discount + 15 shipping net = 105 net; gross 100 - 10 + 18 = 108.
      expect(num(order.grandTotalNetAmount)).toBe(105)
      expect(num(order.grandTotalGrossAmount)).toBe(108)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('multi-line order aggregates line totals', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null

    try {
      const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD' },
      })
      orderId = (await readJson(orderResponse)).id as string
      await apiRequest(request, 'POST', '/api/sales/order-lines', {
        token,
        data: { orderId, currencyCode: 'USD', quantity: 2, name: 'Line A', unitPriceNet: 50, unitPriceGross: 50 },
      })
      await apiRequest(request, 'POST', '/api/sales/order-lines', {
        token,
        data: { orderId, currencyCode: 'USD', quantity: 1, name: 'Line B', unitPriceNet: 30, unitPriceGross: 30 },
      })

      const order = await readSingleDocument(request, token, 'orders', orderId!)
      expect(num(order.subtotalNetAmount)).toBe(130)
      expect(num(order.grandTotalGrossAmount)).toBe(130)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('return reduces order grand total', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null

    try {
      const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD' },
      })
      orderId = (await readJson(orderResponse)).id as string
      const lineResponse = await apiRequest(request, 'POST', '/api/sales/order-lines', {
        token,
        data: { orderId, currencyCode: 'USD', quantity: 2, name: 'Returnable', unitPriceNet: 100, unitPriceGross: 100 },
      })
      const orderLineId = (await readJson(lineResponse)).id as string

      let order = await readSingleDocument(request, token, 'orders', orderId!)
      expect(num(order.grandTotalGrossAmount)).toBe(200)

      const returnResponse = await apiRequest(request, 'POST', '/api/sales/returns', {
        token,
        data: { orderId, reason: 'Damaged', lines: [{ orderLineId, quantity: 1 }] },
      })
      expect(returnResponse.status()).toBe(201)

      order = await readSingleDocument(request, token, 'orders', orderId!)
      expect(num(order.grandTotalGrossAmount)).toBe(100)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('rate-based and tax-kind order adjustments aggregate correctly', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let discountOrderId: string | null = null
    let taxOrderId: string | null = null

    try {
      // Rate-based discount: 10% of a 100 net line.
      const discountOrderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD' },
      })
      discountOrderId = (await readJson(discountOrderResponse)).id as string
      await apiRequest(request, 'POST', '/api/sales/order-lines', {
        token,
        data: { orderId: discountOrderId, currencyCode: 'USD', quantity: 1, name: 'Rate disc line', unitPriceNet: 100, unitPriceGross: 100 },
      })
      await apiRequest(request, 'POST', '/api/sales/order-adjustments', {
        token,
        data: { orderId: discountOrderId, scope: 'order', kind: 'discount', rate: 10, currencyCode: 'USD', label: 'Percent off' },
      })
      const discountOrder = await readSingleDocument(request, token, 'orders', discountOrderId!)
      expect(num(discountOrder.discountTotalAmount)).toBe(10)
      expect(num(discountOrder.grandTotalNetAmount)).toBe(90)

      // Tax-kind adjustment: an explicit 7 tax on a 100 net line.
      const taxOrderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD' },
      })
      taxOrderId = (await readJson(taxOrderResponse)).id as string
      await apiRequest(request, 'POST', '/api/sales/order-lines', {
        token,
        data: { orderId: taxOrderId, currencyCode: 'USD', quantity: 1, name: 'Tax adj line', unitPriceNet: 100, unitPriceGross: 100 },
      })
      await apiRequest(request, 'POST', '/api/sales/order-adjustments', {
        token,
        data: { orderId: taxOrderId, scope: 'order', kind: 'tax', amountNet: 7, amountGross: 7, currencyCode: 'USD', label: 'Eco tax' },
      })
      const taxOrder = await readSingleDocument(request, token, 'orders', taxOrderId!)
      expect(num(taxOrder.taxTotalAmount)).toBe(7)
      expect(num(taxOrder.grandTotalGrossAmount)).toBe(107)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', discountOrderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', taxOrderId)
    }
  })

  test('multiple payments sum into paid total', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null
    const paymentIds: string[] = []

    try {
      const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD' },
      })
      orderId = (await readJson(orderResponse)).id as string
      await apiRequest(request, 'POST', '/api/sales/order-lines', {
        token,
        data: { orderId, currencyCode: 'USD', quantity: 1, name: 'Split-pay line', unitPriceNet: 100, unitPriceGross: 100 },
      })
      for (const amount of [30, 50]) {
        const payResponse = await apiRequest(request, 'POST', '/api/sales/payments', {
          token,
          data: { orderId, amount, currencyCode: 'USD' },
        })
        expect(payResponse.status()).toBe(201)
        paymentIds.push((await readJson(payResponse)).id as string)
      }

      const order = await readSingleDocument(request, token, 'orders', orderId!)
      expect(num(order.paidTotalAmount)).toBe(80)
      expect(num(order.outstandingAmount)).toBe(20)
    } finally {
      for (const id of paymentIds) {
        await deleteSalesEntityIfExists(request, token, '/api/sales/payments', id)
      }
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('deleting an order adjustment recomputes document totals', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null

    try {
      const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD' },
      })
      orderId = (await readJson(orderResponse)).id as string
      await apiRequest(request, 'POST', '/api/sales/order-lines', {
        token,
        data: { orderId, currencyCode: 'USD', quantity: 1, name: 'Adj-del line', unitPriceNet: 100, unitPriceGross: 100 },
      })
      const adjResponse = await apiRequest(request, 'POST', '/api/sales/order-adjustments', {
        token,
        data: { orderId, scope: 'order', kind: 'surcharge', amountNet: 25, amountGross: 25, currencyCode: 'USD', label: 'Temp fee' },
      })
      expect(adjResponse.status()).toBe(201)
      const adjustmentId = (await readJson(adjResponse)).id as string

      let order = await readSingleDocument(request, token, 'orders', orderId!)
      expect(num(order.grandTotalGrossAmount)).toBe(125)

      const deleteResponse = await apiRequest(request, 'DELETE', '/api/sales/order-adjustments', {
        token,
        data: { id: adjustmentId, orderId },
      })
      expect(deleteResponse.status()).toBe(200)

      order = await readSingleDocument(request, token, 'orders', orderId!)
      expect(num(order.surchargeTotalAmount)).toBe(0)
      expect(num(order.grandTotalGrossAmount)).toBe(100)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('deleting an order line recomputes document totals', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null

    try {
      const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD' },
      })
      orderId = (await readJson(orderResponse)).id as string
      await apiRequest(request, 'POST', '/api/sales/order-lines', {
        token,
        data: { orderId, currencyCode: 'USD', quantity: 1, name: 'Keep', unitPriceNet: 100, unitPriceGross: 100 },
      })
      const removableResponse = await apiRequest(request, 'POST', '/api/sales/order-lines', {
        token,
        data: { orderId, currencyCode: 'USD', quantity: 1, name: 'Remove', unitPriceNet: 40, unitPriceGross: 40 },
      })
      const removableLineId = (await readJson(removableResponse)).id as string

      let order = await readSingleDocument(request, token, 'orders', orderId!)
      expect(num(order.subtotalNetAmount)).toBe(140)

      const deleteResponse = await apiRequest(request, 'DELETE', '/api/sales/order-lines', {
        token,
        data: { id: removableLineId, orderId },
      })
      expect(deleteResponse.status()).toBe(200)

      order = await readSingleDocument(request, token, 'orders', orderId!)
      expect(num(order.subtotalNetAmount)).toBe(100)
      expect(num(order.grandTotalGrossAmount)).toBe(100)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
