import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

/**
 * TC-SALES-033: Return creation and returned-quantity tracking via API.
 *
 * Issue #2459 scenario "TC-SALES-032 — Return Creation and Quantity Tracking via API" (P0).
 * Renumbered to 033: TC-SALES-030 is already taken (read-model totals, #2455/#2457).
 *
 * The returns API exposes list GET + POST (`sales.returns.view` / `sales.returns.create`)
 * and a detail GET at `/api/sales/returns/{id}`. There is no PUT/DELETE — a return is
 * cleaned up by deleting its parent order. Creating a return increments
 * `returned_quantity` on the source order line and recomputes order totals; this spec
 * asserts the quantity increment (the key fulfilment contract) and the detail read-back.
 * Returns require whole-integer quantities >= 1 and reject over-returns.
 *
 * Cache note: the order line's `returned_quantity` is read back exactly once, after the
 * return — and never before it. The return command updates the line column but does not
 * invalidate the order-lines list cache, so a read taken before the return would be served
 * stale from cache (`ENABLE_CRUD_API_CACHE`, on in CI). Reading only after the return keeps
 * the request a cache miss for this freshly created order, so it reflects the live value.
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

async function readOrderLine(
  request: APIRequestContext,
  token: string,
  orderId: string,
  lineId: string,
): Promise<JsonRecord> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/sales/order-lines?orderId=${encodeURIComponent(orderId)}`,
    { token },
  )
  expect(response.status()).toBe(200)
  const rows = listItems(await readJson(response))
  return rows.find((row) => row.id === lineId) ?? {}
}

test.describe('TC-SALES-033 return creation + quantity tracking', () => {
  test('creates a return and increments returned_quantity on the source line', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null
    let orderLineId: string | null = null

    try {
      const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD' },
      })
      expect(orderResponse.status()).toBe(201)
      orderId = (await readJson(orderResponse)).id as string

      const lineResponse = await apiRequest(request, 'POST', '/api/sales/order-lines', {
        token,
        data: { orderId, currencyCode: 'USD', quantity: 5, name: `Returnable ${Date.now()}`, unitPriceNet: 50, unitPriceGross: 50 },
      })
      expect(lineResponse.status()).toBe(201)
      orderLineId = (await readJson(lineResponse)).id as string
      expect(orderLineId).toBeTruthy()

      const returnResponse = await apiRequest(request, 'POST', '/api/sales/returns', {
        token,
        data: { orderId, reason: `QA return ${Date.now()}`, lines: [{ orderLineId, quantity: 2 }] },
      })
      expect(returnResponse.status(), 'POST /api/sales/returns should be 201').toBe(201)
      const returnId = (await readJson(returnResponse)).id as string
      expect(returnId, 'create response should carry id').toBeTruthy()

      // Detail read-back: return header + return lines.
      const detailResponse = await apiRequest(
        request,
        'GET',
        `/api/sales/returns/${encodeURIComponent(returnId)}`,
        { token },
      )
      expect(detailResponse.status()).toBe(200)
      const detail = await readJson(detailResponse)
      const returnHeader = (detail.return ?? {}) as JsonRecord
      expect(returnHeader.orderId).toBe(orderId)
      expect(typeof returnHeader.returnNumber).toBe('string')
      const returnLines = Array.isArray(detail.lines) ? (detail.lines as JsonRecord[]) : []
      expect(returnLines.length).toBe(1)
      expect(returnLines[0]?.orderLineId).toBe(orderLineId)
      expect(num(returnLines[0]?.quantityReturned)).toBe(2)

      // List filter by order surfaces the return.
      const byOrder = listItems(
        await readJson(await apiRequest(request, 'GET', `/api/sales/returns?orderId=${encodeURIComponent(orderId)}`, { token })),
      )
      expect(byOrder.some((row) => row.id === returnId)).toBeTruthy()

      // The source line now reports 2 returned of 5.
      const after = await readOrderLine(request, token, orderId!, orderLineId!)
      expect(num(after.returned_quantity)).toBe(2)
    } finally {
      // Returns have no delete endpoint; removing the parent order is the cleanup path.
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('rejects a return whose quantity exceeds the remaining line quantity', async ({ request }) => {
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
        data: { orderId, currencyCode: 'USD', quantity: 2, name: `Over-return ${Date.now()}`, unitPriceNet: 50, unitPriceGross: 50 },
      })
      const orderLineId = (await readJson(lineResponse)).id as string

      const response = await apiRequest(request, 'POST', '/api/sales/returns', {
        token,
        data: { orderId, lines: [{ orderLineId, quantity: 99 }] },
      })
      expect(response.status(), 'over-return should be rejected with 400').toBe(400)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
