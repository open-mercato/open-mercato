import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  createRandomCurrencyFixture,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/helpers/integration/currenciesFixtures'

/**
 * TC-SALES-PRECISION-001: an order in an 18-decimal currency keeps every digit,
 * including a 25-significant-digit exchange rate. The order API does not expose
 * the exchange rate, so it is read back from the order create audit snapshot.
 * Source: .ai/specs/2026-10-08-arbitrary-precision-money-and-fx.md
 */

type JsonRecord = Record<string, unknown>

const LONG_EXCHANGE_RATE = '1.234567890123456789012345'

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

async function readCreateSnapshot(
  request: APIRequestContext,
  token: string,
  resourceKind: string,
  resourceId: string,
  commandId: string,
): Promise<JsonRecord> {
  const query = `resourceKind=${encodeURIComponent(resourceKind)}&resourceId=${encodeURIComponent(resourceId)}`
  const response = await apiRequest(request, 'GET', `/api/audit_logs/audit-logs/actions?${query}`, { token })
  expect(response.status(), 'GET /api/audit_logs/audit-logs/actions should be 200').toBe(200)
  const items = ((await readJson(response)).items ?? []) as JsonRecord[]
  const entry = items.find((item) => item.commandId === commandId)
  const snapshot = entry?.snapshotAfter
  return snapshot && typeof snapshot === 'object' ? (snapshot as JsonRecord) : {}
}

test.describe('TC-SALES-PRECISION-001: 18-decimal currency order totals', () => {
  test('line, document and payment totals stay exact beyond float precision', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let currencyId: string | null = null
    let orderId: string | null = null
    let paymentId: string | null = null

    try {
      const currency = await createRandomCurrencyFixture(request, token, {
        name: 'QA TC-SALES-PRECISION-001',
        decimalPlaces: 18,
      })
      currencyId = currency.id

      const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: {
          currencyCode: currency.code,
          exchangeRate: LONG_EXCHANGE_RATE,
          customerReference: `PRECISION-${Date.now()}`,
          lines: [
            {
              currencyCode: currency.code,
              quantity: 3,
              name: 'QA wei line',
              unitPriceNet: '0.000000000000000001',
              unitPriceGross: '0.000000000000000001',
              taxRate: 0,
            },
            {
              currencyCode: currency.code,
              quantity: 1,
              name: 'QA precise line',
              unitPriceNet: '1.123456789012345678',
              unitPriceGross: '1.123456789012345678',
              taxRate: 0,
            },
          ],
        },
      })
      expect(orderResponse.status(), 'POST /api/sales/orders should be 201').toBe(201)
      orderId = (await readJson(orderResponse)).id as string
      expect(orderId, 'order create should return id').toBeTruthy()

      const order = await readOrder(request, token, orderId)
      expect(order.grandTotalNetAmountExact).toBe('1.123456789012345681')
      expect(order.grandTotalGrossAmountExact).toBe('1.123456789012345681')
      expect(order.outstandingAmountExact).toBe('1.123456789012345681')

      const createdOrderId = orderId
      await expect
        .poll(async () => {
          const snapshot = await readCreateSnapshot(request, token, 'sales.order', createdOrderId, 'sales.orders.create')
          const orderSnapshot = (snapshot.order ?? {}) as JsonRecord
          return orderSnapshot.exchangeRate
        }, { message: 'order exchange rate should keep all 25 significant digits' })
        .toBe(LONG_EXCHANGE_RATE)

      const linesResponse = await apiRequest(
        request,
        'GET',
        `/api/sales/order-lines?orderId=${encodeURIComponent(orderId)}&pageSize=10`,
        { token },
      )
      expect(linesResponse.status()).toBe(200)
      const lines = ((await readJson(linesResponse)).items ?? []) as JsonRecord[]
      const totals = lines.map((line) => String(line.total_net_amount ?? line.totalNetAmount)).sort()
      expect(totals).toEqual(['0.000000000000000003', '1.123456789012345678'])

      const paymentResponse = await apiRequest(request, 'POST', '/api/sales/payments', {
        token,
        data: { orderId, amount: '1.12345678901234568', currencyCode: currency.code },
      })
      expect(paymentResponse.status(), 'POST /api/sales/payments should be 201').toBe(201)
      const paymentBody = await readJson(paymentResponse)
      paymentId = typeof paymentBody.id === 'string' ? paymentBody.id : null
      const orderTotals = (paymentBody.orderTotals ?? {}) as JsonRecord
      expect(orderTotals.paidTotalAmountExact).toBe('1.12345678901234568')
      expect(orderTotals.outstandingAmountExact).toBe('0.000000000000000001')
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/payments', paymentId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', currencyId)
    }
  })
})
