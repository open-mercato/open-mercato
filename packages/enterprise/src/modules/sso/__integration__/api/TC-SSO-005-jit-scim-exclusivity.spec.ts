import { expect, test } from '@playwright/test'
import {
  apiRequest,
  createSsoConfigFixture,
  createScimTokenFixture,
  getAuthToken,
} from '../helpers/ssoFixtures'

test.describe('TC-SSO-005: JIT/SCIM Mutual Exclusivity', () => {
  test('should block SCIM token creation when JIT is enabled', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { configId, cleanup } = await createSsoConfigFixture(request, token, {
      jitEnabled: true,
    })

    try {
      const response = await apiRequest(request, 'POST', '/api/sso/scim/tokens', {
        token,
        data: { ssoConfigId: configId, name: 'Should Fail' },
      })
      expect(response.ok()).toBeFalsy()
      expect(response.status()).toBe(409)
    } finally {
      await cleanup()
    }
  })

  test('should block enabling JIT when SCIM tokens exist', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { configId, cleanup: cleanupConfig } = await createSsoConfigFixture(request, token, {
      jitEnabled: false,
    })

    const { cleanup: cleanupToken } = await createScimTokenFixture(request, token, configId)

    try {
      // Try to enable JIT — should fail
      const response = await apiRequest(request, 'PUT', `/api/sso/config/${configId}`, {
        token,
        data: { jitEnabled: true },
      })
      expect(response.ok()).toBeFalsy()
      expect(response.status()).toBe(409)
    } finally {
      await cleanupToken()
      await cleanupConfig()
    }
  })

  test('should allow SCIM token creation after disabling JIT', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { configId, cleanup: cleanupConfig } = await createSsoConfigFixture(request, token, {
      jitEnabled: true,
    })

    try {
      // Disable JIT
      const updateResponse = await apiRequest(request, 'PUT', `/api/sso/config/${configId}`, {
        token,
        data: { jitEnabled: false },
      })
      expect(updateResponse.ok()).toBeTruthy()

      // Now SCIM token creation should work
      const { cleanup: cleanupToken } = await createScimTokenFixture(request, token, configId)
      await cleanupToken()
    } finally {
      await cleanupConfig()
    }
  })

  test('should allow enabling JIT after revoking all SCIM tokens', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { configId, cleanup: cleanupConfig } = await createSsoConfigFixture(request, token, {
      jitEnabled: false,
    })

    const { tokenId } = await createScimTokenFixture(request, token, configId)

    try {
      // Revoke SCIM token
      await apiRequest(request, 'DELETE', `/api/sso/scim/tokens/${tokenId}`, { token })

      // Now enabling JIT should work
      const response = await apiRequest(request, 'PUT', `/api/sso/config/${configId}`, {
        token,
        data: { jitEnabled: true },
      })
      expect(response.ok()).toBeTruthy()
    } finally {
      await cleanupConfig()
    }
  })
})
