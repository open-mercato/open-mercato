import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { createCampaign, deleteCampaignIfExists } from './helpers/marketing'

const CAMPAIGNS_PATH = '/api/marketing_automation/campaigns'
const READINESS_PATH = '/api/marketing_automation/readiness'

/**
 * TC-MA-029: channel and language targeting, and the readiness checklist.
 *
 * Both targeting dimensions are audience fields, so the assertion that matters is that an audience using them
 * is accepted and estimable — and that the readiness answer is computed from live state rather than a flag.
 */
test.describe('TC-MA-029 channel and language targeting, readiness', () => {
  test('an audience can target a sales channel, and the estimate says what kind of number it is', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const created = await apiRequest(request, 'POST', CAMPAIGNS_PATH, { token, data: { name: `TC-MA-029 ${Date.now()}` } })
    const campaignId = (await readJsonSafe<{ id?: string }>(created))?.id
    expect(campaignId).toBeTruthy()

    try {
      const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/audience-estimate`, {
        token,
        data: {
          audience: {
            operator: 'AND',
            rules: [{ field: 'orders.channels', operator: 'CONTAINS', value: 'web' }],
          },
        },
      })
      expect(response.status()).toBe(200)
      const body = await readJsonSafe<{ count?: number; qualifier?: string; narrowing?: string }>(response)
      expect(typeof body?.count).toBe('number')
      // A channel condition is expressible in SQL, so the whole audience is — the estimate is exact, and the
      // narrowing description says which predicate went down.
      expect(body?.qualifier).toBe('exact')
      expect(body?.narrowing).toContain('channel:web')
    } finally {
      await apiRequest(request, 'DELETE', `${CAMPAIGNS_PATH}/${campaignId}`, { token }).catch(() => undefined)
    }
  })

  test('a language audience is accepted and decided per customer', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const created = await apiRequest(request, 'POST', CAMPAIGNS_PATH, { token, data: { name: `TC-MA-029 lang ${Date.now()}` } })
    const campaignId = (await readJsonSafe<{ id?: string }>(created))?.id

    try {
      const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/audience-estimate`, {
        token,
        data: {
          audience: {
            operator: 'AND',
            rules: [{ field: 'customer.locale', operator: '=', value: 'pl' }],
          },
        },
      })
      expect(response.status()).toBe(200)
      const body = await readJsonSafe<{ qualifier?: string }>(response)
      // A chosen language lives in this module's own preference table and is not pushed down, so the number is
      // an upper bound decided per customer at send time — and it says so.
      expect(body?.qualifier).toBe('atMost')
    } finally {
      await apiRequest(request, 'DELETE', `${CAMPAIGNS_PATH}/${campaignId}`, { token }).catch(() => undefined)
    }
  })

  test('the profile reports a language only once the customer has chosen one', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const customerId = await createPersonFixture(request, token, {
      firstName: 'Language',
      lastName: `Unset${stamp}`,
      displayName: `Language Unset ${stamp}`,
      primaryEmail: `qa-ma-lang-${stamp}@example.com`,
    })
    try {
      const profile = await readJsonSafe<{ preference?: { locale?: string | null } }>(
        await apiRequest(request, 'GET', `/api/marketing_automation/customers/${customerId}/profile`, { token }),
      )
      // Null, not a guess from their address: writing to somebody in the language of the country they live in
      // is how people receive marketing they cannot read.
      expect(profile?.preference?.locale ?? null).toBeNull()
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', customerId)
    }
  })

  test('readiness is answered from live state, with blocking checks named', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    /**
     * Its own campaign, so `first_campaign` is satisfied by something THIS test did.
     *
     * It used to lean on "the installation has campaigns from the rest of the suite", which held while the specs
     * ran in one process against a database other specs had already filled. Sharded across three lanes on a fresh
     * database it is a coin toss: the spec that happened to create a campaign lands in another lane. The module's
     * own AGENTS.md asks for self-contained fixtures for exactly this reason, and this was the one test that
     * quietly ignored it.
     */
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA readiness ${Date.now()}`)
      await assertReadiness(request, token)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  async function assertReadiness(request: Parameters<typeof apiRequest>[0], token: string) {
    const response = await apiRequest(request, 'GET', READINESS_PATH, { token })
    expect(response.status()).toBe(200)
    const body = await readJsonSafe<{
      checks?: Array<{ id?: string; severity?: string; done?: boolean }>
      ready?: boolean
      remaining?: number
    }>(response)

    const ids = (body?.checks ?? []).map((check) => check.id)
    expect(ids).toEqual([
      'email_channel',
      'tracking',
      'first_campaign',
      'publish',
      'first_run',
      'segments',
      'content_blocks',
    ])
    expect(typeof body?.ready).toBe('boolean')
    expect(typeof body?.remaining).toBe('number')

    const malformed = (body?.checks ?? []).filter((check) => !['blocking', 'recommended'].includes(String(check.severity)))
    expect(malformed).toEqual([])

    // Satisfied by the campaign this test created, not by whatever else happens to be in the database.
    expect((body?.checks ?? []).find((check) => check.id === 'first_campaign')?.done).toBe(true)
  }

  test('an anonymous caller cannot read readiness', async ({ request }) => {
    expect([401, 403]).toContain((await request.get(READINESS_PATH)).status())
  })
})
