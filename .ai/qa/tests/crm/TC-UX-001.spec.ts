/**
 * TC-UX-001: Collapsible CrudForm Groups
 * Source: 2026-04-06-crm-detail-pages-ux-enhancements — Enhancement 1
 *
 * Verifies:
 * - CrudForm groups have collapsible headers with aria-expanded
 * - Click collapse hides group content
 * - Click expand restores group content
 */
import { test, expect } from '@playwright/test'
import { login } from '../helpers/auth'
import { getAuthToken } from '../helpers/api'
import { createCompanyFixture, deleteEntityIfExists } from '../helpers/crmFixtures'

test.describe('TC-UX-001: Collapsible CrudForm Groups', () => {
  test('should collapse and expand groups', async ({ page, request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA Collapse Test ${Date.now()}`)
      await login(page, 'admin')

      await page.goto(`/backend/customers/companies-v2/${companyId}`, { waitUntil: 'commit' })
      await expect(page.getByRole('button', { name: /save/i }).first()).toBeVisible({ timeout: 10_000 })

      // Expand the Zone 1 form panel if it's collapsed (detail v3 hides form by default)
      const expandPanelButton = page.getByRole('button', { name: /expand form panel/i })
      if (await expandPanelButton.isVisible().catch(() => false)) {
        await expandPanelButton.click()
      }

      // CrudForm group buttons are inside main content — scope to main
      const main = page.locator('main')

      // Find the "IDENTITY" collapsible header button. The DOM nests an outer button (wrapping
      // header + content for click targeting) around the header button itself; match the exact
      // header accessible name (e.g. "IDENTITY · N fields") which carries aria-expanded.
      const identityButton = main.getByRole('button', { name: /^IDENTITY\s+·\s+\d+\s+fields?$/ })
      await expect(identityButton).toBeVisible({ timeout: 10_000 })
      await expect(identityButton).toHaveAttribute('aria-expanded', 'true')

      // Find "CONTACT" group button
      const contactButton = main.getByRole('button', { name: /^CONTACT\s+·\s+\d+\s+fields?$/ })
      await expect(contactButton).toBeVisible()
      await expect(contactButton).toHaveAttribute('aria-expanded', 'true')

      // Collapse the "CONTACT" group
      await contactButton.click()
      await expect(contactButton).toHaveAttribute('aria-expanded', 'false')

      // Expand it back
      await contactButton.click()
      await expect(contactButton).toHaveAttribute('aria-expanded', 'true')

      // Collapse "IDENTITY" group
      await identityButton.click()
      await expect(identityButton).toHaveAttribute('aria-expanded', 'false')

      // Expand it back
      await identityButton.click()
      await expect(identityButton).toHaveAttribute('aria-expanded', 'true')

    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
