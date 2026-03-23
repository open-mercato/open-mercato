import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createUserFixture,
  deleteUserIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import { getTokenContext } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

/**
 * TC-AUTH-010: Edit Existing User
 * Source: .ai/qa/scenarios/TC-AUTH-010-user-edit.md
 */
test.describe('TC-AUTH-010: Edit Existing User', () => {
  test('should edit a user email and persist changes', async ({ page, request }) => {
    test.slow()

    const stamp = Date.now()
    const initialEmail = `qa-auth-010-${stamp}@acme.com`
    const updatedEmail = `qa-auth-010-updated-${stamp}@acme.com`
    let token: string | null = null
    let userId: string | null = null

    try {
      token = await getAuthToken(request)
      const { organizationId } = getTokenContext(token)
      userId = await createUserFixture(request, token, {
        email: initialEmail,
        password: 'Valid1!Pass',
        organizationId,
        roles: ['employee'],
      })

      await login(page, 'admin')
      await page.goto(`/backend/users/${userId}/edit`, { waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('domcontentloaded')
      await expect(page).toHaveURL(new RegExp(`/backend/users/${userId}/edit$`, 'i'))

      const emailInput = page.locator('[data-crud-field-id="email"] input').first()
      await expect(emailInput).toBeVisible()
      await emailInput.fill(updatedEmail)
      await page.getByRole('button', { name: 'Save' }).first().click()

      await expect(page).toHaveURL(/\/backend\/users(?:\?.*)?$/)
      const searchInput = page.getByRole('textbox', { name: 'Search' })
      await expect(searchInput).toBeVisible()
      await searchInput.fill(updatedEmail)
      await expect(page.getByRole('row', { name: new RegExp(updatedEmail, 'i') })).toBeVisible()
    } finally {
      await deleteUserIfExists(request, token, userId)
    }
  })
})
