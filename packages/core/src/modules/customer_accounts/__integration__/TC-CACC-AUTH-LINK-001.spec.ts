import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCustomerUserFixture,
  deleteCustomerUserFixture,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'

/**
 * TC-CACC-AUTH-LINK-001: password-reset and magic-link tokens are delivered by email (#5959)
 *
 * Both request endpoints used to mint a single-use token, drop the raw value and
 * emit an event no subscriber consumed, so no email was ever sent. The raw token
 * is never returned by the API, so it is read out of the captured email — the
 * only channel that carries it — and redeemed against the real confirm/verify
 * endpoints, proving the delivered link actually works end to end.
 */

type CapturedEmail = { to?: string; links?: string[] }

const EMAIL_CAPTURE_PATH = process.env.OM_TEST_EMAIL_CAPTURE_PATH?.trim()
  || join(process.cwd(), '.ai', 'qa', 'email-capture.jsonl')

async function readCapturedEmails(): Promise<CapturedEmail[]> {
  try {
    const raw = await readFile(EMAIL_CAPTURE_PATH, 'utf8')
    return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line) as CapturedEmail)
  } catch {
    return []
  }
}

async function waitForLinkToken(to: string, pathFragment: string): Promise<string> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const tokens = (await readCapturedEmails())
      .filter((entry) => entry.to?.toLowerCase() === to.toLowerCase())
      .flatMap((entry) => entry.links ?? [])
      .filter((link) => link.includes(`${pathFragment}?token=`))
      .map((link) => new URL(link).searchParams.get('token'))
      .filter((token): token is string => !!token)
    if (tokens.length > 0) return tokens[tokens.length - 1]
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`[internal] timed out waiting for a captured ${pathFragment} email to ${to}`)
}

async function postJson(request: APIRequestContext, path: string, data: Record<string, unknown>) {
  return request.post(path, { data, headers: { 'Content-Type': 'application/json' } })
}

test.describe('TC-CACC-AUTH-LINK-001: portal auth links are delivered and redeemable', () => {
  test('password reset request emails a working reset link', async ({ request }) => {
    const stamp = Date.now()
    const email = `qa-cacc-reset-${stamp}@test.local`
    const newPassword = `NewPassword${stamp}!`
    let adminToken: string | null = null
    let userId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const { tenantId } = getTokenContext(adminToken)
      const user = await createCustomerUserFixture(request, adminToken, { email })
      userId = user.id

      const requestRes = await postJson(request, '/api/customer_accounts/password/reset-request', { email, tenantId })
      expect(requestRes.status()).toBe(200)
      expect(JSON.stringify(await requestRes.json()), 'raw token must not be returned by the API').not.toContain('token')

      const token = await waitForLinkToken(email, '/reset-password')

      const confirmRes = await postJson(request, '/api/customer_accounts/password/reset-confirm', { token, password: newPassword })
      expect(confirmRes.status(), 'token from the delivered reset email should be accepted').toBe(200)

      const session = await portalLogin(request, { email, password: newPassword, tenantId })
      expect(session.authToken).toBeTruthy()

      const reuseRes = await postJson(request, '/api/customer_accounts/password/reset-confirm', { token, password: `Other${stamp}!aA` })
      expect(reuseRes.status(), 'a reset token is single-use').toBe(400)
    } finally {
      await deleteCustomerUserFixture(request, adminToken, userId)
    }
  })

  test('magic link request emails a working sign-in link', async ({ request }) => {
    const stamp = Date.now()
    const email = `qa-cacc-magic-${stamp}@test.local`
    let adminToken: string | null = null
    let userId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const { tenantId } = getTokenContext(adminToken)
      const user = await createCustomerUserFixture(request, adminToken, { email })
      userId = user.id

      const requestRes = await postJson(request, '/api/customer_accounts/magic-link/request', { email, tenantId })
      expect(requestRes.status()).toBe(200)

      const token = await waitForLinkToken(email, '/magic-link')

      const verifyRes = await postJson(request, '/api/customer_accounts/magic-link/verify', { token })
      expect(verifyRes.status(), 'token from the delivered magic-link email should sign the user in').toBe(200)
      const verifyBody = (await verifyRes.json()) as { ok: boolean; user: { email: string } }
      expect(verifyBody.ok).toBe(true)
      expect(verifyBody.user.email.toLowerCase()).toBe(email.toLowerCase())
      expect(verifyRes.headers()['set-cookie'] ?? '').toContain('customer_auth_token=')
    } finally {
      await deleteCustomerUserFixture(request, adminToken, userId)
    }
  })
})
