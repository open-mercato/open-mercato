/**
 * TC-UX-001b: Collapsible Zone 1 Panel
 * Source: SPEC-072-2026-04-06-crm-detail-pages-ux-enhancements — Enhancement 1b
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

      // Set wide desktop viewport — CollapsibleZoneLayout requires container width >= 1280
      // to render the side-by-side layout with a collapse button. The sidebar consumes ~240px,
      // so the page viewport must be wider than the threshold for the main region to exceed it.
      await page.setViewportSize({ width: 1680, height: 1000 })
      await page.goto(`/backend/customers/companies-v2/${companyId}`, { waitUntil: 'commit' })
      await expect(page.getByRole('button', { name: /save/i }).first()).toBeVisible({ timeout: 10_000 })

      // If the layout ended up collapsed anyway (constrained width, shown as "Expand form panel"),
      // expand it first so the collapse control becomes visible.
      const preExpandButton = page.getByRole('button', { name: /expand form panel/i })
      if (await preExpandButton.isVisible().catch(() => false)) {
        await preExpandButton.click()
      }

      // Verify collapse button exists
      const collapseButton = page.getByRole('button', { name: /collapse form panel/i })
      await expect(collapseButton).toBeVisible({ timeout: 5_000 })

      // Click collapse
      await collapseButton.click()

      // Verify expand button appears
      const expandButton = page.getByRole('button', { name: /expand form panel/i })
      await expect(expandButton).toBeVisible({ timeout: 5_000 })

      // When Zone 1 is collapsed, the CrudForm group headers should no longer be visible.
      // (Header-level Save button stays visible and disabled — it's not part of Zone 1.)
      const main = page.locator('main')
      await expect(main.getByRole('button', { name: /^IDENTITY(?:\s|·|$)/ })).not.toBeVisible()

      // Expand back
      await expandButton.click()

      // Collapse button should be back
      await expect(page.getByRole('button', { name: /collapse form panel/i })).toBeVisible({ timeout: 5_000 })

      // Zone 1 IDENTITY group header visible again
      await expect(main.getByRole('button', { name: /^IDENTITY(?:\s|·|$)/ }).first()).toBeVisible()

    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
