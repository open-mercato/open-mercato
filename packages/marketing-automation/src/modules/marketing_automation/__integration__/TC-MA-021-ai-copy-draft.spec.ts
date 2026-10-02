import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { CAMPAIGNS_PATH, createCampaign, deleteCampaignIfExists } from './helpers/marketing'

const SETTINGS_PATH = '/api/marketing_automation/settings'

/**
 * TC-MA-021: drafting copy with AI.
 *
 * Whether a model is configured depends on the environment, so the shape assertions are written to hold
 * either way: a 503 is a correct answer and so is a draft, and both are checked for the right body.
 */
test.describe('TC-MA-021 AI copy drafting', () => {
  test('answers either a usable draft or an honest "not configured"', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const campaignId = await createCampaign(request, token, `TC-MA-021 ${Date.now()}`)

    try {
      const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/draft-copy`, {
        token,
        data: { brief: 'Thank a first-time buyer and suggest two products' },
        timeout: 60_000,
      })

      if (response.status() === 503) {
        const body = await readJsonSafe<{ code?: string }>(response)
        expect(body?.code).toBe('marketing_automation.errors.aiNotConfigured')
        return
      }
      if (response.status() === 502) {
        // A provider that is configured but failing is not this test's business; the code must still be ours.
        const body = await readJsonSafe<{ code?: string }>(response)
        expect(['marketing_automation.errors.aiUnusable', 'marketing_automation.errors.aiFailed']).toContain(body?.code)
        return
      }

      expect(response.status()).toBe(200)
      const draft = await readJsonSafe<{ subject?: string; bodyHtml?: string; bodyText?: string }>(response)
      expect(draft?.subject && draft.subject.length > 0).toBe(true)
      // One line: the field it fills is a header.
      expect(draft?.subject).not.toContain('\n')
      expect(draft?.bodyHtml && draft.bodyHtml.length > 0).toBe(true)
      // Sanitised on the way out, whatever the model wrote.
      expect(draft?.bodyHtml?.toLowerCase()).not.toContain('<script')
      expect(draft?.bodyHtml?.toLowerCase()).not.toContain('onclick=')
      expect(draft?.bodyText && draft.bodyText.length > 0).toBe(true)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('refuses a brief for a campaign in another tenant, or one that does not exist', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/00000000-0000-0000-0000-000000000000/draft-copy`, {
      token,
      data: {},
    })
    expect(response.status()).toBe(404)
  })

  test('refuses an oversized brief before it reaches a model', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const campaignId = await createCampaign(request, token, `TC-MA-021 long ${Date.now()}`)
    try {
      const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/draft-copy`, {
        token,
        data: { brief: 'x'.repeat(5000) },
      })
      expect(response.status()).toBe(400)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('an anonymous caller cannot ask for a draft', async ({ request }) => {
    const response = await request.post(`${CAMPAIGNS_PATH}/00000000-0000-0000-0000-000000000000/draft-copy`, { data: {} })
    expect([401, 403]).toContain(response.status())
  })

  test('the brand voice round-trips through the settings endpoint', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const before = await readJsonSafe<{ brandVoice?: string }>(
      await apiRequest(request, 'GET', SETTINGS_PATH, { token }),
    )
    try {
      const saved = await apiRequest(request, 'PUT', SETTINGS_PATH, {
        token,
        data: { brandVoice: 'Warm and direct. No exclamation marks.' },
      })
      expect(saved.status()).toBe(200)
      const body = await readJsonSafe<{ brandVoice?: string }>(saved)
      expect(body?.brandVoice).toBe('Warm and direct. No exclamation marks.')
    } finally {
      await apiRequest(request, 'PUT', SETTINGS_PATH, { token, data: { brandVoice: before?.brandVoice ?? '' } })
    }
  })
})
