import { expect, test } from '@playwright/test'
import {
  createAdminApiToken,
  createUserFixture,
  deleteUserFixture,
  enrollTotp,
  fetchJson,
  loginViaApi,
  verifyTotpChallenge,
} from './helpers/securityFixtures'

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'
const READ_PROBE = '/api/auth/profile'
const MUTATION_PROBE = '/api/security/mfa/recovery-codes/regenerate'

async function rawRequest(
  request: import('@playwright/test').APIRequestContext,
  method: 'GET' | 'POST',
  path: string,
  options: { bearer?: string; cookie?: string },
): Promise<{ status: number; setCookie: string[] }> {
  const response = await request.fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(options.bearer ? { authorization: `Bearer ${options.bearer}` } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
    },
    ...(method === 'POST' ? { data: {} } : {}),
  })
  return { status: response.status(), setCookie: response.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value) }
}

function authCookieValue(token: string): string {
  return `auth_token=${encodeURIComponent(token)}`
}

test.describe('TC-SEC-010: MFA-pending tokens are rejected by general staff APIs (#5212)', () => {
  test.describe.configure({ timeout: 120_000 })

  let adminToken: string
  let userId: string | null = null
  let userEmail = ''
  let userPassword = 'Valid1!Pass'
  let totpSecret = ''

  test.beforeAll(async ({ request }) => {
    adminToken = await createAdminApiToken(request)
    const user = await createUserFixture(request, adminToken, { password: userPassword })
    userId = user.id
    userEmail = user.email

    const firstLogin = await loginViaApi(request, userEmail, userPassword)
    const enrollment = await enrollTotp(request, firstLogin.token)
    totpSecret = enrollment.secret
  })

  test.afterAll(async ({ request }) => {
    await deleteUserFixture(request, adminToken ?? null, userId)
  })

  async function pendingLogin(request: import('@playwright/test').APIRequestContext): Promise<{ token: string; challengeId: string }> {
    const login = await loginViaApi(request, userEmail, userPassword)
    expect(login.mfa_required).toBe(true)
    expect(login.token).toBeTruthy()
    return { token: login.token, challengeId: login.challenge_id as string }
  }

  test('pending bearer token gets 401 (not authenticated) from protected read and mutation APIs', async ({ request }) => {
    const { token } = await pendingLogin(request)

    const readProbe = await fetchJson<{ error?: string }>(request, 'GET', READ_PROBE, { token })
    expect(readProbe.status).toBe(401)

    const mutationProbe = await fetchJson(request, 'POST', MUTATION_PROBE, { token })
    expect(mutationProbe.status).toBe(401)
  })

  test('pending cookie credentials get 401 with staff auth cookies cleared by the dispatcher', async ({ request }) => {
    const { token } = await pendingLogin(request)

    const probe = await rawRequest(request, 'GET', READ_PROBE, { cookie: authCookieValue(token) })
    expect(probe.status).toBe(401)

    const clearedAuthCookie = probe.setCookie.find((value) => value.startsWith('auth_token='))
    expect(clearedAuthCookie).toBeTruthy()
    expect(clearedAuthCookie).toMatch(/auth_token=;/)
    expect(clearedAuthCookie).toMatch(/max-age=0/i)

    const mutationProbe = await rawRequest(request, 'POST', MUTATION_PROBE, { cookie: authCookieValue(token) })
    expect(mutationProbe.status).toBe(401)
  })

  test('completion routes stay reachable for the pending token and the verified replacement regains access', async ({ request }) => {
    const { token, challengeId } = await pendingLogin(request)

    const prepare = await fetchJson<{ ok?: boolean; challenge_id?: string }>(
      request,
      'POST',
      '/api/security/mfa/prepare',
      { token },
    )
    expect(prepare.status).toBe(200)
    expect(prepare.body.ok).toBe(true)
    expect(typeof prepare.body.challenge_id).toBe('string')

    const verify = await verifyTotpChallenge(request, token, challengeId, totpSecret)
    expect(verify.status).toBe(200)
    expect(verify.body.ok).toBe(true)
    const verifiedToken = verify.body.token as string
    expect(verifiedToken).toBeTruthy()

    const readProbe = await fetchJson<{ email?: string }>(request, 'GET', READ_PROBE, { token: verifiedToken })
    expect(readProbe.status).toBe(200)
    expect(readProbe.body.email).toBe(userEmail)

    const mutationProbe = await fetchJson<{ recoveryCodes?: string[] }>(request, 'POST', MUTATION_PROBE, { token: verifiedToken })
    expect(mutationProbe.status).toBe(200)
    expect(Array.isArray(mutationProbe.body.recoveryCodes)).toBe(true)
  })

  test('exhausted challenge is cleaned up: correct code stops working and pending token stays locked out', async ({ request }) => {
    const { token, challengeId } = await pendingLogin(request)

    let lastVerifyStatus = 0
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const wrongAttempt = await fetchJson<{ ok?: boolean; error?: string }>(request, 'POST', '/api/security/mfa/verify', {
        token,
        data: { challengeId, methodType: 'totp', payload: { code: '000000' } },
      })
      lastVerifyStatus = wrongAttempt.status
      if (wrongAttempt.status !== 401 && wrongAttempt.status !== 400) break
      if ((wrongAttempt.body.error ?? '').toLowerCase().includes('locked')) break
    }
    expect(lastVerifyStatus).not.toBe(200)

    const exhaustedVerify = await verifyTotpChallenge(request, token, challengeId, totpSecret)
    expect(exhaustedVerify.status).not.toBe(200)

    const readProbe = await fetchJson<{ error?: string }>(request, 'GET', READ_PROBE, { token })
    expect(readProbe.status).toBe(401)

    const freshLogin = await pendingLogin(request)
    const freshVerify = await verifyTotpChallenge(request, freshLogin.token, freshLogin.challengeId, totpSecret)
    expect(freshVerify.status).toBe(200)
    expect(freshVerify.body.ok).toBe(true)
  })
})
