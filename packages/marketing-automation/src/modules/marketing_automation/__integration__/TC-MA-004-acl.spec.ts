import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  CAMPAIGNS_PATH,
  createCampaign,
  deleteCampaignIfExists,
  getCampaign,
  minimalGraph,
  saveGraph,
} from './helpers/marketing'

/**
 * TC-MA-004: viewing a campaign and changing one are separate powers.
 *
 * Authoring a campaign sends real messages to real customers, so `campaigns.manage` is not
 * implied by `campaigns.view`. The `employee` role receives only the read features from
 * `setup.ts`, which makes it the natural probe.
 */
test.describe('TC-MA-004 access control', () => {
  test('a read-only role can list and read but cannot create, save or delete', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    let campaignId: string | null = null

    try {
      campaignId = await createCampaign(request, adminToken, `QA acl ${Date.now()}`)
      const detail = await getCampaign(request, adminToken, campaignId)

      const list = await apiRequest(request, 'GET', `${CAMPAIGNS_PATH}?pageSize=10`, { token: employeeToken })
      expect(list.ok(), 'a read-only role can list campaigns').toBe(true)

      const read = await apiRequest(request, 'GET', `${CAMPAIGNS_PATH}/${campaignId}`, { token: employeeToken })
      expect(read.ok(), 'a read-only role can read a campaign').toBe(true)

      const create = await apiRequest(request, 'POST', CAMPAIGNS_PATH, {
        token: employeeToken,
        data: { name: 'should not be created' },
      })
      expect(create.status()).toBe(403)

      const save = await saveGraph(request, employeeToken, campaignId, minimalGraph(detail.updatedAt, 'nope'))
      expect(save.status()).toBe(403)

      const remove = await apiRequest(request, 'DELETE', `${CAMPAIGNS_PATH}/${campaignId}`, { token: employeeToken })
      expect(remove.status()).toBe(403)

      // A denied attempt changed nothing.
      const after = await getCampaign(request, adminToken, campaignId)
      expect(after.updatedAt).toBe(detail.updatedAt)
      expect(after.definition.steps).toEqual([])
    } finally {
      await deleteCampaignIfExists(request, adminToken, campaignId)
    }
  })
})
