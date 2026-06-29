import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import { getTokenContext } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

/**
 * TC-AUTH-040: Remove user display name from the edit form
 * Verifies the backend edit form can clear the display name and the change survives a refresh/reopen.
 */
test.describe('TC-AUTH-040: Remove user display name from the edit form', () => {
  test('should keep an emptied display name cleared after save and reopen', async ({ page, request }) => {
    test.slow()

    const stamp = Date.now()
    const email = `qa-auth-040-${stamp}@acme.com`
    let token: string | null = null
    let userId: string | null = null

    try {
      token = await getAuthToken(request)
      const { organizationId } = getTokenContext(token)
      userId = await createUserFixture(request, token, {
        email,
        name: 'Name To Remove',
        password: 'Valid1!Pass',
        organizationId,
        roles: ['employee'],
      })

      await login(page, 'admin')
      await page.goto(`/backend/users/${userId}/edit`, { waitUntil: 'domcontentloaded' })
      await expect(page).toHaveURL(new RegExp(`/backend/users/${userId}/edit$`, 'i'))

      const nameInput = page.locator('[data-crud-field-id="name"] input').first()
      await expect(nameInput).toHaveValue('Name To Remove')
      await nameInput.fill('')
      await page.getByRole('button', { name: 'Save' }).first().click()

      await expect(page).toHaveURL(/\/backend\/users(?:\?.*)?$/)

      await page.goto(`/backend/users/${userId}/edit`, { waitUntil: 'domcontentloaded' })
      await expect(page).toHaveURL(new RegExp(`/backend/users/${userId}/edit$`, 'i'))
      await expect(page.locator('[data-crud-field-id="name"] input').first()).toHaveValue('')
    } finally {
      await deleteUserIfExists(request, token, userId)
    }
  })
})
