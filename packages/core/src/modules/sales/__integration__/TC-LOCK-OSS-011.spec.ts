import { expect, test, type APIRequestContext } from '@playwright/test'
import { createSalesOrderFixture, deleteSalesEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  OPTIMISTIC_LOCK_HEADER_NAME,
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_CONFLICT_ERROR,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * TC-LOCK-OSS-011: sales document update response carries the fresh `updatedAt`
 * so back-to-back inline saves on the same page do NOT falsely 409.
 *
 * Spec: .ai/specs/implemented/2026-05-25-oss-optimistic-locking.md
 *
 * Round-4 QA reproduced a false-positive: open an order, edit a field, save
 * (success), then edit another field and save again → 409, with no concurrent
 * edit. Root cause: the document update response stripped `updatedAt`, so the
 * page kept the pre-save token and the second save sent a now-stale value.
 *
 * The fix returns `updatedAt` from the order/quote PUT response. This proves:
 *   1. The PUT response body includes a fresh `updatedAt` that advanced past t0.
 *   2. A SECOND save using the token from the previous response succeeds (the
 *      false-positive is gone) — the loop the page now performs in updateDocument.
 *   3. A save using the ORIGINAL (stale) t0 is still correctly refused with 409,
 *      proving locking remains effective.
 */

const BASE_URL = process.env.BASE_URL?.trim() || null
function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

type OrderPutResult = { updatedAt?: string | null } & Record<string, unknown>

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
  const raw = body.items?.[0]?.updated_at ?? body.items?.[0]?.updatedAt
  expect(typeof raw, 'order response should expose updated_at as a string').toBe('string')
  return new Date(Date.parse(raw as string)).toISOString()
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

test.describe('TC-LOCK-OSS-011: sales order update response refreshes the lock token', () => {
  test('back-to-back saves using the returned updatedAt do not falsely 409', async ({ request }) => {
    let token: string | null = null
    let orderId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      orderId = await createSalesOrderFixture(request, token, 'USD')

      const t0 = await fetchOrderUpdatedAt(request, token, orderId)
      expect(t0).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      // First inline save with the page's initial token (t0) — succeeds and the
      // response now carries the fresh updatedAt the client adopts.
      const firstSave = await putOrder(request, token, orderId, `QA OSS-011 first ${Date.now()}`, t0)
      expect(firstSave.status(), 'first save with fresh t0 should succeed').toBeLessThan(300)
      const firstBody = (await firstSave.json()) as OrderPutResult
      expect(typeof firstBody.updatedAt, 'PUT response should include updatedAt (#2055 fix)').toBe('string')
      const t1 = new Date(Date.parse(firstBody.updatedAt as string)).toISOString()
      expect(t1, 'response updatedAt should have advanced past t0').not.toBe(t0)

      // Second inline save on the SAME page using the token from the previous
      // response — this is the flow that previously false-409'd. Must succeed.
      const secondSave = await putOrder(request, token, orderId, `QA OSS-011 second ${Date.now()}`, t1)
      expect(
        secondSave.status(),
        'second save using the returned token must succeed (no false 409)',
      ).toBeLessThan(300)
      const secondBody = (await secondSave.json()) as OrderPutResult
      expect(typeof secondBody.updatedAt, 'second PUT response should also include updatedAt').toBe('string')

      // Negative control: a save still using the original stale t0 IS refused —
      // locking remains effective.
      const staleSave = await putOrder(request, token, orderId, `QA OSS-011 stale ${Date.now()}`, t0)
      expect(staleSave.status(), 'save with the original stale token should still 409').toBe(409)
      const staleBody = (await staleSave.json()) as Record<string, unknown>
      expect(staleBody).toMatchObject({
        error: OPTIMISTIC_LOCK_CONFLICT_ERROR,
        code: OPTIMISTIC_LOCK_CONFLICT_CODE,
      })
    } finally {
      if (orderId && token) {
        await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      }
    }
  })
})
