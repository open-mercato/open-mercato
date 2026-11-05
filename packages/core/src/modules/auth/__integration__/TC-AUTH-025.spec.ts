import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import { getTokenContext } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

/**
 * TC-AUTH-025: Filter Users by Display Name
 * Verifies that the live users list request includes the `name` filter.
 */
test.describe('TC-AUTH-025: Filter Users by Display Name', () => {
  test('should include display name in the live users list request and return matching users', async ({ page, request }) => {
    const filterValue = `qa-filter-name-${Date.now()}`
    const displayName = `John ${filterValue}`
    const email = `${filterValue}@acme.com`
    let token: string | null = null
    let userId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const { organizationId } = getTokenContext(token)
      userId = await createUserFixture(request, token, {
        email,
        password: 'Valid1!Pass',
        organizationId,
        roles: ['employee'],
        name: displayName,
      })

      await login(page, 'admin')
      await page.goto('/backend/users')
      await page.waitForLoadState('domcontentloaded')
      await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()

      await page.getByRole('button', { name: /Filters/i }).click()
      const filterPanel = page.locator('.fixed.inset-0')
      await expect(filterPanel).toBeVisible()

      const nameInput = filterPanel.getByPlaceholder(/filter by display name/i)
      await expect(nameInput).toBeVisible()
      await nameInput.fill('john')

      const requestPromise = page.waitForRequest((request) => {
        const url = new URL(request.url())
        return url.pathname === '/api/auth/users' && url.searchParams.get('name') === 'john'
      })

      await filterPanel.getByRole('button', { name: /Apply/i }).first().click()

      const requestRecord = await requestPromise
      expect(new URL(requestRecord.url()).searchParams.get('name')).toBe('john')
      await expect(page.getByText(displayName, { exact: false })).toBeVisible()
    } finally {
      await deleteUserIfExists(request, token, userId)
    }
  })
})
