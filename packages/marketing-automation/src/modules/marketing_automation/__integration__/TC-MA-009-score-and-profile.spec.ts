import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { CAMPAIGNS_PATH, createCampaign, deleteCampaignIfExists, PALETTE_PATH } from './helpers/marketing'

type Profile = {
  customer: { id: string; displayName: string | null; email: string | null }
  score: { points: number; tier: string | null; tierRank: number; pointsToNext: number | null }
  orders: { count: number; totalGross: number; daysSinceLast: number | null }
  tags: string[]
  messages: { sent: number; suppressed: number; opened: number; clicked: number }
  recentScoreEntries: unknown[]
  recentRuns: unknown[]
}

/**
 * TC-MA-009: lead scoring and the customer profile.
 *
 * The scoring engine's own writes happen inside a run, which these tests do not drive; what they
 * assert is the surface around it — that the step is offered with a usable form, that a score
 * audience is answerable in the database, and that the profile reports a real customer with the
 * derived tier rather than a stored one.
 */
test.describe('TC-MA-009 scoring and customer profile', () => {
  test('the palette offers the scoring step with an editable form', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', PALETTE_PATH, { token })
    expect(response.ok()).toBe(true)
    const body = await readJsonSafe<{ steps?: Array<{ type?: string; uiFields?: Array<{ name?: string; kind?: string }> }> }>(response)
    const step = (body?.steps ?? []).find((entry) => entry.type === 'add_points')
    expect(step, 'add_points must be offered').toBeTruthy()
    const fields = (step?.uiFields ?? []).map((field) => `${field.name}:${field.kind}`)
    expect(fields).toContain('points:number')
    expect(fields).toContain('reason:text')
  })

  test('the score trigger is available for authoring', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', PALETTE_PATH, { token })
    const body = await readJsonSafe<{ triggers?: Array<{ eventId?: string; available?: boolean }> }>(response)
    const trigger = (body?.triggers ?? []).find((entry) => entry.eventId === 'marketing_automation.score.changed')
    expect(trigger?.available).toBe(true)
  })

  test('a campaign whose trigger is the event its own step emits is refused', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA score cascade ${Date.now()}`)
      const { updatedAt } = await (async () => {
        const read = await apiRequest(request, 'GET', `${CAMPAIGNS_PATH}/${campaignId}`, { token })
        return (await readJsonSafe<{ updatedAt: string }>(read)) as { updatedAt: string }
      })()

      // `add_points` emits `score_changed`, so a campaign triggered by it would re-enter itself.
      const response = await apiRequest(request, 'PUT', `${CAMPAIGNS_PATH}/${campaignId}/save-graph`, {
        token,
        data: {
          updatedAt,
          name: 'QA score cascade',
          triggers: [{ kind: 'event', eventId: 'marketing_automation.score.changed' }],
          definition: {
            version: 1,
            audience: null,
            steps: [{ id: 's1', type: 'add_points', params: { points: 10 } }],
          },
        },
      })
      expect(response.status()).toBe(400)
      const body = await readJsonSafe<{ code?: string }>(response)
      expect(body?.code).toMatch(/^marketing_automation\.validation\./)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('a score audience is answerable in the database, and reported as exact', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA score audience ${Date.now()}`)
      const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/audience-estimate`, {
        token,
        data: {
          audience: { operator: 'AND', rules: [{ field: 'score.points', operator: '>=', value: 1 }] },
        },
      })
      expect(response.ok(), await response.text()).toBe(true)
      const body = await readJsonSafe<{ qualifier?: string; narrowing?: string; candidates?: number | null }>(response)
      expect(body?.qualifier).toBe('exact')
      expect(body?.narrowing).toBe('score.points>=1')
      expect(body?.candidates).not.toBeNull()
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  // A never-scored customer has a total of zero and no ledger row, so this comparison must NOT be
  // pushed down — the estimate stays an upper bound instead of silently excluding them.
  test('a comparison a never-scored customer satisfies stays an upper bound', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA score cold ${Date.now()}`)
      const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/audience-estimate`, {
        token,
        data: { audience: { operator: 'AND', rules: [{ field: 'score.points', operator: '<=', value: 10 }] } },
      })
      const body = await readJsonSafe<{ qualifier?: string; narrowing?: string }>(response)
      expect(body?.qualifier).toBe('atMost')
      expect(body?.narrowing).toBe('all')
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('the profile reports a real customer with a derived tier', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const list = await apiRequest(request, 'GET', '/api/customers/people?pageSize=1', { token })
    expect(list.ok(), 'the suite needs at least one customer in the installation').toBe(true)
    const people = await readJsonSafe<{ items?: Array<{ id?: string; entityId?: string }> }>(list)
    const customerId = people?.items?.[0]?.entityId ?? people?.items?.[0]?.id
    test.skip(!customerId, 'no customer available in this installation')

    const response = await apiRequest(request, 'GET', `/api/marketing_automation/customers/${customerId}/profile`, { token })
    expect(response.ok(), await response.text()).toBe(true)
    const profile = await readJsonSafe<Profile>(response)
    expect(profile?.customer.id).toBe(customerId)
    // Zero points is the bronze tier on the default ladder, and the tier is derived rather than
    // stored — so it is present even for a customer nothing has ever scored.
    expect(profile?.score.points).toBe(0)
    expect(profile?.score.tier).toBe('bronze')
    expect(profile?.score.tierRank).toBe(0)
    expect(profile?.score.pointsToNext).toBe(100)
    expect(Array.isArray(profile?.tags)).toBe(true)
    expect(profile?.messages).toMatchObject({ sent: expect.any(Number), opened: expect.any(Number) })
  })

  test('the profile is refused without both features', async ({ request }) => {
    const response = await request.get('/api/marketing_automation/customers/00000000-0000-4000-8000-000000000000/profile')
    expect([401, 403]).toContain(response.status())
  })

  test('an unknown customer answers 404 rather than an empty profile', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', '/api/marketing_automation/customers/00000000-0000-4000-8000-000000000000/profile', { token })
    expect(response.status()).toBe(404)
  })
})
