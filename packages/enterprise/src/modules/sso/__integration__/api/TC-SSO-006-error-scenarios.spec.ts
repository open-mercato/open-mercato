import { expect, test } from '@playwright/test'
import {
  apiRequest,
  createSsoConfigFixture,
  getAuthToken,
} from '../helpers/ssoFixtures'

test.describe('TC-SSO-006: Error Scenarios', () => {
  test('should reject config creation with missing required fields', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(request, 'POST', '/api/sso/config', {
      token,
      data: { name: 'Incomplete Config' },
    })
    expect(response.ok()).toBeFalsy()
    expect(response.status()).toBe(400)
  })

  test('should reject duplicate config creation', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { cleanup } = await createSsoConfigFixture(request, token)

    try {
      // Second config for same org should fail (1:1 with org)
      const response = await apiRequest(request, 'POST', '/api/sso/config', {
        token,
        data: {
          name: 'Duplicate Config',
          protocol: 'oidc',
          issuer: 'https://duplicate.example.com',
          clientId: 'dup-client',
          clientSecret: 'dup-secret',
        },
      })
      expect(response.ok()).toBeFalsy()
      expect(response.status()).toBe(409)
    } finally {
      await cleanup()
    }
  })

  test('should return 404 for non-existent config ID', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(request, 'GET', '/api/sso/config/00000000-0000-0000-0000-000000000000', { token })
    expect(response.status()).toBe(404)
  })

  test('should reject HRD with invalid email', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(request, 'POST', '/api/sso/hrd', {
      token,
      data: { email: 'not-an-email' },
    })
    expect(response.ok()).toBeFalsy()
  })

  test('should require authentication for admin endpoints', async ({ request }) => {
    const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

    const response = await request.fetch(`${BASE_URL}/api/sso/config`, {
      method: 'GET',
    })
    // Should be rejected (401 or 403)
    expect(response.status()).toBeGreaterThanOrEqual(401)
  })
})
