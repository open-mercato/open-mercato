import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { stampOf } from './helpers'
import { cleanupLeaseSetup, createLeaseSetup, type LeaseSetup } from './leaseFixtures'
import { watchHydration } from './hydrationWatch'

/**
 * TC-PM-019: New lease form
 * The form shows the calculated end date for *Term: N months*; ticking *Send as a proposal* reveals
 * *Proposal expires after N days* prefilled from Settings and the resulting respond-by date.
 */
test.describe('TC-PM-019: new lease form', () => {
  test('switches between a direct lease and a proposal', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: LeaseSetup | null = null
    try {
      setup = await createLeaseSetup(request, token, stamp)
      const watch = watchHydration(page)
      await login(page, 'admin')
      const response = await page.goto('/backend/property_management/leases/create')
      expect(response?.status() ?? 0, 'the New lease page is served').toBeLessThan(400)

      await expect(page.getByRole('heading', { name: /new lease/i }).first()).toBeVisible()
      const term = page.locator('[data-crud-field-id="termMonths"] input')
      const termSummary = page.locator('[data-crud-field-id="termSummary"]')
      await term.fill('12')
      await expect(termSummary).toContainText(/ends/i)
      const twelveMonths = await termSummary.innerText()
      await term.fill('6')
      await expect(termSummary, 'the end date follows the term').not.toHaveText(twelveMonths)
      await expect(termSummary).toContainText(/ends/i)

      const proposalField = page.locator('[data-crud-field-id="asProposal"]')
      const proposal = proposalField.getByRole('checkbox', { name: /send as a proposal/i })
      const expiry = page.locator('[data-crud-field-id="expiresInDays"]')
      await expect(proposal).toBeVisible()
      await expect(expiry).toHaveCount(0)
      await proposal.check()
      await expect(expiry.getByRole('spinbutton', { name: /expires after/i })).toHaveValue(String(setup.originalSettings?.proposalExpiryDays ?? 14))
      await expect(page.getByTestId('pm-lease-respond-by')).toContainText(/respond by/i)
      await proposal.uncheck()
      await expect(expiry).toHaveCount(0)
      watch.assertClean()
    } finally {
      await cleanupLeaseSetup(request, token, setup)
    }
  })
})
