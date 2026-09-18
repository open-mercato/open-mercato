import { expect, test } from '@playwright/test'
import { postForm, withCredentialIsolatedRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
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
// One over `securityConfig.mfa.maxAttempts` (5), which expires the challenge. Staying well under
// the verify route's own limiter (`points: 10, duration: 60`) keeps a lockout-status change from
// exhausting the limiter and failing the later assertions as a confusing 429 instead.
const MAX_WRONG_VERIFY_PROBES = 6

function setCookieHeaders(response: { headersArray: () => Array<{ name: string; value: string }> }): string[] {
  return response.headersArray().filter((header) => header.name.toLowerCase() === 'set-cookie').map((header) => header.value)
}

function readSetCookie(response: { headersArray: () => Array<{ name: string; value: string }> }, name: string): string | undefined {
  return setCookieHeaders(response).find((value) => value.startsWith(`${name}=`))
}

function readCookieValue(setCookie: string | undefined): string | null {
  if (!setCookie) return null
  const raw = setCookie.slice(setCookie.indexOf('=') + 1).split(';')[0]
  return raw ? decodeURIComponent(raw) : null
}

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

test.describe('TC-SEC-014: MFA-pending tokens are rejected by general staff APIs (#5212)', () => {
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

    const prepare = await fetchJson<{ ok?: boolean; clientData?: Record<string, unknown> }>(
      request,
      'POST',
      '/api/security/mfa/prepare',
      { token, data: { challengeId, methodType: 'totp' } },
    )
    expect(prepare.status).toBe(200)
    expect(prepare.body.ok).toBe(true)

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
    for (let attempt = 0; attempt < MAX_WRONG_VERIFY_PROBES; attempt += 1) {
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

  test('a remember-me session_token planted before enrollment cannot be traded for a full staff token while MFA is pending', async () => {
    await withCredentialIsolatedRequest(async (isolated) => {
      const fixture = await createUserFixture(isolated, adminToken, { password: userPassword })
      try {
        const rememberLogin = await postForm(isolated, '/api/auth/login', {
          email: fixture.email,
          password: userPassword,
          remember: 'on',
        })
        expect(rememberLogin.status()).toBe(200)
        const rememberBody = await rememberLogin.json() as { token: string; mfa_required?: boolean }
        expect(rememberBody.mfa_required).toBeFalsy()
        const plantedSessionToken = readCookieValue(readSetCookie(rememberLogin, 'session_token'))
        expect(plantedSessionToken).toBeTruthy()

        await enrollTotp(isolated, rememberBody.token)

        const challengeLogin = await postForm(isolated, '/api/auth/login', {
          email: fixture.email,
          password: userPassword,
          remember: 'on',
        })
        expect(challengeLogin.status()).toBe(200)
        const challengeBody = await challengeLogin.json() as { token: string; mfa_required?: boolean }
        expect(challengeBody.mfa_required).toBe(true)

        const clearedSessionCookie = readSetCookie(challengeLogin, 'session_token')
        expect(clearedSessionCookie).toBeTruthy()
        expect(clearedSessionCookie).toMatch(/session_token=;/)
        expect(clearedSessionCookie).toMatch(/max-age=0/i)

        await withCredentialIsolatedRequest(async (replay) => {
          const refresh = await replay.fetch(`${BASE_URL}/api/auth/session/refresh?redirect=%2Fbackend`, {
            method: 'GET',
            maxRedirects: 0,
            headers: {
              cookie: `auth_token=${encodeURIComponent(challengeBody.token)}; session_token=${encodeURIComponent(plantedSessionToken as string)}`,
            },
          })
          const refreshedAuthCookie = readSetCookie(refresh, 'auth_token')
          expect(refreshedAuthCookie).toBeTruthy()
          expect(refreshedAuthCookie).toMatch(/auth_token=;/)
          expect(refreshedAuthCookie).toMatch(/max-age=0/i)
          expect(refresh.headers()['location'] ?? '').toContain('/login')
        })
      } finally {
        await deleteUserFixture(isolated, adminToken, fixture.id)
      }
    })
  })
})
