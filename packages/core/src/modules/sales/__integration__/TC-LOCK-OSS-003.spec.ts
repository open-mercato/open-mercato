import { expect, test } from '@playwright/test'
import { createSalesOrderFixture } from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-LOCK-OSS-003: OSS opt-in optimistic locking on sales.order
 *
 * Spec: .ai/specs/2026-05-25-oss-optimistic-locking.md
 *
 * Mirrors TC-LOCK-OSS-001/002 but for `sales.order`. Verifies that when
 * `OM_OPTIMISTIC_LOCK` covers `sales.order`:
 *   - A PUT without the extension header succeeds (guard skips).
 *   - A PUT with a fresh `updatedAt` header succeeds.
 *   - A PUT with a stale `updatedAt` header returns 409 with the structured body.
 */
const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

const BASE_URL = process.env.BASE_URL?.trim() || null
function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

async function fetchOrderUpdatedAt(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  orderId: string,
): Promise<string> {
  const response = await request.fetch(resolveUrl(`/api/sales/orders?id=${encodeURIComponent(orderId)}`), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  expect(response.status(), 'GET /api/sales/orders?id=... should return 200').toBe(200)
  const body = (await response.json()) as { items?: Array<Record<string, unknown>> }
  const item = body.items?.[0]
  expect(item, 'response should include the requested order').toBeTruthy()
  const raw = item?.updated_at ?? item?.updatedAt
  expect(typeof raw, 'order response should expose updated_at as a string').toBe('string')
  const ms = Date.parse(raw as string)
  expect(Number.isFinite(ms), `updated_at should parse as a date, got: ${raw as string}`).toBe(true)
  return new Date(ms).toISOString()
}

async function putOrder(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  orderId: string,
  data: Record<string, unknown>,
  headerValue?: string,
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  if (headerValue !== undefined) {
    headers[OPTIMISTIC_LOCK_HEADER] = headerValue
  }
  return request.fetch(resolveUrl('/api/sales/orders'), {
    method: 'PUT',
    headers,
    data: { id: orderId, ...data },
  })
}

async function deleteOrder(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  orderId: string,
) {
  return request.fetch(resolveUrl('/api/sales/orders'), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { id: orderId },
  })
}

test.describe('TC-LOCK-OSS-003: sales.order optimistic-lock guard', () => {
  test('writes without the header always succeed (opt-in semantics)', async ({ request }) => {
    let token: string | null = null
    let orderId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      orderId = await createSalesOrderFixture(request, token, 'USD')

      const res = await putOrder(request, token, orderId, { comment: `QA OSS-003 nohdr ${Date.now()}` })
      expect(res.status(), 'PUT without header should succeed (200/204)').toBeLessThan(300)
    } finally {
      if (orderId && token) {
        await deleteOrder(request, token, orderId)
      }
    }
  })

  test('fresh updatedAt header passes; stale header returns 409 with structured body', async ({ request }) => {
    let token: string | null = null
    let orderId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      orderId = await createSalesOrderFixture(request, token, 'USD')

      const t0 = await fetchOrderUpdatedAt(request, token, orderId)
      expect(t0).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      const ok = await putOrder(
        request,
        token,
        orderId,
        { comment: `QA OSS-003 v1 ${Date.now()}` },
        t0,
      )
      expect(ok.status(), 'PUT with fresh updatedAt header should succeed').toBeLessThan(300)

      const t1 = await fetchOrderUpdatedAt(request, token, orderId)
      expect(t1, 'updatedAt should advance after a successful update').not.toBe(t0)

      const conflict = await putOrder(
        request,
        token,
        orderId,
        { comment: `QA OSS-003 v2 ${Date.now()}` },
        t0,
      )
      expect(
        conflict.status(),
        'PUT with stale updatedAt header should return 409',
      ).toBe(409)
      const body = (await conflict.json()) as Record<string, unknown>
      expect(body).toMatchObject({
        error: 'record_modified',
        code: 'optimistic_lock_conflict',
        expectedUpdatedAt: t0,
      })
      expect(typeof body.currentUpdatedAt, 'response includes currentUpdatedAt as ISO string').toBe('string')
      expect(body.currentUpdatedAt).not.toBe(t0)
    } finally {
      if (orderId && token) {
        await deleteOrder(request, token, orderId)
      }
    }
  })
})
