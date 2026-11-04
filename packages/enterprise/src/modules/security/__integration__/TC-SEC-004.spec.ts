import { expect, test } from '@playwright/test'
import {
  attemptUnsignedPasskeyVerify,
  createAdminApiToken,
  createPasskeyAuthenticator,
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

  test('requires verified registration and authenticates multiple genuine passkeys', async ({ request, page, browser, browserName }) => {
    test.setTimeout(60_000)
    test.skip(browserName !== 'chromium', 'Passkey coverage is only exercised on Chromium in this suite.')

    const firstLogin = await loginViaApi(request, userEmail, userPassword)
    const userToken = firstLogin.token

    const webauthnBaseUrl = new URL(process.env.BASE_URL || 'http://localhost:3000')
    if (webauthnBaseUrl.hostname === '127.0.0.1') webauthnBaseUrl.hostname = 'localhost'
    await setAuthCookie(page, userToken, webauthnBaseUrl.origin)
    await page.goto(new URL('/backend/profile/security/mfa', webauthnBaseUrl).href)
    await expect(page.getByRole('button', { name: /Security keys/ })).toBeVisible()

    await page.goto(new URL('/backend/profile/security/mfa/passkey', webauthnBaseUrl).href)
    const browserHasWebAuthn = await page.evaluate(() => typeof window.PublicKeyCredential !== 'undefined')
    expect(browserHasWebAuthn, 'Chromium must support the WebAuthn registration ceremony').toBe(true)

    await expect(page.getByRole('button', { name: 'Add' })).toBeVisible()

    const invalidSetup = await fetchJson<{ setupId: string; clientData: { challenge: string } }>(
      request, 'POST', '/api/security/mfa/provider/passkey', { token: userToken, data: { label: 'Unverified' } },
    )
    expect(invalidSetup.status).toBe(200)
    for (const payload of [
      { credentialId: 'unverified-key', publicKey: 'AQIDBA', challenge: invalidSetup.body.clientData.challenge },
      { response: null },
    ]) {
      const rejected = await fetchJson<{ ok?: boolean }>(request, 'PUT', '/api/security/mfa/provider/passkey', {
        token: userToken,
        data: { setupId: invalidSetup.body.setupId, payload },
      })
      expect(rejected.status).toBe(400)
      expect(rejected.body.ok).toBeFalsy()
    }
    const beforeEnrollment = await fetchJson<{ methods: unknown[] }>(request, 'GET', '/api/security/mfa/methods', { token: userToken })
    expect(beforeEnrollment.status).toBe(200)
    expect(beforeEnrollment.body.methods).toEqual([])

    const removeAuthenticator = await createPasskeyAuthenticator(page)
    const secondaryContext = await browser.newContext()
    const secondPage = await secondaryContext.newPage()
    let removeSecondAuthenticator: (() => Promise<void>) | undefined
    try {
      await secondPage.goto(new URL('/login', page.url()).href)
      removeSecondAuthenticator = await createPasskeyAuthenticator(secondPage)
      const enrollment = await enrollPasskey(request, userToken, page, 'Primary passkey')
      const secondEnrollment = await enrollPasskey(request, userToken, secondPage, 'Backup passkey')
      expect(secondEnrollment.credentialId).not.toBe(enrollment.credentialId)
      const credentialPages = new Map([
        [enrollment.credentialId, page],
        [secondEnrollment.credentialId, secondPage],
      ])

      const methodsResponse = await fetchJson<{ methods: Array<{ id: string; type: string; providerMetadata: { credentialId: string } }> }>(
        request,
        'GET',
        '/api/security/mfa/methods',
        { token: userToken },
      )
      expect(methodsResponse.status).toBe(200)
      expect(methodsResponse.body.methods.map((method) => method.type)).toEqual(['passkey', 'passkey'])

      const pendingLogin = await loginViaApi(request, userEmail, userPassword)
      expect(pendingLogin.available_methods?.map((method) => method.type)).toContain('passkey')

      for (const method of ['POST', 'PUT'] as const) {
        const deniedEnrollment = await fetchJson(request, method, '/api/security/mfa/provider/passkey', {
          token: pendingLogin.token,
          data: { setupId: invalidSetup.body.setupId, payload: {} },
        })
        expect(deniedEnrollment.status).toBe(401)
      }

      const unsignedVerify = await attemptUnsignedPasskeyVerify(
        request,
        pendingLogin.token,
        pendingLogin.challenge_id as string,
        enrollment.credentialId,
      )
      expect(unsignedVerify.status).toBe(401)
      expect(unsignedVerify.body.ok).toBeFalsy()
      expect(unsignedVerify.body.token).toBeFalsy()

      const verified = await verifyPasskeyChallenge(request, pendingLogin.token, pendingLogin.challenge_id as string, credentialPages)
      expect(verified.status).toBe(200)
      expect(verified.body.ok).toBe(true)
      expect(verified.body.token).toBeTruthy()
      const selectedMethod = methodsResponse.body.methods.find((method) => method.providerMetadata.credentialId === verified.credentialId)
      expect(selectedMethod).toBeTruthy()
      if (!selectedMethod || !verified.body.token) throw new Error('Signed verification must identify the enrolled method and issue a token')
      const removed = await fetchJson(request, 'DELETE', `/api/security/mfa/methods/${selectedMethod.id}`, { token: verified.body.token })
      expect(removed.status).toBe(200)

      const remainingLogin = await loginViaApi(request, userEmail, userPassword)
      const remainingVerified = await verifyPasskeyChallenge(request, remainingLogin.token, remainingLogin.challenge_id as string, credentialPages)
      expect(remainingVerified.status).toBe(200)
      expect(remainingVerified.body.ok).toBe(true)
      expect(remainingVerified.credentialId).not.toBe(verified.credentialId)
    } finally {
      await removeSecondAuthenticator?.()
      await secondaryContext.close()
      await removeAuthenticator()
    }
  })
})
