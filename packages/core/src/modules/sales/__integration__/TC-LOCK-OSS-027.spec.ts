import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createSalesQuoteFixture } from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'
import {
  bumpRecordViaApi,
  readUpdatedAt,
  expectConflictBanner,
  resolveApiUrl,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import {
  OPTIMISTIC_LOCK_HEADER_NAME,
  OPTIMISTIC_LOCK_CONFLICT_CODE,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * TC-LOCK-OSS-027 — quote → convert-to-order race (SAL-09, closes #2114).
 *
 * The convert command (`sales/commands/documents.ts` → `sales.quotes.convert_to_order`)
 * calls `enforceSalesDocumentOptimisticLock(ctx, quote, SALES_RESOURCE_KIND_QUOTE)`
 * BEFORE materializing the order: it compares the quote's stored `updatedAt`
 * against the `x-om-ext-optimistic-lock-expected-updated-at` header the client
 * sends. So a Convert that carries a STALE quote version (`t0`) — after the quote
 * has already advanced to `t1` out-of-band — must be refused with the structured
 * 409 instead of converting a stale snapshot.
 *
 * Deterministic trigger (no two real tabs / no sleeps):
 *   create quote via API fixture (unique fixture currency) → load the quote
 *   detail page (`/backend/sales/documents/<quoteId>`; the page captures the
 *   quote's `updatedAt` as its optimistic-lock token) → advance the quote
 *   `updated_at` out-of-band with a header-less PUT (`t0` → `t1`) → drive Convert.
 *
 * Two layers of executable coverage:
 *  - BROWSER (preferred): open the header "Actions" dropdown on the quote detail
 *    page, click "Convert to order". The page's `handleConvert` sends the now-stale
 *    `buildOptimisticLockHeader(record.updatedAt)` and routes the 409 through
 *    `surfaceRecordConflict` → the unified "Record changed" conflict bar
 *    (`data-testid="record-conflict-banner"`).
 *  - API FALLBACK: POST `/api/sales/quotes/convert` with the stale `t0` header →
 *    409 with `code === OPTIMISTIC_LOCK_CONFLICT_CODE`; then with the fresh `t1`
 *    header → 200 (the conversion actually goes through, proving the lock gates
 *    the race rather than blocking all converts).
 *
 * See `packages/core/src/modules/sales/__integration__/__concurrent_edit_pattern.md`
 * (document-aggregate sub-resource pattern; here the "sub-resource write" is the
 * quote→order conversion).
 */

const QUOTES_API_BASE = '/api/sales/quotes'
const CONVERT_API_BASE = '/api/sales/quotes/convert'

async function deleteQuoteIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  try {
    await request.fetch(resolveApiUrl(`${QUOTES_API_BASE}?id=${encodeURIComponent(id)}`), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
  } catch {
    // best-effort cleanup
  }
}

async function deleteOrderIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  try {
    await request.fetch(resolveApiUrl(`/api/sales/orders?id=${encodeURIComponent(id)}`), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
  } catch {
    // best-effort cleanup
  }
}

async function convertQuote(
  request: APIRequestContext,
  token: string,
  quoteId: string,
  lockValue: string,
) {
  return request.fetch(resolveApiUrl(CONVERT_API_BASE), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      [OPTIMISTIC_LOCK_HEADER_NAME]: lockValue,
    },
    data: { quoteId },
  })
}

async function openActionsMenuAndConvert(page: Page): Promise<void> {
  // FormHeader renders the quote's `menuActions` ("Convert to order", "Send to
  // customer") inside an ActionsDropdown whose default trigger label is "Actions".
  // The dropdown opens on hover or click and renders its items as
  // `role="menuitem"` buttons in a portal.
  // Exact "Actions" — the FormHeader dropdown trigger. A substring match would
  // also grab the topbar "AI Inbox Actions" button.
  const trigger = page.getByRole('button', { name: 'Actions', exact: true })
  const convertItem = page.getByRole('menuitem', { name: /convert to order/i })
  await expect(async () => {
    await trigger.click()
    await expect(convertItem).toBeVisible({ timeout: 1_500 })
  }).toPass({ timeout: 15_000 })
  await convertItem.click()
}

test.describe('TC-LOCK-OSS-027: quote → convert-to-order race (SAL-09)', () => {
  // Runs as `admin`, which the sales module grants `sales.*` to in setup.ts
  // (`defaultRoleFeatures`) — so a freshly installed tenant and CI both hold
  // `sales.quotes.manage` + `sales.orders.manage` out of the box.
  test('browser: stale Convert on the quote page surfaces the conflict bar', async ({ page }) => {
    test.setTimeout(60_000)
    const token = await getAuthToken(page.request, 'admin')
    let quoteId: string | null = null
    try {
      quoteId = await createSalesQuoteFixture(page.request, token, 'USD')

      await login(page, 'admin')
      await page.goto(`/backend/sales/documents/${quoteId}`)

      // The detail page is loaded; it captures the quote's `updatedAt` as its
      // optimistic-lock token. Wait for the header "Actions" dropdown to exist.
      const actionsTrigger = page.getByRole('button', { name: 'Actions', exact: true })
      await expect(actionsTrigger).toBeVisible({ timeout: 20_000 })

      // Advance the quote `updated_at` out-of-band (header-less PUT) → the loaded
      // page now holds a stale token (`t0`), while the server is at `t1`.
      await bumpRecordViaApi(page.request, token, QUOTES_API_BASE, {
        id: quoteId,
        comment: `QA Lock 027 bumped ${Date.now()}`,
      })

      // Drive Convert in the browser → stale header → 409 → conflict bar.
      await openActionsMenuAndConvert(page)

      await expectConflictBanner(page)

      // The refused stale convert must NOT have created an order, so the quote
      // page is still on the quote (no redirect to /backend/sales/orders/...).
      expect(page.url(), 'a refused stale convert must not navigate to the new order').not.toContain(
        '/backend/sales/orders/',
      )
    } finally {
      await deleteQuoteIfExists(page.request, token, quoteId)
    }
  })

  test('API fallback: stale t0 Convert → 409; fresh t1 Convert → 200', async ({ request }) => {
    let token: string | null = null
    let quoteId: string | null = null
    let convertedOrderId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      quoteId = await createSalesQuoteFixture(request, token, 'USD')

      const t0 = await readUpdatedAt(request, token, QUOTES_API_BASE, quoteId)
      expect(t0).toMatch(/^\d{4}-\d{2}-\d{2}T/)

      // Advance the quote out-of-band: t0 → t1 (header-less PUT bumps updated_at).
      const t1 = await bumpRecordViaApi(request, token, QUOTES_API_BASE, {
        id: quoteId,
        comment: `QA Lock 027 api ${Date.now()}`,
      })
      expect(t1, 'quote updated_at should advance after the out-of-band bump').not.toBe(t0)

      // Stale convert: carries t0 while the quote is at t1 → 409 conflict.
      const stale = await convertQuote(request, token, quoteId, t0)
      expect(stale.status(), 'stale Convert (t0) should be refused with 409').toBe(409)
      const staleBody = (await stale.json()) as Record<string, unknown>
      expect(staleBody.code, 'conflict body should carry the optimistic-lock conflict code').toBe(
        OPTIMISTIC_LOCK_CONFLICT_CODE,
      )

      // The quote must still exist (the refused convert is a no-op).
      const stillThere = await readUpdatedAt(request, token, QUOTES_API_BASE, quoteId)
      expect(stillThere, 'a refused stale convert must leave the quote intact at t1').toBe(t1)

      // Fresh convert: carries t1 → succeeds, materializing the order. This proves
      // the lock gates the *race* rather than blocking every convert.
      const fresh = await convertQuote(request, token, quoteId, t1 as string)
      expect(fresh.status(), 'fresh Convert (t1) should succeed').toBeLessThan(300)
      const freshBody = (await fresh.json()) as { orderId?: string }
      convertedOrderId = typeof freshBody?.orderId === 'string' ? freshBody.orderId : quoteId
      // Conversion consumes the quote, so once it succeeds there is no quote left
      // to clean up — only the produced order.
      quoteId = null
    } finally {
      await deleteQuoteIfExists(request, token, quoteId)
      await deleteOrderIfExists(request, token, convertedOrderId)
    }
  })
})
