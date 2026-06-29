import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import {
  bumpRecordViaApi,
  readUpdatedAt,
  expectConflictBanner,
  expectConflictBody,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import { fillControlledInput } from '@open-mercato/core/modules/core/__integration__/helpers/ui'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * TC-LOCK-OSS-020 — manual cases CAT-02 / CAT-03 (catalog product variant).
 *
 * Edit route: /backend/catalog/products/<productId>/variants/<variantId>
 * (renders a `CrudForm` whose submit goes through `updateCrud('catalog/variants', …)`
 * and whose delete callback goes through `deleteCrud('catalog/variants', …)` —
 * both carry the optimistic-lock header). API base: /api/catalog/variants
 * (`makeCrudRoute` with `indexer.entityType = catalog_product_variant`).
 *
 * Pattern (see ../../sales/__integration__/__concurrent_edit_pattern.md):
 * load the edit page (the CrudForm captures the variant `updated_at` from
 * `GET /api/catalog/variants?id=…`) → advance `updated_at` out-of-band via a
 * header-less API PUT (additive path, always succeeds) → edit/save in the
 * browser so the now-stale `x-om-ext-optimistic-lock-expected-updated-at`
 * header triggers the 409 → conflict bar (`data-testid="record-conflict-banner"`).
 *
 * Surface notes (confirmed against the live env + page source):
 * - CAT-02 (stale edit, browser): the variant `name` field lives inside the
 *   custom `VariantBasicsSection` group (a plain `<Input>`, NOT a
 *   `data-crud-field-id`-wrapped field), so it is targeted by its unique
 *   placeholder. The custom-component group does not bubble `Control+Enter` to
 *   the CrudForm submit handler, so the save is triggered by clicking the
 *   footer "Save changes" button instead.
 * - CAT-03 (stale delete): the variant edit page renders NO browser Delete
 *   button — `CrudForm` only shows Delete when `values.id` is set, but the
 *   variant form keeps `variantId` out of its form values (so `isNewRecord`
 *   is true and `showDelete` is false). The variant `DELETE /api/catalog/variants`
 *   route DOES enforce the optimistic lock, so this surface is covered with the
 *   sanctioned API-level fallback (stale lock header → 409 conflict body).
 */

const VARIANTS_API_BASE = '/api/catalog/variants'
const NAME_PLACEHOLDER = /Blue \/ Small/i
const BASE_URL = process.env.BASE_URL?.trim() || ''
const resolveUrl = (path: string): string => (BASE_URL ? `${BASE_URL}${path}` : path)

test.describe('TC-LOCK-OSS-020: catalog variant edit + stale delete conflict', () => {
  test('CAT-02 stale variant edit shows the conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let productId: string | null = null
    try {
      productId = await createProductFixture(page.request, token, {
        title: `QA Lock 020 ${stamp}`,
        sku: `qa-lock-020-${stamp}`,
      })
      const variantId = await createVariantFixture(page.request, token, {
        productId,
        name: `QA Lock 020 variant ${stamp}`,
        sku: `qa-lock-020-var-${stamp}`,
      })

      await login(page, 'admin')
      await page.goto(`/backend/catalog/products/${productId}/variants/${variantId}`)

      // Form is loaded (its optimistic-lock token is captured at load time).
      const nameInput = page.getByPlaceholder(NAME_PLACEHOLDER).first()
      await expect(nameInput).toBeVisible({ timeout: 20_000 })

      // Advance updated_at out-of-band → the browser form now holds a stale token.
      await bumpRecordViaApi(page.request, token, VARIANTS_API_BASE, {
        id: variantId,
        name: `QA Lock 020 bumped ${stamp}`,
      })

      // Edit + save in the browser → stale header → 409 → conflict bar.
      await fillControlledInput(nameInput, `QA Lock 020 stale ${stamp}`)
      await page.getByRole('button', { name: /save changes/i }).first().click()

      await expectConflictBanner(page)
    } finally {
      await deleteCatalogProductIfExists(page.request, token, productId)
    }
  })

  test('CAT-03 stale variant delete is refused (API-level: route enforces the lock)', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let productId: string | null = null
    try {
      productId = await createProductFixture(page.request, token, {
        title: `QA Lock 020 del ${stamp}`,
        sku: `qa-lock-020-del-${stamp}`,
      })
      const variantId = await createVariantFixture(page.request, token, {
        productId,
        name: `QA Lock 020 del variant ${stamp}`,
        sku: `qa-lock-020-delvar-${stamp}`,
      })

      // Capture the pre-edit version (t0), then advance updated_at out-of-band.
      const staleLock = await readUpdatedAt(page.request, token, VARIANTS_API_BASE, variantId)
      await bumpRecordViaApi(page.request, token, VARIANTS_API_BASE, {
        id: variantId,
        name: `QA Lock 020 del bumped ${stamp}`,
      })

      // Stale DELETE → the lock guard refuses with the structured 409 body.
      const response = await page.request.fetch(
        resolveUrl(`${VARIANTS_API_BASE}?id=${encodeURIComponent(variantId)}`),
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            [OPTIMISTIC_LOCK_HEADER_NAME]: staleLock,
          },
        },
      )
      await expectConflictBody(response)
    } finally {
      await deleteCatalogProductIfExists(page.request, token, productId)
    }
  })
})
