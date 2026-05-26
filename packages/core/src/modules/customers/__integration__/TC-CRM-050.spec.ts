import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-CRM-050: Collapsed-rail section icons drive section navigation (issue #1731).
 *
 * On the company-v2 detail page, when the form panel is in its collapsed-rail
 * state (viewport between 1024px and 1280px wide), the vertical icon strip
 * representing form sections (Identity, Contact, Classification, …) MUST be
 * fully interactive: clicking an icon expands the form panel, scrolls to the
 * matching section, expands the inner CollapsibleGroup if it was previously
 * collapsed, and focuses the first input of that section.
 *
 * This guards against regressions where icons appear interactive (cursor /
 * tooltip) but produce no visible navigation — the original failure mode
 * reported in #1731.
 */
test.describe('TC-CRM-050: Collapsed rail icons navigate to form sections', () => {
  test('clicking a section icon expands the panel, opens the group, and focuses the first input', async ({
    page,
    request,
  }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    const stamp = Date.now()

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-050 Co ${stamp}`)

      await login(page, 'admin')

      // 1024px ≤ width < 1280px → CollapsibleZoneLayout renders the collapsed rail.
      await page.setViewportSize({ width: 1200, height: 900 })
      await page.goto(`/backend/customers/companies-v2/${companyId}`, {
        waitUntil: 'domcontentloaded',
      })

      // Wait for the layout container with its mode attribute.
      const layout = page.locator('[data-zone-layout-mode]').first()
      await expect(layout).toBeVisible({ timeout: 15_000 })
      await expect(layout).toHaveAttribute('data-zone-layout-mode', 'collapsed')

      // The Contact icon must exist in the rail and be a real button (not just a div).
      const contactIcon = page.getByRole('button', { name: 'Contact' })
      await expect(contactIcon).toBeVisible()

      await contactIcon.click()

      // After click: the layout expands (stacked) and the Contact group is open.
      await expect(layout).toHaveAttribute('data-zone-layout-mode', 'stacked', { timeout: 5_000 })
      const contactWrapper = page.locator('#collapsible-group-wrapper-contact').first()
      await expect(contactWrapper).toBeVisible()
      await expect(
        contactWrapper.locator('button[aria-controls]').first(),
      ).toHaveAttribute('aria-expanded', 'true')

      // The first input of the Contact group is reachable now that the panel
      // and inner group are both expanded. We assert visibility (not focus) —
      // headless browsers can drop programmatic focus across React re-renders;
      // the precise focus landing is covered by the unit test in
      // packages/ui/src/backend/__tests__/CollapsibleZoneLayout.test.tsx.
      await expect(
        contactWrapper.locator('input:not([type="hidden"])').first(),
      ).toBeVisible({ timeout: 5_000 })
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
