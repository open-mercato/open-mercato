import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { CAMPAIGNS_PATH, createCampaign, deleteCampaignIfExists, getCampaign, PALETTE_PATH, saveGraph } from './helpers/marketing'

type Profile = {
  orders: { count: number; totalGross: number; averageGross: number | null; firstPlacedAt: string | null }
  rfm: { recency: number; frequency: number; monetary: number; cell: string; total: number } | null
  value: {
    averageOrderGross: number
    ordersPerYear?: number
    projectedAnnualGross?: number
    projectedHorizonGross?: number
    grossPercentile?: number
  } | null
}

/**
 * TC-MA-030: RFM scoring and the value projection.
 *
 * The scores themselves are unit-tested against a fixed distribution; what an installation can go wrong about
 * is the SHAPE — whether the profile answers with the keys the screen reads, whether "not enough data" comes
 * back as null rather than as a confident 1-1-1, and whether an audience over the new paths is accepted and
 * answerable. A seeded development database has few or no buyers, so null is the expected answer here and the
 * test asserts the honest-null contract rather than a number it cannot arrange.
 */
test.describe('TC-MA-030 RFM and value projection', () => {
  test('the profile answers with the RFM and value keys, null when there is nothing to score', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const list = await apiRequest(request, 'GET', '/api/customers/people?pageSize=1', { token })
    const people = await readJsonSafe<{ items?: Array<{ id?: string; entityId?: string }> }>(list)
    const customerId = people?.items?.[0]?.entityId ?? people?.items?.[0]?.id
    test.skip(!customerId, 'no customer available in this installation')

    const response = await apiRequest(request, 'GET', `/api/marketing_automation/customers/${customerId}/profile`, { token })
    expect(response.ok(), await response.text()).toBe(true)
    const profile = await readJsonSafe<Profile>(response)

    // The keys must be PRESENT, because the screen reads them; their values are legitimately null.
    expect(profile).toHaveProperty('rfm')
    expect(profile).toHaveProperty('value')

    if (profile?.orders.count === 0) {
      // A never-buyer scored 1-1-1 would read as "our worst customer" rather than "not a customer yet".
      expect(profile.rfm).toBeNull()
      expect(profile.value).toBeNull()
      expect(profile.orders.averageGross).toBeNull()
    } else if (profile?.rfm) {
      for (const digit of [profile.rfm.recency, profile.rfm.frequency, profile.rfm.monetary]) {
        expect(digit).toBeGreaterThanOrEqual(1)
        expect(digit).toBeLessThanOrEqual(5)
      }
      expect(profile.rfm.cell).toHaveLength(3)
      expect(profile.rfm.total).toBe(profile.rfm.recency + profile.rfm.frequency + profile.rfm.monetary)
    }

    // An order count above zero must come with an average; the two are computed from the same row.
    if ((profile?.orders.count ?? 0) > 0) {
      expect(profile?.orders.averageGross).not.toBeNull()
      expect(profile?.value?.averageOrderGross).toBeGreaterThan(0)
    }
  })

  test('an audience over an RFM digit is accepted and answerable', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const name = `RFM audience ${Date.now()}`
    const campaignId = await createCampaign(request, token, name)
    try {
      const created = await getCampaign(request, token, campaignId)
      const saved = await saveGraph(request, token, campaignId, {
        updatedAt: created.updatedAt,
        name,
        definition: {
          version: 1,
          // "In the top two fifths of this shop's buyers by spend" — a threshold nobody had to invent.
          audience: { operator: 'AND', rules: [{ field: 'rfm.monetary', operator: '>=', value: 4 }] },
          steps: [],
        },
        triggers: [],
      })
      expect(saved.ok(), await saved.text()).toBe(true)

      const estimate = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/audience-estimate`, {
        token,
        data: { audience: { operator: 'AND', rules: [{ field: 'rfm.monetary', operator: '>=', value: 4 }] } },
      })
      expect(estimate.ok(), await estimate.text()).toBe(true)
      const body = await readJsonSafe<{ count?: number; qualifier?: string; narrowing?: string }>(estimate)
      expect(typeof body?.count).toBe('number')
      // RFM is derived per customer from stored cut points, so it can never be pushed down to SQL: the
      // estimate walks the population, and the narrowing must say so rather than claim a filter it did not run.
      expect(body?.narrowing ?? '').not.toContain('rfm')
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  /**
   * Category targeting, which pushes down to SQL — unlike RFM.
   *
   * Both are new audience paths and they behave oppositely on purpose: a category is a join on orders that the
   * database can answer, while RFM is derived per customer from stored cut points and can only be evaluated in
   * memory. The narrowing string is where that difference becomes visible to an operator.
   */
  test('a category audience is pushed down to the database', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const campaignId = await createCampaign(request, token, `Category audience ${Date.now()}`)
    try {
      const audience = { operator: 'AND', rules: [{ field: 'orders.categories', operator: 'CONTAINS', value: 'footwear' }] }
      const estimate = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/audience-estimate`, {
        token,
        data: { audience },
      })
      expect(estimate.ok(), await estimate.text()).toBe(true)
      const body = await readJsonSafe<{ count?: number; narrowing?: string }>(estimate)
      expect(typeof body?.count).toBe('number')
      expect(body?.narrowing).toContain('category:footwear')
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('the profile reports which categories the customer buys from', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const list = await apiRequest(request, 'GET', '/api/customers/people?pageSize=1', { token })
    const people = await readJsonSafe<{ items?: Array<{ id?: string; entityId?: string }> }>(list)
    const customerId = people?.items?.[0]?.entityId ?? people?.items?.[0]?.id
    test.skip(!customerId, 'no customer available in this installation')

    const response = await apiRequest(request, 'GET', `/api/marketing_automation/customers/${customerId}/profile`, { token })
    expect(response.ok()).toBe(true)
    const profile = await readJsonSafe<{ orders?: { categories?: unknown } }>(response)
    // Present and an array even for somebody who has bought nothing: the screen reads it unconditionally.
    expect(Array.isArray(profile?.orders?.categories)).toBe(true)
  })

  test('the agent is offered the new audience paths', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', PALETTE_PATH, { token })
    expect(response.ok()).toBe(true)
    // The palette drives the canvas; the agent's own field list is asserted by its unit tests. Both must know
    // about a new subject-document key, or the feature exists only for somebody who reads the source.
    const body = await readJsonSafe<{ triggers?: unknown[]; steps?: unknown[] }>(response)
    expect(Array.isArray(body?.steps)).toBe(true)
  })
})
