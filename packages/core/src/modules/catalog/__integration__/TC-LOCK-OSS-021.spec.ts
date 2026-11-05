import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createCategoryFixture,
  deleteCatalogCategoryIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import {
  bumpRecordViaApi,
  expectConflictBanner,
  expectNoConflictBanner,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import { fillControlledInput } from '@open-mercato/core/modules/core/__integration__/helpers/ui'

/**
 * TC-LOCK-OSS-021 (browser UI) — manual cases CAT-05 / CAT-06.
 *
 * Browser-driven proof that a stale edit AND a stale delete on the catalog
 * category CrudForm surface the unified "Record changed" conflict bar
 * (`data-testid="record-conflict-banner"`) instead of silently overwriting or
 * deleting, and that a clean single-tab save does NOT raise a false-positive
 * bar.
 *
 * Pattern: load the edit page (the form captures `updated_at` via
 * `optimisticLockUpdatedAt`) → advance `updated_at` out-of-band via a
 * header-less API PUT (additive path, always succeeds) → edit/save (or delete)
 * in the browser so the now-stale `x-om-ext-optimistic-lock-expected-updated-at`
 * header triggers the 409 → conflict bar. See
 * `packages/core/src/modules/sales/__integration__/__concurrent_edit_pattern.md`.
 *
 * The categories GET route only serves the paged "manage" view
 * (`view=manage&ids=<id>&status=all&page=1&pageSize=1`), so the form fetches
 * that URL directly and the spec reads `items[0].updatedAt` from it. The
 * header-less PUT bump still advances `updated_at` regardless of the read shape.
 */

const CATEGORIES_API_BASE = '/api/catalog/categories'

test.describe('TC-LOCK-OSS-021: catalog category edit + stale delete conflict bar', () => {
  test('stale category edit shows the conflict bar; clean edit does not', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let categoryId: string | null = null
    try {
      categoryId = await createCategoryFixture(page.request, token, {
        name: `QA Lock 021 ${stamp}`,
      })

      await login(page, 'admin')
      await page.goto(`/backend/catalog/categories/${categoryId}/edit`)

      // Form is loaded (its optimistic-lock token is now captured at load time).
      const nameInput = page.locator('[data-crud-field-id="name"] input').first()
      await expect(nameInput).toBeVisible({ timeout: 10_000 })

      // Advance updated_at out-of-band → the browser form now holds a stale token.
      await bumpRecordViaApi(page.request, token, CATEGORIES_API_BASE, {
        id: categoryId,
        name: `QA Lock 021 bumped ${stamp}`,
      })

      // Edit + save in the browser → stale header → 409 → conflict bar.
      await fillControlledInput(nameInput, `QA Lock 021 stale ${stamp}`)
      await nameInput.press('Control+Enter')

      await expectConflictBanner(page)
    } finally {
      await deleteCatalogCategoryIfExists(page.request, token, categoryId)
    }
  })

  test('stale category delete shows the conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let categoryId: string | null = null
    try {
      categoryId = await createCategoryFixture(page.request, token, {
        name: `QA Lock 021 del ${stamp}`,
      })

      await login(page, 'admin')
      await page.goto(`/backend/catalog/categories/${categoryId}/edit`)

      // Wait for the form so its optimistic-lock token is captured at load time.
      const nameInput = page.locator('[data-crud-field-id="name"] input').first()
      await expect(nameInput).toBeVisible({ timeout: 10_000 })

      // Advance updated_at out-of-band → the loaded form now holds a stale token.
      await bumpRecordViaApi(page.request, token, CATEGORIES_API_BASE, {
        id: categoryId,
        name: `QA Lock 021 del bumped ${stamp}`,
      })

      // Trigger the delete from the form → confirm dialog → stale DELETE header → 409.
      await page.getByRole('button', { name: /delete/i }).first().click()
      const confirmDialog = page.getByRole('alertdialog')
      await expect(confirmDialog).toBeVisible({ timeout: 10_000 })
      await confirmDialog.getByRole('button', { name: /confirm/i }).click()

      await expectConflictBanner(page)
    } finally {
      await deleteCatalogCategoryIfExists(page.request, token, categoryId)
    }
  })

  test('clean single-tab category save does not raise a false-positive conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let categoryId: string | null = null
    try {
      categoryId = await createCategoryFixture(page.request, token, {
        name: `QA Lock 021b ${stamp}`,
      })

      await login(page, 'admin')
      await page.goto(`/backend/catalog/categories/${categoryId}/edit`)

      const nameInput = page.locator('[data-crud-field-id="name"] input').first()
      await expect(nameInput).toBeVisible({ timeout: 10_000 })

      const putPromise = page.waitForResponse(
        (r) => r.request().method() === 'PUT' && r.url().includes(CATEGORIES_API_BASE),
        { timeout: 10_000 },
      )
      await fillControlledInput(nameInput, `QA Lock 021b saved ${stamp}`)
      await nameInput.press('Control+Enter')
      const settled = await putPromise
      expect(settled.status(), 'clean save should not 409').toBeLessThan(400)
      await expectNoConflictBanner(page)
    } finally {
      await deleteCatalogCategoryIfExists(page.request, token, categoryId)
    }
  })
})
