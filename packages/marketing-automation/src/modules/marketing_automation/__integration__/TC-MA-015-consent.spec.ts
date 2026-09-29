import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { resolveTrackingSecret, trackingSecretEnvNames } from '../lib/tracking/secret'
import { signTrackingToken } from '../lib/tracking/token'
import { TRACKING_TOKEN_PARAM, UNSUBSCRIBE_PATH } from '../lib/tracking/urls'

/** Same fallback as TC-MA-008: the app has the secret, this process may not. */
function readTrackingSecret(): string | null {
  const fromEnv = resolveTrackingSecret()
  if (fromEnv) return fromEnv
  const envFile = path.resolve(process.cwd(), 'apps/mercato/.env')
  if (!fs.existsSync(envFile)) return null
  const values: Record<string, string> = {}
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  for (const name of trackingSecretEnvNames()) {
    const value = values[name]?.trim()
    if (value) return value
  }
  return null
}

const secret = readTrackingSecret()
test.skip(!secret, 'no tracking secret configured in this environment')

function callerScope(jwt: string): { tenantId: string; organizationId: string } {
  const [, payload] = jwt.split('.')
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
  const tenantId = typeof claims.tenantId === 'string' ? claims.tenantId : ''
  const organizationId = typeof claims.orgId === 'string' ? claims.orgId : ''
  expect(tenantId).toBeTruthy()
  expect(organizationId).toBeTruthy()
  return { tenantId, organizationId }
}

/**
 * TC-MA-015: consent and one-click unsubscribe.
 *
 * The public endpoint's contract is unusual and worth pinning: it must never CLAIM success it did not
 * achieve, because somebody who believes they unsubscribed and did not is the worst outcome this feature
 * can produce — worse than an honest error.
 */
test.describe('TC-MA-015 consent and unsubscribe', () => {
  test('an unusable link says so instead of confirming', async ({ request }) => {
    for (const token of ['garbage', '']) {
      const response = await request.get(`${UNSUBSCRIBE_PATH}?${TRACKING_TOKEN_PARAM}=${token}`)
      expect(response.status()).toBe(400)
      const html = await response.text()
      expect(html).toContain('not valid')
      expect(html.toLowerCase()).not.toContain('you have been unsubscribed')
    }
  })

  test('an open token cannot be replayed as an unsubscribe', async ({ request }) => {
    const authToken = await getAuthToken(request, 'admin')
    const scope = callerScope(authToken)
    const openToken = signTrackingToken({
      ...scope,
      campaignId: '11111111-1111-4111-8111-111111111111',
      runId: '22222222-2222-4222-8222-222222222222',
      stepId: 'step-1',
      purpose: 'open',
    }, secret as string)

    const response = await request.get(`${UNSUBSCRIBE_PATH}?${TRACKING_TOKEN_PARAM}=${openToken}`)
    expect(response.status()).toBe(400)
  })

  /**
   * A GET never unsubscribes anybody — it asks.
   *
   * Every URL in an email is fetched by things that are not the recipient: SafeLinks, antivirus gateways,
   * proxies, chat unfurlers. A GET that opted somebody out let any of them do it on that person's behalf,
   * indistinguishably from a real click.
   */
  test('following the link asks rather than acting', async ({ request }) => {
    const authToken = await getAuthToken(request, 'admin')
    const scope = callerScope(authToken)
    const token = signTrackingToken({
      ...scope,
      campaignId: '11111111-1111-4111-8111-111111111111',
      runId: '33333333-3333-4333-8333-333333333333',
      stepId: 'step-1',
      purpose: 'unsubscribe',
    }, secret as string)

    const response = await request.get(`${UNSUBSCRIBE_PATH}?${TRACKING_TOKEN_PARAM}=${token}`)
    expect(response.status()).toBe(200)
    const html = await response.text()
    // It offers the action and claims nothing.
    expect(html).toContain('method="post"')
    expect(html.toLowerCase()).not.toContain('you have been unsubscribed')
    // The run above does not exist, so an endpoint that had acted would have had to answer 404 instead.
  })

  // A correctly signed link for a run that no longer exists must not pretend: there is nobody to
  // unsubscribe, and saying otherwise leaves somebody subscribed while believing they are not.
  test('a signed link for an unknown run answers honestly rather than confirming', async ({ request }) => {
    const authToken = await getAuthToken(request, 'admin')
    const scope = callerScope(authToken)
    const token = signTrackingToken({
      ...scope,
      campaignId: '11111111-1111-4111-8111-111111111111',
      runId: '33333333-3333-4333-8333-333333333333',
      stepId: 'step-1',
      purpose: 'unsubscribe',
    }, secret as string)

    const response = await request.post(`${UNSUBSCRIBE_PATH}?${TRACKING_TOKEN_PARAM}=${token}`)
    expect(response.status()).toBe(404)
    const html = await response.text()
    expect(html.toLowerCase()).not.toContain('you have been unsubscribed')
  })

  test('answers HTML with no-store and no referrer, because a mail client opens it', async ({ request }) => {
    const response = await request.get(`${UNSUBSCRIBE_PATH}?${TRACKING_TOKEN_PARAM}=garbage`)
    expect(response.headers()['content-type']).toContain('text/html')
    expect(response.headers()['cache-control']).toContain('no-store')
    expect(await response.text()).toContain('referrer')
  })

  // RFC 8058 clients POST, and that single action is what actually unsubscribes — so an unusable token must
  // fail the same way on both verbs.
  test('POST rejects an unusable token the same way', async ({ request }) => {
    const response = await request.post(`${UNSUBSCRIBE_PATH}?${TRACKING_TOKEN_PARAM}=garbage`)
    expect(response.status()).toBe(400)
    expect(response.headers()['content-type']).toContain('text/html')
  })

  test('the customer profile reports consent, including that none is recorded', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const list = await apiRequest(request, 'GET', '/api/customers/people?pageSize=1', { token })
    const people = await readJsonSafe<{ items?: Array<{ id?: string; entityId?: string }> }>(list)
    const customerId = people?.items?.[0]?.entityId ?? people?.items?.[0]?.id
    test.skip(!customerId, 'no customer available in this installation')

    const response = await apiRequest(request, 'GET', `/api/marketing_automation/customers/${customerId}/profile`, { token })
    expect(response.ok(), await response.text()).toBe(true)
    const profile = await readJsonSafe<{ consent?: { email?: string | null } }>(response)
    // Null, not false: "nothing on record" and "said no" are different facts and the screen shows both.
    expect(profile?.consent).toBeDefined()
    expect([null, 'subscribed', 'unsubscribed']).toContain(profile?.consent?.email ?? null)
  })
})
