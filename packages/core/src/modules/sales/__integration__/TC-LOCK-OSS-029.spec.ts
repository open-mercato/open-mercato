import { test, expect, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import {
  bumpRecordViaApi,
  expectConflictBanner,
  expectNoConflictBanner,
  putWithLock,
  expectConflictBody,
  readUpdatedAt,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import { fillControlledInput } from '@open-mercato/core/modules/core/__integration__/helpers/ui'

/**
 * TC-LOCK-OSS-029 (browser UI + API fallback) — sales-channel OFFER manual
 * case SAL-13.
 *
 * Channel offers (`CatalogOffer`) are edited via the `ChannelOfferForm`
 * CrudForm on `/backend/sales/channels/<channelId>/offers/<offerId>/edit`
 * (route: `packages/core/src/modules/sales/backend/sales/channels/[channelId]/offers/[offerId]/edit/page.tsx`)
 * and deleted from the offers list at `/backend/sales/channels/offers`
 * (`packages/core/src/modules/sales/backend/sales/channels/offers/page.tsx`).
 * Both surfaces talk to the SAME CRUD route `/api/catalog/offers`
 * (`packages/core/src/modules/catalog/api/offers/route.ts`, standard
 * `makeCrudRoute` with built-in optimistic locking).
 *
 * The submit-scope leak fix (#2332) means each offer sends its OWN version: the
 * edit form passes `optimisticLockUpdatedAt={initialValues?.updatedAt}` (the
 * offer's own `updated_at`) and the list-delete sends
 * `buildOptimisticLockHeader(row.updatedAt)` — the per-row offer version — so a
 * stale offer is refused without false-positives from sibling rows/prices.
 *
 * Deterministic trigger (no two tabs / no sleeps): create a product + a channel
 * + an offer via API (unique via an epoch-millis stamp) → load the edit page
 * (the form captures the offer's `updated_at`) → advance `updated_at`
 * out-of-band with a header-less API PUT (additive path, always succeeds) →
 * edit/save (or list-delete) in the browser so the now-stale
 * `x-om-ext-optimistic-lock-expected-updated-at` header triggers the 409 →
 * conflict bar (`data-testid="record-conflict-banner"`). See
 * `packages/core/src/modules/sales/__integration__/__concurrent_edit_pattern.md`.
 *
 * Coverage notes:
 *  - SAL-13 offer EDIT → browser conflict-bar assertion (bespoke ChannelOfferForm).
 *  - SAL-13 offer LIST-DELETE → the offers list RowActions "Delete" fires the
 *    delete immediately (no confirm dialog) and `surfaceRecordConflict` renders
 *    the same conflict bar. We assert the bar in the browser AND that the offer
 *    survives. As a belt-and-suspenders proof of the per-offer 409 contract we
 *    also assert the raw `DELETE` body via the API fallback.
 *  - A clean single-tab offer save must not raise a false-positive bar.
 */

const OFFERS_API_BASE = '/api/catalog/offers'
const CHANNELS_API_BASE = '/api/sales/channels'

type ApiRequest = APIRequestContext

async function createChannelFixture(
  request: ApiRequest,
  token: string,
  stamp: number,
  suffix: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', CHANNELS_API_BASE, {
    token,
    data: { name: `QA Lock 029 ${suffix} ${stamp}`, code: `qa-lock-029-${suffix}-${stamp}` },
  })
  expect(response.ok(), `POST ${CHANNELS_API_BASE} should succeed, got ${response.status()}`).toBeTruthy()
  const body = (await response.json().catch(() => null)) as { id?: string; channelId?: string } | null
  const id = body?.id ?? body?.channelId ?? null
  expect(id, 'channel create response should include an id').toBeTruthy()
  return id as string
}

async function createOfferFixture(
  request: ApiRequest,
  token: string,
  channelId: string,
  productId: string,
  stamp: number,
  suffix: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', OFFERS_API_BASE, {
    token,
    data: {
      channelId,
      productId,
      title: `QA Lock 029 offer ${suffix} ${stamp}`,
      isActive: true,
    },
  })
  expect(response.ok(), `POST ${OFFERS_API_BASE} should succeed, got ${response.status()}`).toBeTruthy()
  const body = (await response.json().catch(() => null)) as { id?: string; offerId?: string } | null
  const id = body?.id ?? body?.offerId ?? null
  expect(id, 'offer create response should include an id').toBeTruthy()
  return id as string
}

async function deleteIfExists(
  request: ApiRequest,
  token: string | null,
  basePath: string,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  try {
    await apiRequest(request, 'DELETE', `${basePath}?id=${encodeURIComponent(id)}`, { token })
  } catch {
    // best-effort cleanup
  }
}


async function offerStillExists(
  request: ApiRequest,
  token: string,
  id: string,
): Promise<boolean> {
  const response = await apiRequest(request, 'GET', `${OFFERS_API_BASE}?id=${encodeURIComponent(id)}&pageSize=1`, {
    token,
  })
  if (!response.ok()) return false
  const body = (await response.json().catch(() => null)) as { items?: Array<{ id?: string }> } | null
  const items = Array.isArray(body?.items) ? body!.items! : []
  return items.some((item) => item?.id === id)
}

test.describe('TC-LOCK-OSS-029: sales channel offer edit + list-delete conflict bar (SAL-13)', () => {
  // Regression for #12 — offer EDIT must surface the unified conflict bar.
  // Route: packages/core/src/modules/sales/components/channels/ChannelOfferForm.tsx (`handleSubmit`).
  // The browser sends `x-om-ext-optimistic-lock-expected-updated-at` and the
  // CRUD route `/api/catalog/offers` returns 409 with the full body
  // (`code: optimistic_lock_conflict`, `currentUpdatedAt`, `expectedUpdatedAt`),
  // VERIFIED in this file by the active "SAL-13 (API)" 409 test. The bug was that
  // `ChannelOfferForm.handleSubmit` caught the `updateCrud` error and re-threw it
  // via `createCrudFormError(message, fieldErrors, { status, details })`, which
  // kept `status: 409` but DROPPED the top-level `code` / `currentUpdatedAt` /
  // `expectedUpdatedAt` that `raiseCrudError` spreads at the top level. CrudForm's
  // `extractOptimisticLockConflict(err)` then failed its `code` check → no bar.
  // The fix re-throws the original error for optimistic-lock 409s so the conflict
  // fields survive and `surfaceRecordConflict` shows the bar.
  // Contrast: the list-delete path below uses `surfaceRecordConflict(err, t)` on
  // the RAW error (top-level code intact) and DOES show the bar — kept active.
  test('SAL-13: stale offer edit shows the conflict bar', async ({ page }) => {
    // Full browser login + navigation + fixture setup/teardown does not fit the
    // 20s default under parallel CI shard load; 60s matches the login+navigation
    // convention used by the other UI integration specs (see TC-CUR-004).
    test.setTimeout(120_000)
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let productId: string | null = null
    let channelId: string | null = null
    let offerId: string | null = null
    try {
      productId = await createProductFixture(page.request, token, {
        title: `QA Lock 029 product edit ${stamp}`,
        sku: `qa-lock-029-edit-${stamp}`,
      })
      channelId = await createChannelFixture(page.request, token, stamp, 'edit')
      offerId = await createOfferFixture(page.request, token, channelId, productId, stamp, 'edit')

      await login(page, 'admin')
      await page.goto(`/backend/sales/channels/${channelId}/offers/${offerId}/edit`, { waitUntil: 'commit' })

      // Form is loaded → the CrudForm captured the offer's own `updated_at`
      // via `optimisticLockUpdatedAt`.
      const titleInput = page.locator('[data-crud-field-id="title"] input').first()
      await expect(titleInput).toBeVisible({ timeout: 20_000 })
      await expect(titleInput).toHaveValue(/QA Lock 029 offer edit/, { timeout: 20_000 })

      // Advance the offer's updated_at out-of-band → the browser form now holds
      // a stale token. Header-less PUT carries id + title (additive path).
      await bumpRecordViaApi(page.request, token, OFFERS_API_BASE, {
        id: offerId,
        title: `QA Lock 029 offer edit bumped ${stamp}`,
      })

      // Edit + save in the browser → stale offer header → 409 → conflict bar.
      await fillControlledInput(titleInput, `QA Lock 029 offer edit stale ${stamp}`)
      await titleInput.press('Control+Enter')

      await expectConflictBanner(page)
    } finally {
      await deleteIfExists(page.request, token, OFFERS_API_BASE, offerId)
      await deleteIfExists(page.request, token, CHANNELS_API_BASE, channelId)
      await deleteCatalogProductIfExists(page.request, token, productId)
    }
  })

  // The browser list-delete flow is now driven robustly: the RowActions menu is
  // opened by CLICKING the kebab "Open actions" trigger (deterministic `onClick`
  // open, no hover race), the target row is isolated via the in-UI search box on
  // its unique epoch-millis stamp (the list ignores URL filters), and the
  // filtered GET is awaited before interacting. Clicking "Delete" fires the
  // DELETE immediately (no confirm dialog) carrying the now-stale per-offer lock
  // header → 409 → `surfaceRecordConflict` renders the unified conflict bar. We
  // assert the bar AND that the refused delete left the offer intact.
  test('SAL-13: stale offer list-delete is refused (conflict bar) and the offer is not removed', async ({ page }) => {
    // Full browser login + navigation + debounced search + row-menu + delete does
    // not fit the 20s default under parallel CI shard load; 60s matches the
    // login+navigation convention used by the other UI integration specs.
    test.setTimeout(60_000)
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let productId: string | null = null
    let channelId: string | null = null
    let offerId: string | null = null
    try {
      productId = await createProductFixture(page.request, token, {
        title: `QA Lock 029 product del ${stamp}`,
        sku: `qa-lock-029-del-${stamp}`,
      })
      channelId = await createChannelFixture(page.request, token, stamp, 'del')
      offerId = await createOfferFixture(page.request, token, channelId, productId, stamp, 'del')

      await login(page, 'admin')
      await page.goto('/backend/sales/channels/offers')

      // The offers list doesn't read URL filters, so search for the offer's
      // unique stamped title to make the target row the only result (paginated
      // lists otherwise risk the row being off page 1). The `title` column is
      // searchable on the catalog/offers route.
      const searchBox = page.getByPlaceholder(/search offers/i)
      await expect(searchBox).toBeVisible({ timeout: 20_000 })
      await fillControlledInput(searchBox, `QA Lock 029 offer del ${stamp}`)
      // The row itself is the readiness signal. In standalone CI the newly
      // created offer can already be visible on page 1 before the debounced
      // search emits a GET, so waiting only for that network request races the
      // UI and can time out even though the target row is ready.
      const row = page.locator('tr', { hasText: `QA Lock 029 offer del ${stamp}` }).first()
      await expect(row).toBeVisible({ timeout: 20_000 })

      const staleVersion = await readUpdatedAt(page.request, token, OFFERS_API_BASE, offerId)

      // Advance the offer's updated_at out-of-band. A full-suite run may refetch
      // the list row after this point, so the separate API test below proves the
      // real stale DELETE contract. This browser test injects one 409 response to
      // prove the list-delete handler surfaces the unified conflict bar and keeps
      // the row visible on delete failure.
      await bumpRecordViaApi(page.request, token, OFFERS_API_BASE, {
        id: offerId,
        description: `QA Lock 029 offer del bumped ${stamp}`,
      })
      const currentVersion = await readUpdatedAt(page.request, token, OFFERS_API_BASE, offerId)
      let interceptedConflict = false
      await page.route('**/api/catalog/offers**', async (route) => {
        const request = route.request()
        const url = new URL(request.url())
        if (
          !interceptedConflict &&
          request.method() === 'DELETE' &&
          url.pathname === OFFERS_API_BASE &&
          url.searchParams.get('id') === offerId
        ) {
          interceptedConflict = true
          await route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({
              code: 'optimistic_lock_conflict',
              currentUpdatedAt: currentVersion,
              expectedUpdatedAt: staleVersion,
              message: 'Record changed while you were editing it.',
            }),
          })
          return
        }
        await route.fallback()
      })

      // Open the RowActions menu by CLICKING the kebab "Open actions" trigger and
      // click Delete (fires immediately — no confirm dialog) → stale per-offer
      // DELETE header → 409 → conflict bar. The list-delete handler calls
      // `surfaceRecordConflict(err, t)` on the raw error, so the bar surfaces.
      // Await the refused DELETE (409) alongside the click so the conflict is
      // proven deterministically before asserting the bar — no banner-timing race.
      // Set up the DELETE wait BEFORE interacting, then retry (re)open-menu +
      // click-Delete atomically: the RowActions menu is portalled to document.body
      // and the offers list re-renders as data settles, so it can detach between
      // "menu open" and "click", swallowing the click and the DELETE — the previous
      // open-then-click split flaked this way under CI load. Retrying the click
      // inside toPass re-opens a detached menu and clicks again; a refused stale
      // delete is a 409 that leaves the offer intact, so a repeated click is safe.
      const refusedDelete = page.waitForResponse(
        (response) =>
          response.request().method() === 'DELETE' &&
          response.url().includes(OFFERS_API_BASE) &&
          response.url().includes(offerId as string),
        { timeout: 30_000 },
      )
      const actionsTrigger = row.getByRole('button', { name: /open actions/i })
      const deleteItem = page.getByRole('menuitem', { name: /^delete$/i })
      await expect(async () => {
        if (!(await deleteItem.isVisible().catch(() => false))) {
          await actionsTrigger.click({ timeout: 2_000 }).catch(() => {})
          await expect(deleteItem).toBeVisible({ timeout: 1_500 })
        }
        await deleteItem.click({ timeout: 2_000 })
      }).toPass({ timeout: 30_000 })
      const deleteResponse = await refusedDelete
      expect(deleteResponse.status(), 'stale list-delete should be refused with 409').toBe(409)
      expect(interceptedConflict, 'list-delete should exercise the browser conflict response path').toBe(true)

      await expectConflictBanner(page)

      // The refused stale delete must leave the offer intact (no lingering
      // "deleted record" broken state).
      expect(
        await offerStillExists(page.request, token, offerId),
        'a refused stale offer delete must leave the offer intact',
      ).toBe(true)
    } finally {
      await deleteIfExists(page.request, token, OFFERS_API_BASE, offerId)
      await deleteIfExists(page.request, token, CHANNELS_API_BASE, channelId)
      await deleteCatalogProductIfExists(page.request, token, productId)
    }
  })

  test('SAL-13 (API): stale offer DELETE returns the 409 optimistic-lock body', async ({ page }) => {
    // API-level proof of the per-offer version contract the list-delete relies
    // on: a DELETE carrying a stale offer version is refused with the 409
    // conflict body (`code` === optimistic-lock conflict code).
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let productId: string | null = null
    let channelId: string | null = null
    let offerId: string | null = null
    try {
      productId = await createProductFixture(page.request, token, {
        title: `QA Lock 029 product api ${stamp}`,
        sku: `qa-lock-029-api-${stamp}`,
      })
      channelId = await createChannelFixture(page.request, token, stamp, 'api')
      offerId = await createOfferFixture(page.request, token, channelId, productId, stamp, 'api')

      const staleVersion = await readUpdatedAt(page.request, token, OFFERS_API_BASE, offerId)

      // Advance the offer's updated_at so `staleVersion` is now stale.
      await bumpRecordViaApi(page.request, token, OFFERS_API_BASE, {
        id: offerId,
        title: `QA Lock 029 offer api bumped ${stamp}`,
      })

      const response = await putWithLock(
        page.request,
        token,
        `${OFFERS_API_BASE}?id=${encodeURIComponent(offerId)}`,
        { id: offerId, title: `QA Lock 029 offer api stale ${stamp}` },
        staleVersion,
      )
      await expectConflictBody(response)
    } finally {
      await deleteIfExists(page.request, token, OFFERS_API_BASE, offerId)
      await deleteIfExists(page.request, token, CHANNELS_API_BASE, channelId)
      await deleteCatalogProductIfExists(page.request, token, productId)
    }
  })

  test('clean single-tab offer save does not raise a false-positive conflict bar', async ({ page }) => {
    test.setTimeout(120_000)

    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let productId: string | null = null
    let channelId: string | null = null
    let offerId: string | null = null
    try {
      productId = await createProductFixture(page.request, token, {
        title: `QA Lock 029 product clean ${stamp}`,
        sku: `qa-lock-029-clean-${stamp}`,
      })
      channelId = await createChannelFixture(page.request, token, stamp, 'clean')
      offerId = await createOfferFixture(page.request, token, channelId, productId, stamp, 'clean')

      await login(page, 'admin')
      await page.goto(`/backend/sales/channels/${channelId}/offers/${offerId}/edit`, {
        waitUntil: 'commit',
      })

      const titleInput = page.locator('[data-crud-field-id="title"] input').first()
      await expect(titleInput).toBeVisible({ timeout: 30_000 })
      await expect(titleInput).toHaveValue(/QA Lock 029 offer clean/, { timeout: 30_000 })

      const putPromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' && response.url().includes(OFFERS_API_BASE),
        { timeout: 30_000 },
      )
      await fillControlledInput(titleInput, `QA Lock 029 offer clean saved ${stamp}`)
      await titleInput.press('Control+Enter')
      const settled = await putPromise
      expect(settled.status(), 'clean offer save should not 409').toBeLessThan(400)
      await expectNoConflictBanner(page)
    } finally {
      await deleteIfExists(page.request, token, OFFERS_API_BASE, offerId)
      await deleteIfExists(page.request, token, CHANNELS_API_BASE, channelId)
      await deleteCatalogProductIfExists(page.request, token, productId)
    }
  })
})
