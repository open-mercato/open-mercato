import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createCurrencyFixture,
  deleteCurrenciesEntityIfExists,
  generateUniqueCurrencyCode,
} from '@open-mercato/core/modules/core/__integration__/helpers/currenciesFixtures'
import {
  bumpRecordViaApi,
  expectConflictBanner,
  expectNoConflictBanner,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import { fillControlledInput } from '@open-mercato/core/modules/core/__integration__/helpers/ui'

/**
 * TC-LOCK-OSS-040 (browser UI) — manual cases CUR-01 / CUR-02.
 *
 * Browser-driven proof that a stale edit on the currency CrudForm surfaces the
 * unified "Record changed" conflict bar instead of silently overwriting, and
 * that a clean single-tab save does NOT raise a false-positive bar.
 *
 * Pattern: load the edit page (the form captures `updated_at`) → advance
 * `updated_at` out-of-band via a header-less API PUT → edit + save in the
 * browser (the now-stale header → 409 → conflict bar). See
 * `packages/core/src/modules/sales/__integration__/__concurrent_edit_pattern.md`.
 */

const randomCode = generateUniqueCurrencyCode

test.describe('TC-LOCK-OSS-040: currency edit optimistic-lock conflict bar', () => {
  test('stale currency edit shows the conflict bar; clean edit does not', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    const code = randomCode()
    let currencyId: string | null = null
    try {
      currencyId = await createCurrencyFixture(page.request, token, {
        code,
        name: `QA Lock 040 ${stamp}`,
      })

      await login(page, 'admin')
      await page.goto(`/backend/currencies/${currencyId}`)

      // Form is loaded (its optimistic-lock token is now captured at load time).
      const nameInput = page.locator('[data-crud-field-id="name"] input').first()
      await expect(nameInput).toBeVisible({ timeout: 10_000 })

      // Advance updated_at out-of-band → the browser form now holds a stale token.
      await bumpRecordViaApi(page.request, token, '/api/currencies/currencies', {
        id: currencyId,
        code,
        name: `QA Lock 040 bumped ${stamp}`,
      })

      // Edit + save in the browser → stale header → 409 → conflict bar.
      await fillControlledInput(nameInput, `QA Lock 040 stale ${stamp}`)
      await nameInput.press('Control+Enter')

      await expectConflictBanner(page)
    } finally {
      await deleteCurrenciesEntityIfExists(page.request, token, '/api/currencies/currencies', currencyId)
    }
  })

  test('clean single-tab currency save does not raise a false-positive conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    const code = randomCode()
    let currencyId: string | null = null
    try {
      currencyId = await createCurrencyFixture(page.request, token, {
        code,
        name: `QA Lock 040b ${stamp}`,
      })

      await login(page, 'admin')
      await page.goto(`/backend/currencies/${currencyId}`)

      const nameInput = page.locator('[data-crud-field-id="name"] input').first()
      await expect(nameInput).toBeVisible({ timeout: 10_000 })

      const putPromise = page.waitForResponse(
        (r) => r.request().method() === 'PUT' && r.url().includes('/api/currencies/currencies'),
        { timeout: 10_000 },
      )
      await fillControlledInput(nameInput, `QA Lock 040b saved ${stamp}`)
      await nameInput.press('Control+Enter')
      const settled = await putPromise
      expect(settled.status(), 'clean save should not 409').toBeLessThan(400)
      await expectNoConflictBanner(page)
    } finally {
      await deleteCurrenciesEntityIfExists(page.request, token, '/api/currencies/currencies', currencyId)
    }
  })
})
