import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteCampaignIfExists } from './helpers/marketing'

/**
 * TC-MA-048: what one organization authors, another cannot read or change.
 *
 * The module's loudest rule is that every query is scoped by BOTH `tenant_id` and `organization_id`, and until
 * this spec existed the only thing enforcing it was that somebody had read the source. Forty-seven integration
 * specs and not one of them ever looked at a second organization — so a route that dropped its scope would have
 * passed every test in the suite while returning another shop's campaigns.
 *
 * **Driven as the SUPERADMIN, and that is not incidental.** `om_selected_org` is honoured only for a
 * super-admin (`applySuperAdminScope` in `packages/shared/src/lib/auth/server.ts` returns the context
 * untouched for anybody else), so the first version of this spec — which sent the cookie with an ordinary
 * admin's token — was scoping nothing at all: every request read the admin's own organization and the 404 it
 * asserted could only ever have come from somewhere else. The control below is therefore load-bearing: the
 * same request, with the same token, differing only in the cookie, MUST still succeed for the owning
 * organization. Without it a rejected token or a broken cookie would read exactly like isolation.
 */
test.describe('TC-MA-048 organization isolation', () => {
  test('a campaign is invisible, unreadable and unchangeable from another organization', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const { tenantId, organizationId: ownOrgId } = getTokenContext(token)
    expect(ownOrgId, 'the super-admin must have an organization of its own to author in').toBeTruthy()
    const stamp = Date.now()
    let foreignOrgId: string | null = null
    let campaignId: string | null = null

    try {
      foreignOrgId = await createOrganizationFixture(request, token, {
        name: `QA TC-MA-048 Foreign ${stamp}`,
        tenantId: tenantId ?? undefined,
      })

      // Authored while looking at the super-admin's own organization, so the row carries that org.
      const created = await apiRequestWithSelectedOrg(request, 'POST', '/api/marketing_automation/campaigns', {
        token,
        selectedOrgId: ownOrgId,
        data: { name: `TC-MA-048 isolation ${stamp}` },
      })
      expect(created.status(), await created.text()).toBe(201)
      campaignId = ((await readJsonSafe<{ id?: string }>(created))?.id) as string
      expect(campaignId).toBeTruthy()

      /**
       * The control, first: the same user, the same token, looking at the OWNING organization.
       *
       * It runs before the isolation assertions on purpose. If the cookie were ignored, or the token
       * refused, this would fail here rather than leaving three 404s below looking like a passing test.
       */
      const own = await apiRequestWithSelectedOrg(
        request,
        'GET',
        `/api/marketing_automation/campaigns/${campaignId}`,
        { token, selectedOrgId: ownOrgId },
      )
      expect(own.status(), 'the owning organization can read it').toBe(200)

      /**
       * Now the same request with only the organization changed.
       *
       * Every `[id]` route in this module answers 404 rather than 403 — saying "not yours" would confirm
       * the id exists.
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

      // The owning organization does list it, so "absent" is about the scope rather than about the query.
      const ownList = await apiRequestWithSelectedOrg(
        request,
        'GET',
        '/api/marketing_automation/campaigns?pageSize=100',
        { token, selectedOrgId: ownOrgId },
      )
      const ownItems = (await readJsonSafe<{ items?: Array<{ id?: string }> }>(ownList))?.items ?? []
      expect(ownItems.filter((item) => item.id === campaignId), 'listed from its own org').toHaveLength(1)

      // Its runs are a separate route with its own scope, and a separate chance to get it wrong.
      const runs = await apiRequestWithSelectedOrg(
        request,
        'GET',
        `/api/marketing_automation/campaigns/${campaignId}/runs`,
        { token, selectedOrgId: foreignOrgId },
      )
      expect(runs.status(), 'reading another org\'s runs').toBe(404)

      const ownRuns = await apiRequestWithSelectedOrg(
        request,
        'GET',
        `/api/marketing_automation/campaigns/${campaignId}/runs`,
        { token, selectedOrgId: ownOrgId },
      )
      expect(ownRuns.status(), 'the owning organization can read its runs').toBe(200)

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

      // Unchanged by that attempt, read from the organization that owns it.
      const after = await apiRequestWithSelectedOrg(
        request,
        'GET',
        `/api/marketing_automation/campaigns/${campaignId}`,
        { token, selectedOrgId: ownOrgId },
      )
      expect(((await readJsonSafe<{ isEnabled?: boolean }>(after))?.isEnabled) ?? true).toBe(false)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
      await deleteOrganizationIfExists(request, token, foreignOrgId)
    }
  })
})

/**
 * A second organization changes nothing for an ordinary admin, because the cookie is not theirs to use.
 *
 * Kept as its own test so the mechanism above cannot quietly become the thing under test: an admin who sends
 * `om_selected_org` is not switching scope, and anything that started honouring it for them would be widening
 * the platform's scoping rules rather than this module's.
 */
test.describe('TC-MA-048b the selected-organization cookie is a super-admin mechanism', () => {
  test('an ordinary admin keeps their own organization whatever cookie they send', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let campaignId: string | null = null

    try {
      const created = await apiRequest(request, 'POST', '/api/marketing_automation/campaigns', {
        token,
        data: { name: `TC-MA-048b own scope ${stamp}` },
      })
      expect(created.status()).toBe(201)
      campaignId = ((await readJsonSafe<{ id?: string }>(created))?.id) as string

      const withForeignCookie = await apiRequestWithSelectedOrg(
        request,
        'GET',
        `/api/marketing_automation/campaigns/${campaignId}`,
        { token, selectedOrgId: '11111111-1111-4111-8111-111111111111' },
      )
      // Their own organization, still — the cookie is ignored rather than obeyed or refused.
      expect(withForeignCookie.status()).toBe(200)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })
})
