import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { CONFLICT_BANNER_TESTID } from '@open-mercato/core/helpers/integration/optimisticLockUi'

/**
 * TC-LOCK-OSS-049 (browser UI) — issue #8289.
 *
 * A stale save from inside a modal dialog must surface the "Record changed"
 * conflict bar INSIDE the dialog, where it is visible and clickable. Before the
 * fix the bar rendered inline in `AppShell`, under the dialog overlay: blurred,
 * and `elementFromPoint` on its Refresh button hit the overlay.
 *
 * Surface: the customers activity-type editor (`/backend/config/customers`),
 * an embedded `CrudForm` inside a `Dialog` that stays open on a 409. The form
 * captures the entry's `updatedAt` on open; an out-of-band header-less PATCH
 * then makes that version stale so the browser save returns 409.
 */

const DICTIONARY_PATH = '/api/customers/dictionaries/activity-types'
const CATALOG_PATH = '/api/customers/activity-types'
const SETTINGS_PATH = '/backend/config/customers#customer-dictionary-activity-types'

type CatalogItem = { key: string; behavior: Record<string, unknown> }

test.describe('TC-LOCK-OSS-049: conflict bar is reachable while a dialog is open', () => {
  test('stale save in a dialog renders an actionable conflict bar inside the dialog', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const key = `qa_lock_049_${stamp}`
    const label = `QA Lock 049 ${stamp}`
    let entryId: string | null = null
    try {
      const catalogResponse = await apiRequest(request, 'GET', CATALOG_PATH, { token })
      expect(catalogResponse.status()).toBe(200)
      const catalog = (await catalogResponse.json()) as { items: CatalogItem[] }
      const meeting = catalog.items.find((item) => item.key === 'meeting')
      expect(meeting, 'built-in meeting activity type should exist').toBeTruthy()
      const behavior = { ...meeting!.behavior, order: 9000, selectable: true }

      const created = await apiRequest(request, 'POST', DICTIONARY_PATH, {
        token,
        data: { value: key, label, behavior },
      })
      expect(created.status(), await created.text()).toBe(201)
      entryId = ((await created.json()) as { id?: string }).id ?? null
      expect(entryId).toBeTruthy()

      await login(page, 'admin')
      await page.goto(SETTINGS_PATH)

      const row = page.getByRole('row').filter({ hasText: label }).first()
      await expect(row).toBeVisible({ timeout: 30_000 })
      await row.getByRole('button', { name: /open actions/i }).click()
      await page.getByRole('menuitem', { name: /configure/i }).click()

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible({ timeout: 15_000 })
      const labelInput = dialog.locator('[data-crud-field-id="label"] input').first()
      await expect(labelInput).toHaveValue(label, { timeout: 15_000 })

      const bumped = await apiRequest(request, 'PATCH', `${DICTIONARY_PATH}/${entryId}`, {
        token,
        data: { label: `${label} bumped` },
      })
      expect(bumped.status(), await bumped.text()).toBe(200)

      const staleLabel = `${label} stale`
      await labelInput.fill(staleLabel)
      const saveButton = dialog.getByRole('button', { name: /^save$/i })
      await saveButton.click()

      const banner = dialog.getByTestId(CONFLICT_BANNER_TESTID)
      await expect(banner).toBeVisible({ timeout: 15_000 })
      await expect(banner).toHaveAttribute('data-placement', 'modal')
      await expect(dialog).toBeVisible()

      await banner.getByRole('button', { name: /dismiss/i }).click()
      await expect(page.getByTestId(CONFLICT_BANNER_TESTID)).toHaveCount(0)
      await expect(dialog, 'dismissing the conflict must not close the dialog').toBeVisible()
      await expect(labelInput, 'the attempted edit must survive dismissing the conflict').toHaveValue(staleLabel)

      await saveButton.click()
      await expect(banner).toBeVisible({ timeout: 15_000 })

      const refresh = banner.getByRole('button', { name: /refresh/i })
      const refreshIsTopmost = await refresh.evaluate((button) => {
        const rect = button.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        return hit !== null && button.contains(hit)
      })
      expect(refreshIsTopmost, 'Refresh must be the element under the pointer, not the dialog overlay').toBe(true)

      await refresh.click()
      await expect(page.getByTestId(CONFLICT_BANNER_TESTID)).toHaveCount(0, { timeout: 15_000 })
    } finally {
      if (entryId) {
        await apiRequest(request, 'DELETE', `${DICTIONARY_PATH}/${entryId}`, { token }).catch(() => {})
      }
    }
  })
})
