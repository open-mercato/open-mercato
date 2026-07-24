import { expect, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { canManageSalesOrders, deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

/**
 * TC-SALES-4021: a sales order must contain at least one line item.
 *
 * Issue #4021 — an order with zero lines represents nothing being sold and is
 * not a valid state (matches the module invariant in the sales AGENTS.md:
 * "Sales Orders … MUST have a channel and at least one line"). This spec locks
 * in the two enforcement points:
 *   1. Creation is rejected (400) when `lines` is missing or empty.
 *   2. Deleting the only remaining line of an existing order is rejected (409).
 * Orders with more than one line can still have lines removed down to one.
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

function seedLine(name: string): JsonRecord {
  return { currencyCode: 'USD', quantity: 1, name, unitPriceNet: 10, unitPriceGross: 12 }
}

test.describe('TC-SALES-4021 order requires at least one line', () => {
  test('rejects order creation without lines and blocks deleting the last line', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    if (!(await canManageSalesOrders(request, token))) {
      test.skip(true, 'principal cannot manage sales orders on this tenant')
      return
    }
    const stamp = Date.now()
    let orderId: string | null = null
    let twoLineOrderId: string | null = null

    try {
      // (1) Missing lines → 400.
      const missingLines = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD' },
      })
      expect(missingLines.status(), 'order create without lines must be rejected').toBe(400)

      // (2) Empty lines array → 400.
      const emptyLines = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD', lines: [] },
      })
      expect(emptyLines.status(), 'order create with an empty lines array must be rejected').toBe(400)

      // (3) One line → 201.
      const created = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD', lines: [seedLine(`Only line ${stamp}`)] },
      })
      expect(created.status(), 'order create with one line must succeed').toBe(201)
      orderId = (await readJson(created)).id as string
      expect(orderId).toBeTruthy()

      // The single line cannot be deleted — the order would be left empty.
      const singleLine = listItems(
        await readJson(
          await apiRequest(request, 'GET', `/api/sales/order-lines?orderId=${encodeURIComponent(orderId!)}`, { token }),
        ),
      )
      expect(singleLine.length).toBe(1)
      const lastLineId = singleLine[0].id as string
      const deleteLast = await apiRequest(request, 'DELETE', '/api/sales/order-lines', {
        token,
        data: { id: lastLineId, orderId },
      })
      expect(deleteLast.status(), 'deleting the only line must be rejected').toBe(409)

      // The line is still there after the rejected delete.
      const afterReject = listItems(
        await readJson(
          await apiRequest(request, 'GET', `/api/sales/order-lines?orderId=${encodeURIComponent(orderId!)}`, { token }),
        ),
      )
      expect(afterReject.length, 'the rejected delete must not remove the line').toBe(1)

      // (4) With two lines, one can be removed down to a single remaining line.
      const twoLines = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD', lines: [seedLine(`Keep ${stamp}`), seedLine(`Remove ${stamp}`)] },
      })
      expect(twoLines.status()).toBe(201)
      twoLineOrderId = (await readJson(twoLines)).id as string

      const bothLines = listItems(
        await readJson(
          await apiRequest(request, 'GET', `/api/sales/order-lines?orderId=${encodeURIComponent(twoLineOrderId!)}`, { token }),
        ),
      )
      expect(bothLines.length).toBe(2)
      const removableId = (bothLines.find((line) => line.name === `Remove ${stamp}`) ?? bothLines[0]).id as string
      const removeOne = await apiRequest(request, 'DELETE', '/api/sales/order-lines', {
        token,
        data: { id: removableId, orderId: twoLineOrderId },
      })
      expect(removeOne.status(), 'deleting a line while another remains must succeed').toBe(200)

      const remaining = listItems(
        await readJson(
          await apiRequest(request, 'GET', `/api/sales/order-lines?orderId=${encodeURIComponent(twoLineOrderId!)}`, { token }),
        ),
      )
      expect(remaining.length).toBe(1)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', twoLineOrderId)
    }
  })
})
