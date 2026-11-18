import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui'
import { stampOf } from './helpers'
import { watchHydration } from './hydrationWatch'

/**
 * TC-PM-051: leases list (hydration smoke)
 * The leases page renders without page errors or hydration mismatches, and its search box is live:
 * typing a reference refetches the list with that term.
 */
test.describe('TC-PM-051: leases list hydration', () => {
  test('renders and refetches on search', async ({ page }) => {
    const watch = watchHydration(page)
    const stamp = stampOf()
    await login(page, 'admin')
    await page.goto('/backend/property_management/leases')
    await expect(page.getByText('Leases', { exact: true }).first()).toBeVisible()

    const searchInput = page.getByPlaceholder('Search by lease reference')
    await expect(searchInput).toBeVisible()
    const refetch = page.waitForRequest(
      (request) => request.url().includes('/api/property_management/leases') && request.url().includes(`search=${stamp}`),
    )
    await fillControlledInput(searchInput, stamp)
    await refetch
    await expect(page.getByText('No leases yet', { exact: true })).toBeVisible()
    watch.assertClean()
  })
})
