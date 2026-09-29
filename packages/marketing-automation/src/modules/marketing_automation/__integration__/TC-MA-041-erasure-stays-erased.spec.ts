import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  createCampaign,
  deleteCampaignIfExists,
  getCampaign,
  listRuns,
  saveGraph,
  setEnabled,
} from './helpers/marketing'

const SEGMENTS_PATH = '/api/marketing_automation/segments'
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

/** Long enough for the worker to have acted if it was going to; the assertion is that it did NOT. */
const QUIET_PERIOD_MS = 6_000

async function erase(request: APIRequestContext, token: string, personId: string): Promise<void> {
  const response = await apiRequest(request, 'POST', `/api/marketing_automation/customers/${personId}/gdpr`, {
    token,
    data: { confirm: 'erase' },
  })
  expect(response.status(), 'erasure').toBe(200)
}

async function scoreOf(request: APIRequestContext, token: string, personId: string): Promise<number> {
  const response = await apiRequest(request, 'GET', `/api/marketing_automation/customers/${personId}/profile`, { token })
  expect(response.ok()).toBe(true)
  return ((await readJsonSafe<{ score: { points: number } }>(response))?.score.points) ?? -1
}

async function createTag(request: APIRequestContext, token: string, label: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/customers/tags', { token, data: { label, slug: label } })
  expect(response.status(), 'tag create').toBeLessThan(400)
  return ((await readJsonSafe<{ id?: string }>(response))?.id) as string
}

/**
 * TC-MA-041: once a person's marketing data is erased, nothing in this module writes about them again.
 *
 * Erasure unlinks what existed; these are the paths that would otherwise start writing it back — an event naming
 * their customer id enrolling them in a campaign, and a bulk action over a segment their customer record still
 * matches. Each test waits out a quiet period and asserts nothing happened, because "nothing" has no event to poll.
 */
test.describe('TC-MA-041 erasure stays erased', () => {
  test('an event about an erased person enrols them in no campaign', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const marker = `QA Erased Event ${stamp}`
    let personId: string | null = null
    let tagId: string | null = null
    let campaignId: string | null = null
    try {
      personId = await createPersonFixture(request, token, { firstName: 'QA', lastName: 'ErasedEvent', displayName: marker })
      tagId = await createTag(request, token, `qa-erased-${stamp}`)

      campaignId = await createCampaign(request, token, `TC-MA-041 event ${stamp}`)
      const detail = await getCampaign(request, token, campaignId)
      const saved = await saveGraph(request, token, campaignId, {
        updatedAt: detail.updatedAt,
        name: detail.name,
        triggers: [{ kind: 'event', eventId: 'customers.tag.assigned' }],
        definition: {
          version: 1,
          audience: { operator: 'AND', rules: [{ field: 'customer.displayName', operator: '=', value: marker }] },
          steps: [{ id: 'step-points', type: 'add_points', params: { points: 5, reason: 'TC-MA-041' } }],
        },
      })
      expect(saved.status()).toBe(200)
      const afterSave = await getCampaign(request, token, campaignId)
      expect((await setEnabled(request, token, campaignId, { updatedAt: afterSave.updatedAt, isEnabled: true })).status()).toBe(200)

      await erase(request, token, personId)

      const assigned = await apiRequest(request, 'POST', '/api/customers/tags/assign', { token, data: { tagId, entityId: personId } })
      expect(assigned.status()).toBeLessThan(400)

      await new Promise((resolve) => setTimeout(resolve, QUIET_PERIOD_MS))
      const body = await readJsonSafe<{ items?: Array<{ subjectEntityId?: string | null }> }>(await listRuns(request, token, campaignId))
      expect((body?.items ?? []).filter((run) => run.subjectEntityId === personId)).toHaveLength(0)
      expect(await scoreOf(request, token, personId)).toBe(0)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      await deleteEntityIfExists(request, token, '/api/customers/tags', tagId)
    }
  })

  test('a bulk action over a segment passes an erased member by', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const marker = `QA Erased Segment ${Date.now()}`
    let personId: string | null = null
    let segment: { id: string; updatedAt: string } | null = null
    try {
      personId = await createPersonFixture(request, token, { firstName: 'QA', lastName: 'ErasedSegment', displayName: marker })
      const created = await apiRequest(request, 'POST', SEGMENTS_PATH, {
        token,
        data: {
          name: marker,
          expression: { operator: 'AND', rules: [{ field: 'customer.displayName', operator: '=', value: marker }] },
        },
      })
      expect(created.status()).toBe(200)
      segment = (await readJsonSafe<{ id: string; updatedAt: string }>(created))!

      await erase(request, token, personId)

      const action = await apiRequest(request, 'POST', `${SEGMENTS_PATH}/${segment.id}/actions`, {
        token,
        data: { kind: 'add_points', points: 7, reason: 'TC-MA-041' },
      })
      if (action.status() === 503) {
        test.skip(true, 'this installation cannot track background work, so bulk actions are unavailable')
      }
      expect(action.status()).toBeLessThan(300)

      await new Promise((resolve) => setTimeout(resolve, QUIET_PERIOD_MS))
      expect(await scoreOf(request, token, personId)).toBe(0)
    } finally {
      if (segment) {
        await apiRequest(request, 'DELETE', `${SEGMENTS_PATH}/${segment.id}`, { token, headers: { [LOCK_HEADER]: segment.updatedAt } })
      }
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
