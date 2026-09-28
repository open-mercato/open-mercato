import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { CAMPAIGNS_PATH, createCampaign, deleteCampaignIfExists, getCampaign, saveGraph } from './helpers/marketing'

const email = (id: string) => ({ id, type: 'send_email', params: { subject: 'Hello {{trigger.orderNumber}}', bodyHtml: '<p>Hi</p>' } })

/**
 * TC-MA-014: product and geographic targeting, and the real test send.
 *
 * The interesting assertions are about WHERE a predicate is evaluated. A purchased SKU is a plain
 * membership query, so the estimate can be exact; a customer address is encrypted at rest, so it can
 * never be — and an estimate that claimed otherwise would be silently wrong for every geographic
 * campaign ever written.
 */
test.describe('TC-MA-014 product and geographic targeting', () => {
  async function estimate(request: Parameters<typeof apiRequest>[0], token: string, id: string, audience: unknown) {
    const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${id}/audience-estimate`, { token, data: { audience } })
    expect(response.ok(), await response.text()).toBe(true)
    return (await readJsonSafe<{ qualifier?: string; narrowing?: string; candidates?: number | null }>(response))!
  }

  test('a purchased product is answerable in the database, and exactly', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA sku ${Date.now()}`)
      const body = await estimate(request, token, campaignId, {
        operator: 'AND',
        rules: [{ field: 'orders.skus', operator: 'CONTAINS', value: 'ATLAS-RUNNER' }],
      })
      expect(body.qualifier).toBe('exact')
      expect(body.narrowing).toBe('sku:ATLAS-RUNNER')
      expect(body.candidates).not.toBeNull()
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  // The important one. Addresses are encrypted, so a SQL comparison would match nothing — silently.
  test('a geographic audience is NEVER narrowed in the database', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA geo ${Date.now()}`)
      for (const field of ['address.country', 'address.city', 'address.postalCode']) {
        const body = await estimate(request, token, campaignId, {
          operator: 'AND',
          rules: [{ field, operator: '=', value: 'PL' }],
        })
        expect(body.narrowing, field).toBe('all')
        expect(body.qualifier, field).toBe('atMost')
      }
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('a mixed product-and-place audience narrows on the product only', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA sku geo ${Date.now()}`)
      const body = await estimate(request, token, campaignId, {
        operator: 'AND',
        rules: [
          { field: 'orders.skus', operator: 'CONTAINS', value: 'ATLAS-RUNNER' },
          { field: 'address.country', operator: '=', value: 'PL' },
        ],
      })
      expect(body.narrowing).toBe('sku:ATLAS-RUNNER')
      // The place half is decided per customer, so the count is an upper bound.
      expect(body.qualifier).toBe('atMost')
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })
})

test.describe('TC-MA-014 test send', () => {
  test('sends to the CALLER and cannot be aimed anywhere else', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA test send ${Date.now()}`)
      const created = await getCampaign(request, token, campaignId)
      const saved = await saveGraph(request, token, campaignId, {
        updatedAt: created.updatedAt,
        name: 'QA test send',
        triggers: [{ kind: 'event', eventId: 'sales.order.created' }],
        definition: { version: 1, audience: null, steps: [email('s1')] },
      })
      expect(saved.ok(), await saved.text()).toBe(true)

      const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/test-send`, {
        token,
        // A recipient in the body must be ignored: the endpoint takes the address from the session.
        data: { stepId: 's1', to: 'someone-else@example.com', recipient: 'someone-else@example.com' },
      })

      const body = await readJsonSafe<{ sent?: boolean; to?: string; code?: string }>(response)
      if (response.ok()) {
        expect(body?.sent).toBe(true)
        expect(body?.to).toBeTruthy()
        // The address from the body was ignored, which is the whole security property.
        expect(body?.to).not.toBe('someone-else@example.com')
      } else {
        // An installation with no email channel is a configuration state, not a code failure — and it
        // must say so distinctly rather than reporting a refused message. Everything up to the
        // transport is still proven by getting here.
        expect(response.status(), await response.text()).toBe(400)
        expect(body?.code).toBe('marketing_automation.errors.emailChannelMissing')
      }

      // A test is not a campaign send: nothing recorded, nothing to report.
      const tracking = await apiRequest(request, 'GET', `${CAMPAIGNS_PATH}/${campaignId}/tracking`, { token })
      const counts = await readJsonSafe<{ sends?: { sent?: number } }>(tracking)
      expect(counts?.sends?.sent).toBe(0)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('refuses a step that is not an email step, and one that does not exist', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA test send refuse ${Date.now()}`)
      const created = await getCampaign(request, token, campaignId)
      await saveGraph(request, token, campaignId, {
        updatedAt: created.updatedAt,
        name: 'QA test send refuse',
        triggers: [{ kind: 'event', eventId: 'sales.order.created' }],
        definition: {
          version: 1,
          audience: null,
          steps: [{ id: 'tag1', type: 'add_tag', params: { tagId: '11111111-1111-4111-8111-111111111111' } }, email('s1')],
        },
      })

      const notEmail = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/test-send`, {
        token, data: { stepId: 'tag1' },
      })
      expect(notEmail.status()).toBe(400)

      const missing = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/test-send`, {
        token, data: { stepId: 'nope' },
      })
      expect(missing.status()).toBe(404)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('rejects an unauthenticated request', async ({ request }) => {
    const response = await request.post(`${CAMPAIGNS_PATH}/00000000-0000-4000-8000-000000000000/test-send`, {
      data: { stepId: 's1' },
    })
    expect([401, 403]).toContain(response.status())
  })
})
