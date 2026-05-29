import { expect, test, type APIRequestContext } from '@playwright/test'
import {
  createSalesOrderFixture,
  createOrderLineFixture,
  canManageSalesOrders,
} from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  OPTIMISTIC_LOCK_HEADER_NAME,
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_CONFLICT_ERROR,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * TC-LOCK-OSS-008: sales document sub-resource (line) aggregate conflict.
 *
 * Spec: .ai/specs/2026-05-28-optimistic-locking-coverage-completion.md
 *
 * Sub-resource writes (order lines) are NOT plain `makeCrudRoute` updates of
 * the line — they run through the `sales.orders.lines.upsert` command, which
 * recalculates the parent order's totals and therefore advances the ORDER's
 * `updated_at`. The order is the consistency boundary, so the command guards
 * the parent via `enforceSalesDocumentOptimisticLock` using the order's
 * expected `updated_at` carried in the optimistic-lock header.
 *
 * Deterministic flow:
 *  1. Create order. GET the order's `updated_at` (t0).
 *  2. Advance the order version with a SECOND action — add a line (no header) →
 *     totals recalc dirties the order → t1.
 *  3. Attempt another line POST carrying the STALE order header (t0) → 409,
 *     proving the document-aggregate guard fires on a sub-resource mutation.
 */

const BASE_URL = process.env.BASE_URL?.trim() || null
function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

async function fetchOrderUpdatedAt(
  request: APIRequestContext,
  token: string,
  orderId: string,
): Promise<string> {
  const response = await request.fetch(
    resolveUrl(`/api/sales/orders?id=${encodeURIComponent(orderId)}`),
    { method: 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
  )
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

async function postOrderLine(
  request: APIRequestContext,
  token: string,
  orderId: string,
  name: string,
  headerValue?: string,
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  if (headerValue !== undefined) headers[OPTIMISTIC_LOCK_HEADER_NAME] = headerValue
  return request.fetch(resolveUrl('/api/sales/order-lines'), {
    method: 'POST',
    headers,
    data: {
      orderId,
      currencyCode: 'USD',
      quantity: 1,
      name,
      unitPriceNet: 10,
      unitPriceGross: 12,
    },
  })
}

async function deleteOrder(request: APIRequestContext, token: string, orderId: string) {
  return request.fetch(resolveUrl('/api/sales/orders'), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { id: orderId },
  })
}

test.describe('TC-LOCK-OSS-008: sales document sub-resource (line) aggregate conflict', () => {
  // Self-skip on dev databases whose role ACLs were never synced so the admin
  // principal lacks `sales.orders.manage`. CI bootstraps a fully-synced tenant,
  // so the probe passes and the test runs there. Deterministic, never flaky.
  test.beforeAll(async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    test.skip(
      !(await canManageSalesOrders(request, token)),
      'admin lacks sales.orders.manage on this tenant — run `yarn mercato auth sync-role-acls`',
    )
  })

  test('stale parent-order header on a line upsert returns 409 (document-aggregate guard)', async ({ request }) => {
    let token: string | null = null
    let orderId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      orderId = await createSalesOrderFixture(request, token, 'USD')

      // t0: pre-mutation order version.
      const t0 = await fetchOrderUpdatedAt(request, token, orderId)
      expect(t0).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      // Second action: add a line — recalculates order totals → order advances to t1.
      await createOrderLineFixture(request, token, orderId, { name: `QA OSS-008 line v1 ${Date.now()}` })
      const t1 = await fetchOrderUpdatedAt(request, token, orderId)
      expect(t1, "adding a line should advance the parent order's updated_at").not.toBe(t0)

      // A line upsert carrying the STALE order header (t0) must conflict.
      const conflict = await postOrderLine(request, token, orderId, `QA OSS-008 line v2 ${Date.now()}`, t0)
      expect(
        conflict.status(),
        'line upsert with stale parent-order header should return 409 (enforceSalesDocumentOptimisticLock)',
      ).toBe(409)
      const body = (await conflict.json()) as Record<string, unknown>
      expect(body).toMatchObject({
        error: OPTIMISTIC_LOCK_CONFLICT_ERROR,
        code: OPTIMISTIC_LOCK_CONFLICT_CODE,
        expectedUpdatedAt: t0,
      })
      expect(typeof body.currentUpdatedAt, 'conflict body includes currentUpdatedAt as ISO string').toBe('string')
      expect(body.currentUpdatedAt).not.toBe(t0)

      // A line upsert carrying the FRESH order header (t1) must succeed.
      const ok = await postOrderLine(request, token, orderId, `QA OSS-008 line v3 ${Date.now()}`, t1)
      expect(ok.status(), 'line upsert with fresh parent-order header should succeed').toBeLessThan(300)
    } finally {
      if (orderId && token) {
        await deleteOrder(request, token, orderId)
      }
    }
  })
})
