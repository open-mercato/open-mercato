import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { CAMPAIGNS_PATH, createCampaign, deleteCampaignIfExists } from './helpers/marketing'

type Estimate = {
  count: number
  qualifier: 'exact' | 'atMost'
  narrowing: string
  candidates: number | null
}

async function estimate(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  id: string,
  audience: unknown,
) {
  return apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${id}/audience-estimate`, { token, data: { audience } })
}

/**
 * TC-MA-007: the audience estimate.
 *
 * The number an author is shown before publishing. What matters is not the value — that depends on
 * the installation's data — but that it never LIES about what it is: `exact` only when the whole
 * expression was answerable in the database, `atMost` whenever a leaf is decided per customer at
 * send time.
 */
test.describe('TC-MA-007 audience estimate', () => {
  test('reports the population exactly when the campaign has no audience', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA estimate ${Date.now()}`)
      const response = await estimate(request, token, campaignId, null)
      expect(response.ok(), await response.text()).toBe(true)
      const body = await readJsonSafe<Estimate>(response)
      // No audience means everyone the trigger produces, which is an exact statement.
      expect(body?.qualifier).toBe('exact')
      expect(body?.narrowing).toBe('all')
      expect(body?.candidates).toBeNull()
      expect(body?.count).toBeGreaterThanOrEqual(0)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('an expression the database can answer is counted, and called exact', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA estimate tag ${Date.now()}`)
      const response = await estimate(request, token, campaignId, {
        operator: 'AND',
        rules: [{ field: 'tags', operator: 'CONTAINS', value: `qa-absent-${Date.now()}` }],
      })
      expect(response.ok(), await response.text()).toBe(true)
      const body = await readJsonSafe<Estimate>(response)
      expect(body?.qualifier).toBe('exact')
      expect(body?.narrowing).toMatch(/^tag:qa-absent-/)
      // Nobody carries a tag that was invented a millisecond ago.
      expect(body?.count).toBe(0)
      expect(body?.candidates).toBe(0)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  // The honesty requirement: a leaf that only the per-subject check can decide must downgrade the
  // number to an upper bound rather than being silently ignored.
  test('an expression the database cannot answer is reported as an upper bound', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA estimate trigger ${Date.now()}`)
      const response = await estimate(request, token, campaignId, {
        operator: 'AND',
        rules: [{ field: 'trigger.orderTotal', operator: '>=', value: 100 }],
      })
      expect(response.ok(), await response.text()).toBe(true)
      const body = await readJsonSafe<Estimate>(response)
      expect(body?.qualifier).toBe('atMost')
      expect(body?.narrowing).toBe('all')
      expect(body?.candidates).toBeNull()
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('a mixed expression narrows on what it can and stays an upper bound', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA estimate mixed ${Date.now()}`)
      const response = await estimate(request, token, campaignId, {
        operator: 'AND',
        rules: [
          { field: 'orders.daysSinceLast', operator: '>=', value: 90 },
          { field: 'customer.email', operator: 'CONTAINS', value: '@example.com' },
        ],
      })
      expect(response.ok(), await response.text()).toBe(true)
      const body = await readJsonSafe<Estimate>(response)
      expect(body?.qualifier).toBe('atMost')
      expect(body?.narrowing).toBe('orders.daysSinceLast>=90')
      expect(body?.candidates).not.toBeNull()
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('refuses an audience that is not an expression', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA estimate invalid ${Date.now()}`)
      const response = await estimate(request, token, campaignId, { operator: 'AND', rules: 'not-an-array' })
      expect(response.status()).toBe(400)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('rejects an unauthenticated request', async ({ request }) => {
    const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/00000000-0000-4000-8000-000000000000/audience-estimate`, {
      data: { audience: null },
    })
    expect([401, 403]).toContain(response.status())
  })
})
