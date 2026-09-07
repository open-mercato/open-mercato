import { expect, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

/**
 * TC-SALES-031: Credit memo create / read / update / delete via API.
 *
 * Issue #2459 scenario "TC-SALES-030 — Credit Memo Creation and Linking via API" (P0).
 * Renumbered to 031: TC-SALES-030 is already taken (read-model totals, #2455/#2457).
 *
 * Credit memos are a standalone sales document with an active CRUD API
 * (`/api/sales/credit-memos`, gated by `sales.credit_memos.manage`). The create command
 * returns `{ creditMemoId }` — not the full record — so field values are read back via GET.
 */

type JsonRecord = Record<string, unknown>

const NONEXISTENT_UUID = '00000000-0000-4000-8000-000000000000'

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

test.describe('TC-SALES-031 credit memo create/read/update/delete', () => {
  test('creates, reads, updates, and deletes a credit memo', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let orderId: string | null = null
    let creditMemoId: string | null = null

    try {
      const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD' , lines: [{ currencyCode: 'USD', quantity: 1, name: 'QA seed line', unitPriceNet: 0, unitPriceGross: 0 }] },
      })
      expect(orderResponse.status()).toBe(201)
      orderId = (await readJson(orderResponse)).id as string
      expect(orderId).toBeTruthy()

      const createResponse = await apiRequest(request, 'POST', '/api/sales/credit-memos', {
        token,
        data: { orderId, currencyCode: 'USD', reason: `QA credit ${stamp}` },
      })
      expect(createResponse.status(), 'POST /api/sales/credit-memos should be 201').toBe(201)
      creditMemoId = (await readJson(createResponse)).creditMemoId as string
      expect(creditMemoId, 'create response should carry creditMemoId').toBeTruthy()

      const created = listItems(
        await readJson(
          await apiRequest(request, 'GET', `/api/sales/credit-memos?id=${encodeURIComponent(creditMemoId)}`, { token }),
        ),
      ).find((row) => row.id === creditMemoId) ?? {}
      expect(created.id).toBe(creditMemoId)
      expect(created.reason).toBe(`QA credit ${stamp}`)
      expect(created.currency_code).toBe('USD')
      expect(typeof created.credit_memo_number).toBe('string')
      expect((created.credit_memo_number as string).length).toBeGreaterThan(0)
      // The validated order reference is persisted and returned as the memo's order link.
      expect(created.order_id).toBe(orderId)

      const updatedReason = `QA credit updated ${stamp}`
      const updatedGrossTotal = 37.5
      const updateResponse = await apiRequest(request, 'PUT', '/api/sales/credit-memos', {
        token,
        data: { id: creditMemoId, reason: updatedReason, grandTotalGrossAmount: updatedGrossTotal },
      })
      expect(updateResponse.status(), 'PUT /api/sales/credit-memos should be 200').toBe(200)
      expect((await readJson(updateResponse)).creditMemoId).toBe(creditMemoId)

      const updated = listItems(
        await readJson(
          await apiRequest(request, 'GET', `/api/sales/credit-memos?id=${encodeURIComponent(creditMemoId)}`, { token }),
        ),
      ).find((row) => row.id === creditMemoId) ?? {}
      expect(updated.id).toBe(creditMemoId)
      expect(updated.reason).toBe(updatedReason)
      expect(num(updated.grand_total_gross_amount)).toBe(updatedGrossTotal)

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/sales/credit-memos?id=${encodeURIComponent(creditMemoId)}`,
        { token },
      )
      expect(deleteResponse.status(), 'DELETE /api/sales/credit-memos should be 200').toBe(200)
      const afterDelete = listItems(
        await readJson(
          await apiRequest(request, 'GET', `/api/sales/credit-memos?id=${encodeURIComponent(creditMemoId)}`, { token }),
        ),
      )
      expect(afterDelete.some((row) => row.id === creditMemoId)).toBeFalsy()
      creditMemoId = null
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/credit-memos', creditMemoId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('rejects a credit memo that references an unknown order', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'POST', '/api/sales/credit-memos', {
      token,
      data: { orderId: NONEXISTENT_UUID, currencyCode: 'USD', reason: 'QA orphan credit' },
    })
    expect(response.status(), 'unknown order reference should be rejected with 400').toBe(400)
  })
})
