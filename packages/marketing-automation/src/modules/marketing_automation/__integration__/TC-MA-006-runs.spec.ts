import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCampaign, deleteCampaignIfExists, getCampaign, listRuns } from './helpers/marketing'

/**
 * TC-MA-006: the runs view, and the grant that protects it.
 *
 * Seeing a campaign and seeing which named customers it has messaged are different disclosures, so
 * `runs.view` is its own feature. The first test is the one that makes that guard FIRE — a principal
 * holding `campaigns.view` alone must be refused — because a test that only proves an admin can read
 * the list would pass just as well if the feature were never checked.
 */
test.describe('TC-MA-006 campaign runs', () => {
  test('is refused to a principal holding campaigns.view but not runs.view', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)
    const stamp = Date.now()
    const email = `qa-ma-viewer-${stamp}@example.com`
    const roleName = `qa-ma-viewer-${stamp}`
    const password = 'Qa-Viewer-1!'
    let campaignId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null

    try {
      campaignId = await createCampaign(request, adminToken, `QA runs acl ${stamp}`)

      roleId = await createRoleFixture(request, adminToken, { name: roleName })
      // Campaign visibility WITHOUT run visibility — the exact boundary under test.
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['marketing_automation.campaigns.view'],
      })
      userId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId,
        roles: [roleId],
        name: 'QA Campaign Viewer',
      })
      const viewerToken = await getAuthToken(request, email, password)

      // Sanity: the role really can see the campaign, so the refusal below is about runs only.
      const campaignRead = await apiRequest(request, 'GET', `/api/marketing_automation/campaigns/${campaignId}`, { token: viewerToken })
      expect(campaignRead.ok(), 'the role can read the campaign itself').toBe(true)

      const runs = await listRuns(request, viewerToken, campaignId)
      expect(runs.status(), 'runs.view is required to list runs').toBe(403)
    } finally {
      await deleteCampaignIfExists(request, adminToken, campaignId)
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('lists runs for a campaign, filters by status, and returns no PII', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null

    try {
      campaignId = await createCampaign(request, token, `QA runs ${Date.now()}`)
      const campaign = await getCampaign(request, token, campaignId)

      const response = await listRuns(request, token, campaignId)
      expect(response.ok()).toBe(true)
      const body = await readJsonSafe<{
        campaign?: { id?: string; name?: string }
        items?: Array<Record<string, unknown>>
        total?: number
      }>(response)

      expect(body?.campaign?.id).toBe(campaignId)
      expect(body?.campaign?.name).toBe(campaign.name)
      // A fresh campaign has no runs; the page must render that rather than fail.
      expect(body?.items).toEqual([])
      expect(body?.total).toBe(0)

      // The curated row shape must never carry the stored context blob or a decrypted address.
      const serialized = JSON.stringify(body)
      expect(serialized).not.toContain('"context"')
      expect(serialized).not.toContain('subjectEmail')

      const filtered = await listRuns(request, token, campaignId, 'waiting')
      expect(filtered.ok(), 'a known status filter is accepted').toBe(true)

      // An unknown status is ignored rather than erroring, so a stale bookmark still renders.
      const bogus = await listRuns(request, token, campaignId, 'not-a-status')
      expect(bogus.ok()).toBe(true)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('refuses a campaign from outside the caller scope', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await listRuns(request, token, '11111111-1111-4111-8111-111111111111')
    expect(response.status()).toBe(404)
  })
})
