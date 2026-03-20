import { expect, test } from '@playwright/test'
import {
  clearAuthCookie,
  createAdminApiToken,
  createUserFixture,
  deleteUserFixture,
  enrollTotp,
  fetchJson,
  loginViaApi,
  setAuthCookie,
  verifyTotpChallenge,
} from './helpers/securityFixtures'

test.describe('TC-SEC-002: TOTP enrollment, login, and recovery codes', () => {
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

  test('enrolls TOTP, completes MFA login, consumes a recovery code, and rotates the recovery set', async ({ request, page }) => {
    const firstLogin = await loginViaApi(request, userEmail, userPassword)
    const userToken = firstLogin.token

    const providerResponse = await fetchJson<{ providers: Array<{ type: string }> }>(
      request,
      'GET',
      '/api/security/mfa/providers',
      { token: userToken },
    )
    expect(providerResponse.status).toBe(200)
    expect(providerResponse.body.providers.map((provider) => provider.type)).toContain('totp')

    const enrollment = await enrollTotp(request, userToken)

    await setAuthCookie(page, userToken)
    await page.goto('/backend/profile/security/mfa')
    await expect(page.getByRole('button', { name: /Authenticator app/ })).toBeVisible()

    const methodsResponse = await fetchJson<{ methods: Array<{ type: string }> }>(
      request,
      'GET',
      '/api/security/mfa/methods',
      { token: userToken },
    )
    expect(methodsResponse.status).toBe(200)
    expect(methodsResponse.body.methods.map((method) => method.type)).toContain('totp')

    await clearAuthCookie(page)

    const mfaLogin = await loginViaApi(request, userEmail, userPassword)
    expect(mfaLogin.mfa_required).toBe(true)
    expect(mfaLogin.challenge_id).toBeTruthy()
    expect(mfaLogin.available_methods?.map((method) => method.type)).toContain('totp')

    const totpVerify = await verifyTotpChallenge(
      request,
      mfaLogin.token,
      mfaLogin.challenge_id as string,
      enrollment.secret,
    )
    expect(totpVerify.status).toBe(200)
    expect(totpVerify.body.ok).toBe(true)
    expect(totpVerify.body.redirect).toBe('/backend')

    const regenerateResponse = await fetchJson<{ recoveryCodes?: string[] }>(
      request,
      'POST',
      '/api/security/mfa/recovery-codes/regenerate',
      {
        token: userToken,
        data: {},
      },
    )
    expect(regenerateResponse.status).toBe(200)
    expect(regenerateResponse.body.recoveryCodes).toHaveLength(10)

    const recoveryLogin = await loginViaApi(request, userEmail, userPassword)
    const recoveryVerify = await fetchJson<{ ok?: boolean; redirect?: string }>(
      request,
      'POST',
      '/api/security/mfa/recovery',
      {
        token: recoveryLogin.token,
        data: { code: regenerateResponse.body.recoveryCodes?.[0] },
      },
    )
    expect(recoveryVerify.status).toBe(200)
    expect(recoveryVerify.body.ok).toBe(true)

    const verifiedToken = typeof totpVerify.body.token === 'string' ? totpVerify.body.token : userToken
    const rotateResponse = await fetchJson<{ recoveryCodes?: string[] }>(
      request,
      'POST',
      '/api/security/mfa/recovery-codes/regenerate',
      {
        token: verifiedToken,
        data: {},
      },
    )
    expect(rotateResponse.status).toBe(200)
    expect(rotateResponse.body.recoveryCodes).toHaveLength(10)

    const staleRecoveryLogin = await loginViaApi(request, userEmail, userPassword)
    const staleRecoveryResponse = await fetchJson<{ error?: string }>(
      request,
      'POST',
      '/api/security/mfa/recovery',
      {
        token: staleRecoveryLogin.token,
        data: { code: regenerateResponse.body.recoveryCodes?.[0] },
      },
    )
    expect(staleRecoveryResponse.status).toBe(401)
    expect(staleRecoveryResponse.body.error).toContain('Invalid recovery code')
  })
})
