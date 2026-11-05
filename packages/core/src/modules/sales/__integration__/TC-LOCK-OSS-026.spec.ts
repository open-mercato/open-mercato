import { expect, test, type APIRequestContext } from '@playwright/test'
import { createSalesOrderFixture, createOrderLineFixture } from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  putWithLock,
  expectConflictBody,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import {
  OPTIMISTIC_LOCK_CONFLICT_ERROR,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * TC-LOCK-OSS-026: order payments (SAL-07) + shipments (SAL-08) — PARENT-ORDER
 * AGGREGATE optimistic locking.
 *
 * Spec: .ai/specs/enterprise/2026-06-09-record-locks-unified-coverage.md
 *       (Phase 3 Gap A/B + the Phase-7 realignment of this test).
 *
 * SEMANTIC SHIFT (Phase 3 of record-locks unified coverage). Payments and
 * shipments used to be guarded ROW-by-ROW against each row's own `updated_at`.
 * They are now guarded against the PARENT ORDER's aggregate `updated_at` —
 * exactly like sales LINES / ADJUSTMENTS / RETURNS (TC-LOCK-OSS-008). Their
 * mutations recalculate the order's totals / fulfilled quantities, so the order
 * is the consistency boundary. The CRUD-layer guard resolves the parent order
 * from the payment/shipment id and compares the optimistic-lock header against
 * the ORDER's `updated_at` (see `sales/di.ts`
 * `readPaymentParentOrderUpdatedAt` / `readShipmentParentOrderUpdatedAt`), which
 * keeps a single optimistic-lock header consistent across the makeCrudRoute
 * guard and the command-level `enforceSalesDocumentOptimisticLock` guard. The UI
 * sub-resource sections therefore send the DOCUMENT (`order`) version, not the
 * row version.
 *
 * Coverage mechanism: API-level (putWithLock + expectConflictBody). The payments
 * and shipments sub-sections have no first-class row-EDIT conflict surface that
 * is practical to drive deterministically in a browser, so per the task's
 * allowance we assert the aggregate-level 409 contract directly against the
 * payment/shipment routes.
 *
 * Deterministic flow (per sub-resource, mirrors TC-LOCK-OSS-008):
 *  1. Create order (+ line for the shipment). Create the payment / shipment row.
 *  2. Read the PARENT ORDER's `updated_at` (t0) AFTER the sub-resource exists.
 *  3. Advance the ORDER out-of-band with a SECOND action — add a line (no header)
 *     → totals recalc dirties the order → t1.
 *  4. Stale ORDER header (t0) on a payment/shipment PUT → 409 (aggregate guard).
 *  5. Fresh ORDER header (t1) on a payment/shipment PUT → 200 (proves it was the
 *     staleness, not the PUT shape).
 */

const BASE_URL = process.env.BASE_URL?.trim() || null
function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

/**
 * Read the PARENT ORDER's own `updated_at`, normalized to ISO. The payment /
 * shipment guard compares the header against this aggregate version, so the test
 * advances and asserts against the ORDER, never the sub-resource row.
 */
async function readOrderUpdatedAt(
  request: APIRequestContext,
  token: string,
  orderId: string,
): Promise<string> {
  const response = await request.fetch(
    resolveUrl(`/api/sales/orders?id=${encodeURIComponent(orderId)}`),
    { method: 'GET', headers: authHeaders(token) },
  )
  expect(response.status(), 'GET /api/sales/orders?id=... should be 200').toBe(200)
  const body = (await response.json()) as { items?: Array<Record<string, unknown>> }
  const item = body.items?.[0]
  expect(item, `response should include order ${orderId}`).toBeTruthy()
  const raw = (item?.updated_at ?? item?.updatedAt) as string | undefined
  expect(typeof raw, `order should expose updated_at, got ${String(raw)}`).toBe('string')
  const ms = Date.parse(raw as string)
  expect(Number.isFinite(ms), `order updated_at should parse, got ${String(raw)}`).toBe(true)
  return new Date(ms).toISOString()
}

async function deleteOrder(request: APIRequestContext, token: string, orderId: string) {
  return request.fetch(resolveUrl('/api/sales/orders'), {
    method: 'DELETE',
    headers: authHeaders(token),
    data: { id: orderId },
  })
}

test.describe('TC-LOCK-OSS-026: sales payments + shipments parent-order aggregate optimistic locking', () => {
  // Runs as `admin`, which the sales module grants `sales.*` to in setup.ts
  // (`defaultRoleFeatures`), so a freshly installed tenant and CI both carry the
  // sales features (sales.payments.manage / sales.shipments.manage) out of the
  // box — no manual `yarn mercato auth sync-role-acls`, no self-skip.

  test('payment (SAL-07): stale PARENT-ORDER header on a payment PUT returns 409; fresh order header wins', async ({ request }) => {
    let token: string | null = null
    let orderId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      orderId = await createSalesOrderFixture(request, token, 'USD')

      const createResponse = await apiRequest(request, 'POST', '/api/sales/payments', {
        token,
        data: {
          orderId,
          amount: '10.00',
          currencyCode: 'USD',
          receivedAt: new Date().toISOString(),
        },
      })
      expect(createResponse.status(), 'payment create should return 201').toBe(201)
      const createBody = (await createResponse.json()) as { id?: string | null; paymentId?: string | null }
      const paymentId = createBody.id ?? createBody.paymentId ?? null
      expect(paymentId, 'payment create response should include the payment id').toBeTruthy()

      // t0: the PARENT ORDER's version (after the payment exists). The payment
      // create itself recalculated order totals, so t0 reflects that.
      const t0 = await readOrderUpdatedAt(request, token, orderId)
      expect(t0).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      // Advance the ORDER out-of-band with a SECOND action — add a line (no
      // header) → totals recalc dirties the order → t1.
      await createOrderLineFixture(request, token, orderId, { name: `OSS-026 pay bump ${Date.now()}` })
      const t1 = await readOrderUpdatedAt(request, token, orderId)
      expect(t1, "adding a line should advance the parent order's updated_at").not.toBe(t0)

      // Stale ORDER header (t0) on a payment update → 409 (parent-order aggregate guard).
      const conflict = await putWithLock(
        request,
        token,
        '/api/sales/payments',
        { id: paymentId, paymentReference: `OSS-026 stale ${Date.now()}` },
        t0,
      )
      const conflictBody = await expectConflictBody(conflict)
      expect(conflictBody.expectedUpdatedAt, 'conflict echoes the stale expected (order) version').toBe(t0)
      expect(typeof conflictBody.currentUpdatedAt, 'conflict body includes currentUpdatedAt').toBe('string')
      expect(conflictBody.currentUpdatedAt, 'currentUpdatedAt reflects the post-bump order version').not.toBe(t0)
      expect((conflictBody as { error?: string }).error).toBe(OPTIMISTIC_LOCK_CONFLICT_ERROR)

      // Fresh ORDER header (t1) → 200, proving it was the staleness, not the PUT shape.
      const fresh = await putWithLock(
        request,
        token,
        '/api/sales/payments',
        { id: paymentId, paymentReference: `OSS-026 fresh ${Date.now()}` },
        t1,
      )
      expect(fresh.status(), 'payment PUT with the fresh order header should succeed').toBeLessThan(300)
    } finally {
      if (orderId && token) {
        await deleteOrder(request, token, orderId)
      }
    }
  })

  test('shipment (SAL-08): stale PARENT-ORDER header on a shipment PUT returns 409; fresh order header wins', async ({ request }) => {
    let token: string | null = null
    let orderId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      orderId = await createSalesOrderFixture(request, token, 'USD')
      const orderLineId = await createOrderLineFixture(request, token, orderId, {
        name: `OSS-026 ship line ${Date.now()}`,
      })

      const createResponse = await apiRequest(request, 'POST', '/api/sales/shipments', {
        token,
        data: {
          orderId,
          shipmentNumber: `OSS-026-${Date.now()}`,
          currencyCode: 'USD',
          trackingNumbers: [`TRK-${Date.now()}`],
          shippedAt: new Date().toISOString(),
          items: [{ orderLineId, quantity: '1' }],
        },
      })
      expect(createResponse.status(), 'shipment create should return 201').toBe(201)
      const createBody = (await createResponse.json()) as { id?: string | null; shipmentId?: string | null }
      const shipmentId = createBody.id ?? createBody.shipmentId ?? null
      expect(shipmentId, 'shipment create response should include the shipment id').toBeTruthy()

      // t0: the PARENT ORDER's version (after the line + shipment exist).
      const t0 = await readOrderUpdatedAt(request, token, orderId)
      expect(t0).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      // Advance the ORDER out-of-band with a SECOND action — add another line
      // (no header) → totals recalc dirties the order → t1.
      await createOrderLineFixture(request, token, orderId, { name: `OSS-026 ship bump ${Date.now()}` })
      const t1 = await readOrderUpdatedAt(request, token, orderId)
      expect(t1, "adding a line should advance the parent order's updated_at").not.toBe(t0)

      // Stale ORDER header (t0) on a shipment update → 409 (parent-order aggregate guard).
      // The shipment update schema requires `orderId` alongside `id`.
      const conflict = await putWithLock(
        request,
        token,
        '/api/sales/shipments',
        { id: shipmentId, orderId, carrierName: `OSS-026 stale ${Date.now()}` },
        t0,
      )
      const conflictBody = await expectConflictBody(conflict)
      expect(conflictBody.expectedUpdatedAt, 'conflict echoes the stale expected (order) version').toBe(t0)
      expect(typeof conflictBody.currentUpdatedAt, 'conflict body includes currentUpdatedAt').toBe('string')
      expect(conflictBody.currentUpdatedAt, 'currentUpdatedAt reflects the post-bump order version').not.toBe(t0)
      expect((conflictBody as { error?: string }).error).toBe(OPTIMISTIC_LOCK_CONFLICT_ERROR)

      // Fresh ORDER header (t1) → 200.
      const fresh = await putWithLock(
        request,
        token,
        '/api/sales/shipments',
        { id: shipmentId, orderId, carrierName: `OSS-026 fresh ${Date.now()}` },
        t1,
      )
      expect(fresh.status(), 'shipment PUT with the fresh order header should succeed').toBeLessThan(300)
    } finally {
      if (orderId && token) {
        await deleteOrder(request, token, orderId)
      }
    }
  })
})
