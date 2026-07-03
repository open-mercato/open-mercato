import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import { deleteGeneralEntityIfExists, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  cleanupDraftClaimWithLines,
  createClaimFixture,
  listClaims,
  uniqueLabel,
} from './helpers'

test.describe('TC-WC-007: warranty claims tenant isolation', () => {
  test('hides org-1 claims from a user authenticated in a second tenant and organization', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const stamp = uniqueLabel('tc-wc-007')
    const t2Email = `${stamp}@test.invalid`
    const t2Password = 'Valid1!Pass'

    let claimId: string | null = null
    let t2TenantId: string | null = null
    let t2OrgId: string | null = null
    let t2RoleId: string | null = null
    let t2UserId: string | null = null

    try {
      const claim = await createClaimFixture(request, adminToken, {
        claimType: 'warranty',
        customerName: `QA WC Tenant Source ${stamp}`,
        reasonCode: 'defective',
        currencyCode: 'USD',
      })
      claimId = claim.id

      const tenantResponse = await apiRequest(request, 'POST', '/api/directory/tenants', {
        token: superadminToken,
        data: { name: `QA WC Tenant ${stamp}` },
      })
      expect(tenantResponse.status(), 'second tenant should be created').toBe(201)
      t2TenantId = (await readJsonSafe<{ id?: string }>(tenantResponse))?.id ?? null
      expect(t2TenantId, 'tenant create should return id').toBeTruthy()

      const orgResponse = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token: superadminToken,
        data: { tenantId: t2TenantId, name: `QA WC Org ${stamp}` },
      })
      expect(orgResponse.status(), 'second organization should be created').toBe(201)
      t2OrgId = (await readJsonSafe<{ id?: string }>(orgResponse))?.id ?? null
      expect(t2OrgId, 'organization create should return id').toBeTruthy()

      t2RoleId = await createRoleFixture(request, superadminToken, {
        tenantId: t2TenantId!,
        name: `QA WC T2 View ${stamp}`,
      })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: t2RoleId,
        features: ['warranty_claims.claim.view', 'warranty_claims.claim.manage'],
        organizations: [t2OrgId!],
      })

      t2UserId = await createUserFixture(request, superadminToken, {
        email: t2Email,
        password: t2Password,
        organizationId: t2OrgId!,
        roles: [t2RoleId],
        name: `QA WC T2 User ${stamp}`,
      })
      const t2Token = await getAuthToken(request, t2Email, t2Password)

      const t2List = await listClaims(request, t2Token, 'pageSize=100')
      expect(t2List.some((item) => item.id === claimId), 'second-tenant list must not include org-1 claim').toBe(false)

      const t2IdsReadback = await listClaims(request, t2Token, `ids=${encodeURIComponent(claimId!)}&pageSize=10`)
      expect(t2IdsReadback, 'ids readback in second tenant should return zero rows for org-1 claim').toHaveLength(0)

      const unsupportedDetailRoute = await request.get(`/api/warranty_claims/${claimId}`, {
        headers: { Authorization: `Bearer ${t2Token}` },
      })
      expect(unsupportedDetailRoute.status(), 'no staff detail route should expose cross-tenant records').toBe(404)

      const crossTenantTransition = await apiRequest(request, 'POST', '/api/warranty_claims/transition', {
        token: t2Token,
        data: { id: claimId, toStatus: 'submitted' },
      })
      expect(crossTenantTransition.status(), 'second-tenant user must not transition an org-1 claim by id').toBe(404)

      const crossTenantComment = await apiRequest(request, 'POST', '/api/warranty_claims/events', {
        token: t2Token,
        data: { claimId, body: 'cross-tenant probe', visibility: 'internal' },
      })
      expect(crossTenantComment.status(), 'second-tenant user must not comment on an org-1 claim by id').toBe(404)
    } finally {
      await cleanupDraftClaimWithLines(request, adminToken, claimId)
      await deleteUserIfExists(request, superadminToken, t2UserId)
      await deleteRoleIfExists(request, superadminToken, t2RoleId)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/organizations', t2OrgId)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', t2TenantId)
    }
  })
})
