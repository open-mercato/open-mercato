import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

/**
 * TC-SALES-ATOMIC-VERIFY: backward-compatibility & data-safety verification for the
 * atomic-write refactors on the sales module.
 *
 * Covers, against the live API:
 *  - Order/quote header + line + adjustment field fidelity (set -> read) and parent totals recalc
 *  - PUT-update field round-trip for orders and quotes (uses the documentUpdate `comment` field)
 *  - Quote convert-to-order (PR #2347): lines/adjustments/totals carry over, source quote is consumed
 *  - Payment create/update (PR #2355): payment fields persist and the command-returned orderTotals stay consistent
 *  - Undo round-trip via x-om-operation header + /api/audit_logs/audit-logs/actions/undo:
 *      order create, order-line upsert, and order update
 *
 * Each `data:read` decimal field is serialized by the API as a fixed-scale string
 * (e.g. "100.0000"), so numeric assertions parse with Number().
 */

const SALES_UNDO_PATH = '/api/audit_logs/audit-logs/actions/undo'

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

function parseUndoToken(response: APIResponse): string | null {
  const header = response.headers()['x-om-operation'] ?? ''
  if (!header.startsWith('omop:')) return null
  try {
    const decoded = JSON.parse(decodeURIComponent(header.slice(5))) as { undoToken?: unknown }
    return typeof decoded.undoToken === 'string' ? decoded.undoToken : null
  } catch {
    return null
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

async function listChildItems(
  request: APIRequestContext,
  token: string,
  resource: 'order-lines' | 'order-adjustments' | 'quote-lines' | 'quote-adjustments' | 'payments',
  query: string,
): Promise<JsonRecord[]> {
  const response = await apiRequest(request, 'GET', `/api/sales/${resource}?${query}`, { token })
  expect(response.status(), `GET /api/sales/${resource} should be 200`).toBe(200)
  const body = await readJson(response)
  return Array.isArray(body.items) ? (body.items as JsonRecord[]) : []
}

async function runUndo(request: APIRequestContext, token: string, undoToken: string): Promise<void> {
  const response = await apiRequest(request, 'POST', SALES_UNDO_PATH, { token, data: { undoToken } })
  expect(response.status(), `POST ${SALES_UNDO_PATH} should be 200`).toBe(200)
  const body = await readJson(response)
  expect(body.ok, 'undo response should report ok: true').toBe(true)
}

test.describe('TC-SALES-ATOMIC-VERIFY: atomic-write backward-compat & data safety', () => {
  test('order: header/line/adjustment field fidelity, totals recalc, and PUT update round-trip', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let orderId: string | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD', customerReference: `ATOMIC-ORD-${stamp}` },
      })
      expect(createResponse.status(), 'POST /api/sales/orders should be 201').toBe(201)
      const created = await readJson(createResponse)
      orderId = typeof created.id === 'string' ? created.id : null
      expect(orderId, 'order create should return id').toBeTruthy()

      // Header fields round-trip on read.
      const afterCreate = await readSingleDocument(request, token, 'orders', orderId!)
      expect(afterCreate.currencyCode).toBe('USD')
      expect(afterCreate.customerReference).toBe(`ATOMIC-ORD-${stamp}`)
      expect(afterCreate.orderNumber, 'order should receive a generated number').toBeTruthy()

      // Add a line.
      const lineResponse = await apiRequest(request, 'POST', '/api/sales/order-lines', {
        token,
        data: {
          orderId: orderId!,
          currencyCode: 'USD',
          quantity: 3,
          name: `ATOMIC line ${stamp}`,
          unitPriceNet: 100,
          unitPriceGross: 123,
        },
      })
      expect(lineResponse.status(), 'POST /api/sales/order-lines should be 201').toBe(201)
      const lineBody = await readJson(lineResponse)
      const lineId = typeof lineBody.id === 'string' ? lineBody.id : null
      expect(lineId, 'order line create should return id').toBeTruthy()

      // Add an order-scoped surcharge adjustment.
      const adjustmentResponse = await apiRequest(request, 'POST', '/api/sales/order-adjustments', {
        token,
        data: {
          orderId: orderId!,
          kind: 'surcharge',
          label: `ATOMIC fee ${stamp}`,
          amountNet: 10,
          amountGross: 12,
          currencyCode: 'USD',
        },
      })
      expect(adjustmentResponse.status(), 'POST /api/sales/order-adjustments should be 201').toBe(201)

      // Line fields round-trip (decimals come back as fixed-scale strings).
      const lines = await listChildItems(request, token, 'order-lines', `orderId=${encodeURIComponent(orderId!)}`)
      expect(lines.length).toBe(1)
      const line = lines[0]
      expect(line.id).toBe(lineId)
      expect(line.name).toBe(`ATOMIC line ${stamp}`)
      expect(num(line.quantity)).toBe(3)
      expect(num(line.unit_price_net)).toBe(100)
      expect(num(line.unit_price_gross)).toBe(123)
      expect(num(line.total_net_amount)).toBe(300) // 3 * 100

      // Adjustment fields round-trip.
      const adjustments = await listChildItems(
        request,
        token,
        'order-adjustments',
        `orderId=${encodeURIComponent(orderId!)}`,
      )
      expect(adjustments.length).toBe(1)
      const adjustment = adjustments[0]
      expect(adjustment.kind).toBe('surcharge')
      expect(adjustment.label).toBe(`ATOMIC fee ${stamp}`)
      expect(num(adjustment.amount_net)).toBe(10)
      expect(num(adjustment.amount_gross)).toBe(12)

      // Parent totals recalc on read: subtotal = line + surcharge, surcharge bucket isolated.
      const afterChildren = await readSingleDocument(request, token, 'orders', orderId!)
      expect(afterChildren.lineItemCount).toBe(1)
      expect(num(afterChildren.subtotalNetAmount)).toBe(310) // 300 line + 10 surcharge
      expect(num(afterChildren.subtotalGrossAmount)).toBe(312) // 300 line + 12 surcharge
      expect(num(afterChildren.surchargeTotalAmount)).toBe(10)
      expect(num(afterChildren.grandTotalNetAmount)).toBe(310)
      expect(num(afterChildren.grandTotalGrossAmount)).toBe(312)
      expect(num(afterChildren.outstandingAmount)).toBe(312)

      // PUT-update header field round-trip. The document update contract uses the
      // singular `comment` field (mapped to the persisted `comments` column) and
      // `customerReference`; `comments`/`validUntil` are not part of the update schema.
      const updateResponse = await apiRequest(request, 'PUT', '/api/sales/orders', {
        token,
        data: { id: orderId!, comment: `updated ${stamp}`, customerReference: `ATOMIC-ORD-UPD-${stamp}` },
      })
      expect(updateResponse.status(), 'PUT /api/sales/orders should be 200').toBe(200)

      const afterUpdate = await readSingleDocument(request, token, 'orders', orderId!)
      expect(afterUpdate.comment).toBe(`updated ${stamp}`)
      expect(afterUpdate.customerReference).toBe(`ATOMIC-ORD-UPD-${stamp}`)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('quote: header/line/adjustment field fidelity, totals recalc, and PUT update round-trip', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let quoteId: string | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', '/api/sales/quotes', {
        token,
        data: { currencyCode: 'USD' },
      })
      expect(createResponse.status(), 'POST /api/sales/quotes should be 201').toBe(201)
      const created = await readJson(createResponse)
      quoteId = typeof created.id === 'string' ? created.id : null
      expect(quoteId, 'quote create should return id').toBeTruthy()

      const afterCreate = await readSingleDocument(request, token, 'quotes', quoteId!)
      expect(afterCreate.currencyCode).toBe('USD')
      expect(afterCreate.quoteNumber, 'quote should receive a generated number').toBeTruthy()

      const lineResponse = await apiRequest(request, 'POST', '/api/sales/quote-lines', {
        token,
        data: {
          quoteId: quoteId!,
          currencyCode: 'USD',
          quantity: 2,
          name: `ATOMIC quote line ${stamp}`,
          unitPriceNet: 50,
          unitPriceGross: 60,
        },
      })
      expect(lineResponse.status(), 'POST /api/sales/quote-lines should be 201').toBe(201)
      const lineBody = await readJson(lineResponse)
      const lineId = typeof lineBody.id === 'string' ? lineBody.id : null
      expect(lineId, 'quote line create should return id').toBeTruthy()

      const adjustmentResponse = await apiRequest(request, 'POST', '/api/sales/quote-adjustments', {
        token,
        data: {
          quoteId: quoteId!,
          kind: 'discount',
          label: `ATOMIC quote disc ${stamp}`,
          amountNet: 5,
          amountGross: 6,
          currencyCode: 'USD',
        },
      })
      expect(adjustmentResponse.status(), 'POST /api/sales/quote-adjustments should be 201').toBe(201)

      const lines = await listChildItems(request, token, 'quote-lines', `quoteId=${encodeURIComponent(quoteId!)}`)
      expect(lines.length).toBe(1)
      const line = lines[0]
      expect(line.id).toBe(lineId)
      expect(line.name).toBe(`ATOMIC quote line ${stamp}`)
      expect(num(line.quantity)).toBe(2)
      expect(num(line.unit_price_net)).toBe(50)
      expect(num(line.unit_price_gross)).toBe(60)
      expect(num(line.total_net_amount)).toBe(100) // 2 * 50

      const adjustments = await listChildItems(
        request,
        token,
        'quote-adjustments',
        `quoteId=${encodeURIComponent(quoteId!)}`,
      )
      expect(adjustments.length).toBe(1)
      const adjustment = adjustments[0]
      expect(adjustment.kind).toBe('discount')
      expect(adjustment.label).toBe(`ATOMIC quote disc ${stamp}`)
      expect(num(adjustment.amount_net)).toBe(5)
      expect(num(adjustment.amount_gross)).toBe(6)

      const afterChildren = await readSingleDocument(request, token, 'quotes', quoteId!)
      expect(afterChildren.lineItemCount).toBe(1)
      expect(num(afterChildren.discountTotalAmount)).toBe(5)
      expect(num(afterChildren.grandTotalNetAmount)).toBe(95) // 100 - 5 discount
      expect(num(afterChildren.grandTotalGrossAmount)).toBe(94) // 100 - 6 discount

      const updateResponse = await apiRequest(request, 'PUT', '/api/sales/quotes', {
        token,
        data: { id: quoteId!, comment: `quote updated ${stamp}`, customerReference: `ATOMIC-Q-UPD-${stamp}` },
      })
      expect(updateResponse.status(), 'PUT /api/sales/quotes should be 200').toBe(200)

      const afterUpdate = await readSingleDocument(request, token, 'quotes', quoteId!)
      expect(afterUpdate.comment).toBe(`quote updated ${stamp}`)
      expect(afterUpdate.customerReference).toBe(`ATOMIC-Q-UPD-${stamp}`)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    }
  })

  test('convert-to-order (PR #2347): lines/adjustments/totals carry over and source quote is consumed', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let quoteId: string | null = null
    let orderId: string | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', '/api/sales/quotes', {
        token,
        data: { currencyCode: 'USD' },
      })
      expect(createResponse.status()).toBe(201)
      const created = await readJson(createResponse)
      quoteId = typeof created.id === 'string' ? created.id : null
      expect(quoteId).toBeTruthy()

      const lineResponse = await apiRequest(request, 'POST', '/api/sales/quote-lines', {
        token,
        data: {
          quoteId: quoteId!,
          currencyCode: 'USD',
          quantity: 2,
          name: `CONVERT item ${stamp}`,
          unitPriceNet: 50,
          unitPriceGross: 60,
        },
      })
      expect(lineResponse.status()).toBe(201)

      const adjustmentResponse = await apiRequest(request, 'POST', '/api/sales/quote-adjustments', {
        token,
        data: {
          quoteId: quoteId!,
          kind: 'discount',
          label: `CONVERT disc ${stamp}`,
          amountNet: 5,
          amountGross: 6,
          currencyCode: 'USD',
        },
      })
      expect(adjustmentResponse.status()).toBe(201)

      const beforeConvert = await readSingleDocument(request, token, 'quotes', quoteId!)
      const expectedGrandNet = num(beforeConvert.grandTotalNetAmount)
      const expectedGrandGross = num(beforeConvert.grandTotalGrossAmount)
      expect(expectedGrandNet).toBe(95)
      expect(expectedGrandGross).toBe(94)

      // Single-transaction convert: source quote -> order.
      const convertResponse = await apiRequest(request, 'POST', '/api/sales/quotes/convert', {
        token,
        data: { quoteId: quoteId! },
      })
      expect(convertResponse.status(), 'POST /api/sales/quotes/convert should be 200').toBe(200)
      const convertBody = await readJson(convertResponse)
      orderId = typeof convertBody.orderId === 'string' ? convertBody.orderId : null
      expect(orderId, 'convert should return orderId').toBeTruthy()
      // Convert also emits an undo operation header.
      expect(parseUndoToken(convertResponse), 'convert should emit an undo token').toBeTruthy()

      // The resulting order carries the line over.
      const orderLines = await listChildItems(request, token, 'order-lines', `orderId=${encodeURIComponent(orderId!)}`)
      expect(orderLines.length).toBe(1)
      expect(orderLines[0].name).toBe(`CONVERT item ${stamp}`)
      expect(num(orderLines[0].quantity)).toBe(2)
      expect(num(orderLines[0].unit_price_net)).toBe(50)

      // ...and the adjustment.
      const orderAdjustments = await listChildItems(
        request,
        token,
        'order-adjustments',
        `orderId=${encodeURIComponent(orderId!)}`,
      )
      expect(orderAdjustments.length).toBe(1)
      expect(orderAdjustments[0].kind).toBe('discount')
      expect(num(orderAdjustments[0].amount_net)).toBe(5)

      // ...and totals match the source quote.
      const convertedOrder = await readSingleDocument(request, token, 'orders', orderId!)
      expect(convertedOrder.lineItemCount).toBe(1)
      expect(num(convertedOrder.discountTotalAmount)).toBe(5)
      expect(num(convertedOrder.grandTotalNetAmount)).toBe(expectedGrandNet)
      expect(num(convertedOrder.grandTotalGrossAmount)).toBe(expectedGrandGross)

      // The source quote is consumed by the conversion (no longer retrievable).
      const quoteAfter = await apiRequest(request, 'GET', `/api/sales/quotes?id=${encodeURIComponent(quoteId!)}`, {
        token,
      })
      expect(quoteAfter.status()).toBe(200)
      const quoteAfterBody = await readJson(quoteAfter)
      const remainingQuotes = Array.isArray(quoteAfterBody.items) ? quoteAfterBody.items : []
      expect(remainingQuotes.length, 'source quote should be consumed by conversion').toBe(0)

      // Clearing quoteId so cleanup does not try to delete the consumed quote.
      quoteId = null
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('payment (PR #2355): create/update field persistence and consistent order totals', async ({ request }) => {
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
      expect(orderId).toBeTruthy()

      // Give the order a grand total so payment math is meaningful.
      const lineResponse = await apiRequest(request, 'POST', '/api/sales/order-lines', {
        token,
        data: {
          orderId,
          currencyCode: 'USD',
          quantity: 1,
          name: `PAY line ${stamp}`,
          unitPriceNet: 100,
          unitPriceGross: 100,
        },
      })
      expect(lineResponse.status()).toBe(201)

      // Create a payment.
      const createResponse = await apiRequest(request, 'POST', '/api/sales/payments', {
        token,
        data: { orderId, amount: 40, currencyCode: 'USD', paymentReference: `PAY-${stamp}` },
      })
      expect(createResponse.status(), 'POST /api/sales/payments should be 201').toBe(201)
      const createBody = await readJson(createResponse)
      paymentId = typeof createBody.id === 'string' ? createBody.id : null
      expect(paymentId, 'payment create should return id').toBeTruthy()

      // The command-returned orderTotals are internally consistent:
      // outstanding = grandTotalGross - paid + refunded.
      const createTotals = (createBody.orderTotals ?? {}) as JsonRecord
      expect(num(createTotals.paidTotalAmount)).toBe(40)
      expect(num(createTotals.refundedTotalAmount)).toBe(0)
      expect(num(createTotals.outstandingAmount)).toBe(60) // 100 grand - 40 paid

      // Update the payment (amount + reference).
      const updateResponse = await apiRequest(request, 'PUT', '/api/sales/payments', {
        token,
        data: { id: paymentId!, amount: 75, currencyCode: 'USD', paymentReference: `PAY-UPD-${stamp}` },
      })
      expect(updateResponse.status(), 'PUT /api/sales/payments should be 200').toBe(200)
      const updateBody = await readJson(updateResponse)
      expect(updateBody.id).toBe(paymentId)

      // Payment fields persist (decimals serialized as fixed-scale strings).
      const payments = await listChildItems(request, token, 'payments', `orderId=${encodeURIComponent(orderId!)}`)
      expect(payments.length).toBe(1)
      const payment = payments[0]
      expect(payment.id).toBe(paymentId)
      expect(num(payment.amount)).toBe(75)
      expect(payment.payment_reference).toBe(`PAY-UPD-${stamp}`)
      expect(payment.order_id).toBe(orderId)
      expect(payment.currency_code).toBe('USD')

      // Order header totals reflect the recorded payment on read (#2455).
      // The single-document read recomputes display totals through the sales
      // calculation pipeline; the provider totals calculator must not reset the
      // payment totals back to the pre-payment snapshot.
      const order = await readSingleDocument(request, token, 'orders', orderId!)
      const grand = num(order.grandTotalGrossAmount)
      const paid = num(order.paidTotalAmount)
      const refunded = num(order.refundedTotalAmount)
      const outstanding = num(order.outstandingAmount)
      expect(grand).toBe(100)
      expect(paid).toBe(75)
      expect(refunded).toBe(0)
      expect(outstanding).toBe(25)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/payments', paymentId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('undo round-trip: order create, line upsert, and order update revert via audit-log undo', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let orderId: string | null = null
    let lineUndoOrderId: string | null = null
    let updateUndoOrderId: string | null = null

    try {
      // (1) Undo of order create removes the order entirely.
      const createResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD', customerReference: `UNDO-CREATE-${stamp}` },
      })
      expect(createResponse.status()).toBe(201)
      orderId = (await readJson(createResponse)).id as string
      const createUndoToken = parseUndoToken(createResponse)
      expect(createUndoToken, 'order create should emit an undo token').toBeTruthy()

      await runUndo(request, token, createUndoToken!)
      const afterCreateUndo = await apiRequest(request, 'GET', `/api/sales/orders?id=${encodeURIComponent(orderId)}`, {
        token,
      })
      const afterCreateUndoBody = await readJson(afterCreateUndo)
      expect(
        Array.isArray(afterCreateUndoBody.items) ? afterCreateUndoBody.items.length : 1,
        'order should be gone after create undo',
      ).toBe(0)
      orderId = null // undone; nothing to clean up

      // (2) Undo of a line upsert removes the line and reverts parent totals.
      const lineOrderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD' },
      })
      expect(lineOrderResponse.status()).toBe(201)
      lineUndoOrderId = (await readJson(lineOrderResponse)).id as string

      const lineResponse = await apiRequest(request, 'POST', '/api/sales/order-lines', {
        token,
        data: {
          orderId: lineUndoOrderId,
          currencyCode: 'USD',
          quantity: 1,
          name: `UNDO line ${stamp}`,
          unitPriceNet: 10,
          unitPriceGross: 10,
        },
      })
      expect(lineResponse.status()).toBe(201)
      const lineUndoToken = parseUndoToken(lineResponse)
      expect(lineUndoToken, 'line upsert should emit an undo token').toBeTruthy()

      const beforeLineUndo = await listChildItems(
        request,
        token,
        'order-lines',
        `orderId=${encodeURIComponent(lineUndoOrderId)}`,
      )
      expect(beforeLineUndo.length).toBe(1)

      await runUndo(request, token, lineUndoToken!)
      const afterLineUndo = await listChildItems(
        request,
        token,
        'order-lines',
        `orderId=${encodeURIComponent(lineUndoOrderId)}`,
      )
      expect(afterLineUndo.length, 'line should be removed after upsert undo').toBe(0)
      const orderAfterLineUndo = await readSingleDocument(request, token, 'orders', lineUndoOrderId)
      expect(orderAfterLineUndo.lineItemCount).toBe(0)
      expect(num(orderAfterLineUndo.grandTotalGrossAmount)).toBe(0)

      // (3) Undo of an order update reverts the prior field state. The update-undo
      // restores the document graph snapshot (`comment`/totals/lines/adjustments).
      const updateOrderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD' },
      })
      expect(updateOrderResponse.status()).toBe(201)
      updateUndoOrderId = (await readJson(updateOrderResponse)).id as string

      const firstUpdate = await apiRequest(request, 'PUT', '/api/sales/orders', {
        token,
        data: { id: updateUndoOrderId, comment: `STATE_A_${stamp}` },
      })
      expect(firstUpdate.status()).toBe(200)

      const secondUpdate = await apiRequest(request, 'PUT', '/api/sales/orders', {
        token,
        data: { id: updateUndoOrderId, comment: `STATE_B_${stamp}` },
      })
      expect(secondUpdate.status()).toBe(200)
      const updateUndoToken = parseUndoToken(secondUpdate)
      expect(updateUndoToken, 'order update should emit an undo token').toBeTruthy()

      const afterSecondUpdate = await readSingleDocument(request, token, 'orders', updateUndoOrderId)
      expect(afterSecondUpdate.comment).toBe(`STATE_B_${stamp}`)

      await runUndo(request, token, updateUndoToken!)
      const afterUpdateUndo = await readSingleDocument(request, token, 'orders', updateUndoOrderId)
      expect(afterUpdateUndo.comment, 'update undo should revert comment to prior state').toBe(`STATE_A_${stamp}`)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', lineUndoOrderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', updateUndoOrderId)
    }
  })
})
