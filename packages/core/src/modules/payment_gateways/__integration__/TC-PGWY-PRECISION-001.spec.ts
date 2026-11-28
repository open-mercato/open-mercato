import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  createRandomCurrencyFixture,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/helpers/integration/currenciesFixtures'

/**
 * TC-PGWY-PRECISION-001: gateway amounts for an 18-decimal order keep every digit.
 * Source: .ai/specs/2026-10-08-arbitrary-precision-money-and-fx.md
 *
 * The order total, the session amount, the partial captures and the refund all carry more
 * significant digits than a float can hold. The session is reconciled against the exact
 * amount due, the status endpoint returns `amountExact` / `amountReceivedExact`, capture and
 * refund return `capturedAmountExact` / `refundedAmountExact`, and the capture ceiling is
 * enforced on the exact captured-to-date total. Uses the `mock` provider from the `example`
 * module, which reports float amounts only.
 */

export const integrationMeta = {
  dependsOnModules: ['payment_gateways', 'sales', 'currencies', 'example'],
}

type JsonRecord = Record<string, unknown>

const ORDER_TOTAL = '1234.567890123456789012'
const FLOAT_EQUAL_MISMATCH = '1234.567890123456789'
const FIRST_CAPTURE = '1000.000000000000000001'
const REMAINING_AFTER_FIRST_CAPTURE = '234.567890123456789011'
const OVER_CEILING_CAPTURE = '234.567890123456789012'
const PARTIAL_REFUND = '100.000000000000000001'

async function readJson(response: APIResponse): Promise<JsonRecord> {
  const raw = await response.text()
  if (!raw) return {}
  try {
    return JSON.parse(raw) as JsonRecord
  } catch {
    return {}
  }
}

async function readOrder(request: APIRequestContext, token: string, id: string): Promise<JsonRecord> {
  const response = await apiRequest(request, 'GET', `/api/sales/orders?id=${encodeURIComponent(id)}`, { token })
  expect(response.status(), 'GET /api/sales/orders?id should be 200').toBe(200)
  const body = await readJson(response)
  const items = Array.isArray(body.items) ? (body.items as JsonRecord[]) : []
  return items[0] ?? {}
}

async function postSession(
  request: APIRequestContext,
  token: string,
  data: { orderId: string; amount: string; currencyCode: string },
): Promise<APIResponse> {
  return apiRequest(request, 'POST', '/api/payment_gateways/sessions', {
    token,
    data: {
      providerKey: 'mock',
      captureMethod: 'manual',
      description: `QA TC-PGWY-PRECISION-001 ${Date.now()}`,
      ...data,
    },
  })
}

async function capture(
  request: APIRequestContext,
  token: string,
  transactionId: string,
  amount?: string,
): Promise<APIResponse> {
  return apiRequest(request, 'POST', '/api/payment_gateways/capture', {
    token,
    data: amount === undefined ? { transactionId } : { transactionId, amount },
  })
}

async function refreshStatus(request: APIRequestContext, token: string, transactionId: string): Promise<JsonRecord> {
  const response = await apiRequest(request, 'POST', '/api/payment_gateways/status', {
    token,
    data: { transactionId },
  })
  expect(response.status(), 'POST /api/payment_gateways/status should be 200').toBe(200)
  return readJson(response)
}

test.describe('TC-PGWY-PRECISION-001: 18-decimal gateway amounts', () => {
  test('session, status, capture and refund amounts stay exact beyond float precision', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let currencyId: string | null = null
    let orderId: string | null = null

    try {
      const currency = await createRandomCurrencyFixture(request, token, {
        name: 'QA TC-PGWY-PRECISION-001',
        decimalPlaces: 18,
      })
      currencyId = currency.id

      const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: {
          currencyCode: currency.code,
          customerReference: `PGWY-PRECISION-${Date.now()}`,
          lines: [
            {
              currencyCode: currency.code,
              quantity: 1,
              name: 'QA gateway precision line',
              unitPriceNet: ORDER_TOTAL,
              unitPriceGross: ORDER_TOTAL,
              taxRate: 0,
            },
          ],
        },
      })
      expect(orderResponse.status(), 'POST /api/sales/orders should be 201').toBe(201)
      orderId = (await readJson(orderResponse)).id as string
      expect(orderId, 'order create should return id').toBeTruthy()

      const order = await readOrder(request, token, orderId)
      expect(order.grandTotalGrossAmountExact).toBe(ORDER_TOTAL)
      expect(order.outstandingAmountExact).toBe(ORDER_TOTAL)

      const underflowResponse = await postSession(request, token, {
        orderId,
        amount: '1e-400',
        currencyCode: currency.code,
      })
      expect(underflowResponse.status(), 'a positive amount whose numeric copy underflows should be rejected').toBe(422)

      expect(Number(FLOAT_EQUAL_MISMATCH), 'the mismatch must be invisible to float comparison').toBe(Number(ORDER_TOTAL))
      const mismatch = await postSession(request, token, {
        orderId,
        amount: FLOAT_EQUAL_MISMATCH,
        currencyCode: currency.code,
      })
      expect(mismatch.status(), 'an amount off the exact amount due should be rejected with 409').toBe(409)

      const sessionResponse = await postSession(request, token, {
        orderId,
        amount: ORDER_TOTAL,
        currencyCode: currency.code,
      })
      expect(sessionResponse.status(), 'POST /api/payment_gateways/sessions should be 201').toBe(201)
      const transactionId = (await readJson(sessionResponse)).transactionId as string
      expect(transactionId, 'session create should return transactionId').toBeTruthy()

      const storedStatusResponse = await apiRequest(
        request,
        'GET',
        `/api/payment_gateways/status?transactionId=${encodeURIComponent(transactionId)}`,
        { token },
      )
      expect(storedStatusResponse.status(), 'GET /api/payment_gateways/status should be 200').toBe(200)
      const storedStatus = await readJson(storedStatusResponse)
      expect(storedStatus.amountExact).toBe(ORDER_TOTAL)
      expect(storedStatus.amount).toBe(Number(ORDER_TOTAL))
      expect(storedStatus.currencyCode).toBe(currency.code)

      const authorizedStatus = await refreshStatus(request, token, transactionId)
      expect(authorizedStatus.status).toBe('authorized')
      expect(authorizedStatus.amountExact).toBe(ORDER_TOTAL)
      expect(authorizedStatus.amountReceivedExact).toBe('0')

      const firstCaptureResponse = await capture(request, token, transactionId, FIRST_CAPTURE)
      expect(firstCaptureResponse.status(), 'partial capture should be 200').toBe(200)
      const firstCapture = await readJson(firstCaptureResponse)
      expect(firstCapture.capturedAmountExact).toBe(FIRST_CAPTURE)
      expect(firstCapture.capturedAmount).toBe(Number(FIRST_CAPTURE))

      const capturedStatus = await refreshStatus(request, token, transactionId)
      expect(capturedStatus.amountExact).toBe(ORDER_TOTAL)
      expect(capturedStatus.amountReceivedExact).toBe(FIRST_CAPTURE)

      const overCeilingResponse = await capture(request, token, transactionId, OVER_CEILING_CAPTURE)
      expect(overCeilingResponse.status(), 'capturing past the exact remainder should be rejected with 409').toBe(409)
      const overCeiling = await readJson(overCeilingResponse)
      expect(overCeiling.code).toBe('payment_capture_ceiling_exceeded')
      expect(String(overCeiling.error)).toContain(REMAINING_AFTER_FIRST_CAPTURE)

      const remainderCaptureResponse = await capture(request, token, transactionId)
      expect(remainderCaptureResponse.status(), 'capturing the remainder should be 200').toBe(200)
      const remainderCapture = await readJson(remainderCaptureResponse)
      expect(remainderCapture.capturedAmountExact).toBe(REMAINING_AFTER_FIRST_CAPTURE)

      const exhaustedResponse = await capture(request, token, transactionId, '0.000000000000000001')
      expect(exhaustedResponse.status(), 'a fully captured authorization should reject further captures').toBe(409)
      expect((await readJson(exhaustedResponse)).code).toBe('payment_capture_ceiling_exceeded')

      const refundResponse = await apiRequest(request, 'POST', '/api/payment_gateways/refund', {
        token,
        data: { transactionId, amount: PARTIAL_REFUND, reason: 'QA precision refund' },
      })
      expect(refundResponse.status(), 'partial refund should be 200').toBe(200)
      const refund = await readJson(refundResponse)
      expect(refund.status).toBe('partially_refunded')
      expect(refund.refundedAmountExact).toBe(PARTIAL_REFUND)
      expect(refund.refundedAmount).toBe(Number(PARTIAL_REFUND))
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', currencyId)
    }
  })
})
