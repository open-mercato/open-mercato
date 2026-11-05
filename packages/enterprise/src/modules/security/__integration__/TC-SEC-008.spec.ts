import { expect, test } from '@playwright/test'
import {
  createAdminApiToken,
  createUserFixture,
  deleteUserFixture,
  fetchJson,
  getBuiltInProviders,
  getCustomProviderTypes,
  loginViaApi,
  setAuthCookie,
} from './helpers/securityFixtures'

test.describe('TC-SEC-008: Provider registry and generic fallback UI', () => {
  let adminToken: string
  let userId: string | null = null
  let userEmail = ''
  const userPassword = 'Valid1!Pass'

  test.beforeAll(async ({ request }) => {
    adminToken = await createAdminApiToken(request)
    const user = await createUserFixture(request, adminToken, { password: userPassword })
    userId = user.id
    userEmail = user.email
  })

  test.afterAll(async ({ request }) => {
    await deleteUserFixture(request, adminToken ?? null, userId)
  })

  test('lists built-in providers and exercises the generic fallback when a custom provider exists', async ({ request, page }) => {
    const login = await loginViaApi(request, userEmail, userPassword)
    const userToken = login.token

    const providerTypes = await getBuiltInProviders(request, userToken)
    expect(providerTypes).toEqual(expect.arrayContaining(['totp', 'passkey', 'otp_email']))

    await setAuthCookie(page, userToken)
    await page.goto('/backend/profile/security/mfa')
    await expect(page.getByRole('button', { name: /Authenticator app/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Security keys/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Email OTP/ })).toBeVisible()

    const customProviderTypes = getCustomProviderTypes(providerTypes)
    test.skip(
      customProviderTypes.length === 0,
      'No custom MFA provider module is enabled in the current app, so the generic fallback path cannot be exercised here.',
    )

    const customProviderType = customProviderTypes[0] as string
    await page.goto(`/backend/profile/security/mfa/${encodeURIComponent(customProviderType)}`)
    await expect(page.getByLabel(/Setup payload \(JSON\)/)).toBeVisible()

    const setupResponse = await fetchJson<{ setupId?: string }>(
      request,
      'POST',
      `/api/security/mfa/provider/${encodeURIComponent(customProviderType)}`,
      {
        token: userToken,
        data: {},
      },
    )
    expect(setupResponse.status).toBe(200)
    expect(setupResponse.body.setupId).toBeTruthy()

    const confirmResponse = await fetchJson<{ ok?: boolean }>(
      request,
      'PUT',
      `/api/security/mfa/provider/${encodeURIComponent(customProviderType)}`,
      {
        token: userToken,
        data: {
          setupId: setupResponse.body.setupId,
          payload: {},
        },
      },
    )
    expect(confirmResponse.status).toBe(200)
    expect(confirmResponse.body.ok).toBe(true)

    const methodsResponse = await fetchJson<{ methods: Array<{ type: string }> }>(
      request,
      'GET',
      '/api/security/mfa/methods',
      { token: userToken },
    )
    expect(methodsResponse.status).toBe(200)
    expect(methodsResponse.body.methods.map((method) => method.type)).toContain(customProviderType)
  })
})
