import { test, expect, type Page, type Locator } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createCompanyFixture,
  deleteEntityByBody,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import {
  bumpRecordViaApi,
  expectConflictBanner,
  expectNoConflictBanner,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import {
  fillControlledInput,
  waitForApiMutation,
} from '@open-mercato/core/modules/core/__integration__/helpers/ui'

/**
 * TC-LOCK-OSS-014 (browser UI) — manual cases CRM-01 / CRM-02 / CRM-03.
 *
 * Browser-driven proof that a stale edit AND a stale delete on the CRM v2
 * company detail page surface the unified "Record changed" conflict bar
 * (`data-testid="record-conflict-banner"`) instead of silently overwriting or
 * deleting, and that a clean single-tab save does NOT raise a false-positive
 * bar.
 *
 * The companies-v2 page (`/backend/customers/companies-v2/<id>`) is a CUSTOM
 * detail page: it GETs `/api/customers/companies/<id>` (which exposes
 * `company.updatedAt`) and embeds the company `CrudForm` with
 * `optimisticLockUpdatedAt={data.company.updatedAt}`. The form has NO visible
 * footer (`hideFooterActions`); SAVE is the page-header "Save" button (its
 * `onSave` handler calls `form.requestSubmit()`), and DELETE is the header
 * delete action that opens a confirm dialog. Both writes go through
 * `PUT`/`DELETE /api/customers/companies` (a `makeCrudRoute`) with the stale
 * optimistic-lock header → 409 → conflict bar.
 *
 * Pattern (per `optimisticLockUi.ts`): load the edit page (the form captures
 * `updated_at` at load) → advance `updated_at` out-of-band via a header-less
 * API PUT → edit/save (or delete) in the browser so the now-stale
 * `x-om-ext-optimistic-lock-expected-updated-at` header triggers the 409.
 */

const COMPANIES_API_BASE = '/api/customers/companies'

/**
 * The companies-v2 form lives in a `CollapsibleZoneLayout`. On a constrained
 * container the form renders as a collapsed icon rail (Identity / Contact / …)
 * and its inputs are not in the DOM until the user activates a section. Click
 * the "Identity" section so the form expands and the `displayName` input
 * becomes visible; this is a no-op when the form is already laid out
 * side-by-side. Returns the visible display-name input.
 */
async function revealDisplayNameInput(page: Page): Promise<Locator> {
  const nameInput = page.locator('[data-crud-field-id="displayName"] input').first()
  if (!(await nameInput.isVisible().catch(() => false))) {
    const identitySection = page.getByRole('button', { name: /^identity$/i }).first()
    await expect(identitySection).toBeVisible({ timeout: 15_000 })
    await identitySection.click()
  }
  await expect(nameInput).toBeVisible({ timeout: 15_000 })
  // Wait until the embedded CrudForm has hydrated its loaded value before any edit.
  // Editing while the field is still empty (form mounted but initialValues not yet
  // applied) would make the typed value the dirty baseline, so the form never
  // registers dirty and the header Save stays disabled — the load-race behind this
  // test's CI flakiness. A created company always has a non-empty display name.
  await expect(nameInput).not.toHaveValue('', { timeout: 15_000 })
  return nameInput
}

test.describe('TC-LOCK-OSS-014: CRM v2 company edit + delete optimistic-lock conflict bar', () => {
  test('CRM-01 stale company edit shows the conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let companyId: string | null = null
    try {
      companyId = await createCompanyFixture(page.request, token, `QA Lock 014 ${stamp}`)

      await login(page, 'admin')
      await page.goto(`/backend/customers/companies-v2/${companyId}`)

      // Form is loaded; its optimistic-lock token is captured at load time.
      const nameInput = await revealDisplayNameInput(page)

      // Advance updated_at out-of-band → the browser form now holds a stale token.
      await bumpRecordViaApi(page.request, token, COMPANIES_API_BASE, {
        id: companyId,
        displayName: `QA Lock 014 bumped ${stamp}`,
      })

      // Edit + save in the browser via the header "Save" button → stale header → 409.
      await fillControlledInput(nameInput, `QA Lock 014 stale ${stamp}`)
      await page.getByRole('button', { name: /save/i }).first().click()

      await expectConflictBanner(page)
    } finally {
      await deleteEntityByBody(page.request, token, COMPANIES_API_BASE, companyId)
    }
  })

  test('CRM-02 clean single-tab company save does not raise a false-positive conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let companyId: string | null = null
    try {
      companyId = await createCompanyFixture(page.request, token, `QA Lock 014b ${stamp}`)

      await login(page, 'admin')
      await page.goto(`/backend/customers/companies-v2/${companyId}`)

      const nameInput = await revealDisplayNameInput(page)

      await fillControlledInput(nameInput, `QA Lock 014b saved ${stamp}`)
      const form = nameInput.locator('xpath=ancestor::form[1]')
      await expect(form).toHaveCount(1)

      const settled = await waitForApiMutation(
        page,
        COMPANIES_API_BASE,
        () =>
          form.evaluate((node) => {
            if (!(node instanceof HTMLFormElement)) {
              throw new Error('displayName input is not inside a form')
            }
            node.requestSubmit()
          }),
        'PUT',
        15_000,
      )
      expect(settled.status(), 'clean save should not 409').toBeLessThan(400)
      await expectNoConflictBanner(page)
    } finally {
      await deleteEntityByBody(page.request, token, COMPANIES_API_BASE, companyId)
    }
  })

  test('CRM-03 stale company delete shows the conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let companyId: string | null = null
    try {
      companyId = await createCompanyFixture(page.request, token, `QA Lock 014 del ${stamp}`)

      await login(page, 'admin')
      await page.goto(`/backend/customers/companies-v2/${companyId}`)

      // Wait for the form so its optimistic-lock token is captured at load time.
      await revealDisplayNameInput(page)

      // Advance updated_at out-of-band → the loaded page now holds a stale token.
      await bumpRecordViaApi(page.request, token, COMPANIES_API_BASE, {
        id: companyId,
        displayName: `QA Lock 014 del bumped ${stamp}`,
      })

      // Trigger the delete from the header → confirm dialog → stale DELETE header → 409.
      await page
        .getByRole('button', { name: /delete company/i })
        .first()
        .click()
      const confirmDialog = page.getByRole('alertdialog')
      await expect(confirmDialog).toBeVisible({ timeout: 10_000 })
      await confirmDialog.getByRole('button', { name: /delete company/i }).click()

      await expectConflictBanner(page)
    } finally {
      await deleteEntityByBody(page.request, token, COMPANIES_API_BASE, companyId)
    }
  })
})
