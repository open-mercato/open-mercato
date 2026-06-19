import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import { putWithLock, expectConflictBody } from '@open-mercato/core/helpers/integration/optimisticLockUi'

/**
 * TC-SALES-038: Return edit (PUT) and delete (DELETE) via API — PR #3066 (#3035).
 *
 * Before this change the returns API was create-only. This spec proves the new
 * `sales.returns.manage`-gated mutations:
 *  - PUT  /api/sales/returns  edits reason / notes / returnedAt on the return header only
 *    (order totals untouched), and 409s on a stale optimistic-lock token.
 *  - DELETE /api/sales/returns reverses the source line's `returned_quantity`,
 *    removes the return, and the return no longer appears in the order's list.
 *
 * Cache note (mirrors TC-SALES-033): the order line's `returned_quantity` is read
 * back exactly once — after the delete — never before it, so the read is a cache
 * miss reflecting the live reversed value rather than a stale cached row.
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

async function readReturnUpdatedAt(
  request: APIRequestContext,
  token: string,
  orderId: string,
  returnId: string,
): Promise<string> {
  const rows = listItems(
    await readJson(
      await apiRequest(request, 'GET', `/api/sales/returns?orderId=${encodeURIComponent(orderId)}`, { token }),
    ),
  )
  const row = rows.find((item) => item.id === returnId) ?? {}
  const raw = (row.updated_at ?? row.updatedAt) as string | undefined
  expect(typeof raw, `return ${returnId} should expose updated_at, got ${String(raw)}`).toBe('string')
  return new Date(Date.parse(raw as string)).toISOString()
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
  return listItems(await readJson(response)).find((row) => row.id === lineId) ?? {}
}

async function createOrderWithReturn(
  request: APIRequestContext,
  token: string,
  quantity: number,
  returnQuantity: number,
): Promise<{ orderId: string; orderLineId: string; returnId: string }> {
  const orderResponse = await apiRequest(request, 'POST', '/api/sales/orders', {
    token,
    data: { currencyCode: 'USD' },
  })
  expect(orderResponse.status()).toBe(201)
  const orderId = (await readJson(orderResponse)).id as string

  const lineResponse = await apiRequest(request, 'POST', '/api/sales/order-lines', {
    token,
    data: { orderId, currencyCode: 'USD', quantity, name: `Returnable ${Date.now()}`, unitPriceNet: 50, unitPriceGross: 50 },
  })
  expect(lineResponse.status()).toBe(201)
  const orderLineId = (await readJson(lineResponse)).id as string

  const returnResponse = await apiRequest(request, 'POST', '/api/sales/returns', {
    token,
    data: { orderId, reason: `QA return ${Date.now()}`, lines: [{ orderLineId, quantity: returnQuantity }] },
  })
  expect(returnResponse.status(), 'POST /api/sales/returns should be 201').toBe(201)
  const returnId = (await readJson(returnResponse)).id as string
  expect(returnId).toBeTruthy()

  return { orderId, orderLineId, returnId }
}

test.describe('TC-SALES-038 return edit + delete', () => {
  test('PUT updates reason/notes/returnedAt on the return header', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null

    try {
      const created = await createOrderWithReturn(request, token, 5, 2)
      orderId = created.orderId

      const updateResponse = await apiRequest(request, 'PUT', '/api/sales/returns', {
        token,
        data: {
          id: created.returnId,
          orderId,
          reason: 'Edited reason',
          notes: 'Edited notes',
          returnedAt: '2026-06-01T00:00:00.000Z',
        },
      })
      expect(updateResponse.status(), 'PUT /api/sales/returns should be 200').toBe(200)
      expect((await readJson(updateResponse)).ok).toBe(true)

      const detail = await readJson(
        await apiRequest(request, 'GET', `/api/sales/returns/${encodeURIComponent(created.returnId)}`, { token }),
      )
      const header = (detail.return ?? {}) as JsonRecord
      expect(header.reason).toBe('Edited reason')
      expect(header.notes).toBe('Edited notes')
      expect(String(header.returnedAt ?? '')).toContain('2026-06-01')
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('PUT with a stale optimistic-lock token is refused with 409', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null

    try {
      const created = await createOrderWithReturn(request, token, 5, 1)
      orderId = created.orderId

      const staleUpdatedAt = await readReturnUpdatedAt(request, token, orderId, created.returnId)

      // Out-of-band header-less PUT advances updated_at so the captured token is now stale.
      const bump = await apiRequest(request, 'PUT', '/api/sales/returns', {
        token,
        data: { id: created.returnId, orderId, notes: 'Concurrent edit' },
      })
      expect(bump.status(), 'header-less PUT should succeed and bump updated_at').toBe(200)

      const conflict = await putWithLock(
        request,
        token,
        '/api/sales/returns',
        { id: created.returnId, orderId, reason: 'Stale edit' },
        staleUpdatedAt,
      )
      await expectConflictBody(conflict)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('DELETE reverses returned_quantity and removes the return', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null

    try {
      const created = await createOrderWithReturn(request, token, 5, 2)
      orderId = created.orderId

      const deleteResponse = await apiRequest(request, 'DELETE', '/api/sales/returns', {
        token,
        data: { id: created.returnId, orderId },
      })
      expect(deleteResponse.status(), 'DELETE /api/sales/returns should be 200').toBe(200)
      expect((await readJson(deleteResponse)).ok).toBe(true)

      // The source line's returned_quantity is reversed back to 0.
      const line = await readOrderLine(request, token, orderId, created.orderLineId)
      expect(num(line.returned_quantity)).toBe(0)

      // The return no longer appears in the order's return list.
      const remaining = listItems(
        await readJson(
          await apiRequest(request, 'GET', `/api/sales/returns?orderId=${encodeURIComponent(orderId)}`, { token }),
        ),
      )
      expect(remaining.some((row) => row.id === created.returnId)).toBe(false)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
