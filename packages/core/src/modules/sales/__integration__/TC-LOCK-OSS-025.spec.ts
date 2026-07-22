import { expect, test, type APIRequestContext } from '@playwright/test'
import {
  createSalesOrderFixture,
  createOrderLineFixture,
  createShipmentFixture,
} from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  readUpdatedAt,
  expectConflictBody,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import {
  OPTIMISTIC_LOCK_HEADER_NAME,
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_CONFLICT_ERROR,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * TC-LOCK-OSS-025: order adjustments + returns (SAL-05 / SAL-06) document-aggregate
 * optimistic-lock guard.
 *
 * Spec: .ai/specs/2026-05-28-optimistic-locking-coverage-completion.md
 *
 * Adjustments (`POST /api/sales/order-adjustments` → `sales.orders.adjustments.upsert`)
 * and returns (`POST /api/sales/returns` → `sales.returns.create`) are sales document
 * SUB-RESOURCES, not plain `makeCrudRoute` updates of the child. Each command loads the
 * parent ORDER, recalculates its totals / transitions it, and therefore advances the
 * ORDER's `updated_at`. The order is the consistency boundary, so both commands guard
 * the parent via `enforceSalesDocumentOptimisticLock(ctx, order, SALES_RESOURCE_KIND_ORDER)`
 * (see packages/core/src/modules/sales/commands/documents.ts:7418 for the adjustment
 * upsert, packages/core/src/modules/sales/commands/returns.ts:289 for the return create).
 * The guard is opt-in per request: it fires only when the client sends
 * OPTIMISTIC_LOCK_HEADER_NAME carrying the order's expected `updated_at`.
 *
 * Coverage approach: API document-aggregate fallback (per __concurrent_edit_pattern.md
 * and the explicit fallback allowance for these bespoke surfaces). Driving the stale-doc
 * conflict to the browser conflict bar for adjustments/returns is impractical: the detail
 * page re-reads the order's `updated_at` on load and the salesUi `addAdjustment` helper
 * does not let the test inject a controllable stale lock header, so there is no
 * deterministic single-tab way to arm a stale parent header from the UI. The API-level
 * assertion is the deterministic, executable coverage here.
 *
 * Deterministic flow per sub-case (see __concurrent_edit_pattern.md → document-aggregate):
 *  1. Create the order. GET the order's `updated_at` (t0).
 *  2. Advance the order with a SECOND action — add a line (header-less) → totals recalc
 *     dirties the order → t1 (t1 !== t0).
 *  3. Sub-resource write carrying the order's STALE header (t0) → 409 conflict contract.
 *  4. Same write carrying the order's FRESH header (t1) → 2xx.
 */

const ORDERS_BASE = '/api/sales/orders'
const ORDER_ADJUSTMENTS_BASE = '/api/sales/order-adjustments'
const RETURNS_BASE = '/api/sales/returns'
const ORDER_LINES_BASE = '/api/sales/order-lines'

const BASE_URL = process.env.BASE_URL?.trim() || ''
function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

function authHeaders(token: string, lockValue?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  if (lockValue !== undefined) headers[OPTIMISTIC_LOCK_HEADER_NAME] = lockValue
  return headers
}

/** POST a sub-resource carrying the parent ORDER's expected `updated_at` header. */
async function postWithOrderLock(
  request: APIRequestContext,
  token: string,
  basePath: string,
  body: Record<string, unknown>,
  orderLockValue: string,
) {
  return request.fetch(resolveUrl(basePath), {
    method: 'POST',
    headers: authHeaders(token, orderLockValue),
    data: body,
  })
}

/** Read the id of the most recently created order line for an order. */
async function fetchAnyOrderLineId(
  request: APIRequestContext,
  token: string,
  orderId: string,
): Promise<string> {
  const response = await request.fetch(
    resolveUrl(`${ORDER_LINES_BASE}?orderId=${encodeURIComponent(orderId)}&pageSize=100`),
    { method: 'GET', headers: authHeaders(token) },
  )
  expect(response.status(), 'GET /api/sales/order-lines should return 200').toBe(200)
  const body = (await response.json()) as { items?: Array<Record<string, unknown>> }
  const lineId = body.items?.find((item) => typeof item?.id === 'string')?.id
  expect(typeof lineId, 'order should have at least one line to return').toBe('string')
  return lineId as string
}

async function deleteOrder(request: APIRequestContext, token: string, orderId: string) {
  return request.fetch(resolveUrl(ORDERS_BASE), {
    method: 'DELETE',
    headers: authHeaders(token),
    data: { id: orderId },
  })
}

test.describe('TC-LOCK-OSS-025: order adjustments + returns document-aggregate conflict', () => {
  // Runs as `admin`, granted `sales.*` (incl. `sales.orders.manage` and
  // `sales.returns.create`) by the sales module's setup.ts `defaultRoleFeatures`,
  // so a fresh install and CI have these features out of the box — no manual ACL
  // sync, no self-skip. (Only a long-lived tenant created before these features
  // existed needs the documented one-time `yarn mercato auth sync-role-acls`.)

  test('SAL-05 adjustment create with stale parent-order header returns 409; fresh header succeeds', async ({ request }) => {
    let token: string | null = null
    let orderId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      orderId = await createSalesOrderFixture(request, token, 'USD')

      // t0: pre-mutation order version.
      const t0 = await readUpdatedAt(request, token, ORDERS_BASE, orderId)
      expect(t0).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      // Second action: add a line — recalculates order totals → order advances to t1.
      await createOrderLineFixture(request, token, orderId, { name: `QA OSS-025 adj line ${Date.now()}` })
      const t1 = await readUpdatedAt(request, token, ORDERS_BASE, orderId)
      expect(t1, "adding a line should advance the parent order's updated_at").not.toBe(t0)

      // Adjustment create carrying the STALE order header (t0) must conflict.
      const conflict = await postWithOrderLock(
        request,
        token,
        ORDER_ADJUSTMENTS_BASE,
        {
          orderId,
          scope: 'order',
          kind: 'discount',
          label: `QA OSS-025 stale discount ${Date.now()}`,
          amountNet: 5,
          amountGross: 6,
          currencyCode: 'USD',
        },
        t0,
      )
      const body = await expectConflictBody(conflict)
      expect(body).toMatchObject({
        error: OPTIMISTIC_LOCK_CONFLICT_ERROR,
        code: OPTIMISTIC_LOCK_CONFLICT_CODE,
        expectedUpdatedAt: t0,
      })
      expect(typeof body.currentUpdatedAt, 'conflict body includes currentUpdatedAt as ISO string').toBe('string')
      expect(body.currentUpdatedAt).not.toBe(t0)

      // Adjustment create carrying the FRESH order header (t1) must succeed.
      const ok = await postWithOrderLock(
        request,
        token,
        ORDER_ADJUSTMENTS_BASE,
        {
          orderId,
          scope: 'order',
          kind: 'discount',
          label: `QA OSS-025 fresh discount ${Date.now()}`,
          amountNet: 5,
          amountGross: 6,
          currencyCode: 'USD',
        },
        t1,
      )
      expect(
        ok.status(),
        'adjustment create with fresh parent-order header should succeed',
      ).toBeLessThan(300)
    } finally {
      if (orderId && token) {
        await deleteOrder(request, token, orderId)
      }
    }
  })

  test('SAL-06 return create with stale parent-order header returns 409; fresh header succeeds', async ({ request }) => {
    let token: string | null = null
    let orderId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      orderId = await createSalesOrderFixture(request, token, 'USD')

      // A return needs a real order line to reference. Adding it is also the
      // SECOND action that advances the order from t0 → t1.
      const t0 = await readUpdatedAt(request, token, ORDERS_BASE, orderId)
      expect(t0).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      await createOrderLineFixture(request, token, orderId, {
        name: `QA OSS-025 return line ${Date.now()}`,
        quantity: 2,
      })
      const orderLineId = await fetchAnyOrderLineId(request, token, orderId)
      // The return guard (issue #3034) requires the line to have been shipped.
      // Ship before capturing t1 so the fresh header reflects the latest order state.
      await createShipmentFixture(request, token, orderId, [{ orderLineId, quantity: 2 }])
      const t1 = await readUpdatedAt(request, token, ORDERS_BASE, orderId)
      expect(t1, "adding a line should advance the parent order's updated_at").not.toBe(t0)

      const returnBody = (suffix: string) => ({
        orderId,
        reason: `QA OSS-025 ${suffix} ${Date.now()}`,
        lines: [{ orderLineId, quantity: 1 }],
      })

      // Return create carrying the STALE order header (t0) must conflict.
      const conflict = await postWithOrderLock(request, token, RETURNS_BASE, returnBody('stale'), t0)
      const body = await expectConflictBody(conflict)
      expect(body).toMatchObject({
        error: OPTIMISTIC_LOCK_CONFLICT_ERROR,
        code: OPTIMISTIC_LOCK_CONFLICT_CODE,
        expectedUpdatedAt: t0,
      })
      expect(typeof body.currentUpdatedAt, 'conflict body includes currentUpdatedAt as ISO string').toBe('string')
      expect(body.currentUpdatedAt).not.toBe(t0)

      // Return create carrying the FRESH order header (t1) must succeed.
      const ok = await postWithOrderLock(request, token, RETURNS_BASE, returnBody('fresh'), t1)
      expect(
        ok.status(),
        'return create with fresh parent-order header should succeed',
      ).toBeLessThan(300)
    } finally {
      if (orderId && token) {
        await deleteOrder(request, token, orderId)
      }
    }
  })
})
