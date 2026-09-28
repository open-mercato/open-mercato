import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { CAMPAIGNS_PATH, createCampaign, deleteCampaignIfExists } from './helpers/marketing'
import fs from 'node:fs'
import path from 'node:path'
import { resolveTrackingSecret, trackingSecretEnvNames } from '../lib/tracking/secret'
import { signTrackingToken } from '../lib/tracking/token'
import { TRACK_CLICK_PATH, TRACK_OPEN_PATH, TRACKING_TOKEN_PARAM } from '../lib/tracking/urls'

type Counts = {
  sends: { sent: number; suppressed: number }
  events: { delivered: number; opened: number; clicked: number; bounced: number }
  uniqueRecipients: { opened: number; clicked: number }
}

/**
 * The secret the SERVER signs with, which is what the test has to mint tokens with.
 *
 * The app process gets it from `apps/mercato/.env`; this process may not, depending on how the run
 * was launched. Falling back to reading that file keeps the suite meaningful locally instead of
 * skipping itself into silence, while `process.env` still wins so CI can inject a secret.
 */
function readTrackingSecret(): string | null {
  const fromEnv = resolveTrackingSecret()
  if (fromEnv) return fromEnv
  const envFile = path.resolve(process.cwd(), 'apps/mercato/.env')
  if (!fs.existsSync(envFile)) return null
  const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/)
  const values: Record<string, string> = {}
  for (const line of lines) {
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

// The endpoints are inert without a signing secret, so the suite says so instead of failing
// mysteriously on an installation that has not configured one.
test.skip(!secret, 'no tracking secret configured in this environment')

async function counts(request: Parameters<typeof apiRequest>[0], token: string, id: string): Promise<Counts> {
  const response = await apiRequest(request, 'GET', `${CAMPAIGNS_PATH}/${id}/tracking`, { token })
  if (!response.ok()) throw new Error(`tracking read failed: ${response.status()}`)
  const body = await readJsonSafe<Counts>(response)
  if (!body) throw new Error('tracking read returned no body')
  return body
}

/**
 * The caller's scope, read from its own JWT.
 *
 * A tracking token has to carry the tenant and organization it writes into — the endpoints are
 * public and have no session to infer them from — so the test needs the same scope the API would
 * have used. There is no endpoint that reports it, and the claims are right there in the token the
 * helper already obtained.
 */
function callerScope(jwt: string): { tenantId: string; organizationId: string } {
  const [, payload] = jwt.split('.')
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
  const tenantId = typeof claims.tenantId === 'string' ? claims.tenantId : ''
  const organizationId = typeof claims.orgId === 'string'
    ? claims.orgId
    : typeof claims.organizationId === 'string' ? claims.organizationId : ''
  // Loud rather than skipped: without a scope the whole suite would pass while asserting nothing.
  expect(tenantId, 'the session token must carry a tenant').toBeTruthy()
  expect(organizationId, 'the session token must carry an organization').toBeTruthy()
  return { tenantId, organizationId }
}

function tokenFor(input: {
  tenantId: string
  organizationId: string
  campaignId: string
  runId: string
  purpose: 'open' | 'click'
  target?: string
}): string {
  return signTrackingToken({ ...input, stepId: 'step-1' }, secret as string)
}

/**
 * TC-MA-008: the tracking endpoints.
 *
 * They are the only PUBLIC surface this module has, so what matters is as much what they refuse as
 * what they record: an unsigned token must change nothing, and a destination nobody signed must not
 * be redirected to.
 */
test.describe('TC-MA-008 delivery tracking', () => {
  test('records an open, and keeps answering with a pixel whatever the token is', async ({ request }) => {
    const authToken = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, authToken, `QA tracking ${Date.now()}`)
      const before = await counts(request, authToken, campaignId)
      const scoped = await apiRequest(request, 'GET', `${CAMPAIGNS_PATH}/${campaignId}`, { token: authToken })
      const campaign = await readJsonSafe<{ id: string }>(scoped)
      expect(campaign?.id).toBe(campaignId)

      // The scope has to come from the token, since the request carries no session at all.
      const { tenantId, organizationId } = callerScope(authToken)
      expect(tenantId, 'the test needs the caller scope to mint a token').toBeTruthy()
      expect(organizationId).toBeTruthy()

      const open = tokenFor({ tenantId, organizationId, campaignId, runId: '11111111-1111-4111-8111-111111111111', purpose: 'open' })
      const pixel = await request.get(`${TRACK_OPEN_PATH}?${TRACKING_TOKEN_PARAM}=${open}`)
      expect(pixel.status()).toBe(200)
      expect(pixel.headers()['content-type']).toContain('image/gif')
      // A cached pixel would silently stop recording every open after the first.
      expect(pixel.headers()['cache-control']).toContain('no-store')

      const after = await counts(request, authToken, campaignId)
      expect(after.events.opened).toBe(before.events.opened + 1)
      expect(after.uniqueRecipients.opened).toBe(1)

      // A second fetch from the same recipient is a second event but the same person.
      await request.get(`${TRACK_OPEN_PATH}?${TRACKING_TOKEN_PARAM}=${open}`)
      const twice = await counts(request, authToken, campaignId)
      expect(twice.events.opened).toBe(before.events.opened + 2)
      expect(twice.uniqueRecipients.opened).toBe(1)
    } finally {
      await deleteCampaignIfExists(request, authToken, campaignId)
    }
  })

  test('records a click and redirects to the signed destination', async ({ request }) => {
    const authToken = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, authToken, `QA tracking click ${Date.now()}`)
      const { tenantId, organizationId } = callerScope(authToken)

      const target = 'https://example.com/offer?utm=qa'
      const click = tokenFor({
        tenantId, organizationId, campaignId,
        runId: '22222222-2222-4222-8222-222222222222',
        purpose: 'click',
        target,
      })
      const response = await request.get(`${TRACK_CLICK_PATH}?${TRACKING_TOKEN_PARAM}=${click}`, { maxRedirects: 0 })
      expect(response.status()).toBe(302)
      expect(response.headers().location).toBe(target)

      const after = await counts(request, authToken, campaignId)
      expect(after.events.clicked).toBe(1)
    } finally {
      await deleteCampaignIfExists(request, authToken, campaignId)
    }
  })

  test('an unsigned or tampered token records nothing', async ({ request }) => {
    const authToken = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, authToken, `QA tracking forged ${Date.now()}`)
      const forged = Buffer.from(JSON.stringify({
        v: 1, t: '33333333-3333-4333-8333-333333333333', o: '44444444-4444-4444-8444-444444444444',
        c: campaignId, r: '55555555-5555-4555-8555-555555555555', s: 'step-1', p: 'open',
      })).toString('base64url')

      for (const token of [`${forged}.notasignature`, 'garbage', '']) {
        const pixel = await request.get(`${TRACK_OPEN_PATH}?${TRACKING_TOKEN_PARAM}=${token}`)
        // Still a pixel: a broken image in an inbox is worse than a lost statistic, and an error
        // status would tell a prober which tokens are real.
        expect(pixel.status()).toBe(200)
        const click = await request.get(`${TRACK_CLICK_PATH}?${TRACKING_TOKEN_PARAM}=${token}`, { maxRedirects: 0 })
        expect(click.status()).toBe(404)
      }

      const after = await counts(request, authToken, campaignId)
      expect(after.events.opened).toBe(0)
      expect(after.events.clicked).toBe(0)
    } finally {
      await deleteCampaignIfExists(request, authToken, campaignId)
    }
  })

  // Signed by us is not the same as safe: the author writes the links.
  test('refuses to redirect to a destination that is not http(s)', async ({ request }) => {
    const authToken = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, authToken, `QA tracking scheme ${Date.now()}`)
      const { tenantId, organizationId } = callerScope(authToken)

      for (const target of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', '/relative']) {
        const token = tokenFor({
          tenantId, organizationId, campaignId,
          runId: '66666666-6666-4666-8666-666666666666',
          purpose: 'click',
          target,
        })
        const response = await request.get(`${TRACK_CLICK_PATH}?${TRACKING_TOKEN_PARAM}=${token}`, { maxRedirects: 0 })
        expect(response.status(), target).toBe(404)
      }

      expect((await counts(request, authToken, campaignId)).events.clicked).toBe(0)
    } finally {
      await deleteCampaignIfExists(request, authToken, campaignId)
    }
  })

  test('an open token cannot be replayed as a click, or the other way round', async ({ request }) => {
    const authToken = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, authToken, `QA tracking purpose ${Date.now()}`)
      const { tenantId, organizationId } = callerScope(authToken)
      const runId = '77777777-7777-4777-8777-777777777777'

      const openToken = tokenFor({ tenantId, organizationId, campaignId, runId, purpose: 'open' })
      const clickToken = tokenFor({ tenantId, organizationId, campaignId, runId, purpose: 'click', target: 'https://example.com/x' })

      expect((await request.get(`${TRACK_CLICK_PATH}?${TRACKING_TOKEN_PARAM}=${openToken}`, { maxRedirects: 0 })).status()).toBe(404)
      const pixel = await request.get(`${TRACK_OPEN_PATH}?${TRACKING_TOKEN_PARAM}=${clickToken}`)
      expect(pixel.status()).toBe(200)

      const after = await counts(request, authToken, campaignId)
      expect(after.events.opened).toBe(0)
      expect(after.events.clicked).toBe(0)
    } finally {
      await deleteCampaignIfExists(request, authToken, campaignId)
    }
  })

  test('the counts are refused to a principal without runs.view', async ({ request }) => {
    const authToken = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, authToken, `QA tracking acl ${Date.now()}`)
      const response = await request.get(`${CAMPAIGNS_PATH}/${campaignId}/tracking`)
      expect([401, 403]).toContain(response.status())
    } finally {
      await deleteCampaignIfExists(request, authToken, campaignId)
    }
  })
})
