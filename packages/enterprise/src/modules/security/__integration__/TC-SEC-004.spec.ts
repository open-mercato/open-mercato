import { expect, test } from '@playwright/test'
import {
  configureVirtualWebAuthn,
  createAdminApiToken,
  createUserFixture,
  deleteUserFixture,
  loginWithCredentials,
  logout,
} from './helpers/securityFixtures'

/**
 * TC-SEC-004: Passkey enrollment and MFA login
 * Source: .ai/qa/scenarios/TC-SEC-004-passkey-enrollment-and-login.md
 */
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

  test('enrolls a passkey from the security profile and completes a later MFA login with the same credential', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Passkey coverage requires Chromium so the test can provision a virtual authenticator.')

    const firstLoginState = await loginWithCredentials(page, userEmail, userPassword)
    expect(firstLoginState).toBe('backend')

    await page.goto('/backend/profile/security/mfa')
    const securityKeysButton = page.getByRole('button', { name: /Security keys/i })
    await expect(securityKeysButton).toBeVisible()
    await securityKeysButton.click()

    await expect(page).toHaveURL(/\/backend\/profile\/security\/mfa\/passkey$/)
    await expect(page.getByPlaceholder(/Enter a nickname for this security key/i)).toBeVisible()

    const webauthn = await configureVirtualWebAuthn(page)
    test.skip(!webauthn.supported, webauthn.reason ?? 'WebAuthn is unavailable in the current runtime.')

    try {
      const passkeyLabel = `QA passkey ${Date.now()}`
      await page.getByPlaceholder(/Enter a nickname for this security key/i).fill(passkeyLabel)
      await page.getByRole('button', { name: /^Add$/i }).click()

      await expect(page.getByText('Passkey enabled.')).toBeVisible()
      await expect(page.getByText(passkeyLabel)).toBeVisible()

      await page.goto('/backend/profile/security/mfa')
      await expect(securityKeysButton).toBeVisible()
      await expect(securityKeysButton).toContainText('1 key')

      await logout(page)

      const secondLoginState = await loginWithCredentials(page, userEmail, userPassword)
      expect(secondLoginState).toBe('mfa')

      const challengePanel = page.getByTestId('security-mfa-challenge-panel')
      await expect(challengePanel).toBeVisible()

      const verifyWithPasskeyButton = page.getByRole('button', { name: /Verify with passkey|Use passkey/i })
      await expect(verifyWithPasskeyButton).toBeVisible()
      await verifyWithPasskeyButton.click()

      await page.waitForURL(/\/backend(?:\/.*)?$/, { timeout: 10_000 })
      await expect(page).toHaveURL(/\/backend(?:\/.*)?$/)
    } finally {
      await webauthn.cleanup()
    }
  })
})
