import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  CAMPAIGNS_PATH,
  createCampaign,
  deleteCampaignIfExists,
  getCampaign,
  saveGraph,
} from './helpers/marketing'

type Revision = { version?: number; name?: string; note?: string; stepCount?: number; triggerCount?: number }

/**
 * TC-MA-022: campaign history, restore, and the job log.
 *
 * The restore assertions are the interesting ones: it must go through the ordinary save — so it is
 * validated and version-checked — and it must become a NEW version rather than rewriting the old one.
 */
test.describe('TC-MA-022 history and job runs', () => {
  test('each save is a version, and an earlier one can be put back', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const campaignId = await createCampaign(request, token, `TC-MA-022 ${Date.now()}`)

    try {
      const first = await getCampaign(request, token, campaignId)
      const one = await saveGraph(request, token, campaignId, {
        updatedAt: first.updatedAt,
        name: first.name,
        triggers: [{ kind: 'event', eventId: 'customers.person.created' }],
        definition: {
          version: 1,
          audience: null,
          steps: [{ id: 's1', type: 'send_email', params: { subject: 'First', bodyHtml: '<p>First</p>' } }],
        },
      })
      expect(one.status()).toBe(200)

      const afterFirst = await getCampaign(request, token, campaignId)
      const two = await saveGraph(request, token, campaignId, {
        updatedAt: afterFirst.updatedAt,
        name: afterFirst.name,
        triggers: [{ kind: 'event', eventId: 'customers.person.created' }],
        definition: {
          version: 1,
          audience: null,
          steps: [
            { id: 's1', type: 'send_email', params: { subject: 'Second', bodyHtml: '<p>Second</p>' } },
            { id: 's2', type: 'add_points', params: { points: 5 } },
          ],
        },
      })
      expect(two.status()).toBe(200)

      const listed = await apiRequest(request, 'GET', `${CAMPAIGNS_PATH}/${campaignId}/revisions`, { token })
      expect(listed.status()).toBe(200)
      const history = await readJsonSafe<{ items?: Revision[] }>(listed)
      const versions = (history?.items ?? []).map((item) => item.version)
      // Newest first, and the create itself is not a version — the first SAVE is.
      expect(versions).toEqual([2, 1])
      expect(history?.items?.[0]?.stepCount).toBe(2)
      expect(history?.items?.[1]?.stepCount).toBe(1)
      expect(history?.items?.[1]?.triggerCount).toBe(1)
      expect(history?.items?.[0]?.note).toBe('saved')

      const restored = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/revisions/1/restore`, { token })
      expect(restored.status()).toBe(200)

      const current = await getCampaign(request, token, campaignId)
      expect(current.definition.steps).toHaveLength(1)

      const afterRestore = await readJsonSafe<{ items?: Revision[] }>(
        await apiRequest(request, 'GET', `${CAMPAIGNS_PATH}/${campaignId}/revisions`, { token }),
      )
      // A restore is a new version, not a rewrite: history keeps saying what happened.
      expect((afterRestore?.items ?? []).map((item) => item.version)).toEqual([3, 2, 1])
      expect(afterRestore?.items?.[0]?.note).toBe('restored:1')
      expect(afterRestore?.items?.[0]?.stepCount).toBe(1)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('restoring a version that does not exist is a 404, not a silent no-op', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const campaignId = await createCampaign(request, token, `TC-MA-022 missing ${Date.now()}`)
    try {
      const response = await apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${campaignId}/revisions/99/restore`, { token })
      expect(response.status()).toBe(404)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('history is refused for a campaign in no tenant of the caller', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', `${CAMPAIGNS_PATH}/00000000-0000-0000-0000-000000000000/revisions`, { token })
    expect(response.status()).toBe(404)
  })

  test('the job log answers with the shape the screen reads', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', '/api/marketing_automation/jobs?limit=10', { token })
    expect(response.status()).toBe(200)
    const body = await readJsonSafe<{ items?: Array<{ kind?: string; status?: string; startedAt?: string }> }>(response)
    expect(Array.isArray(body?.items)).toBe(true)

    const malformed = (body?.items ?? []).filter((item) => !item.kind || !item.status || !item.startedAt)
    expect(malformed).toEqual([])
    const unknownStatus = (body?.items ?? []).filter((item) => !['running', 'ok', 'failed'].includes(String(item.status)))
    expect(unknownStatus).toEqual([])
  })

  test('an anonymous caller cannot read the history or the job log', async ({ request }) => {
    const history = await request.get(`${CAMPAIGNS_PATH}/00000000-0000-0000-0000-000000000000/revisions`)
    expect([401, 403]).toContain(history.status())
    const jobs = await request.get('/api/marketing_automation/jobs')
    expect([401, 403]).toContain(jobs.status())
  })
})
