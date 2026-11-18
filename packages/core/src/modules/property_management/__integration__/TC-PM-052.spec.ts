import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { stampOf } from './helpers'
import { cleanupLeaseSetup, createLease, createLeaseSetup, isoDayFromToday, type LeaseSetup } from './leaseFixtures'
import { watchHydration } from './hydrationWatch'

/**
 * TC-PM-052: lease detail (hydration smoke)
 * A lease's detail page renders its heading, summary and history from the client fetch without page
 * errors or hydration mismatches, and shows the manager actions to an administrator.
 */
test.describe('TC-PM-052: lease detail hydration', () => {
  test('renders the lease detail page', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: LeaseSetup | null = null
    try {
      setup = await createLeaseSetup(request, token, stamp)
      const lease = await createLease(request, token, setup, {
        unitId: setup.unitIds[0],
        customerCompanyId: setup.companyIds[0],
        startsOn: isoDayFromToday(5),
        termMonths: 3,
      })

      const watch = watchHydration(page)
      await login(page, 'admin')
      await page.goto(`/backend/property_management/leases/${lease.id}`)
      await expect(page.getByRole('heading', { level: 1, name: /^Lease / })).toBeVisible()
      await expect(page.getByRole('button', { name: 'End lease', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Delete lease', exact: true })).toBeVisible()
      watch.assertClean()
    } finally {
      await cleanupLeaseSetup(request, token, setup)
    }
  })
})
