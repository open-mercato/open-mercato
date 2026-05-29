import { expect, test, type APIRequestContext } from '@playwright/test'
import { createSalesOrderFixture } from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  OPTIMISTIC_LOCK_HEADER_NAME,
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_CONFLICT_ERROR,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * TC-LOCK-OSS-007: deterministic two-session concurrent-edit + stale-DELETE on
 * `sales.order`.
 *
 * Spec: .ai/specs/2026-05-25-oss-optimistic-locking.md +
 *       .ai/specs/2026-05-28-optimistic-locking-coverage-completion.md
 *
 * Pattern (see __concurrent_edit_pattern.md):
 *  - concurrent edit: two sessions hold t0; A wins (→ t1, 200), stale B → 409.
 *  - stale delete: GET t0 → advance to t1 → DELETE with t0 → 409;
 *    DELETE with t1 → 200; DELETE again → already-gone contract (404/2xx).
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

async function putOrder(
  request: APIRequestContext,
  token: string,
  orderId: string,
  comment: string,
  headerValue: string,
) {
  return request.fetch(resolveUrl('/api/sales/orders'), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      [OPTIMISTIC_LOCK_HEADER_NAME]: headerValue,
    },
    data: { id: orderId, comment },
  })
}

async function deleteOrder(
  request: APIRequestContext,
  token: string,
  orderId: string,
  headerValue?: string,
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  if (headerValue !== undefined) headers[OPTIMISTIC_LOCK_HEADER_NAME] = headerValue
  return request.fetch(resolveUrl('/api/sales/orders'), {
    method: 'DELETE',
    headers,
    data: { id: orderId },
  })
}

test.describe('TC-LOCK-OSS-007: sales.order concurrent edit + stale delete', () => {
  // Runs as `admin`, which the sales module grants `sales.*` to in setup.ts
  // (`defaultRoleFeatures`). So a freshly installed tenant and CI both have the
  // sales features out of the box — no manual `yarn mercato auth sync-role-acls`
  // and no self-skip. (Only a long-lived tenant created before these features
  // existed needs the documented one-time ACL sync.)
  test('concurrent edit: session A wins, stale session B gets 409', async ({ request }) => {
    let token: string | null = null
    let orderId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      orderId = await createSalesOrderFixture(request, token, 'USD')

      const t0 = await fetchOrderUpdatedAt(request, token, orderId)
      expect(t0).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      const sessionA = await putOrder(request, token, orderId, `QA OSS-007 A ${Date.now()}`, t0)
      expect(sessionA.status(), 'session A (fresh t0) PUT should win').toBeLessThan(300)

      const t1 = await fetchOrderUpdatedAt(request, token, orderId)
      expect(t1, 'updated_at should advance after session A').not.toBe(t0)

      const sessionB = await putOrder(request, token, orderId, `QA OSS-007 B ${Date.now()}`, t0)
      expect(sessionB.status(), 'stale session B PUT should be refused with 409').toBe(409)
      const body = (await sessionB.json()) as Record<string, unknown>
      expect(body).toMatchObject({
        error: OPTIMISTIC_LOCK_CONFLICT_ERROR,
        code: OPTIMISTIC_LOCK_CONFLICT_CODE,
        expectedUpdatedAt: t0,
      })
      expect(typeof body.currentUpdatedAt, 'conflict body includes currentUpdatedAt as ISO string').toBe('string')
      expect(body.currentUpdatedAt).not.toBe(t0)
    } finally {
      if (orderId && token) {
        await deleteOrder(request, token, orderId)
      }
    }
  })

  test('stale delete returns 409; fresh delete succeeds; delete-again is already-gone', async ({ request }) => {
    let token: string | null = null
    let orderId: string | null = null
    let deleted = false
    try {
      token = await getAuthToken(request, 'admin')
      orderId = await createSalesOrderFixture(request, token, 'USD')

      const t0 = await fetchOrderUpdatedAt(request, token, orderId)
      const bumped = await putOrder(request, token, orderId, `QA OSS-007 del v1 ${Date.now()}`, t0)
      expect(bumped.status(), 'PUT with fresh t0 should win').toBeLessThan(300)
      const t1 = await fetchOrderUpdatedAt(request, token, orderId)
      expect(t1, 'updated_at should advance after the update').not.toBe(t0)

      const stale = await deleteOrder(request, token, orderId, t0)
      expect(stale.status(), 'DELETE with stale t0 should be refused with 409').toBe(409)
      const body = (await stale.json()) as Record<string, unknown>
      expect(body).toMatchObject({
        error: OPTIMISTIC_LOCK_CONFLICT_ERROR,
        code: OPTIMISTIC_LOCK_CONFLICT_CODE,
        expectedUpdatedAt: t0,
      })

      const fresh = await deleteOrder(request, token, orderId, t1)
      expect(fresh.status(), 'DELETE with fresh t1 should succeed').toBeLessThan(300)
      deleted = true

      const again = await deleteOrder(request, token, orderId)
      expect(
        [200, 204, 404].includes(again.status()),
        `delete-again should honor the already-gone contract, got ${again.status()}`,
      ).toBe(true)
    } finally {
      if (orderId && token && !deleted) {
        await deleteOrder(request, token, orderId)
      }
    }
  })
})
