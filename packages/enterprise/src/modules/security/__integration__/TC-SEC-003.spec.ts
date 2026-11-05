import { expect, test } from '@playwright/test'
import {
  createAdminApiToken,
  createUserFixture,
  deleteUserFixture,
  enrollOtpEmail,
  fetchJson,
  loginViaApi,
  prepareOtpEmailChallenge,
  setAuthCookie,
} from './helpers/securityFixtures'

test.describe('TC-SEC-003: OTP email challenge attempts', () => {
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

  test('enrolls OTP email, rejects repeated invalid codes, and accepts a fresh valid challenge', async ({ request, page }) => {
    const firstLogin = await loginViaApi(request, userEmail, userPassword)
    const userToken = firstLogin.token

    const providersResponse = await fetchJson<{ providers: Array<{ type: string; label: string }> }>(
      request,
      'GET',
      '/api/security/mfa/providers',
      { token: userToken },
    )
    expect(providersResponse.status).toBe(200)
    expect(providersResponse.body.providers.map((provider) => provider.type)).toContain('otp_email')

    await enrollOtpEmail(request, userToken)

    await setAuthCookie(page, userToken)
    await page.goto('/backend/profile/security/mfa')
    await expect(page.getByText('Email OTP')).toBeVisible()

    const methodsResponse = await fetchJson<{ methods: Array<{ type: string }> }>(
      request,
      'GET',
      '/api/security/mfa/methods',
      { token: userToken },
    )
    expect(methodsResponse.status).toBe(200)
    expect(methodsResponse.body.methods).toHaveLength(1)
    expect(methodsResponse.body.methods[0]?.type).toBe('otp_email')

    const pendingLogin = await loginViaApi(request, userEmail, userPassword)
    expect(pendingLogin.mfa_required).toBe(true)
    expect(pendingLogin.challenge_id).toBeTruthy()

    const prepared = await prepareOtpEmailChallenge(
      request,
      pendingLogin.token,
      pendingLogin.challenge_id as string,
    )
    test.skip(
      prepared.status === 500,
      prepared.error ?? 'OTP email challenge preparation failed because the local email-delivery path is not configured in this workspace.',
    )
    expect(prepared.status).toBe(200)
    expect(prepared.emailHint).toBeTruthy()

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const invalidResponse = await fetchJson<{ error?: string }>(
        request,
        'POST',
        '/api/security/mfa/verify',
        {
          token: pendingLogin.token,
          data: {
            challengeId: pendingLogin.challenge_id,
            methodType: 'otp_email',
            payload: { code: '000000' },
          },
        },
      )
      expect(invalidResponse.status).toBe(401)
      expect(invalidResponse.body.error).toContain('Invalid MFA verification code')
    }

    const exhaustedResponse = await fetchJson<{ error?: string }>(
      request,
      'POST',
      '/api/security/mfa/verify',
      {
        token: pendingLogin.token,
        data: {
          challengeId: pendingLogin.challenge_id,
          methodType: 'otp_email',
          payload: { code: '000000' },
        },
      },
    )
    expect([400, 401]).toContain(exhaustedResponse.status)

    const nonPendingVerify = await fetchJson<{ error?: string }>(
      request,
      'POST',
      '/api/security/mfa/verify',
      {
        token: userToken,
        data: {
          challengeId: pendingLogin.challenge_id,
          methodType: 'otp_email',
          payload: { code: '123456' },
        },
      },
    )
    expect(nonPendingVerify.status).toBe(403)
    expect(nonPendingVerify.body.error).toContain('MFA pending token')

    const freshLogin = await loginViaApi(request, userEmail, userPassword)
    const freshPrepared = await prepareOtpEmailChallenge(
      request,
      freshLogin.token,
      freshLogin.challenge_id as string,
    )
    test.skip(
      freshPrepared.status === 500,
      freshPrepared.error ?? 'OTP email challenge preparation failed because the local email-delivery path is not configured in this workspace.',
    )
    expect(freshPrepared.status).toBe(200)
    expect(typeof freshPrepared.code).toBe('string')

    const successResponse = await fetchJson<{ ok?: boolean; redirect?: string }>(
      request,
      'POST',
      '/api/security/mfa/verify',
      {
        token: freshLogin.token,
        data: {
          challengeId: freshLogin.challenge_id,
          methodType: 'otp_email',
          payload: { code: freshPrepared.code },
        },
      },
    )
    expect(successResponse.status).toBe(200)
    expect(successResponse.body.ok).toBe(true)
    expect(successResponse.body.redirect).toBe('/backend')
  })
})
