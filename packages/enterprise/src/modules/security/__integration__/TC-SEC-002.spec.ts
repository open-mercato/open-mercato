import { expect, test, type Page } from '@playwright/test'
import {
  clearAuthCookie,
  createAdminApiToken,
  createUserFixture,
  deleteUserFixture,
  fetchJson,
  generateTotpCode,
  loginViaApi,
  setAuthCookie,
} from './helpers/securityFixtures'

type ProvidersResponse = {
  providers: Array<{ type: string }>
}

type MethodsResponse = {
  methods: Array<{ type: string }>
}

type TotpSetupResponse = {
  setupId?: string
  clientData?: {
    secret?: string
  }
}

type RecoveryCodesResponse = {
  recoveryCodes?: string[]
}

async function submitLoginForm(page: Page, email: string, password: string): Promise<void> {
  await clearAuthCookie(page)
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  const passwordInput = page.getByLabel('Password')
  await passwordInput.fill(password)
  await passwordInput.press('Enter')
}

async function waitForMfaChallenge(page: Page): Promise<void> {
  await expect(page.getByTestId('security-mfa-challenge-panel')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Two-factor authentication' })).toBeVisible()
}

async function openRecoveryCodeChallenge(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More options' }).click()
  await page.getByRole('button', { name: '2FA recovery code' }).click()
  await expect(page.getByLabel('Recovery code')).toBeVisible()
}

async function generateRecoveryCodesFromUi(page: Page): Promise<string[]> {
  await page.goto('/backend/profile/security/mfa/recovery-codes')
  await expect(page.getByRole('button', { name: 'Generate new recovery codes' })).toBeVisible()

  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST'
      && response.url().endsWith('/api/security/mfa/recovery-codes/regenerate'),
  )

  await page.getByRole('button', { name: 'Generate new recovery codes' }).click()

  const response = await responsePromise
  expect(response.status()).toBe(200)

  const body = await response.json() as RecoveryCodesResponse
  const recoveryCodes = Array.isArray(body.recoveryCodes) ? body.recoveryCodes : []
  expect(recoveryCodes).toHaveLength(10)
  await expect(page.getByText(recoveryCodes[0] ?? '')).toBeVisible()
  return recoveryCodes
}

/**
 * TC-SEC-002: TOTP enrollment, MFA login, and recovery codes
 * Source: .ai/qa/scenarios/TC-SEC-002-totp-enrollment-login-recovery-codes.md
 */
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

  test('enrolls TOTP in the UI, completes MFA login, uses a recovery code, and invalidates the old recovery set', async ({ request, page }) => {
    const firstLogin = await loginViaApi(request, userEmail, userPassword)
    const userToken = firstLogin.token

    const providerResponse = await fetchJson<ProvidersResponse>(
      request,
      'GET',
      '/api/security/mfa/providers',
      { token: userToken },
    )
    expect(providerResponse.status).toBe(200)
    expect(providerResponse.body.providers.map((provider) => provider.type)).toContain('totp')

    await setAuthCookie(page, userToken)
    await page.goto('/backend/profile/security/mfa')
    await expect(page.getByRole('button', { name: /Authenticator app/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Recovery codes/ })).toBeVisible()

    const setupResponsePromise = page.waitForResponse((response) =>
      response.request().method() === 'POST'
        && response.url().endsWith('/api/security/mfa/provider/totp'),
    )
    await page.goto('/backend/profile/security/mfa/totp')
    await expect(page.getByText('Scan the QR code')).toBeVisible()
    await expect(page.getByText('Verify the code from the app')).toBeVisible()

    const setupResponse = await setupResponsePromise
    expect(setupResponse.status()).toBe(200)
    const setupBody = await setupResponse.json() as TotpSetupResponse
    const secret = setupBody.clientData?.secret
    expect(typeof secret).toBe('string')

    await page.getByRole('button', { name: 'Use manual setup instead' }).click()
    await expect(page.getByText(secret as string)).toBeVisible()

    const confirmResponsePromise = page.waitForResponse((response) =>
      response.request().method() === 'PUT'
        && response.url().endsWith('/api/security/mfa/provider/totp'),
    )
    await page.getByPlaceholder('XXXXXX').fill(generateTotpCode(secret as string))
    await page.getByRole('button', { name: 'Save' }).click()

    const confirmResponse = await confirmResponsePromise
    expect(confirmResponse.status()).toBe(200)
    await expect(page).toHaveURL(/\/backend\/profile\/security\/mfa$/)
    await expect(page.getByRole('button', { name: /Authenticator app/ })).toBeVisible()
    await expect(page.getByText('Configured')).toBeVisible()

    const methodsResponse = await fetchJson<MethodsResponse>(
      request,
      'GET',
      '/api/security/mfa/methods',
      { token: userToken },
    )
    expect(methodsResponse.status).toBe(200)
    expect(methodsResponse.body.methods.map((method) => method.type)).toContain('totp')

    const initialRecoveryCodes = await generateRecoveryCodesFromUi(page)
    const consumedRecoveryCode = initialRecoveryCodes[0]
    expect(consumedRecoveryCode).toBeTruthy()

    await submitLoginForm(page, userEmail, userPassword)
    await waitForMfaChallenge(page)
    await page.getByLabel('Verification code').fill(generateTotpCode(secret as string))
    await page.getByRole('button', { name: 'Verify' }).click()
    await expect(page).toHaveURL(/\/backend$/)

    await submitLoginForm(page, userEmail, userPassword)
    await waitForMfaChallenge(page)
    await openRecoveryCodeChallenge(page)
    await page.getByLabel('Recovery code').fill(consumedRecoveryCode as string)
    await page.getByRole('button', { name: 'Verify' }).click()
    await expect(page).toHaveURL(/\/backend$/)

    const rotatedRecoveryCodes = await generateRecoveryCodesFromUi(page)
    expect(rotatedRecoveryCodes).toHaveLength(10)
    expect(rotatedRecoveryCodes).not.toContain(consumedRecoveryCode as string)

    await submitLoginForm(page, userEmail, userPassword)
    await waitForMfaChallenge(page)
    await openRecoveryCodeChallenge(page)
    await page.getByLabel('Recovery code').fill(consumedRecoveryCode as string)
    await page.getByRole('button', { name: 'Verify' }).click()
    await expect(page.getByRole('alert')).toContainText('Invalid recovery code.')
    await expect(page.getByTestId('security-mfa-challenge-panel')).toBeVisible()
  })
})
