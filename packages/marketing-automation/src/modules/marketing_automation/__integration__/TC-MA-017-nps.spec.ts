import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { CAMPAIGNS_PATH, createCampaign, deleteCampaignIfExists } from './helpers/marketing'
import { resolveTrackingSecret, trackingSecretEnvNames } from '../lib/tracking/secret'
import { signTrackingToken } from '../lib/tracking/token'
import { SURVEY_ANSWER_PATH, TRACKING_TOKEN_PARAM } from '../lib/tracking/urls'

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
  return {
    tenantId: typeof claims.tenantId === 'string' ? claims.tenantId : '',
    organizationId: typeof claims.orgId === 'string' ? claims.orgId : '',
  }
}

/**
 * TC-MA-017: the NPS survey.
 *
 * The score lives INSIDE the signature, so the interesting assertions are about what a recipient cannot do:
 * change their answer by editing the URL, answer with a value off the scale, or replay another kind of
 * token as an answer.
 */
test.describe('TC-MA-017 NPS survey', () => {
  test('the palette offers the step with its two fields', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', '/api/marketing_automation/palette', { token })
    const body = await readJsonSafe<{ steps?: Array<{ type?: string; channel?: string | null; uiFields?: Array<{ name?: string }> }> }>(response)
    const step = (body?.steps ?? []).find((entry) => entry.type === 'nps_survey')
    expect(step).toBeTruthy()
    // It declares a channel, which is what makes consent, quiet hours and the frequency cap apply to it.
    expect(step?.channel).toBe('email')
    expect((step?.uiFields ?? []).map((field) => field.name)).toEqual(['subject', 'question'])
  })

  test('a score off the scale is refused, however it is signed', async ({ request }) => {
    const authToken = await getAuthToken(request, 'admin')
    const scope = callerScope(authToken)
    for (const target of ['11', '-1', '3.5', 'seven', '']) {
      const token = signTrackingToken({
        ...scope,
        campaignId: '11111111-1111-4111-8111-111111111111',
        runId: '22222222-2222-4222-8222-222222222222',
        stepId: 's1',
        purpose: 'survey',
        target,
      }, secret as string)
      const response = await request.get(`${SURVEY_ANSWER_PATH}?${TRACKING_TOKEN_PARAM}=${token}`)
      expect(response.status(), target).toBe(400)
    }
  })

  test('another kind of token cannot be replayed as an answer', async ({ request }) => {
    const authToken = await getAuthToken(request, 'admin')
    const scope = callerScope(authToken)
    for (const purpose of ['open', 'click', 'unsubscribe'] as const) {
      const token = signTrackingToken({
        ...scope,
        campaignId: '11111111-1111-4111-8111-111111111111',
        runId: '22222222-2222-4222-8222-222222222222',
        stepId: 's1',
        purpose,
        target: purpose === 'click' ? 'https://example.com' : undefined,
      }, secret as string)
      const response = await request.get(`${SURVEY_ANSWER_PATH}?${TRACKING_TOKEN_PARAM}=${token}`)
      expect(response.status(), purpose).toBe(400)
    }
  })

  // An answer with nowhere to attach must not be confirmed: somebody would believe they had been heard.
  test('a valid answer for a survey that was never asked says so', async ({ request }) => {
    const authToken = await getAuthToken(request, 'admin')
    const scope = callerScope(authToken)
    const token = signTrackingToken({
      ...scope,
      campaignId: '11111111-1111-4111-8111-111111111111',
      runId: '33333333-3333-4333-8333-333333333333',
      stepId: 's1',
      purpose: 'survey',
      target: '9',
    }, secret as string)
    const response = await request.get(`${SURVEY_ANSWER_PATH}?${TRACKING_TOKEN_PARAM}=${token}`)
    expect(response.status()).toBe(404)
    expect((await response.text()).toLowerCase()).not.toContain('thank you')
  })

  test('answers HTML with no-store and no referrer, because a mail client opens it', async ({ request }) => {
    const response = await request.get(`${SURVEY_ANSWER_PATH}?${TRACKING_TOKEN_PARAM}=garbage`)
    expect(response.headers()['content-type']).toContain('text/html')
    expect(response.headers()['cache-control']).toContain('no-store')
    expect(await response.text()).toContain('referrer')
  })

  test('the profile reports the NPS field, including that none was ever given', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const list = await apiRequest(request, 'GET', '/api/customers/people?pageSize=1', { token })
    const people = await readJsonSafe<{ items?: Array<{ id?: string; entityId?: string }> }>(list)
    const customerId = people?.items?.[0]?.entityId ?? people?.items?.[0]?.id
    test.skip(!customerId, 'no customer available in this installation')

    const response = await apiRequest(request, 'GET', `/api/marketing_automation/customers/${customerId}/profile`, { token })
    const profile = await readJsonSafe<{ nps?: unknown }>(response)
    expect(profile).toHaveProperty('nps')
  })

  test('a detractor audience is answerable in the database, and exactly', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA nps ${Date.now()}`)
      const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/audience-estimate`, {
        token,
        data: { audience: { operator: 'AND', rules: [{ field: 'survey.nps', operator: '<=', value: 6 }] } },
      })
      expect(response.ok(), await response.text()).toBe(true)
      const body = await readJsonSafe<{ qualifier?: string; narrowing?: string }>(response)
      // Pushable even though it is a downward comparison — a customer who never answered has null, and the
      // evaluator vetoes magnitude comparisons against null.
      expect(body?.narrowing).toBe('survey.nps<=6')
      expect(body?.qualifier).toBe('exact')
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })
})
