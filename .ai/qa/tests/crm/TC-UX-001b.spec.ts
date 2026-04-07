/**
 * TC-UX-001b: Collapsible Zone 1 Panel
 * Source: SPEC-048 — Enhancement 1b
 *
 * Verifies:
 * - Collapse arrow visible on desktop
 * - Click collapse: Zone 1 hides, expand button appears
 * - Click expand: Zone 1 restores
 */
import { test, expect } from '@playwright/test'
import { login } from '../helpers/auth'
import { getAuthToken } from '../helpers/api'
import { createCompanyFixture, deleteEntityIfExists } from '../helpers/crmFixtures'

test.describe('TC-UX-001b: Collapsible Zone 1 Panel', () => {
  test('should collapse and expand Zone 1', async ({ page, request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA Zone Collapse ${Date.now()}`)
      await login(page, 'admin')

      // Set desktop viewport for side-by-side layout
      await page.setViewportSize({ width: 1280, height: 900 })
      await page.goto(`/backend/customers/companies-v2/${companyId}`, { waitUntil: 'commit' })
      await expect(page.getByRole('button', { name: /save/i }).first()).toBeVisible({ timeout: 10_000 })

      // Verify collapse button exists
      const collapseButton = page.getByRole('button', { name: /collapse form panel/i })
      await expect(collapseButton).toBeVisible()

      // Click collapse
      await collapseButton.click()

      // Verify expand button appears
      const expandButton = page.getByRole('button', { name: /expand form panel/i })
      await expect(expandButton).toBeVisible({ timeout: 5_000 })

      // The CrudForm Save button should no longer be visible (Zone 1 collapsed)
      await expect(page.getByRole('button', { name: /^save$/i }).first()).not.toBeVisible()

      // Expand back
      await expandButton.click()

      // Collapse button should be back
      await expect(page.getByRole('button', { name: /collapse form panel/i })).toBeVisible({ timeout: 5_000 })

      // Save button visible again
      await expect(page.getByRole('button', { name: /save/i }).first()).toBeVisible()

    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
