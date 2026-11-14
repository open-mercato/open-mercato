import { expect, test } from '@playwright/test'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { postForm } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { apiRequest, createSsoConfigFixture, getAuthToken, addDomainFixture, activateConfigFixture } from '../helpers/ssoFixtures'

test.describe('TC-SSO-001: SSO Config CRUD', () => {
  test('should create, read, update, and delete an SSO config', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { configId, cleanup } = await createSsoConfigFixture(request, token, {
      ssoRequired: true,
      requiredAcrValues: ['urn:example:loa:2'],
      requiredAmrValues: ['pwd', 'otp'],
    })

    try {
      // Read
      const getResponse = await apiRequest(request, 'GET', `/api/sso/config/${configId}`, { token })
      expect(getResponse.ok()).toBeTruthy()
      const config = (await getResponse.json()) as Record<string, unknown>
      expect(config.id).toBe(configId)
      expect(config.protocol).toBe('oidc')
      expect(config.isActive).toBe(false)
      expect(config.ssoRequired).toBe(true)
      expect(config.requiredAcrValues).toEqual(['urn:example:loa:2'])
      expect(config.requiredAmrValues).toEqual(['pwd', 'otp'])

      // Update
      const updateResponse = await apiRequest(request, 'PUT', `/api/sso/config/${configId}`, {
        token,
        data: {
          name: 'Updated Config Name',
          issuer: 'https://updated.example.com',
          ssoRequired: false,
          requiredAcrValues: ['urn:example:loa:3'],
          requiredAmrValues: ['otp'],
        },
      })
      expect(updateResponse.ok()).toBeTruthy()

      // Verify update
      const getUpdated = await apiRequest(request, 'GET', `/api/sso/config/${configId}`, { token })
      const updated = (await getUpdated.json()) as Record<string, unknown>
      expect(updated.name).toBe('Updated Config Name')
      expect(updated.ssoRequired).toBe(false)
      expect(updated.requiredAcrValues).toEqual(['urn:example:loa:3'])
      expect(updated.requiredAmrValues).toEqual(['otp'])

      // Delete inactive config
      const deleteResponse = await apiRequest(request, 'DELETE', `/api/sso/config/${configId}`, { token })
      expect(deleteResponse.ok()).toBeTruthy()
    } finally {
      await cleanup()
    }
  })

  test('should list SSO configs', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { configId, cleanup } = await createSsoConfigFixture(request, token)

    try {
      const listResponse = await apiRequest(request, 'GET', '/api/sso/config', { token })
      expect(listResponse.ok()).toBeTruthy()
      const body = (await listResponse.json()) as { items: Array<{ id: string }> }
      const found = body.items?.some((c) => c.id === configId)
      expect(found, 'Created config should appear in list').toBeTruthy()
    } finally {
      await cleanup()
    }
  })

  test('should not activate config without domains', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { configId, cleanup } = await createSsoConfigFixture(request, token)

    try {
      const activateResponse = await apiRequest(request, 'POST', `/api/sso/config/${configId}/activate`, {
        token,
        data: { active: true },
      })
      expect(activateResponse.ok()).toBeFalsy()
      // Service throws SsoConfigError(400) but OIDC discovery may also fail → accept 400 or 500
      expect([400, 500]).toContain(activateResponse.status())
    } finally {
      await cleanup()
    }
  })

  test('should activate config with domain and prevent deletion while active', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    // Use a real OIDC issuer so discovery succeeds during activation
    const { configId, cleanup } = await createSsoConfigFixture(request, token, {
      issuer: 'https://accounts.google.com',
    })

    try {
      // Add domain and activate
      await addDomainFixture(request, token, configId, `test-${Date.now()}.example.com`)
      await activateConfigFixture(request, token, configId)

      // Should not be able to delete active config
      const deleteResponse = await apiRequest(request, 'DELETE', `/api/sso/config/${configId}`, { token })
      expect(deleteResponse.ok()).toBeFalsy()

      // Deactivate first
      const deactivateResponse = await apiRequest(request, 'POST', `/api/sso/config/${configId}/activate`, {
        token,
        data: { active: false },
      })
      expect(deactivateResponse.ok()).toBeTruthy()

      // Now delete should work
      const deleteAfter = await apiRequest(request, 'DELETE', `/api/sso/config/${configId}`, { token })
      expect(deleteAfter.ok()).toBeTruthy()
    } finally {
      await cleanup()
    }
  })

  test('should block password login without issuing auth cookies when SSO is required', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(token)
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const email = `qa-sso-required-${stamp}@acme.com`
    const password = 'Valid1!Pass'
    let userId: string | null = null
    const { configId, cleanup } = await createSsoConfigFixture(request, token, {
      issuer: 'https://accounts.google.com',
      ssoRequired: true,
    })

    try {
      userId = await createUserFixture(request, token, {
        email,
        password,
        organizationId,
        roles: ['employee'],
      })
      await addDomainFixture(request, token, configId, `qa-sso-required-${stamp}.example.com`)
      await activateConfigFixture(request, token, configId)

      const loginResponse = await postForm(request, '/api/auth/login', { email, password })
      const body = (await loginResponse.json()) as { ok?: boolean; code?: string; token?: string }
      const setCookieHeader = loginResponse.headers()['set-cookie'] ?? ''

      expect(loginResponse.status()).toBe(200)
      expect(body.ok).toBe(false)
      expect(body.code).toBe('SSO_REQUIRED')
      expect(body.token).toBeUndefined()
      expect(setCookieHeader).not.toContain('auth_token=')
      expect(setCookieHeader).not.toContain('refresh_token=')
    } finally {
      await cleanup()
      await deleteUserIfExists(request, token, userId)
    }
  })
})
