import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import { getTokenScope } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  cleanupDraftClaimWithLines,
  createClaimFixture,
  listClaims,
  uniqueLabel,
} from './helpers'

test.describe('TC-WC-007: warranty claims tenant isolation', () => {
  test('hides org-A claims from a user authenticated in a second organization of the same tenant', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { tenantId, organizationId: orgAId } = getTokenScope(adminToken)
    expect(tenantId, 'admin token should carry a tenant id').toBeTruthy()
    expect(orgAId, 'admin token should carry an organization id').toBeTruthy()

    const stamp = uniqueLabel('tc-wc-007')
    const orgBEmail = `${stamp}@test.invalid`
    const orgBPassword = 'Valid1!Pass'

    let claimId: string | null = null
    let orgBId: string | null = null
    let orgBRoleId: string | null = null
    let orgBUserId: string | null = null

    try {
      const claim = await createClaimFixture(request, adminToken, {
        claimType: 'warranty',
        customerName: `QA WC Tenant Source ${stamp}`,
        reasonCode: 'defective',
        currencyCode: 'USD',
      })
      claimId = claim.id

      orgBId = await createOrganizationFixture(request, superadminToken, {
        tenantId,
        name: `QA WC Org B ${stamp}`,
      })

      orgBRoleId = await createRoleFixture(request, superadminToken, {
        tenantId,
        name: `QA WC Org B View ${stamp}`,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: orgBRoleId,
        features: ['warranty_claims.claim.view', 'warranty_claims.claim.manage'],
        organizations: [orgBId],
      })

      orgBUserId = await createUserFixture(request, superadminToken, {
        email: orgBEmail,
        password: orgBPassword,
        organizationId: orgBId,
        roles: [orgBRoleId],
        name: `QA WC Org B User ${stamp}`,
      })
      const orgBToken = await getAuthToken(request, orgBEmail, orgBPassword)
      const orgBScope = getTokenScope(orgBToken)
      expect(orgBScope.tenantId, 'org-B user token should share the seeded tenant').toBe(tenantId)
      expect(orgBScope.organizationId, 'org-B user token should be scoped to org B').toBe(orgBId)

      const orgBList = await listClaims(request, orgBToken, 'pageSize=100')
      expect(orgBList.some((item) => item.id === claimId), 'org-B list must not include the org-A claim').toBe(false)

      const orgBIdsReadback = await listClaims(request, orgBToken, `ids=${encodeURIComponent(claimId!)}&pageSize=10`)
      expect(orgBIdsReadback, 'ids readback in org B should return zero rows for the org-A claim').toHaveLength(0)

      const unsupportedDetailRoute = await request.get(`/api/warranty_claims/${claimId}`, {
        headers: { Authorization: `Bearer ${orgBToken}` },
      })
      expect(unsupportedDetailRoute.status(), 'staff detail route should not expose cross-org records').toBe(404)

      const crossOrgTransition = await apiRequest(request, 'POST', '/api/warranty_claims/transition', {
        token: orgBToken,
        data: { id: claimId, toStatus: 'submitted' },
      })
      expect(crossOrgTransition.status(), 'org-B user must not transition an org-A claim by id').toBe(404)

      const crossOrgComment = await apiRequest(request, 'POST', '/api/warranty_claims/events', {
        token: orgBToken,
        data: { claimId, body: 'cross-org probe', visibility: 'internal' },
      })
      expect(crossOrgComment.status(), 'org-B user must not comment on an org-A claim by id').toBe(404)
    } finally {
      await cleanupDraftClaimWithLines(request, adminToken, claimId)
      await deleteUserIfExists(request, superadminToken, orgBUserId)
      await deleteRoleIfExists(request, superadminToken, orgBRoleId)
      await deleteOrganizationIfExists(request, superadminToken, orgBId)
    }
  })
})
