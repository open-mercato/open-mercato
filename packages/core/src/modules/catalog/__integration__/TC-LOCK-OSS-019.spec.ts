import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import {
  bumpRecordViaApi,
  expectConflictBanner,
  expectNoConflictBanner,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import { fillControlledInput } from '@open-mercato/core/modules/core/__integration__/helpers/ui'

/**
 * TC-LOCK-OSS-019 (browser UI) — manual case CAT-01.
 *
 * Browser-driven proof that a stale edit on the catalog product edit surface
 * surfaces the unified "Record changed" conflict bar
 * (`data-testid="record-conflict-banner"`) instead of silently overwriting, and
 * that a clean single-tab save does NOT raise a false-positive bar.
 *
 * Pattern: load the edit page (the CrudForm captures `updated_at` via
 * `optimisticLockUpdatedAt`) → advance `updated_at` out-of-band via a
 * header-less API PUT (additive path, always succeeds) → edit + save in the
 * browser so the now-stale `x-om-ext-optimistic-lock-expected-updated-at`
 * header triggers the 409 → conflict bar. See
 * `packages/core/src/modules/sales/__integration__/__concurrent_edit_pattern.md`.
 *
 * Route: `/backend/catalog/products/<id>` (the product detail/edit page is
 * `backend/catalog/products/[id]/page.tsx`). The product title is a raw
 * `Input` rendered inside a CrudForm group component (not wrapped in
 * `[data-crud-field-id]`), so the spec locates it by its create placeholder.
 * This custom-group form is submitted by clicking the "Save changes" footer
 * button (Control+Enter does not reach the CrudForm submit handler for
 * raw inputs nested inside group components) →
 * `updateCrud('catalog/products', ...)`.
 */

const PRODUCTS_API_BASE = '/api/catalog/products'
const TITLE_PLACEHOLDER = /summer sneaker/i

test.describe('TC-LOCK-OSS-019: catalog product edit conflict bar (CAT-01)', () => {
  test('stale product edit shows the conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let productId: string | null = null
    try {
      productId = await createProductFixture(page.request, token, {
        title: `QA Lock 019 ${stamp}`,
        sku: `QA-LOCK-019-${stamp}`,
      })

      await login(page, 'admin')
      await page.goto(`/backend/catalog/products/${productId}`)

      // Form is loaded → its optimistic-lock token is captured at load time.
      const titleInput = page.getByPlaceholder(TITLE_PLACEHOLDER).first()
      await expect(titleInput).toBeVisible({ timeout: 15_000 })

      // Advance updated_at out-of-band → the browser form now holds a stale token.
      await bumpRecordViaApi(page.request, token, PRODUCTS_API_BASE, {
        id: productId,
        title: `QA Lock 019 bumped ${stamp}`,
      })

      // Edit + save in the browser → stale header → 409 → conflict bar.
      await fillControlledInput(titleInput, `QA Lock 019 stale ${stamp}`)
      await page.getByRole('button', { name: /^save changes$/i }).first().click()

      await expectConflictBanner(page)
    } finally {
      await deleteCatalogProductIfExists(page.request, token, productId)
    }
  })

  test('clean single-tab product save does not raise a false-positive conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let productId: string | null = null
    try {
      productId = await createProductFixture(page.request, token, {
        title: `QA Lock 019b ${stamp}`,
        sku: `QA-LOCK-019B-${stamp}`,
      })

      await login(page, 'admin')
      await page.goto(`/backend/catalog/products/${productId}`)

      const titleInput = page.getByPlaceholder(TITLE_PLACEHOLDER).first()
      await expect(titleInput).toBeVisible({ timeout: 15_000 })

      const putPromise = page.waitForResponse(
        (r) => r.request().method() === 'PUT' && r.url().includes(PRODUCTS_API_BASE),
        { timeout: 15_000 },
      )
      await fillControlledInput(titleInput, `QA Lock 019b saved ${stamp}`)
      await page.getByRole('button', { name: /^save changes$/i }).first().click()
      const settled = await putPromise
      expect(settled.status(), 'clean save should not 409').toBeLessThan(400)
      await expectNoConflictBanner(page)
    } finally {
      await deleteCatalogProductIfExists(page.request, token, productId)
    }
  })
})
