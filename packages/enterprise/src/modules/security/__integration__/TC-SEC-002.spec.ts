import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Response } from '@playwright/test'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  clearAuthCookie,
  createAdminApiToken,
  createUserFixture,
  deleteUserFixture,
  enrollTotp,
  fetchJson,
  generateTotpCode,
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

const outageLocales = [
  {
    locale: 'en',
    password: 'Password',
    submit: 'Sign in',
    code: 'Verification code',
    error: 'An error occurred. Please try again.',
  },
  {
    locale: 'pl',
    password: 'Hasło',
    submit: 'Zaloguj się',
    code: 'Kod weryfikacyjny',
    error: 'Wystąpił błąd. Spróbuj ponownie.',
  },
]

function matchesEphemeralEnvironment(baseURL: string | undefined): baseURL is string {
  const databaseUrl = process.env.DATABASE_URL
  if (process.env.OM_INTEGRATION_TEST !== 'true' || !baseURL || !databaseUrl) return false

  try {
    const appRoot = process.env.OM_TEST_APP_ROOT || process.cwd()
    const state: { status?: unknown; baseUrl?: unknown; databaseUrl?: unknown } = JSON.parse(
      readFileSync(join(appRoot, '.ai', 'qa', 'ephemeral-env.json'), 'utf8'),
    )
    return state?.status === 'running' && state.baseUrl === baseURL && state.databaseUrl === databaseUrl
  } catch {
    return false
  }
}

for (const messages of outageLocales) {
  test(`TC-SEC-002: localized MFA outage and retry (${messages.locale})`, async ({ request, page, baseURL }) => {
    if (!matchesEphemeralEnvironment(baseURL)) {
      test.skip(true, 'Requires the app URL and database URL from the running ephemeral integration environment')
      return
    }
    const adminToken = await createAdminApiToken(request)
    const password = `Valid1!${randomUUID()}`
    const user = await createUserFixture(request, adminToken, { password })
    const constraint = `test_mfa_outage_${randomUUID().replaceAll('-', '')}`
    let outageInstalled = false
    const removeOutage = async () => {
      if (!outageInstalled) return
      await withClient(async (client) => {
        await client.query("set lock_timeout = '2s'")
        await client.query(`alter table mfa_challenges drop constraint if exists "${constraint}"`)
        outageInstalled = false
      })
    }
    const isLogin = (response: Response) =>
      new URL(response.url()).pathname === '/api/auth/login' && response.request().method() === 'POST'

    try {
      const login = await loginViaApi(request, user.email, password)
      const { secret } = await enrollTotp(request, login.token)
      await withClient(async (client) => {
        const { rowCount } = await client.query(
          'select 1 from user_mfa_methods where user_id = $1 and type = $2 and is_active',
          [user.id, 'totp'],
        )
        expect(rowCount, 'The disposable database must contain the TOTP enrollment just written by the app').toBe(1)
        const { rows } = await client.query<{ ddl: string }>(
          `select format('alter table mfa_challenges add constraint %I check (user_id <> %L::uuid) not valid',
            $1::text, $2::uuid) as ddl`,
          [constraint, user.id],
        )
        await client.query("set lock_timeout = '2s'")
        await client.query(rows[0].ddl)
        outageInstalled = true
      })

      await page.context().addCookies([{ name: 'locale', value: messages.locale, url: baseURL }])
      await page.goto('/login')
      await page.getByLabel('Email', { exact: true }).fill(user.email)
      const passwordInput = page.getByLabel(messages.password, { exact: true })
      await passwordInput.fill(password)
      const submit = page.getByRole('button', { name: messages.submit, exact: true })
      const [denied] = await Promise.all([page.waitForResponse(isLogin), submit.click()])
      expect(denied.status()).toBe(500)
      expect(await denied.json()).toEqual({ ok: false, error: messages.error })
      expect(await denied.headerValues('set-cookie')).toEqual([])
      await expect(page.getByRole('alert').and(page.getByText(messages.error, { exact: true }))).toBeVisible()
      await expect(submit).toBeEnabled()
      await expect(passwordInput).toBeEnabled()

      await removeOutage()
      const [pending] = await Promise.all([page.waitForResponse(isLogin), passwordInput.press('Enter')])
      expect(pending.status()).toBe(200)
      expect(await pending.json()).toMatchObject({ mfa_required: true, challenge_id: expect.any(String) })
      const codeInput = page.getByLabel(messages.code, { exact: true })
      await expect(codeInput).toBeVisible()
      await codeInput.fill(generateTotpCode(secret))
      await codeInput.press('Enter')
      await expect(page).toHaveURL(/\/backend(?:[/?#]|$)/)
    } finally {
      try {
        await removeOutage()
      } finally {
        await deleteUserFixture(request, adminToken, user.id)
      }
    }
  })
}
