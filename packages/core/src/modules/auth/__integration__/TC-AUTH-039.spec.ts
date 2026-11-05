import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

/**
 * TC-AUTH-039: Clear user display name through the API
 * Verifies that submitting an empty display name removes the stored value instead of preserving the previous one.
 */
test.describe('TC-AUTH-039: Clear user display name through the API', () => {
  test('should persist a blank display name as null', async ({ request, page }) => {
    test.slow()

    const stamp = Date.now()
    const email = `qa-auth-039-${stamp}@acme.com`
    let token: string | null = null
    let userId: string | null = null

    try {
      token = await getAuthToken(request)
      const { organizationId } = getTokenContext(token)
      userId = await createUserFixture(request, token, {
        email,
        name: 'Temporary Display Name',
        password: 'Valid1!Pass',
        organizationId,
        roles: ['employee'],
      })

      const updateResponse = await apiRequest(request, 'PUT', '/api/auth/users', {
        token,
        data: {
          id: userId,
          name: '',
        },
      })
      expect(updateResponse.status()).toBe(200)

      const readResponse = await apiRequest(request, 'GET', `/api/auth/users?id=${encodeURIComponent(userId)}&page=1&pageSize=1`, {
        token,
      })
      const body = await readJsonSafe<{ items?: Array<{ name?: string | null }> }>(readResponse)
      if (!body) {
        throw new Error('Expected user list response body')
      }
      expect(body.items?.[0]?.name).toBeNull()

      await login(page, 'admin')
      await page.goto(`/backend/users/${userId}/edit`, { waitUntil: 'domcontentloaded' })
      await expect(page).toHaveURL(new RegExp(`/backend/users/${userId}/edit$`, 'i'))
      await expect(page.locator('[data-crud-field-id="name"] input').first()).toHaveValue('')
    } finally {
      await deleteUserIfExists(request, token, userId)
    }
  })
})
