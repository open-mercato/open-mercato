import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createOrganizationInDb, deleteOrganizationInDb } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  ALL_ORGANIZATIONS_SELECTION,
  DEAL_RESOURCE_KIND,
  NOT_FOUND_BODY,
  createQaDeal,
  createScopedUser,
  deleteQaDealIfExists,
  deleteScopedUser,
  explainRecord,
  updateQaDeal,
  uniqueSuffix,
  type ExplainFieldBody,
  type ScopedUserFixture,
} from './helpers/explainApi'

/**
 * TC-INS-019: Organization scope of the explain API
 * Covers:
 *   - GET /api/insights/explain with "All organizations", a selected organization
 *     and an organization-restricted user
 *
 * An unrestricted admin who selects "All organizations" (no single organization)
 * and a superadmin without any selection explain a record of any organization in
 * the tenant; the admin's default home-organization scope does not. A user restricted to the
 * home organization explains home records but never sees a record of another
 * organization, whatever organization cookie they send.
 */
test.describe('TC-INS-019: explain respects the organization scope', () => {
  test('allows all-organizations admins and denies organization-restricted users', async ({ request }) => {
    let adminToken: string | null = null
    let otherOrgId: string | null = null
    let homeDealId: string | null = null
    let otherDealId: string | null = null
    const restrictedFixture: ScopedUserFixture = { roleId: null, userId: null }

    try {
      adminToken = await getAuthToken(request, 'admin')
      const { tenantId, organizationId: homeOrgId } = getTokenScope(adminToken)
      const suffix = uniqueSuffix()
      otherOrgId = await createOrganizationInDb({ name: `QA INS-019 Org ${suffix}`, tenantId })
      homeDealId = await createQaDeal(request, adminToken, { title: `QA INS-019 home ${suffix}`, status: 'open' })
      otherDealId = await createQaDeal(request, adminToken, {
        title: `QA INS-019 other ${suffix}`,
        status: 'open',
        selectedOrgId: otherOrgId,
      })
      const otherStatus = `qa_other_${suffix}`
      await updateQaDeal(request, adminToken, otherDealId, { status: otherStatus }, { selectedOrgId: otherOrgId })
      const otherQuery = { resourceKind: DEAL_RESOURCE_KIND, resourceId: otherDealId, field: 'status' }

      const allOrganizations = await explainRecord<ExplainFieldBody>(request, adminToken, otherQuery, {
        selectedOrgId: ALL_ORGANIZATIONS_SELECTION,
      })
      expect(allOrganizations.status, `"All organizations" admin can explain: ${allOrganizations.text}`).toBe(200)
      expect(allOrganizations.body?.current.value).toBe(otherStatus)
      expect(allOrganizations.body?.verdict).toBe('explained')
      expect(allOrganizations.body?.chain[0]?.to?.value, 'the history of the other organization is readable').toBe(otherStatus)

      const superadminToken = await getAuthToken(request, 'superadmin')
      const superadmin = await explainRecord<ExplainFieldBody>(request, superadminToken, otherQuery)
      expect(superadmin.status, `superadmin without an organization selection can explain: ${superadmin.text}`).toBe(200)
      expect(superadmin.body?.current.value).toBe(otherStatus)

      const homeScoped = await explainRecord(request, adminToken, otherQuery)
      expect(homeScoped.status, 'the admin home-organization scope does not reach the other organization').toBe(404)
      expect(homeScoped.body).toEqual(NOT_FOUND_BODY)

      const restricted = await createScopedUser(request, adminToken, restrictedFixture, {
        label: 'INS-019 home org only',
        features: ['customers.people.view', 'customers.deals.view', 'insights.explain.view'],
        organizations: [homeOrgId],
      })

      const homeExplained = await explainRecord(request, restricted.token, {
        resourceKind: DEAL_RESOURCE_KIND,
        resourceId: homeDealId,
        field: 'status',
      })
      expect(homeExplained.status, `the restricted user explains home records: ${homeExplained.text}`).toBe(200)

      for (const selectedOrgId of [undefined, ALL_ORGANIZATIONS_SELECTION, otherOrgId]) {
        const denied = await explainRecord(request, restricted.token, otherQuery, selectedOrgId ? { selectedOrgId } : {})
        expect(denied.status, `restricted user is denied (selection: ${selectedOrgId ?? 'none'})`).toBe(404)
        expect(denied.body).toEqual(NOT_FOUND_BODY)
      }
    } finally {
      await deleteQaDealIfExists(request, adminToken, homeDealId)
      await deleteQaDealIfExists(request, adminToken, otherDealId, otherOrgId ? { selectedOrgId: otherOrgId } : {})
      await deleteScopedUser(request, adminToken, restrictedFixture)
      await deleteOrganizationInDb(otherOrgId).catch(() => undefined)
    }
  })
})
