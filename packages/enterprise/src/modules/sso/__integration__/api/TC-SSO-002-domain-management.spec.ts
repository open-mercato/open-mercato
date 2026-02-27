import { expect, test } from '@playwright/test'
import { apiRequest, createSsoConfigFixture, getAuthToken, addDomainFixture } from '../helpers/ssoFixtures'

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

      // Remove domain
      const removeResponse = await apiRequest(request, 'DELETE', `/api/sso/config/${configId}/domains`, {
        token,
        data: { domain },
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

  test('should reject duplicate domains', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { configId, cleanup } = await createSsoConfigFixture(request, token)
    const domain = `dup-${Date.now()}.example.com`

    try {
      await addDomainFixture(request, token, configId, domain)

      // Adding same domain again should fail
      const dupResponse = await apiRequest(request, 'POST', `/api/sso/config/${configId}/domains`, {
        token,
        data: { domain },
      })
      expect(dupResponse.ok()).toBeFalsy()
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
      expect(response.status()).toBe(400)
    } finally {
      await cleanup()
    }
  })

  test('should return hasSso:true for matching domain via HRD', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const domain = `hrd-${Date.now()}.example.com`
    const { configId, cleanup } = await createSsoConfigFixture(request, token)

    try {
      await addDomainFixture(request, token, configId, domain)

      // Activate the config
      const activateResponse = await apiRequest(request, 'POST', `/api/sso/config/${configId}/activate`, {
        token,
        data: { active: true },
      })
      expect(activateResponse.ok()).toBeTruthy()

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
