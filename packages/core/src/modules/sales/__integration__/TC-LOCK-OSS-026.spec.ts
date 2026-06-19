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
 * TC-LOCK-OSS-026: order payments (SAL-07) + shipments (SAL-08) — ROW-LEVEL
 * optimistic locking.
 *
 * Spec: .ai/specs/implemented/2026-05-25-oss-optimistic-locking.md +
 *       .ai/runs/2026-05-25-oss-optimistic-locking/qa-repro-report.md (Phase 17.6).
 *
 * Unlike sales LINES / ADJUSTMENTS / RETURNS (which are guarded at the COMMAND
 * level via `enforceSalesDocumentOptimisticLock` against the parent ORDER's
 * `updated_at` — see TC-LOCK-OSS-008), payments and shipments are flat
 * `makeCrudRoute` resources keyed by a top-level `id`. Their ROW-LEVEL
 * `makeCrudRoute` guard fires against the PAYMENT / SHIPMENT row's OWN
 * `updated_at` (qa-repro-report "Payments / Shipments header semantics"). So the
 * deterministic trigger here advances the ROW's `updated_at` out-of-band (NOT the
 * document aggregate) and proves a stale ROW header → 409.
 *
 * Coverage mechanism: API-level (putWithLock + expectConflictBody). The payments
 * and shipments sub-sections have no first-class row-EDIT conflict surface that
 * is practical to drive deterministically in a browser (creation flows the
 * salesUi helpers expose are dialog-heavy and the rows are not directly
 * editable-with-version in the list UI), so per the task's allowance we assert
 * the row-level 409 contract directly against the payment/shipment routes.
 *
 * Important route quirk proven during authoring: `GET /api/sales/payments?id=`
 * and `GET /api/sales/shipments?id=` do NOT filter by id (only `orderId` /
 * `paymentMethodId` are honored), so we read the row's `updated_at` by listing
 * with `orderId` and matching on `id` — the generic `readUpdatedAt` helper
 * (which reads `items[0]`) is unsafe for these routes.
 *
 * Deterministic flow (per sub-resource):
 *  1. Create order + line. Create the payment / shipment row → row v0.
 *  2. Read the ROW's own `updated_at` (t0) via orderId list + id match.
 *  3. Header-less PUT on the row (additive path) advances the row → t1.
 *  4. Stale row PUT carrying t0 → 409 record_modified (row-level guard fires).
 *  5. Fresh row PUT carrying t1 → 200 (proves it was the staleness, not the PUT).
 */

const BASE_URL = process.env.BASE_URL?.trim() || null
function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

/**
 * Read a sub-resource row's own `updated_at`, normalized to ISO. These list
 * routes ignore `?id=`, so we filter by `orderId` and match the row by `id`.
 */
async function readRowUpdatedAt(
  request: APIRequestContext,
  token: string,
  basePath: string,
  orderId: string,
  rowId: string,
): Promise<string> {
  const response = await request.fetch(
    resolveUrl(`${basePath}?orderId=${encodeURIComponent(orderId)}&pageSize=100`),
    { method: 'GET', headers: authHeaders(token) },
  )
  expect(response.status(), `GET ${basePath}?orderId=... should be 200`).toBe(200)
  const body = (await response.json()) as
    | { items?: Array<Record<string, unknown>>; result?: { items?: Array<Record<string, unknown>> } }
    | Record<string, unknown>
  const items = Array.isArray((body as { items?: unknown[] }).items)
    ? (body as { items: Array<Record<string, unknown>> }).items
    : Array.isArray((body as { result?: { items?: unknown[] } }).result?.items)
      ? (body as { result: { items: Array<Record<string, unknown>> } }).result.items
      : []
  const row = items.find((item) => (item?.id ?? null) === rowId)
  expect(row, `row ${rowId} should be present in ${basePath} list for order ${orderId}`).toBeTruthy()
  const raw = (row?.updated_at ?? row?.updatedAt) as string | undefined
  expect(typeof raw, `${basePath} row should expose updated_at, got ${String(raw)}`).toBe('string')
  // These routes emit a Postgres-style timestamp (e.g. `2026-06-03 16:33:49.383+00`):
  // space date/time separator + a 2-digit `+00` offset. Normalize both so
  // `Date.parse` accepts it (it rejects the bare `+00` offset).
  const normalized = (raw as string)
    .replace(' ', 'T')
    .replace(/([+-]\d{2})$/, '$1:00')
  const ms = Date.parse(normalized)
  expect(Number.isFinite(ms), `${basePath} row updated_at should parse, got ${String(raw)}`).toBe(true)
  return new Date(ms).toISOString()
}

async function deleteOrder(request: APIRequestContext, token: string, orderId: string) {
  return request.fetch(resolveUrl('/api/sales/orders'), {
    method: 'DELETE',
    headers: authHeaders(token),
    data: { id: orderId },
  })
}

test.describe('TC-LOCK-OSS-026: sales payments + shipments row-level optimistic locking', () => {
  // Runs as `admin`, which the sales module grants `sales.*` to in setup.ts
  // (`defaultRoleFeatures`), so a freshly installed tenant and CI both carry the
  // sales features (sales.payments.manage / sales.shipments.manage) out of the
  // box — no manual `yarn mercato auth sync-role-acls`, no self-skip.

  test('payment (SAL-07): stale ROW header on a payment PUT returns 409; fresh ROW header wins', async ({ request }) => {
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

      // t0: the payment ROW's own version.
      const t0 = await readRowUpdatedAt(request, token, '/api/sales/payments', orderId, paymentId as string)
      expect(t0).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      // Advance the payment ROW out-of-band with a header-less PUT (additive path).
      const bump = await request.fetch(resolveUrl('/api/sales/payments'), {
        method: 'PUT',
        headers: authHeaders(token),
        data: { id: paymentId, paymentReference: `OSS-026 bump ${Date.now()}` },
      })
      expect(bump.status(), 'header-less payment PUT should win (additive path)').toBeLessThan(300)
      const t1 = await readRowUpdatedAt(request, token, '/api/sales/payments', orderId, paymentId as string)
      expect(t1, "header-less PUT should advance the payment row's own updated_at").not.toBe(t0)

      // Stale ROW header (t0) on a payment update → 409 (row-level makeCrudRoute guard).
      const conflict = await putWithLock(
        request,
        token,
        '/api/sales/payments',
        { id: paymentId, paymentReference: `OSS-026 stale ${Date.now()}` },
        t0,
      )
      const conflictBody = await expectConflictBody(conflict)
      expect(conflictBody.expectedUpdatedAt, 'conflict echoes the stale expected version').toBe(t0)
      expect(typeof conflictBody.currentUpdatedAt, 'conflict body includes currentUpdatedAt').toBe('string')
      expect(conflictBody.currentUpdatedAt, 'currentUpdatedAt reflects the post-bump row version').not.toBe(t0)
      expect((conflictBody as { error?: string }).error).toBe(OPTIMISTIC_LOCK_CONFLICT_ERROR)

      // Fresh ROW header (t1) → 200, proving it was the staleness, not the PUT shape.
      const fresh = await putWithLock(
        request,
        token,
        '/api/sales/payments',
        { id: paymentId, paymentReference: `OSS-026 fresh ${Date.now()}` },
        t1,
      )
      expect(fresh.status(), 'payment PUT with the fresh row header should succeed').toBeLessThan(300)
    } finally {
      if (orderId && token) {
        await deleteOrder(request, token, orderId)
      }
    }
  })

  test('shipment (SAL-08): stale ROW header on a shipment PUT returns 409; fresh ROW header wins', async ({ request }) => {
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

      // t0: the shipment ROW's own version.
      const t0 = await readRowUpdatedAt(request, token, '/api/sales/shipments', orderId, shipmentId as string)
      expect(t0).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      // Advance the shipment ROW out-of-band with a header-less PUT (additive path).
      // The shipment update schema requires `orderId` alongside `id`.
      const bump = await request.fetch(resolveUrl('/api/sales/shipments'), {
        method: 'PUT',
        headers: authHeaders(token),
        data: { id: shipmentId, orderId, carrierName: `OSS-026 bump ${Date.now()}` },
      })
      expect(bump.status(), 'header-less shipment PUT should win (additive path)').toBeLessThan(300)
      const t1 = await readRowUpdatedAt(request, token, '/api/sales/shipments', orderId, shipmentId as string)
      expect(t1, "header-less PUT should advance the shipment row's own updated_at").not.toBe(t0)

      // Stale ROW header (t0) on a shipment update → 409 (row-level makeCrudRoute guard).
      const conflict = await putWithLock(
        request,
        token,
        '/api/sales/shipments',
        { id: shipmentId, orderId, carrierName: `OSS-026 stale ${Date.now()}` },
        t0,
      )
      const conflictBody = await expectConflictBody(conflict)
      expect(conflictBody.expectedUpdatedAt, 'conflict echoes the stale expected version').toBe(t0)
      expect(typeof conflictBody.currentUpdatedAt, 'conflict body includes currentUpdatedAt').toBe('string')
      expect(conflictBody.currentUpdatedAt, 'currentUpdatedAt reflects the post-bump row version').not.toBe(t0)
      expect((conflictBody as { error?: string }).error).toBe(OPTIMISTIC_LOCK_CONFLICT_ERROR)

      // Fresh ROW header (t1) → 200.
      const fresh = await putWithLock(
        request,
        token,
        '/api/sales/shipments',
        { id: shipmentId, orderId, carrierName: `OSS-026 fresh ${Date.now()}` },
        t1,
      )
      expect(fresh.status(), 'shipment PUT with the fresh row header should succeed').toBeLessThan(300)
    } finally {
      if (orderId && token) {
        await deleteOrder(request, token, orderId)
      }
    }
  })
})
