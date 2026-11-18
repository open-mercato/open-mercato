import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { watchHydration } from './hydrationWatch'

/**
 * TC-PM-053: settings page (hydration smoke)
 * The settings page renders its form (billing, leases and bookings groups) without page errors or
 * hydration mismatches, and its number fields accept input. Nothing is saved.
 */
test.describe('TC-PM-053: settings page hydration', () => {
  test('renders the settings form', async ({ page }) => {
    const watch = watchHydration(page)
    await login(page, 'admin')
    await page.goto('/backend/property_management/settings')
    await expect(page.getByRole('heading', { level: 1, name: 'Property management settings' })).toBeVisible()

    const threshold = page.locator('[data-crud-field-id="leaseEndingThresholdDays"] input')
    await expect(threshold).toBeVisible()
    await threshold.fill('45')
    await expect(threshold).toHaveValue('45')
    await expect(page.getByRole('button', { name: 'Save settings' }).first()).toBeEnabled()
    watch.assertClean()
  })
})
