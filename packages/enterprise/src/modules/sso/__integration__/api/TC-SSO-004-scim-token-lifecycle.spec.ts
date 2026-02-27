import { expect, test } from '@playwright/test'
import {
  apiRequest,
  createSsoConfigFixture,
  createScimTokenFixture,
  getAuthToken,
  scimRequest,
} from '../helpers/ssoFixtures'

test.describe('TC-SSO-004: SCIM Token Lifecycle', () => {
  test('should create a token and return raw value only once', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { configId, cleanup: cleanupConfig } = await createSsoConfigFixture(request, token, {
      jitEnabled: false,
    })

    try {
      const { tokenId, rawToken, prefix, cleanup: cleanupToken } = await createScimTokenFixture(request, token, configId)

      try {
        expect(rawToken).toBeTruthy()
        expect(rawToken.startsWith('omscim_')).toBeTruthy()
        expect(prefix).toBeTruthy()

        // List tokens: should show prefix but NOT raw token
        const listResponse = await apiRequest(request, 'GET', `/api/sso/scim/tokens?ssoConfigId=${configId}`, { token })
        expect(listResponse.ok()).toBeTruthy()
        const list = (await listResponse.json()) as { items: Array<{ id: string; tokenPrefix: string; token?: string }> }
        const found = list.items.find((t) => t.id === tokenId)
        expect(found).toBeTruthy()
        expect(found!.tokenPrefix).toBe(prefix)
        expect(found!.token).toBeUndefined()
      } finally {
        await cleanupToken()
      }
    } finally {
      await cleanupConfig()
    }
  })

  test('should authenticate SCIM requests with valid token', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { configId, cleanup: cleanupConfig } = await createSsoConfigFixture(request, token, {
      jitEnabled: false,
    })

    const { rawToken, cleanup: cleanupToken } = await createScimTokenFixture(request, token, configId)

    try {
      // Valid token should work
      const response = await scimRequest(request, 'GET', '/api/sso/scim/v2/Users', rawToken)
      expect(response.ok()).toBeTruthy()
    } finally {
      await cleanupToken()
      await cleanupConfig()
    }
  })

  test('should reject SCIM requests with revoked token', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { configId, cleanup: cleanupConfig } = await createSsoConfigFixture(request, token, {
      jitEnabled: false,
    })

    const { tokenId, rawToken } = await createScimTokenFixture(request, token, configId)

    try {
      // Revoke token
      const revokeResponse = await apiRequest(request, 'DELETE', `/api/sso/scim/tokens/${tokenId}`, { token })
      expect(revokeResponse.ok()).toBeTruthy()

      // Revoked token should be rejected
      const scimResponse = await scimRequest(request, 'GET', '/api/sso/scim/v2/Users', rawToken)
      expect(scimResponse.status()).toBe(401)
    } finally {
      await cleanupConfig()
    }
  })

  test('should reject SCIM requests with invalid token', async ({ request }) => {
    const response = await scimRequest(request, 'GET', '/api/sso/scim/v2/Users', 'omscim_invalid_token_12345678')
    expect(response.status()).toBe(401)
  })

  test('should reject SCIM requests without Authorization header', async ({ request }) => {
    const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
    const response = await request.fetch(`${BASE_URL}/api/sso/scim/v2/Users`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/scim+json' },
    })
    expect(response.status()).toBe(401)
  })
})
