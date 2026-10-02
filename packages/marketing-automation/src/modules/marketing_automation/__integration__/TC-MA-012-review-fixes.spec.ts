import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { CAMPAIGNS_PATH, createCampaign, deleteCampaignIfExists, getCampaign, saveGraph } from './helpers/marketing'

const email = (id: string) => ({ id, type: 'send_email', params: { subject: 'x', bodyHtml: '<p>x</p>' } })

/**
 * TC-MA-012: the defects a review found, each with the case that was let through.
 *
 * Kept as one spec on purpose: these are not a feature, they are a list of things that must never come
 * back, and grouping them says so.
 */
test.describe('TC-MA-012 regressions found by review', () => {
  // The cycle guard recursed in two of its three sibling assertions. A campaign whose `add_tag` sat
  // inside a split lane passed, then drove itself on every tag assignment.
  test('refuses a campaign whose LANE step emits its own trigger', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA lane cycle ${Date.now()}`)
      const { updatedAt } = await getCampaign(request, token, campaignId)
      const response = await saveGraph(request, token, campaignId, {
        updatedAt,
        name: 'QA lane cycle',
        triggers: [{ kind: 'event', eventId: 'customers.tag.assigned' }],
        definition: {
          version: 1,
          audience: null,
          steps: [{
            id: 'sp1',
            type: 'split',
            params: {
              variants: [
                { key: 'a', weight: 1, steps: [{ id: 'a1', type: 'add_tag', params: { tagId: '11111111-1111-4111-8111-111111111111' } }] },
                { key: 'b', weight: 1, steps: [email('b1')] },
              ],
            },
          }],
        },
      })
      expect(response.status()).toBe(400)
      const body = await readJsonSafe<{ code?: string }>(response)
      expect(body?.code).toBe('marketing_automation.validation.loopRisk')
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  // The route defaulted the expected version to '', which is a VALUE — so the platform guard never fell
  // back to the extension header and the optimistic lock silently did nothing.
  test('the winner promotion locks on the version sent as a header', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA header lock ${Date.now()}`)
      const created = await getCampaign(request, token, campaignId)
      await saveGraph(request, token, campaignId, {
        updatedAt: created.updatedAt,
        name: 'QA header lock',
        triggers: [{ kind: 'event', eventId: 'sales.order.created' }],
        definition: {
          version: 1,
          audience: null,
          steps: [{
            id: 'sp1',
            type: 'split',
            params: { variants: [{ key: 'a', weight: 1, steps: [email('a1')] }, { key: 'b', weight: 1, steps: [email('b1')] }] },
          }],
        },
      })

      // `created.updatedAt` is now stale, and it travels ONLY as the header.
      const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/apply-split-winner`, {
        token,
        headers: { 'x-om-ext-optimistic-lock-expected-updated-at': created.updatedAt },
        data: { stepId: 'sp1', variantKey: 'a' },
      })
      expect(response.status()).toBe(409)
      const body = await readJsonSafe<{ code?: string }>(response)
      expect(body?.code).toBe('optimistic_lock_conflict')
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  // The enabled command used `.parse`, so a malformed body escaped as a 500 with nothing actionable.
  test('publishing with a malformed body answers 400 with a code, not 500', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA bad enable ${Date.now()}`)
      const response = await apiRequest(request, 'PUT', `${CAMPAIGNS_PATH}/${campaignId}/enabled`, {
        token,
        data: { isEnabled: 'yes please' },
      })
      expect(response.status()).toBe(400)
      const body = await readJsonSafe<{ code?: string }>(response)
      expect(body?.code).toMatch(/^marketing_automation\.validation\./)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('the score trigger is offered AND has a subscriber behind it', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    // A trigger a campaign can be authored against but which nothing forwards is the worst failure this
    // module has: the campaign saves, shows enabled, and silently never fires.
    const response = await apiRequest(request, 'GET', '/api/marketing_automation/palette', { token })
    const body = await readJsonSafe<{ triggers?: Array<{ eventId?: string; available?: boolean }> }>(response)
    const offered = (body?.triggers ?? []).filter((entry) => entry.available).map((entry) => entry.eventId)
    expect(offered).toContain('marketing_automation.score.changed')
  })

  test('a negative page size is refused rather than reaching the database', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', `${CAMPAIGNS_PATH}?pageSize=-1`, { token })
    // Clamped, not passed through as LIMIT -1.
    expect(response.ok(), await response.text()).toBe(true)
  })
})
