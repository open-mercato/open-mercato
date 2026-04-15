import { expect, test, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

type AccessibilityPreferences = {
  highContrast: boolean
  fontSize: 'sm' | 'md' | 'lg' | 'xl'
  reducedMotion: boolean
}

type ProfileResponse = {
  email?: string | null
  roles?: string[]
  accessibilityPreferences?: AccessibilityPreferences | null
}

async function isSecurityModuleActive(request: APIRequestContext): Promise<boolean> {
  const probe = await request.get('/api/security/mfa').catch(() => null)
  return probe !== null && probe.status() !== 404
}

test.describe('TC-AUTH-027: Accessibility preferences on self-service profile', () => {
  const stamp = Date.now()
  const password = 'Valid1!Pass'

  let adminToken: string | null = null
  let organizationId: string | null = null
  let securityModuleActive = false

  test.beforeAll(async ({ request }) => {
    adminToken = await getAuthToken(request)
    organizationId = getTokenContext(adminToken).organizationId
    securityModuleActive = await isSecurityModuleActive(request)
  })

  async function createTestUser(request: APIRequestContext, email: string) {
    const response = await apiRequest(request, 'POST', '/api/auth/users', {
      token: adminToken!,
      data: {
        email,
        password,
        organizationId,
        roles: ['employee'],
      },
    })
    expect(response.status()).toBe(201)
    const body = (await response.json()) as { id?: string }
    expect(typeof body.id).toBe('string')
    return body.id as string
  }

  async function deleteTestUser(request: APIRequestContext, userId: string) {
    await apiRequest(request, 'DELETE', `/api/auth/users?id=${encodeURIComponent(userId)}`, {
      token: adminToken!,
    }).catch(() => undefined)
  }

  test('persists accessibility preferences through GET and PUT /api/auth/profile', async ({ request }) => {
    const email = `qa-auth-027-${stamp}@acme.com`
    const userId = await createTestUser(request, email)
    const preferences: AccessibilityPreferences = {
      highContrast: true,
      fontSize: 'xl',
      reducedMotion: true,
    }

    try {
      const userToken = await getAuthToken(request, email, password)

      const updateResponse = await apiRequest(request, 'PUT', '/api/auth/profile', {
        token: userToken,
        data: {
          accessibilityPreferences: preferences,
        },
      })

      expect(updateResponse.status()).toBe(200)
      const updateBody = (await updateResponse.json()) as {
        ok?: boolean
        email?: string | null
        accessibilityPreferences?: unknown
      }
      expect(updateBody).toEqual({
        ok: true,
        email,
      })

      const profileResponse = await apiRequest(request, 'GET', '/api/auth/profile', {
        token: userToken,
      })
      expect(profileResponse.status()).toBe(200)
      const profileBody = (await profileResponse.json()) as ProfileResponse

      expect(profileBody.email).toBe(email)
      expect(profileBody.accessibilityPreferences).toEqual(preferences)
    } finally {
      await deleteTestUser(request, userId)
    }
  })

  test('shows skip link and accessibility section on the OSS profile page', async ({ page }) => {
    test.skip(securityModuleActive, 'Security module active: accessibility UI lives in the enterprise security profile')

    await login(page, 'admin')
    await page.goto('/backend/profile/accessibility', { waitUntil: 'domcontentloaded' })

    await page.keyboard.press('Tab')
    const skipLink = page.getByRole('link', { name: 'Skip to content' })
    await expect(skipLink).toBeVisible()

    await skipLink.press('Enter')
    await expect(page.locator('main#main-content')).toBeFocused()
    await expect(page.getByRole('heading', { name: 'Accessibility' })).toBeVisible()
  })
})
