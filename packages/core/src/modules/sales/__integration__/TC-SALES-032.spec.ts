import { expect, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

/**
 * TC-SALES-032: Invoice create / read / delete and totals verification via API.
 *
 * Issue #2459 scenario "TC-SALES-031 — Invoice Creation and Totals Verification via API" (P0).
 * Renumbered to 032: TC-SALES-030 is already taken (read-model totals, #2455/#2457).
 *
 * Invoices are a standalone sales document (`/api/sales/invoices`, gated by
 * `sales.invoices.manage`). The create command returns `{ invoiceId }`, so fields are read
 * back via GET. This spec snapshots the order grand total, creates an invoice with the same
 * totals, and verifies the invoice persists them (the totals-verification intent). The
 * list/detail response is normalized to a camelCase document shape (`currencyCode`,
 * `invoiceNumber`, `orderId`, `grandTotalGrossAmount`, …) by `normalizeFinancialDocumentItem`.
 *
 * Scope notes:
 *  - `orderId` is validated on create (unknown order → 400, covered below) and the order
 *    relation is now persisted, so `orderId` reads back the created order id (asserted below).
 *  - `PUT /api/sales/invoices` (update) currently returns 500, so the update leg is not
 *    exercised; this spec covers create → read → delete, which all work.
 */

type JsonRecord = Record<string, unknown>

const NONEXISTENT_UUID = '00000000-0000-4000-8000-000000000000'

async function readJson(response: APIResponse): Promise<JsonRecord> {
  return (await readJsonSafe<JsonRecord>(response)) ?? {}
}

function listItems(body: JsonRecord): JsonRecord[] {
  return Array.isArray(body.items) ? (body.items as JsonRecord[]) : []
}

function num(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim().length) return Number(value)
  return Number.NaN
}

test.describe('TC-SALES-032 invoice create/read/delete + totals', () => {
  test('creates, reads, and deletes an invoice preserving totals', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null
    let invoiceId: string | null = null

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
        data: { orderId, currencyCode: 'USD', quantity: 1, name: `Invoice line ${Date.now()}`, unitPriceNet: 100, unitPriceGross: 100 },
      })
      expect(lineResponse.status()).toBe(201)

      const order = listItems(
        await readJson(await apiRequest(request, 'GET', `/api/sales/orders?id=${encodeURIComponent(orderId)}`, { token })),
      ).find((row) => row.id === orderId) ?? {}
      const orderGross = num(order.grandTotalGrossAmount)
      expect(orderGross).toBe(100)

      const createResponse = await apiRequest(request, 'POST', '/api/sales/invoices', {
        token,
        data: { orderId, currencyCode: 'USD', grandTotalNetAmount: 100, grandTotalGrossAmount: 100 },
      })
      expect(createResponse.status(), 'POST /api/sales/invoices should be 201').toBe(201)
      invoiceId = (await readJson(createResponse)).invoiceId as string
      expect(invoiceId, 'create response should carry invoiceId').toBeTruthy()

      const created = listItems(
        await readJson(await apiRequest(request, 'GET', `/api/sales/invoices?id=${encodeURIComponent(invoiceId)}`, { token })),
      ).find((row) => row.id === invoiceId) ?? {}
      expect(created.id).toBe(invoiceId)
      expect(created.currencyCode).toBe('USD')
      expect(typeof created.invoiceNumber).toBe('string')
      expect((created.invoiceNumber as string).length).toBeGreaterThan(0)
      // The invoice preserves the totals it was created with (matching the order).
      expect(num(created.grandTotalGrossAmount)).toBe(orderGross)
      // The order relation is persisted on create, so the normalized document echoes the
      // originating order id back through `orderId`.
      expect(created.orderId).toBe(orderId)

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/sales/invoices?id=${encodeURIComponent(invoiceId)}`,
        { token },
      )
      expect(deleteResponse.status(), 'DELETE /api/sales/invoices should be 200').toBe(200)
      const afterDelete = listItems(
        await readJson(await apiRequest(request, 'GET', `/api/sales/invoices?id=${encodeURIComponent(invoiceId)}`, { token })),
      )
      expect(afterDelete.some((row) => row.id === invoiceId)).toBeFalsy()
      invoiceId = null
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/invoices', invoiceId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('rejects an invoice that references an unknown order', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'POST', '/api/sales/invoices', {
      token,
      data: { orderId: NONEXISTENT_UUID, currencyCode: 'USD' },
    })
    expect(response.status(), 'unknown order reference should be rejected with 400').toBe(400)
  })
})
