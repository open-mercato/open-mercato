import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createDealFixture,
  deleteEntityByBody,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import {
  bumpRecordViaApi,
  expectConflictBanner,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import { fillControlledInput } from '@open-mercato/core/modules/core/__integration__/helpers/ui'
import type { Page } from '@playwright/test'

/**
 * TC-LOCK-OSS-016 (browser UI) — manual cases CRM-06 / CRM-07 for the
 * customers deal detail page.
 *
 * Sibling of TC-LOCK-OSS-014 (companies-v2) and -015 (people-v2), but for the
 * deal detail surface. It proves that a stale edit AND a stale delete on the
 * deal detail page raise the unified "Record changed" conflict bar
 * (`data-testid="record-conflict-banner"`) instead of silently overwriting or
 * deleting.
 *
 * `/backend/customers/deals/<id>` is a CUSTOM detail page (not a plain CrudForm
 * edit route). Its handlers live in `useDealFormHandlers`:
 *   - it embeds the deal `CrudForm` inside a `CollapsibleZoneLayout` (zone 1);
 *     the form captures `updated_at` at load via `initialValues={...data.deal}`
 *     and submits through `updateCrud('customers/deals', …)` wrapped in
 *     `withScopedApiRequestHeaders(buildOptimisticLockHeader(data.deal.updatedAt), …)`.
 *   - submit is driven by the header "Save" button (the form is
 *     `hideFooterActions`); Save is `disabled` until the form is dirty.
 *   - delete is driven by the header trash button (aria-label "Delete") →
 *     `confirm()` alertdialog (confirm text "Delete") → `deleteCrud('customers/deals', …)`
 *     wrapped in `buildOptimisticLockHeader(data.deal.updatedAt)`.
 *
 * Both writes go through `PUT`/`DELETE /api/customers/deals` (a `makeCrudRoute`).
 *
 * Pattern (see optimisticLockUi): load the detail page so the page/form captures
 * `updated_at` → advance `updated_at` out-of-band via a header-less API PUT
 * (additive path, always succeeds) → edit/save (or delete) in the browser so the
 * now-stale `x-om-ext-optimistic-lock-expected-updated-at` header triggers the
 * 409 → conflict bar.
 */

const DEALS_API_BASE = '/api/customers/deals'

/**
 * The deal detail page renders the editable `CrudForm` inside a
 * `CollapsibleZoneLayout`. At the default 1280px viewport the form panel
 * ("zone 1", `zone1DefaultWidth="540px"`) starts collapsed into an icon rail, so
 * the CrudForm mounts hidden until the panel is expanded. Clicking
 * "Expand form panel" re-renders the form as a visible (stacked) copy whose
 * field groups are open, mounting the `title` field. At narrow widths the panel
 * is already expanded so the field is reachable directly. Returns the visible
 * `title` text input (a real `data-crud-field-id` CrudForm field).
 */
async function openDealFormTitleInput(page: Page) {
  const titleInput = page.locator('[data-crud-field-id="title"] input:visible').first()
  if (!(await titleInput.isVisible().catch(() => false))) {
    const expandPanel = page.getByRole('button', { name: /expand form panel/i })
    await expect(expandPanel).toBeVisible({ timeout: 15_000 })
    await expandPanel.click()
  }
  await expect(titleInput).toBeVisible({ timeout: 15_000 })
  return titleInput
}

test.describe('TC-LOCK-OSS-016: customers deal edit + stale delete conflict bar', () => {
  test.setTimeout(120_000)

  test('CRM-06 stale deal edit shows the conflict bar', async ({ page }) => {
    test.slow()

    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let dealId: string | null = null
    try {
      dealId = await createDealFixture(page.request, token, { title: `QA Lock 016 ${stamp}` })

      await login(page, 'admin')
      await page.goto(`/backend/customers/deals/${dealId}`)

      // Form is loaded → its optimistic-lock token is captured at load time.
      const titleInput = await openDealFormTitleInput(page)

      // Advance updated_at out-of-band → the browser form now holds a stale token.
      await bumpRecordViaApi(page.request, token, DEALS_API_BASE, {
        id: dealId,
        title: `QA Lock 016 bumped ${stamp}`,
      })

      // Edit (makes the form dirty → enables Save) + click the header Save →
      // stale header → 409 → bar.
      await fillControlledInput(titleInput, `QA Lock 016 stale ${stamp}`)
      const saveButton = page.getByRole('button', { name: /^save$/i }).first()
      await expect(saveButton).toBeEnabled({ timeout: 10_000 })
      const staleSaveResponse = page.waitForResponse((response) => {
        const url = new URL(response.url())
        return response.request().method() === 'PUT' && url.pathname === DEALS_API_BASE
      }, { timeout: 30_000 })
      await saveButton.click()
      const response = await staleSaveResponse
      expect(response.status(), `stale PUT ${DEALS_API_BASE} should conflict`).toBe(409)

      await expectConflictBanner(page)
    } finally {
      await deleteEntityByBody(page.request, token, DEALS_API_BASE, dealId)
    }
  })

  test('CRM-07 stale deal delete shows the conflict bar', async ({ page }) => {
    test.slow()

    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let dealId: string | null = null
    try {
      dealId = await createDealFixture(page.request, token, { title: `QA Lock 016 del ${stamp}` })

      await login(page, 'admin')
      await page.goto(`/backend/customers/deals/${dealId}`)

      // Wait for the header so the page (and its optimistic-lock token captured at
      // page load via `data.deal.updatedAt`) is loaded. The delete path is armed
      // independently of the collapsible form panel.
      const deleteButton = page.getByRole('button', { name: /^delete$/i }).first()
      await expect(deleteButton).toBeVisible({ timeout: 15_000 })

      // Advance updated_at out-of-band → the loaded page now holds a stale token.
      await bumpRecordViaApi(page.request, token, DEALS_API_BASE, {
        id: dealId,
        title: `QA Lock 016 del bumped ${stamp}`,
      })

      // Trigger the delete from the header trash button (aria-label "Delete") →
      // confirm alertdialog → stale DELETE header → 409.
      await deleteButton.click()
      const confirmDialog = page.getByRole('alertdialog')
      await expect(confirmDialog).toBeVisible({ timeout: 10_000 })
      await confirmDialog.getByRole('button', { name: /^delete$/i }).click()

      await expectConflictBanner(page)
    } finally {
      await deleteEntityByBody(page.request, token, DEALS_API_BASE, dealId)
    }
  })
})
