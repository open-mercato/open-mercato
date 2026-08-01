import { expect, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

/**
 * TC-PGWY-023: Payment-session amount reconciliation against the order total
 *
 * Spec: .ai/specs/implemented/SPEC-044-2026-02-24-payment-gateway-integrations.md §16.5
 * Issue #4488 (follow-up to the capture-side guard of #4486).
 *
 * `POST /api/payment_gateways/sessions` reconciles a caller-supplied `amount` and
 * `currencyCode` against the authoritative amount due for a referenced order before any
 * provider is contacted. The unit suites mock the resolver and the entity manager; this
 * spec exercises the real wiring end to end — the `sales` module registering
 * `paymentOrderTotalResolver`, the tenant/organization-scoped order lookup, and the route
 * answering `409` rather than collapsing the conflict into `502`.
 *
 * Covered: mismatched amount, mismatched currency, an order id that does not resolve in the
 * caller's scope, and the matching amount that is allowed through.
 */

type JsonRecord = Record<string, unknown>

const UNRESOLVABLE_ORDER_ID = '00000000-0000-4000-8000-000000000000'
const ORDER_GROSS = 100

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

async function postSession(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  data: JsonRecord,
): Promise<APIResponse> {
  return apiRequest(request, 'POST', '/api/payment_gateways/sessions', {
    token,
    data: {
      providerKey: 'mock',
      currencyCode: 'USD',
      captureMethod: 'manual',
      description: `QA PGWY-023 ${Date.now()}`,
      ...data,
    },
  })
}

test.describe('TC-PGWY-023 payment-session amount reconciliation', () => {
  test('rejects amounts and currencies that do not match the order, and accepts the amount due', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null

    try {
      const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD' },
      })
      expect(orderResponse.status(), 'POST /api/sales/orders should be 201').toBe(201)
      orderId = (await readJson(orderResponse)).id as string
      expect(orderId, 'order create response should carry an id').toBeTruthy()

      const lineResponse = await apiRequest(request, 'POST', '/api/sales/order-lines', {
        token,
        data: {
          orderId,
          currencyCode: 'USD',
          quantity: 1,
          name: `QA PGWY-023 line ${Date.now()}`,
          unitPriceNet: ORDER_GROSS,
          unitPriceGross: ORDER_GROSS,
        },
      })
      expect(lineResponse.status(), 'POST /api/sales/order-lines should be 201').toBe(201)

      const order = listItems(
        await readJson(await apiRequest(request, 'GET', `/api/sales/orders?id=${encodeURIComponent(orderId)}`, { token })),
      ).find((row) => row.id === orderId) ?? {}
      const amountDue = num(order.grandTotalGrossAmount ?? order.grand_total_gross_amount)
      expect(amountDue, 'the seeded order should be due its single line gross total').toBe(ORDER_GROSS)

      const tooHigh = await postSession(request, token, { orderId, amount: amountDue + 25 })
      expect(tooHigh.status(), 'an amount above the amount due should be rejected with 409').toBe(409)
      const tooHighBody = await readJson(tooHigh)
      expect(typeof tooHighBody.error, '409 responses carry an error message').toBe('string')
      expect(tooHighBody.transactionId, 'a rejected request must not create a transaction').toBeUndefined()

      const tooLow = await postSession(request, token, { orderId, amount: amountDue - 25 })
      expect(tooLow.status(), 'an amount below the amount due should be rejected with 409').toBe(409)

      const wrongCurrency = await postSession(request, token, {
        orderId,
        amount: amountDue,
        currencyCode: 'EUR',
      })
      expect(wrongCurrency.status(), 'a currency other than the order currency should be rejected with 409').toBe(409)

      const unresolvableOrder = await postSession(request, token, {
        orderId: UNRESOLVABLE_ORDER_ID,
        amount: amountDue,
      })
      expect(
        unresolvableOrder.status(),
        'an order that does not resolve in the caller scope should be rejected with 409',
      ).toBe(409)
      const unresolvableBody = await readJson(unresolvableOrder)
      expect(typeof unresolvableBody.error, 'the out-of-scope response carries an error message').toBe('string')

      const matching = await postSession(request, token, { orderId, amount: amountDue })
      expect(matching.status(), 'the amount due should be accepted').toBe(201)
      const matchingBody = await readJson(matching)
      expect(matchingBody.transactionId, 'an accepted request creates a gateway transaction').toBeTruthy()
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
