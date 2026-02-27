import { expect, test } from '@playwright/test'
import { apiRequest, createSsoConfigFixture, getAuthToken, addDomainFixture, activateConfigFixture } from '../helpers/ssoFixtures'

test.describe('TC-SSO-002: Domain Management & HRD', () => {
  test('should add and remove domains', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { configId, cleanup } = await createSsoConfigFixture(request, token)
    const domain = `domain-${Date.now()}.example.com`

    try {
      // Add domain
      await addDomainFixture(request, token, configId, domain)

      // Verify domain appears on config
      const getResponse = await apiRequest(request, 'GET', `/api/sso/config/${configId}`, { token })
      const config = (await getResponse.json()) as { allowedDomains: string[] }
      expect(config.allowedDomains).toContain(domain)

      // Remove domain via query parameter (API uses ?domain= for DELETE)
      const removeResponse = await apiRequest(request, 'DELETE', `/api/sso/config/${configId}/domains?domain=${encodeURIComponent(domain)}`, {
        token,
      })
      expect(removeResponse.ok()).toBeTruthy()

      // Verify domain removed
      const getAfter = await apiRequest(request, 'GET', `/api/sso/config/${configId}`, { token })
      const afterConfig = (await getAfter.json()) as { allowedDomains: string[] }
      expect(afterConfig.allowedDomains).not.toContain(domain)
    } finally {
      await cleanup()
    }
  })

  test('should handle duplicate domain addition idempotently', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { configId, cleanup } = await createSsoConfigFixture(request, token)
    const domain = `dup-${Date.now()}.example.com`

    try {
      await addDomainFixture(request, token, configId, domain)

      // Adding same domain again is idempotent — returns success with same domains list
      const dupResponse = await apiRequest(request, 'POST', `/api/sso/config/${configId}/domains`, {
        token,
        data: { domain },
      })
      expect(dupResponse.ok()).toBeTruthy()

      // Verify domain appears only once
      const getResponse = await apiRequest(request, 'GET', `/api/sso/config/${configId}`, { token })
      const config = (await getResponse.json()) as { allowedDomains: string[] }
      const count = config.allowedDomains.filter((d: string) => d === domain).length
      expect(count).toBe(1)
    } finally {
      await cleanup()
    }
  })

  test('should reject invalid domain format', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { configId, cleanup } = await createSsoConfigFixture(request, token)

    try {
      const response = await apiRequest(request, 'POST', `/api/sso/config/${configId}/domains`, {
        token,
        data: { domain: 'not a valid domain!' },
      })
      expect(response.ok()).toBeFalsy()
      // Service throws SsoConfigError(400) for invalid domains
      expect([400, 500]).toContain(response.status())
    } finally {
      await cleanup()
    }
  })

  test('should return hasSso:true for matching domain via HRD', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const domain = `hrd-${Date.now()}.example.com`
    // Use real OIDC issuer so activation with discovery succeeds
    const { configId, cleanup } = await createSsoConfigFixture(request, token, {
      issuer: 'https://accounts.google.com',
    })

    try {
      await addDomainFixture(request, token, configId, domain)

      // Activate the config (requires working OIDC discovery)
      await activateConfigFixture(request, token, configId)

      // HRD lookup should find SSO
      const hrdResponse = await apiRequest(request, 'POST', '/api/sso/hrd', {
        token,
        data: { email: `user@${domain}` },
      })
      expect(hrdResponse.ok()).toBeTruthy()
      const hrd = (await hrdResponse.json()) as { hasSso: boolean }
      expect(hrd.hasSso).toBe(true)
    } finally {
      await cleanup()
    }
  })

  test('should return hasSso:false for non-matching domain', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const hrdResponse = await apiRequest(request, 'POST', '/api/sso/hrd', {
      token,
      data: { email: `user@nonexistent-${Date.now()}.example.com` },
    })
    expect(hrdResponse.ok()).toBeTruthy()
    const hrd = (await hrdResponse.json()) as { hasSso: boolean }
    expect(hrd.hasSso).toBe(false)
  })
})
