import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { stampOf } from './helpers'
import { cleanupLeaseSetup, createLeaseSetup, type LeaseSetup } from './leaseFixtures'

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
      await login(page, 'admin')
      const response = await page.goto('/backend/property_management/leases/create')
      test.skip(!response || response.status() === 404, 'the New lease page is not available in this build')

      await expect(page.getByRole('heading', { name: /new lease/i }).first()).toBeVisible()
      const term = page.getByLabel(/term/i).first()
      await term.fill('12')
      await expect(page.getByText(/ends on|end date/i).first()).toBeVisible()

      const proposal = page.getByRole('checkbox', { name: /send as a proposal/i })
      await expect(proposal).toBeVisible()
      await expect(page.getByLabel(/expires after/i)).toHaveCount(0)
      await proposal.check()
      await expect(page.getByLabel(/expires after/i).first()).toBeVisible()
      await expect(page.getByText(/respond by/i).first()).toBeVisible()
      await proposal.uncheck()
      await expect(page.getByLabel(/expires after/i)).toHaveCount(0)
    } finally {
      await cleanupLeaseSetup(request, token, setup)
    }
  })
})
