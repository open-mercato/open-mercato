import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'

/**
 * TC-AUTH-025: Filter Users by Display Name
 * Verifies that the live users list request includes the `name` filter.
 */
test.describe('TC-AUTH-025: Filter Users by Display Name', () => {
  test('should include display name in the live users list request', async ({ page }) => {
    const name = `qa-filter-name-${Date.now()}`

    await login(page, 'admin')
    await page.goto('/backend/users')
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()

    await page.getByRole('button', { name: /Filters/i }).click()
    const filterPanel = page.locator('.fixed.inset-0')
    await expect(filterPanel).toBeVisible()

    const nameInput = filterPanel.getByPlaceholder(/filter by display name/i)
    await expect(nameInput).toBeVisible()
    await nameInput.fill(name)

    const requestPromise = page.waitForRequest((request) => {
      const url = new URL(request.url())
      return url.pathname === '/api/auth/users' && url.searchParams.get('name') === name
    })

    await filterPanel.getByRole('button', { name: /Apply/i }).first().click()

    const request = await requestPromise
    expect(new URL(request.url()).searchParams.get('name')).toBe(name)
  })
})
