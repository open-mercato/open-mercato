import { test, expect, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  deleteEntityByBody,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui'
import { CONFLICT_BANNER_TESTID } from '@open-mercato/core/helpers/integration/optimisticLockUi'

/**
 * TC-UI-8792: a genuine two-user optimistic-lock conflict (#8792, follow-up
 * from #8412 / #8795).
 *
 * The existing `TC-LOCK-OSS-*` browser specs make the 409 deterministic by
 * loading the edit page in ONE tab, then advancing `updated_at` out-of-band
 * via a header-less API PUT (see `optimisticLockUi.ts`) — intentionally
 * "without two real tabs". That is a fine, documented way to test the 409
 * contract, but it never proves the banner survives a SECOND real logged-in
 * user's own UI save. This spec uses two separate browser contexts, each
 * logged in as a genuinely distinct seeded account (`admin` and
 * `superadmin` — not two tabs of the same session), both editing the same
 * company record on the CRM v2 detail page:
 *
 *  1. `admin` loads the edit page (captures the record's `updated_at`).
 *  2. `superadmin`, in its own context, loads the same page and saves a
 *     real change through the UI — a genuine second user's write, not an
 *     out-of-band API bump.
 *  3. `admin` edits and saves with its now-stale token → 409 → the conflict
 *     banner appears.
 *  4. The admin tab's edited value is still in the DOM while the banner is
 *     visible — the banner coexists with the page's content instead of
 *     tearing it down.
 *  5. Dismissing the banner (a pure client-side state clear, no reload)
 *     removes it while that same content remains untouched.
 */
const COMPANIES_API_BASE = '/api/customers/companies'

async function revealDisplayNameInput(page: Page) {
  const nameInput = page.locator('[data-crud-field-id="displayName"] input').first()
  if (!(await nameInput.isVisible().catch(() => false))) {
    const identitySection = page.getByRole('button', { name: /^identity$/i }).first()
    await expect(identitySection).toBeVisible({ timeout: 15_000 })
    await identitySection.click()
  }
  await expect(nameInput).toBeVisible({ timeout: 15_000 })
  await expect(nameInput).not.toHaveValue('', { timeout: 15_000 })
  return nameInput
}

test.describe('TC-UI-8792: two real distinct users and the record-lock conflict banner', () => {
  test('a second user real save triggers the banner; dismissing it retains the first user content', async ({ browser, request }) => {
    test.setTimeout(120_000)

    const stamp = Date.now()
    const token = await getAuthToken(request, 'admin')
    let companyId: string | null = null

    const adminContext = await browser.newContext()
    const superadminContext = await browser.newContext()
    const adminPage = await adminContext.newPage()
    const superadminPage = await superadminContext.newPage()

    try {
      companyId = await createCompanyFixture(request, token, `QA 8792 two-user ${stamp}`)

      await login(adminPage, 'admin')
      await adminPage.goto(`/backend/customers/companies-v2/${companyId}`)
      await revealDisplayNameInput(adminPage)

      // Second, genuinely distinct real user loads and saves the SAME record
      // through its own UI — not an out-of-band API bump.
      await login(superadminPage, 'superadmin')
      await superadminPage.goto(`/backend/customers/companies-v2/${companyId}`)
      const superadminNameInput = await revealDisplayNameInput(superadminPage)
      await fillControlledInput(superadminNameInput, `QA 8792 superadmin-save ${stamp}`)
      await superadminPage.getByRole('button', { name: /^save$/i }).first().click()
      await expect(
        superadminPage.getByTestId(CONFLICT_BANNER_TESTID),
        'the second user own save must be clean, not a false-positive conflict',
      ).toHaveCount(0)

      // First user's tab still holds the pre-superadmin-save token. Editing and
      // saving now must 409 against the second user's real write.
      const adminNameInput = adminPage.locator('[data-crud-field-id="displayName"] input').first()
      const marker = `QA 8792 admin-stale-marker ${stamp}`
      await fillControlledInput(adminNameInput, marker)
      await adminPage.getByRole('button', { name: /^save$/i }).first().click()

      const banner = adminPage.getByTestId(CONFLICT_BANNER_TESTID)
      await expect(banner, 'the stale save against a real second-user write should surface the conflict banner').toBeVisible({ timeout: 10_000 })

      // The banner must coexist with the page's content, not replace it: the
      // admin tab's own stale edit is still intact while the banner is shown.
      await expect(adminNameInput).toHaveValue(marker)

      // Dismiss is a pure client-side state clear (no reload/navigation) —
      // removing the banner must not disturb that same content either.
      await banner.getByRole('button', { name: /dismiss/i }).click()
      await expect(banner).toHaveCount(0)
      await expect(adminNameInput).toHaveValue(marker)
    } finally {
      await deleteEntityByBody(request, token, COMPANIES_API_BASE, companyId)
      await adminContext.close()
      await superadminContext.close()
    }
  })
})
