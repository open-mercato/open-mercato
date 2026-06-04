import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createSalesOrderFixture,
  createSalesQuoteFixture,
  createOrderLineFixture,
  canManageSalesOrders,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'
import {
  readUpdatedAt,
  putWithLock,
  resolveApiUrl,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'

/**
 * TC-SALES-2453-DOC — sales document update persists scalar columns even when
 * the command performs an interleaved read inside `withAtomicFlush`.
 *
 * Spec: .ai/specs/2026-05-25-oss-optimistic-locking.md +
 *       packages/core/AGENTS.md → "Entity Update Safety — `withAtomicFlush`"
 *
 * Regression guard for the #2453-class bug. `sales.orders.update` /
 * `sales.quotes.update` (packages/core/src/modules/sales/commands/documents.ts)
 * apply a scalar mutation (e.g. `comment`) and then, when the payload also
 * changes a recalc-triggering field (`currencyCode` flips
 * `shouldRecalculateTotals` true), run an interleaved `em.find` over the
 * document's lines/adjustments BEFORE the terminal flush. Under MikroORM v7 that
 * interleaved query silently discards pending scalar changes on the entity, so
 * the pre-fix behaviour was: HTTP 200 + `updated_at` bumped, but the changed
 * scalar columns (`comment`) reverted to their previous value on the next read.
 *
 * The fix flushes the scalar mutations BEFORE the recalc read (the explicit
 * `await em.flush()` between the two `withAtomicFlush` phases). This test proves
 * the changed scalar column actually round-trips after a re-GET — not merely
 * that the PUT returned 200.
 *
 * TRIGGER (critical): every PUT here changes BOTH `comment` (the scalar we
 * assert) AND `currencyCode` (forces the interleaved totals-recalc read). For
 * the order we also attach a real line so the recalc `em.find` returns rows;
 * the quote relies on the same currency-driven recalc path.
 *
 * Runs as `admin`, which the sales module grants `sales.*` to in setup.ts
 * (`defaultRoleFeatures`). On dev databases whose role ACLs were never synced
 * the spec self-skips via `canManageSalesOrders`.
 */

const ORDERS_API_BASE = '/api/sales/orders'
const QUOTES_API_BASE = '/api/sales/quotes'
const ORDER_LINES_API_BASE = '/api/sales/order-lines'

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

async function readDocument(
  request: APIRequestContext,
  token: string,
  basePath: string,
  id: string,
): Promise<Record<string, unknown>> {
  const response = await request.fetch(
    resolveApiUrl(`${basePath}?id=${encodeURIComponent(id)}&pageSize=1`),
    { method: 'GET', headers: authHeaders(token) },
  )
  expect(response.status(), `GET ${basePath}?id=... should be 200`).toBe(200)
  const body = (await response.json()) as
    | { items?: Array<Record<string, unknown>> }
    | Record<string, unknown>
  const item = Array.isArray((body as { items?: unknown[] }).items)
    ? (body as { items: Array<Record<string, unknown>> }).items[0]
    : (body as Record<string, unknown>)
  expect(item, `response should include the record for id=${id}`).toBeTruthy()
  return item as Record<string, unknown>
}

test.describe('TC-SALES-2453-DOC: document scalar update survives interleaved recalc read', () => {
  test('order: comment + currency update persists after an interleaved totals recalc', async ({
    request,
  }) => {
    let token: string | null = null
    let orderId: string | null = null
    let lineId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      test.skip(
        !(await canManageSalesOrders(request, token)),
        'admin role lacks sales.orders.manage on this database (run yarn mercato auth sync-role-acls)',
      )

      // Create an order with at least one line so the recalc `em.find` over
      // lines returns rows (the interleaved read that triggered the bug).
      orderId = await createSalesOrderFixture(request, token, 'USD')
      lineId = await createOrderLineFixture(request, token, orderId)

      const t0 = await readUpdatedAt(request, token, ORDERS_API_BASE, orderId)
      expect(t0).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      const newComment = `QA 2453 order comment ${Date.now()}`

      // PUT changes BOTH a scalar (comment) AND currencyCode. The currency change
      // flips shouldRecalculateTotals → the interleaved em.find runs before the
      // terminal flush. Pre-fix: 200 + updated_at bumped, but comment reverts.
      const put = await putWithLock(
        request,
        token,
        ORDERS_API_BASE,
        { id: orderId, comment: newComment, currencyCode: 'EUR' },
        t0,
      )
      expect(
        put.status(),
        `order update PUT should succeed, got ${put.status()}`,
      ).toBeLessThan(300)

      const t1 = await readUpdatedAt(request, token, ORDERS_API_BASE, orderId)
      expect(t1, 'updated_at should advance after the update').not.toBe(t0)

      // The actual #2453 assertion: the changed scalar columns must round-trip
      // on a fresh GET — not merely that the PUT returned 200.
      const after = await readDocument(request, token, ORDERS_API_BASE, orderId)
      expect(
        after.comment,
        'order comment must persist after the interleaved recalc read (pre-fix it reverted)',
      ).toBe(newComment)
      expect(
        after.currencyCode,
        'order currencyCode must persist after the interleaved recalc read',
      ).toBe('EUR')
    } finally {
      await deleteSalesEntityIfExists(request, token, ORDER_LINES_API_BASE, lineId)
      await deleteSalesEntityIfExists(request, token, ORDERS_API_BASE, orderId)
    }
  })

  test('quote: comment + currency update persists after an interleaved totals recalc', async ({
    request,
  }) => {
    let token: string | null = null
    let quoteId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      test.skip(
        !(await canManageSalesOrders(request, token)),
        'admin role lacks sales manage features on this database (run yarn mercato auth sync-role-acls)',
      )

      quoteId = await createSalesQuoteFixture(request, token, 'USD')

      const t0 = await readUpdatedAt(request, token, QUOTES_API_BASE, quoteId)
      expect(t0).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      const newComment = `QA 2453 quote comment ${Date.now()}`

      // Same trigger: scalar (comment) + currencyCode change. The currency change
      // forces the quote recalc path, which runs the interleaved em.find over
      // quote lines/adjustments before the terminal flush.
      const put = await putWithLock(
        request,
        token,
        QUOTES_API_BASE,
        { id: quoteId, comment: newComment, currencyCode: 'EUR' },
        t0,
      )
      expect(
        put.status(),
        `quote update PUT should succeed, got ${put.status()}`,
      ).toBeLessThan(300)

      const t1 = await readUpdatedAt(request, token, QUOTES_API_BASE, quoteId)
      expect(t1, 'updated_at should advance after the update').not.toBe(t0)

      const after = await readDocument(request, token, QUOTES_API_BASE, quoteId)
      expect(
        after.comment,
        'quote comment must persist after the interleaved recalc read (pre-fix it reverted)',
      ).toBe(newComment)
      expect(
        after.currencyCode,
        'quote currencyCode must persist after the interleaved recalc read',
      ).toBe('EUR')
    } finally {
      await deleteSalesEntityIfExists(request, token, QUOTES_API_BASE, quoteId)
    }
  })
})
