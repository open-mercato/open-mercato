import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { createCampaign, deleteCampaignIfExists } from './helpers/marketing'

/**
 * TC-MA-048: what one organization authors, another cannot read or change.
 *
 * The module's loudest rule is that every query is scoped by BOTH `tenant_id` and `organization_id`, and until
 * this spec existed the only thing enforcing it was that somebody had read the source. Forty-seven integration
 * specs and not one of them ever created a second organization — so a route that dropped its scope would have
 * passed every test in the suite while returning another shop's campaigns.
 *
 * Driven through the selected-organization cookie, which is how the platform scopes a request, rather than by
 * minting a second user: the question here is whether the ROUTES scope their reads, not whether RBAC works.
 * That keeps the test about this module.
 */
test.describe('TC-MA-048 organization isolation', () => {
  test('a campaign is invisible, unreadable and unchangeable from another organization', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(token)
    const stamp = Date.now()
    let foreignOrgId: string | null = null
    let campaignId: string | null = null

    try {
      foreignOrgId = await createOrganizationFixture(request, token, {
        name: `QA TC-MA-048 Foreign ${stamp}`,
        tenantId: tenantId ?? undefined,
      })

      // Authored in the admin's own organization, with no cookie, exactly as every other spec does.
      campaignId = await createCampaign(request, token, `TC-MA-048 isolation ${stamp}`)

      /**
       * Read as the same user, looking at the other organization.
       *
       * The token is identical; only the selected organization differs. A route that scopes its query
       * correctly cannot find the row, and every `[id]` route in this module is documented as returning 404
       * rather than 403 — saying "not yours" would confirm the id exists.
       */
      const detail = await apiRequestWithSelectedOrg(
        request,
        'GET',
        `/api/marketing_automation/campaigns/${campaignId}`,
        { token, selectedOrgId: foreignOrgId },
      )
      expect(detail.status(), 'reading another org\'s campaign').toBe(404)

      // And it is absent from the list, not merely unreachable by id.
      const list = await apiRequestWithSelectedOrg(
        request,
        'GET',
        '/api/marketing_automation/campaigns?pageSize=100',
        { token, selectedOrgId: foreignOrgId },
      )
      expect(list.status()).toBe(200)
      const items = (await readJsonSafe<{ items?: Array<{ id?: string }> }>(list))?.items ?? []
      expect(items.filter((item) => item.id === campaignId), 'listed from another org').toHaveLength(0)

      // Its runs are a separate route with its own scope, and a separate chance to get it wrong.
      const runs = await apiRequestWithSelectedOrg(
        request,
        'GET',
        `/api/marketing_automation/campaigns/${campaignId}/runs`,
        { token, selectedOrgId: foreignOrgId },
      )
      expect(runs.status(), 'reading another org\'s runs').toBe(404)

      /**
       * Writing is the one that matters most: a scope checked on read and forgotten on write is the shape
       * this test exists to catch.
       */
      const enable = await apiRequestWithSelectedOrg(
        request,
        'PUT',
        `/api/marketing_automation/campaigns/${campaignId}`,
        { token, selectedOrgId: foreignOrgId, data: { isEnabled: true } },
      )
      expect(enable.status(), 'enabling another org\'s campaign').toBeGreaterThanOrEqual(400)

      // The control: the same requests from the owning organization still work, so a blanket failure —
      // a broken cookie, a rejected token — cannot be mistaken for isolation.
      const own = await apiRequest(request, 'GET', `/api/marketing_automation/campaigns/${campaignId}`, { token })
      expect(own.status(), 'the owner can still read it').toBe(200)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
      await deleteOrganizationIfExists(request, token, foreignOrgId)
    }
  })
})
