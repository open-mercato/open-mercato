import { expect, test, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createSalesQuoteFixture } from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'
import {
  bumpRecordViaApi,
  readUpdatedAt,
  putWithLock,
  expectConflictBody,
  expectConflictBanner,
  expectNoConflictBanner,
  resolveApiUrl,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'

/**
 * TC-LOCK-OSS-024 — sales QUOTE header edit + delete (SAL-02).
 *
 * Spec: .ai/specs/2026-05-25-oss-optimistic-locking.md +
 *       .ai/specs/2026-05-28-optimistic-locking-coverage-completion.md
 *
 * The quote detail page `/backend/sales/quotes/<id>` re-uses the shared sales
 * document detail page (`backend/sales/documents/[id]/page.tsx` with
 * `initialKind="quote"`). Its inline header fields (comment, currency, …) save
 * through `updateDocument(...)`, which wraps the write in
 * `buildOptimisticLockHeader(record.updatedAt)` and PUTs to `/api/sales/quotes`
 * (the `sales.quotes.update` command, family `sales.order-family`). The header
 * delete (DetailHeader `onDelete` → `handleDelete`) DELETEs the same route with
 * the same lock header. On a 409 both route through
 * `handleDocumentMutationError` → `surfaceRecordConflict`, which mounts the
 * unified conflict bar (`data-testid="record-conflict-banner"`).
 *
 * Deterministic trigger (see __concurrent_edit_pattern.md): create the quote via
 * API fixture → load the detail page (the page captures `record.updatedAt`) →
 * advance `updated_at` out-of-band with a header-LESS PUT
 * (`bumpRecordViaApi(/api/sales/quotes, {id, comment})`) → edit the comment
 * header field / trigger delete in the browser so the now-stale
 * `x-om-ext-optimistic-lock-expected-updated-at` header yields the 409.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * FIXED (#2055 issue #4) — `sales.quotes.update` now enforces the optimistic
 * lock, mirroring `sales.orders.update`.
 *
 * Command: packages/core/src/modules/sales/commands/documents.ts —
 *   `enforceSalesDocumentOptimisticLock(ctx, quote, SALES_RESOURCE_KIND_QUOTE)`
 *   runs right after the quote is loaded + scope-checked and before mutation.
 *
 * A stale quote PUT carrying the expected-updated-at header for a now-advanced
 * record now returns the documented 409 conflict body, identical to
 * `/api/sales/orders` (proven by the `order control` case). The API
 * document-contract case is active; the bespoke browser conflict cases stay
 * `test.fixme` pending a browser-capable runner.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Runs as `admin`, which the sales module grants `sales.*` to in setup.ts
 * (`defaultRoleFeatures`), so a freshly installed tenant and CI both have the
 * quote/order features out of the box.
 */

const QUOTES_API_BASE = '/api/sales/quotes'
const ORDERS_API_BASE = '/api/sales/orders'

const commentFieldContainer = (page: import('@playwright/test').Page) =>
  page
    .locator('[data-component-handle="section:ui.detail:DetailFieldsSection"] >> div', {
      has: page.getByText(/^Comment$/),
    })
    .first()

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

async function deleteEntityIfExists(
  request: APIRequestContext,
  token: string | null,
  basePath: string,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  try {
    await request.fetch(resolveApiUrl(`${basePath}?id=${encodeURIComponent(id)}`), {
      method: 'DELETE',
      headers: authHeaders(token),
    })
  } catch {
    // best-effort cleanup
  }
}

async function quoteStillExists(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<boolean> {
  const response = await request.fetch(
    resolveApiUrl(`${QUOTES_API_BASE}?id=${encodeURIComponent(id)}&pageSize=1`),
    { method: 'GET', headers: authHeaders(token) },
  )
  if (!response.ok()) return false
  const body = (await response.json().catch(() => null)) as { items?: Array<{ id?: string }> } | null
  const items = Array.isArray(body?.items) ? body!.items! : []
  return items.some((item) => item?.id === id)
}

test.describe('TC-LOCK-OSS-024: sales quote header edit + delete conflict bar (SAL-02)', () => {
  // ── Active: stale quote PUT is now refused with 409 (regression guard). ─────
  test('quote: stale PUT is refused with 409 (lock enforced like orders)', async ({ request }) => {
    let token: string | null = null
    let quoteId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      quoteId = await createSalesQuoteFixture(request, token, 'USD')

      const t0 = await readUpdatedAt(request, token, QUOTES_API_BASE, quoteId)
      expect(t0).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      // Session A wins with the fresh token → quote advances to t1.
      const sessionA = await putWithLock(
        request,
        token,
        QUOTES_API_BASE,
        { id: quoteId, comment: `QA Lock 024 A ${Date.now()}` },
        t0,
      )
      expect(sessionA.status(), 'session A (fresh t0) PUT should win').toBeLessThan(300)

      const t1 = await readUpdatedAt(request, token, QUOTES_API_BASE, quoteId)
      expect(t1, 'updated_at should advance after session A').not.toBe(t0)

      // Stale session B replays t0 → the enforced lock yields the 409 conflict.
      const sessionB = await putWithLock(
        request,
        token,
        QUOTES_API_BASE,
        { id: quoteId, comment: `QA Lock 024 B ${Date.now()}` },
        t0,
      )
      const body = await expectConflictBody(sessionB)
      expect(body.expectedUpdatedAt, 'conflict body echoes the stale token').toBe(t0)
      expect(body.currentUpdatedAt).not.toBe(t0)
    } finally {
      await deleteEntityIfExists(request, token, QUOTES_API_BASE, quoteId)
    }
  })

  // ── Active control: same env, same header → orders correctly 409. ───────────
  test('order control: stale PUT IS refused with 409 (proves the env enforces the lock)', async ({ request }) => {
    let token: string | null = null
    let orderId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const created = await request.fetch(resolveApiUrl(ORDERS_API_BASE), {
        method: 'POST',
        headers: authHeaders(token),
        data: { currencyCode: 'USD' },
      })
      expect(created.ok(), `POST ${ORDERS_API_BASE} should succeed`).toBeTruthy()
      orderId = ((await created.json()) as { id?: string }).id ?? null
      expect(orderId, 'order create response should include an id').toBeTruthy()

      const t0 = await readUpdatedAt(request, token, ORDERS_API_BASE, orderId as string)
      const sessionA = await putWithLock(
        request,
        token,
        ORDERS_API_BASE,
        { id: orderId, comment: `QA Lock 024 order A ${Date.now()}` },
        t0,
      )
      expect(sessionA.status(), 'order session A (fresh t0) should win').toBeLessThan(300)

      const t1 = await readUpdatedAt(request, token, ORDERS_API_BASE, orderId as string)
      expect(t1, 'order updated_at should advance after session A').not.toBe(t0)

      const sessionB = await putWithLock(
        request,
        token,
        ORDERS_API_BASE,
        { id: orderId, comment: `QA Lock 024 order B ${Date.now()}` },
        t0,
      )
      const body = await expectConflictBody(sessionB)
      expect(body.expectedUpdatedAt, 'order conflict body echoes the stale token').toBe(t0)
      expect(body.currentUpdatedAt).not.toBe(t0)
    } finally {
      await deleteEntityIfExists(request, token, ORDERS_API_BASE, orderId)
    }
  })

  // ── Fixme'd: blocked by the quote-route product bug (see header). ───────────
  test('API document-contract: stale quote PUT is refused with the 409 conflict body', async ({ request }) => {
    // The quote document aggregate now runs enforceSalesDocumentOptimisticLock in
    // sales.quotes.update, mirroring sales.orders.update, so a stale PUT yields the
    // structured 409 conflict body. Command: packages/core/src/modules/sales/commands/documents.ts
    let token: string | null = null
    let quoteId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      quoteId = await createSalesQuoteFixture(request, token, 'USD')

      const t0 = await readUpdatedAt(request, token, QUOTES_API_BASE, quoteId)
      const sessionA = await putWithLock(
        request,
        token,
        QUOTES_API_BASE,
        { id: quoteId, comment: `QA Lock 024 A ${Date.now()}` },
        t0,
      )
      expect(sessionA.status()).toBeLessThan(300)
      const t1 = await readUpdatedAt(request, token, QUOTES_API_BASE, quoteId)
      expect(t1).not.toBe(t0)

      const sessionB = await putWithLock(
        request,
        token,
        QUOTES_API_BASE,
        { id: quoteId, comment: `QA Lock 024 B ${Date.now()}` },
        t0,
      )
      const body = await expectConflictBody(sessionB)
      expect(body.expectedUpdatedAt).toBe(t0)
      expect(body.currentUpdatedAt).not.toBe(t0)
    } finally {
      await deleteEntityIfExists(request, token, QUOTES_API_BASE, quoteId)
    }
  })

  test.fixme('stale comment header edit shows the conflict bar', async ({ page }) => {
    // BLOCKED: the quote PUT never 409s (product bug, see header), so the
    // conflict bar cannot appear. Bespoke browser proof; un-skip with the route fix.
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let quoteId: string | null = null
    try {
      quoteId = await createSalesQuoteFixture(page.request, token, 'USD')

      await login(page, 'admin')
      await page.goto(`/backend/sales/quotes/${quoteId}`)

      const commentField = commentFieldContainer(page)
      await expect(commentField).toBeVisible({ timeout: 20_000 })

      await bumpRecordViaApi(page.request, token, QUOTES_API_BASE, {
        id: quoteId,
        comment: `QA Lock 024 bumped ${stamp}`,
      })

      await commentField.click()
      const textarea = commentField.locator('textarea').first()
      await expect(textarea).toBeVisible({ timeout: 10_000 })
      await textarea.fill(`QA Lock 024 stale edit ${stamp}`)
      await textarea.press('Control+Enter')

      await expectConflictBanner(page)
    } finally {
      await deleteEntityIfExists(page.request, token, QUOTES_API_BASE, quoteId)
    }
  })

  test.fixme('stale quote delete is refused (conflict bar) and the quote is not removed', async ({ page }) => {
    // BLOCKED: the quote DELETE never 409s (product bug, see header), so the
    // conflict bar cannot appear and a stale delete is NOT refused. Un-skip with
    // the route fix.
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let quoteId: string | null = null
    try {
      quoteId = await createSalesQuoteFixture(page.request, token, 'USD')

      await login(page, 'admin')
      await page.goto(`/backend/sales/quotes/${quoteId}`)

      const deleteButton = page.getByRole('button', { name: /^Delete$/ }).first()
      await expect(deleteButton).toBeVisible({ timeout: 20_000 })

      await bumpRecordViaApi(page.request, token, QUOTES_API_BASE, {
        id: quoteId,
        comment: `QA Lock 024 del bumped ${stamp}`,
      })

      await deleteButton.click()
      const confirmDialog = page.getByRole('alertdialog')
      await expect(confirmDialog).toBeVisible({ timeout: 10_000 })
      await confirmDialog.getByRole('button', { name: /confirm|delete|ok|yes/i }).first().click()

      await expectConflictBanner(page)
      expect(await quoteStillExists(page.request, token, quoteId)).toBe(true)
    } finally {
      await deleteEntityIfExists(page.request, token, QUOTES_API_BASE, quoteId)
    }
  })

  test.fixme('clean single-tab comment save does not raise a false-positive conflict bar', async ({ page }) => {
    // BLOCKED: paired with the bespoke conflict cases above; only meaningful once
    // the quote route enforces the lock (product bug, see header).
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let quoteId: string | null = null
    try {
      quoteId = await createSalesQuoteFixture(page.request, token, 'USD')

      await login(page, 'admin')
      await page.goto(`/backend/sales/quotes/${quoteId}`)

      const commentField = commentFieldContainer(page)
      await expect(commentField).toBeVisible({ timeout: 20_000 })

      await commentField.click()
      const textarea = commentField.locator('textarea').first()
      await expect(textarea).toBeVisible({ timeout: 10_000 })

      const putPromise = page.waitForResponse(
        (response) => response.request().method() === 'PUT' && response.url().includes(QUOTES_API_BASE),
        { timeout: 15_000 },
      )
      await textarea.fill(`QA Lock 024 clean save ${stamp}`)
      await textarea.press('Control+Enter')
      const settled = await putPromise
      expect(settled.status()).toBeLessThan(400)

      await expectNoConflictBanner(page)
    } finally {
      await deleteEntityIfExists(page.request, token, QUOTES_API_BASE, quoteId)
    }
  })
})
