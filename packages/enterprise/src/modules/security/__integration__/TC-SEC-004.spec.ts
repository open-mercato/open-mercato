import { expect, test } from '@playwright/test'
import {
  createAdminApiToken,
  createUserFixture,
  deleteUserFixture,
  enrollPasskey,
  fetchJson,
  loginViaApi,
  setAuthCookie,
  verifyPasskeyChallenge,
} from './helpers/securityFixtures'

test.describe('TC-SEC-004: Passkey enrollment and MFA login', () => {
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

  test('shows the passkey provider UI and completes the simplified passkey contract', async ({ request, page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Passkey coverage is only exercised on Chromium in this suite.')

    const firstLogin = await loginViaApi(request, userEmail, userPassword)
    const userToken = firstLogin.token

    await setAuthCookie(page, userToken)
    await page.goto('/backend/profile/security/mfa')
    await expect(page.getByRole('button', { name: /Security keys/ })).toBeVisible()

    await page.goto('/backend/profile/security/mfa/passkey')
    const browserHasWebAuthn = await page.evaluate(() => typeof window.PublicKeyCredential !== 'undefined')
    test.skip(!browserHasWebAuthn, 'WebAuthn is unavailable in the current runtime.')

    await expect(page.getByRole('button', { name: 'Add' })).toBeVisible()

    const enrollment = await enrollPasskey(request, userToken)
    expect(enrollment.credentialId).toContain('qa-passkey')

    const methodsResponse = await fetchJson<{ methods: Array<{ type: string }> }>(
      request,
      'GET',
      '/api/security/mfa/methods',
      { token: userToken },
    )
    expect(methodsResponse.status).toBe(200)
    expect(methodsResponse.body.methods.map((method) => method.type)).toContain('passkey')

    const pendingLogin = await loginViaApi(request, userEmail, userPassword)
    expect(pendingLogin.available_methods?.map((method) => method.type)).toContain('passkey')

    const verifyResponse = await verifyPasskeyChallenge(
      request,
      pendingLogin.token,
      pendingLogin.challenge_id as string,
      enrollment.credentialId,
    )
    expect(verifyResponse.status).toBe(200)
    expect(verifyResponse.body.ok).toBe(true)
    expect(verifyResponse.body.redirect).toBe('/backend')
  })
})
