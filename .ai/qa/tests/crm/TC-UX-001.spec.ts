/**
 * TC-UX-001: Collapsible CrudForm Groups
 * Source: SPEC-048 — Enhancement 1
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

      // CrudForm group buttons are inside main content — scope to main
      const main = page.locator('main')

      // Find the "Details" collapsible group button
      const detailsButton = main.getByRole('button', { name: /^Details$/i })
      await expect(detailsButton).toBeVisible()
      await expect(detailsButton).toHaveAttribute('aria-expanded', 'true')

      // Find "Company profile" group button
      const profileButton = main.getByRole('button', { name: /company profile/i })
      await expect(profileButton).toBeVisible()
      await expect(profileButton).toHaveAttribute('aria-expanded', 'true')

      // Collapse the "Company profile" group
      await profileButton.click()
      await expect(profileButton).toHaveAttribute('aria-expanded', 'false')

      // Expand it back
      await profileButton.click()
      await expect(profileButton).toHaveAttribute('aria-expanded', 'true')

      // Collapse "Details" group
      await detailsButton.click()
      await expect(detailsButton).toHaveAttribute('aria-expanded', 'false')

      // Expand it back
      await detailsButton.click()
      await expect(detailsButton).toHaveAttribute('aria-expanded', 'true')

    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
