import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken, postForm } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  expectConflictBanner,
  expectConflictBody,
  expectNoConflictBanner,
  putWithLock,
  readUpdatedAt,
} from '@open-mercato/core/helpers/integration/optimisticLockUi'
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * TC-CAT-9680 (#9680) — follow-up from #9668/#9662: automates the manual QA
 * scenario that shipped those fixes (two real writers racing a product save,
 * a view-only reader, and the variant MetadataEditor draft-loss regression)
 * as a durable browser integration test instead of leaving it manual.
 *
 * Scope, matching the issue's acceptance criteria:
 *  - Two genuinely distinct logged-in writers (not two tabs of the same
 *    session, and not the out-of-band API bump the TC-LOCK-OSS-* specs use)
 *    race a product save; the loser gets a 409 with its own draft and the
 *    winner's whole record intact (and an owned, UI-linked document survives
 *    the race untouched). Admin then reloads and retries with a title-only
 *    save.
 *  - Isolated from that race (a full CrudForm save always stamps `metadata`
 *    explicitly): a partial update that never sends `metadata` must leave an
 *    absent `__useMarkdown` flag absent on a record that was never touched by
 *    the UI form (`commands/products.ts`'s `metadataProvided` guard).
 *  - A role scoped to `catalog.products.view` only is refused the write
 *    server-side (403) under the Polish locale, and the UI survives a retry
 *    without crashing.
 *  - A blank (still unfilled) entry added to `MetadataEditor` must survive an
 *    unrelated save + re-render, not disappear — this was a real, reproduced
 *    regression (`components/products/MetadataEditor.tsx`'s external-resync
 *    effect dropped unsaved blank-key drafts); fixed alongside this test.
 */
export const integrationMeta = {
  dependsOnModules: ['documents'],
}

const PRODUCTS_API_BASE = '/api/catalog/products'
const SKU_PLACEHOLDER = /PROD-001/i

/** Locale-agnostic: the title field's placeholder text is translated, the `data-crud-field-id` wrapper is not. */
function titleInputLocator(page: Page) {
  return page.locator('[data-crud-field-id="title"] input').first()
}

async function readProduct(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<{ sku: string; title: string; metadata: Record<string, unknown> | null }> {
  const response = await apiRequest(request, 'GET', `${PRODUCTS_API_BASE}?id=${encodeURIComponent(id)}&page=1&pageSize=1`, { token })
  expect(response.status(), `GET product ${id} should be 200`).toBe(200)
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  const item = (body?.items ?? []).find((entry) => entry.id === id) ?? null
  expect(item, `product ${id} should be present in the list read-back`).toBeTruthy()
  const record = item as Record<string, unknown>
  return {
    sku: String(record.sku ?? ''),
    title: String(record.title ?? ''),
    metadata: (record.metadata ?? null) as Record<string, unknown> | null,
  }
}

async function listLinkedDocumentIds(
  request: APIRequestContext,
  token: string,
  productId: string,
): Promise<string[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/documents?entityType=product&entityId=${encodeURIComponent(productId)}&page=1&pageSize=10`,
    { token },
  )
  expect(response.status(), 'GET /api/documents (related) should be 200').toBe(200)
  const body = await readJsonSafe<{ items?: Array<{ id?: string }> }>(response)
  return (body?.items ?? []).map((row) => String(row.id))
}

async function createDocumentFixture(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<{ id: string; updatedAt: string | null }> {
  const response = await apiRequest(request, 'POST', '/api/documents', {
    token,
    data: { title, folderId: null },
  })
  expect(response.status(), 'POST /api/documents should return 201').toBe(201)
  const body = await readJsonSafe<{ id?: string; updatedAt?: string }>(response)
  return { id: expectId(body?.id, 'document create response should include id'), updatedAt: body?.updatedAt ?? null }
}

async function deleteDocumentIfExists(
  request: APIRequestContext,
  token: string | null,
  documentId: string | null,
  updatedAt: string | null,
): Promise<void> {
  if (!token || !documentId) return
  await request.fetch(`/api/documents/${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(updatedAt ? { [OPTIMISTIC_LOCK_HEADER_NAME]: updatedAt } : {}),
    },
  }).catch(() => undefined)
}

/** A scoped, non-seeded user has no `DEFAULT_CREDENTIALS` entry — sign it in directly. */
async function signIn(
  page: Page,
  credentials: { email: string; password: string },
  scope: { tenantId: string; organizationId: string },
): Promise<string> {
  const response = await postForm(page.request, '/api/auth/login', credentials)
  expect(response.status(), 'Browser login should succeed').toBe(200)
  const body = await readJsonSafe<{ token?: string }>(response)
  if (!body?.token) throw new Error('[internal] Browser login did not return a session token')
  const url = new URL(response.url()).origin
  await page.context().addCookies([
    { name: 'locale', value: 'en', url, sameSite: 'Lax' },
    { name: 'om_selected_tenant', value: scope.tenantId, url, sameSite: 'Lax' },
    { name: 'om_selected_org', value: scope.organizationId, url, sameSite: 'Lax' },
    { name: 'om_demo_notice_ack', value: 'ack', url, sameSite: 'Lax' },
    { name: 'om_cookie_notice_ack', value: 'ack', url, sameSite: 'Lax' },
  ])
  return body.token
}

/** Locale may be pinned via `OM_FORCE_LOCALE` in some environments — callers skip on `false`. */
async function switchLocale(page: Page, locale: string): Promise<boolean> {
  const response = await page.request.post('/api/auth/locale', { data: { locale } })
  if (response.status() === 409) return false
  expect(response.ok(), `POST /api/auth/locale should accept "${locale}": ${response.status()}`).toBeTruthy()
  return true
}

test.describe('TC-CAT-9680: catalog concurrent-edit and metadata browser regressions', () => {
  test('two real writer UI sessions: a stale SKU edit 409s with draft and whole-record preservation; a title-only retry preserves an absent Markdown flag', async ({ browser, request }) => {
    test.setTimeout(120_000)
    const stamp = Date.now()
    const adminToken = await getAuthToken(request, 'admin')
    let productId: string | null = null
    let documentId: string | null = null
    let documentUpdatedAt: string | null = null

    const adminContext = await browser.newContext()
    const writerBContext = await browser.newContext()
    const adminPage = await adminContext.newPage()
    const writerBPage = await writerBContext.newPage()

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `QA 9680 writer ${stamp}`,
        sku: `qa-9680-writer-${stamp}`,
      })
      const docTitle = `QA 9680 linked doc ${stamp}`
      const doc = await createDocumentFixture(request, adminToken, docTitle)
      documentId = doc.id
      documentUpdatedAt = doc.updatedAt

      await login(adminPage, 'admin')
      await adminPage.goto(`/backend/catalog/products/${productId}`)
      const titleInput = titleInputLocator(adminPage)
      await expect(titleInput).toBeVisible({ timeout: 15_000 })

      // UI-link the owned document before the race below, so the link itself
      // is never touched by the conflicting saves that follow.
      await adminPage.getByRole('button', { name: 'Link existing', exact: true }).click()
      await adminPage.getByLabel('Document title').fill(docTitle)
      const documentRow = adminPage.getByRole('button').filter({ hasText: docTitle }).first()
      await expect(documentRow).toBeVisible({ timeout: 10_000 })
      await documentRow.click()
      await expect(adminPage.getByRole('link', { name: docTitle })).toBeVisible({ timeout: 10_000 })

      // Second, genuinely distinct real user (a seeded `employee` account,
      // not a second tab of `admin`) loads and saves the SAME product's SKU
      // through its own UI — not an out-of-band API bump.
      await login(writerBPage, 'employee')
      await writerBPage.goto(`/backend/catalog/products/${productId}`)
      const writerBSkuInput = writerBPage.getByPlaceholder(SKU_PLACEHOLDER).first()
      await expect(writerBSkuInput).toBeVisible({ timeout: 15_000 })
      const newSku = `qa-9680-writerb-${stamp}`
      await fillControlledInput(writerBSkuInput, newSku)
      await writerBPage.getByRole('button', { name: /^save changes$/i }).first().click()
      await expectNoConflictBanner(writerBPage)

      // First user's tab still holds the pre-writer-B-save token. Editing a
      // DIFFERENT field (title) and saving now must 409 against writer B's
      // real write — and the admin tab's own stale edit stays in the DOM.
      const marker = `QA 9680 admin-stale ${stamp}`
      await fillControlledInput(titleInput, marker)
      const conflictResponsePromise = adminPage.waitForResponse((res) =>
        new URL(res.url()).pathname === PRODUCTS_API_BASE && res.request().method() === 'PUT',
      )
      await adminPage.getByRole('button', { name: /^save changes$/i }).first().click()
      const conflictBody = await expectConflictBody(await conflictResponsePromise)
      await expectConflictBanner(adminPage)
      await expect(titleInput).toHaveValue(marker)

      // Whole-record preservation: the failed save must not have reverted
      // writer B's SKU, dropped the document link, or touched anything else.
      const afterConflict = await readProduct(request, adminToken, productId)
      expect(afterConflict.sku, 'the losing save must not revert the winning SKU').toBe(newSku)
      expect(afterConflict.title, 'the losing save must not apply its own stale title').not.toBe(marker)
      const linksAfterConflict = await listLinkedDocumentIds(request, adminToken, productId)
      expect(linksAfterConflict, 'the document link must survive the conflicting save').toContain(documentId)

      // Reload/title-only retry: admin recovers with a title-only save using
      // the 409 body's own `currentUpdatedAt` as the fresh lock. A subsequent
      // list GET (`readUpdatedAt`) can be served from the catalog products
      // list cache and return a stale `updated_at`, making the retry 409
      // again; the conflict response's `currentUpdatedAt` is authoritative.
      const freshLock = conflictBody.currentUpdatedAt
      expect(typeof freshLock, `conflict body should include currentUpdatedAt, got ${JSON.stringify(conflictBody)}`).toBe('string')
      const retryTitle = `QA 9680 title-only retry ${stamp}`
      const retryResponse = await putWithLock(
        request,
        adminToken,
        PRODUCTS_API_BASE,
        { id: productId, title: retryTitle },
        freshLock as string,
      )
      expect(retryResponse.status(), 'the title-only retry should succeed').toBeLessThan(300)
      const afterRetry = await readProduct(request, adminToken, productId)
      expect(afterRetry.title).toBe(retryTitle)
    } finally {
      await adminContext.close()
      await writerBContext.close()
      await deleteDocumentIfExists(request, adminToken, documentId, documentUpdatedAt)
      await deleteCatalogProductIfExists(request, adminToken, productId)
    }
  })

  test('a title-only partial update preserves an absent Markdown flag', async ({ request }) => {
    // Isolated from the writer-conflict scenario above on purpose: any full
    // CrudForm save (like writer B's SKU save there) always sends `metadata`
    // and so always stamps an explicit `__useMarkdown` (see `buildMetadataPayload`
    // in `backend/catalog/products/[id]/page.tsx`). Only a record that has
    // never been through that form — straight from API creation — can prove
    // that a partial update omitting `metadata` leaves it genuinely absent
    // (`commands/products.ts`'s `metadataProvided` guard).
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let productId: string | null = null
    try {
      productId = await createProductFixture(request, adminToken, {
        title: `QA 9680 markdown flag ${stamp}`,
        sku: `qa-9680-markdown-${stamp}`,
      })
      const beforeRetry = await readProduct(request, adminToken, productId)
      expect(
        beforeRetry.metadata == null || !Object.prototype.hasOwnProperty.call(beforeRetry.metadata, '__useMarkdown'),
        `a freshly created product should not carry __useMarkdown, got ${JSON.stringify(beforeRetry.metadata)}`,
      ).toBe(true)

      const freshLock = await readUpdatedAt(request, adminToken, PRODUCTS_API_BASE, productId)
      const retryTitle = `QA 9680 markdown flag retry ${stamp}`
      const retryResponse = await putWithLock(
        request,
        adminToken,
        PRODUCTS_API_BASE,
        { id: productId, title: retryTitle },
        freshLock,
      )
      expect(retryResponse.status(), 'the title-only retry should succeed').toBeLessThan(300)
      const afterRetry = await readProduct(request, adminToken, productId)
      expect(afterRetry.title).toBe(retryTitle)
      expect(
        afterRetry.metadata == null || !Object.prototype.hasOwnProperty.call(afterRetry.metadata, '__useMarkdown'),
        `a title-only save must not inject __useMarkdown, got ${JSON.stringify(afterRetry.metadata)}`,
      ).toBe(true)
    } finally {
      await deleteCatalogProductIfExists(request, adminToken, productId)
    }
  })

  test('a view-only reader is refused the save under the Polish locale and the UI survives a retry', async ({ page, request }) => {
    test.setTimeout(90_000)
    const stamp = Date.now()
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenContext(adminToken)
    const credentials = { email: `qa-9680-reader-${stamp}@example.com`, password: `Test-${stamp}!aA1` }
    let productId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    let localeSwitched = false

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `QA 9680 reader ${stamp}`,
        sku: `qa-9680-reader-${stamp}`,
      })
      roleId = await createRoleFixture(request, adminToken, { name: `qa-9680-reader-${stamp}`, tenantId: scope.tenantId })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['catalog.products.view'] })
      userId = await createUserFixture(request, adminToken, {
        ...credentials,
        organizationId: scope.organizationId,
        roles: [roleId],
      })

      await signIn(page, credentials, scope)
      localeSwitched = await switchLocale(page, 'pl')
      test.skip(!localeSwitched, 'Locale is pinned via OM_FORCE_LOCALE in this environment')

      const pageErrors: string[] = []
      page.on('pageerror', (error) => pageErrors.push(error.message))

      await page.goto(`/backend/catalog/products/${productId}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: 'Edytuj produkt', exact: true })).toBeVisible({ timeout: 15_000 })
      const titleInput = titleInputLocator(page)
      await expect(titleInput).toBeVisible({ timeout: 15_000 })

      const marker = `QA 9680 reader denied ${stamp}`
      await fillControlledInput(titleInput, marker)
      const saveButton = page.getByRole('button', { name: /^zapisz zmiany$/i }).first()
      const deniedOnce = page.waitForResponse((res) =>
        new URL(res.url()).pathname === PRODUCTS_API_BASE && res.request().method() === 'PUT',
      )
      await saveButton.click()
      expect((await deniedOnce).status(), 'the server RBAC guard should refuse a view-only reader').toBe(403)
      await expect(page.getByRole('alert').filter({ hasText: /\S/ }).first()).toBeVisible({ timeout: 10_000 })

      // Retry: the error surface must let the user try again without the
      // app crashing or getting stuck — it must keep refusing cleanly.
      const deniedAgain = page.waitForResponse((res) =>
        new URL(res.url()).pathname === PRODUCTS_API_BASE && res.request().method() === 'PUT',
      )
      await saveButton.click()
      expect((await deniedAgain).status(), 'the retry must still be refused by the server').toBe(403)
      await expect(titleInput).toHaveValue(marker)
      expect(pageErrors, 'the product form must not crash the page while refusing a reader save').toEqual([])
    } finally {
      if (localeSwitched) await switchLocale(page, 'en').catch(() => undefined)
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
    }
  })

  test('a blank metadata draft entry survives an unrelated save and re-render', async ({ page, request }) => {
    test.setTimeout(90_000)
    const stamp = Date.now()
    const adminToken = await getAuthToken(request, 'admin')
    let productId: string | null = null

    try {
      // `MetadataEditor` (packages/core/src/modules/catalog/components/products/MetadataEditor.tsx)
      // is the one shared component used by both the product edit page and
      // every variant create/edit page. The variant pages redirect to the
      // parent product's variants list on a successful save (see
      // `[productId]/variants/[variantId]/page.tsx`'s `router.push`), so an
      // in-place "unrelated save re-renders this page" repro isn't reachable
      // there. The product edit page never navigates away on save (see
      // TC-LOCK-OSS-019), so it drives the exact same regression on the exact
      // same component.
      productId = await createProductFixture(request, adminToken, {
        title: `QA 9680 metadata draft ${stamp}`,
        sku: `qa-9680-metadata-${stamp}`,
      })

      await login(page, 'admin')
      await page.goto(`/backend/catalog/products/${productId}`)
      const titleInput = titleInputLocator(page)
      await expect(titleInput).toBeVisible({ timeout: 15_000 })

      await page.getByRole('button', { name: 'Show metadata', exact: true }).click()
      await page.getByRole('button', { name: 'Add entry', exact: true }).click()
      const keyInput = page.getByPlaceholder('Key', { exact: true })
      const valueInput = page.getByPlaceholder('Value', { exact: true })
      await expect(keyInput).toBeVisible()
      await expect(keyInput).toHaveValue('')
      await expect(valueInput).toHaveValue('')

      // Trigger an unrelated save: the record refetch re-renders MetadataEditor
      // with a fresh `value` object that still has no key for the blank draft.
      const rename = `QA 9680 metadata draft renamed ${stamp}`
      await fillControlledInput(titleInput, rename)
      const savePromise = page.waitForResponse((res) =>
        res.request().method() === 'PUT' && res.url().includes(PRODUCTS_API_BASE),
      )
      await page.getByRole('button', { name: /^save changes$/i }).first().click()
      expect((await savePromise).status(), 'the unrelated rename should succeed').toBeLessThan(400)

      // The still-empty draft row must not have been wiped by the re-render.
      await expect(keyInput).toBeVisible()
      await expect(keyInput).toHaveValue('')
      await expect(valueInput).toHaveValue('')
      await expect(page.getByText('No metadata. Add your first entry.')).toHaveCount(0)
    } finally {
      await deleteCatalogProductIfExists(request, adminToken, productId)
    }
  })
})
