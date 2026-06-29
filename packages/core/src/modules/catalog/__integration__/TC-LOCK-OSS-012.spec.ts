import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'

/**
 * TC-LOCK-OSS-012 (browser UI): the product-variant detail page shows a
 * dedicated "not found" state — not an empty CrudForm with runtime errors —
 * when the variant no longer exists (e.g. it was deleted concurrently in
 * another tab). Round-4 QA for #2055 reported "Variant not found with an empty
 * form and console/runtime errors"; this proves the RecordNotFoundState early
 * return.
 */
test.describe('TC-LOCK-OSS-012: variant detail not-found state', () => {
  test('deleted/missing variant renders RecordNotFoundState with a back link, not an empty form', async ({ page }) => {
    let token: string | null = null
    let productId: string | null = null
    try {
      token = await getAuthToken(page.request, 'admin')
      const stamp = Date.now()
      productId = await createProductFixture(page.request, token, {
        title: `QA TC-LOCK-OSS-012 product ${stamp}`,
        sku: `qa-lock-012-${stamp}`,
      })

      await login(page, 'admin')

      // A syntactically valid but non-existent variant id under a real product.
      const missingVariantId = '00000000-0000-4000-8000-000000000000'
      const targetUrl = `/backend/catalog/products/${productId}/variants/${missingVariantId}`
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded' })
        if (!/\/login(?:\?|$)/.test(page.url())) break
        await login(page, 'admin')
      }

      // The dedicated not-found state is visible…
      await expect(page.getByText('Variant not found.', { exact: false })).toBeVisible({ timeout: 10_000 })
      // …with a recovery action back to the product's variants list…
      // (develop's RecordNotFoundState rollout renamed this label to
      // "Back to product variants" — match either wording.)
      await expect(page.getByRole('link', { name: /back to (product )?variants/i })).toBeVisible()
      // …and NO editable variant form (the empty-form regression).
      await expect(page.getByRole('button', { name: /save changes/i })).toHaveCount(0)
    } finally {
      if (productId && token) {
        await deleteCatalogProductIfExists(page.request, token, productId)
      }
    }
  })
})
