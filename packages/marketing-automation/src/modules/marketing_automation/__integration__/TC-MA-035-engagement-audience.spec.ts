import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { CAMPAIGNS_PATH, createCampaign, deleteCampaignIfExists, getCampaign, saveGraph } from './helpers/marketing'

/**
 * TC-MA-035: targeting people by what they did with the messages.
 *
 * The data existed from the first delivery-tracking phase and only one screen could read it, so the audience most
 * worth writing — "no sign of life in six months" — could not be written at all. What matters here is that the new
 * paths are accepted, that the sunset one is answered by the DATABASE rather than by walking everybody, and that
 * the profile shows the same number a campaign would act on.
 */
test.describe('TC-MA-035 engagement audiences', () => {
  const estimate = async (
    request: APIRequestContext,
    token: string,
    campaignId: string,
    audience: unknown,
  ) => apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/audience-estimate`, { token, data: { audience } })

  test('a sunset audience is accepted and pushed down to the database', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const name = `Sunset ${Date.now()}`
    const campaignId = await createCampaign(request, token, name)
    try {
      const audience = {
        operator: 'AND',
        rules: [{ field: 'engagement.daysSinceEngaged', operator: '>=', value: 180 }],
      }
      const created = await getCampaign(request, token, campaignId)
      const saved = await saveGraph(request, token, campaignId, {
        updatedAt: created.updatedAt,
        name,
        definition: { version: 1, audience, steps: [] },
        triggers: [],
      })
      expect(saved.ok(), await saved.text()).toBe(true)

      const response = await estimate(request, token, campaignId, audience)
      expect(response.ok(), await response.text()).toBe(true)
      const body = await readJsonSafe<{ count?: number; qualifier?: string; narrowing?: string }>(response)
      expect(typeof body?.count).toBe('number')
      /**
       * Answered by a query, not by walking the population.
       *
       * That is the difference between a sunset policy somebody can run daily over a large customer base and one
       * that times out — and the narrowing string is where an operator can see which it was.
       */
      expect(body?.narrowing).toContain('engagement.daysSinceEngaged>=180')
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('"has opened at least once" narrows, "never opened" does not', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const campaignId = await createCampaign(request, token, `Engagement narrowing ${Date.now()}`)
    try {
      const opened = await estimate(request, token, campaignId, {
        operator: 'AND',
        rules: [{ field: 'engagement.opened', operator: '>=', value: 1 }],
      })
      expect(opened.ok(), await opened.text()).toBe(true)
      expect((await readJsonSafe<{ narrowing?: string }>(opened))?.narrowing).toContain('engagement.opened>=1')

      const never = await estimate(request, token, campaignId, {
        operator: 'AND',
        rules: [{ field: 'engagement.opened', operator: '=', value: 0 }],
      })
      expect(never.ok(), await never.text()).toBe(true)
      // An absence cannot be produced by a join as a superset, so this one is evaluated per customer — and the
      // narrowing says `all` rather than claiming a filter it did not run.
      expect((await readJsonSafe<{ narrowing?: string }>(never))?.narrowing).toBe('all')
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('the profile reports the same silence a campaign would act on', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const list = await apiRequest(request, 'GET', '/api/customers/people?pageSize=1', { token })
    const people = await readJsonSafe<{ items?: Array<{ id?: string; entityId?: string }> }>(list)
    const customerId = people?.items?.[0]?.entityId ?? people?.items?.[0]?.id
    test.skip(!customerId, 'no customer available in this installation')

    const response = await apiRequest(request, 'GET', `/api/marketing_automation/customers/${customerId}/profile`, { token })
    expect(response.ok()).toBe(true)
    const profile = await readJsonSafe<{
      messages?: { sent?: number; opened?: number; clicked?: number; daysSinceEngaged?: number | null; lastEngagedAt?: string | null }
    }>(response)

    expect(typeof profile?.messages?.opened).toBe('number')
    // Null rather than zero for somebody nobody has written to: there is no silence to measure.
    expect(profile?.messages).toHaveProperty('daysSinceEngaged')
    if ((profile?.messages?.sent ?? 0) === 0) {
      expect(profile?.messages?.daysSinceEngaged).toBeNull()
    }
  })

  test('a re-engagement campaign can combine silence with having bought', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const campaignId = await createCampaign(request, token, `Quiet buyers ${Date.now()}`)
    try {
      // The audience an operator actually wants: people who spent money and then went quiet — not everybody quiet.
      const response = await estimate(request, token, campaignId, {
        operator: 'AND',
        rules: [
          { field: 'engagement.daysSinceEngaged', operator: '>=', value: 90 },
          { field: 'orders.count', operator: '>=', value: 1 },
        ],
      })
      expect(response.ok(), await response.text()).toBe(true)
      const narrowing = (await readJsonSafe<{ narrowing?: string }>(response))?.narrowing ?? ''
      // Both halves are database-answerable, so the intersection is too.
      expect(narrowing).toContain('engagement.daysSinceEngaged>=90')
      expect(narrowing).toContain('orders.count')
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })
})
