import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  CAMPAIGNS_PATH,
  createCampaign,
  deleteCampaignIfExists,
  getCampaign,
} from './helpers/marketing'

/**
 * TC-MA-001: campaign create / list / read / delete over the API.
 *
 * Also pins the two invariants the canvas depends on: a new campaign is created DISABLED (it has
 * no steps yet, and one that could go live before anybody authored it is a way to mail customers
 * by accident), and `updatedAt` is present on every response because it is the optimistic lock
 * the editor sends back.
 */
test.describe('TC-MA-001 campaign CRUD', () => {
  test('creates disabled, appears in the list, reads back, deletes', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const name = `QA campaign ${Date.now()}`
    let campaignId: string | null = null

    try {
      campaignId = await createCampaign(request, token, name)

      const detail = await getCampaign(request, token, campaignId)
      expect(detail.name).toBe(name)
      expect(detail.isEnabled).toBe(false)
      expect(detail.updatedAt).toBeTruthy()
      expect(detail.definition.steps).toEqual([])
      expect(detail.triggers).toEqual([])

      const listResponse = await apiRequest(request, 'GET', `${CAMPAIGNS_PATH}?pageSize=50`, { token })
      expect(listResponse.ok()).toBe(true)
      const list = await readJsonSafe<{ items?: Array<{ id?: string; updatedAt?: string }> }>(listResponse)
      const row = (list?.items ?? []).find((item) => item.id === campaignId)
      expect(row, 'the created campaign is in the list').toBeTruthy()
      expect(row?.updatedAt, 'list rows carry the optimistic-lock version').toBeTruthy()

      const deleteResponse = await apiRequest(request, 'DELETE', `${CAMPAIGNS_PATH}/${campaignId}`, { token })
      expect(deleteResponse.ok()).toBe(true)

      const afterDelete = await apiRequest(request, 'GET', `${CAMPAIGNS_PATH}/${campaignId}`, { token })
      expect(afterDelete.status(), 'a soft-deleted campaign is no longer readable').toBe(404)
      campaignId = null
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('rejects an unauthenticated request', async ({ request }) => {
    const response = await request.get(CAMPAIGNS_PATH)
    expect([401, 403]).toContain(response.status())
  })
})
