import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createUserFixture,
  deleteUserIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import {
  deleteAttachmentIfExists,
  uploadAttachmentFixture,
} from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

test.describe('TC-ATTACH-XSS-004: Super-admin access to any private attachment', () => {
  test('should return 200 for super-admin while cross-org and cross-tenant users are blocked', async ({
    request,
  }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId: adminTenantId } = getTokenScope(adminToken)

    const stamp = Date.now()
    const crossOrgUserEmail = `qa-xss-004-org-${stamp}@test.invalid`
    const t2UserEmail = `qa-xss-004-t2-${stamp}@test.invalid`
    const recordId = `qa-xss-004-${stamp}`
    const fileContent = 'super-admin bypass test'

    let crossOrgId: string | null = null
    let crossOrgUserId: string | null = null
    let t2TenantId: string | null = null
    let t2OrgId: string | null = null
    let t2UserId: string | null = null
    let attachmentId: string | null = null

    try {
      // Create a second org in T1 so we can prove the org filter is active.
      const orgRes = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token: superadminToken,
        data: { tenantId: adminTenantId, name: `qa-xss-004-org-${stamp}` },
      })
      expect(orgRes.status()).toBe(201)
      crossOrgId = expectId(
        (await readJsonSafe<{ id?: string }>(orgRes))?.id,
        'org create should return id',
      )

      // T1/orgB employee — used to prove the org filter blocks within the same tenant.
      // Roles are assignable here because T1 is the primary seeded tenant.
      crossOrgUserId = await createUserFixture(request, superadminToken, {
        email: crossOrgUserEmail,
        password: 'Valid1!Pass',
        organizationId: crossOrgId,
        roles: ['employee'],
      })

      // Create T2 tenant and a user inside it to prove the tenant filter is also active.
      // T2 user is created without roles because freshly created tenants do not have
      // roles seeded — an authenticated JWT with T2's tenantId is all we need here.
      const tenantRes = await apiRequest(request, 'POST', '/api/directory/tenants', {
        token: superadminToken,
        data: { name: `qa-xss-004-tenant-${stamp}` },
      })
      expect(tenantRes.status()).toBe(201)
      t2TenantId = expectId(
        (await readJsonSafe<{ id?: string }>(tenantRes))?.id,
        'tenant create should return id',
      )

      const t2OrgRes = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token: superadminToken,
        data: { tenantId: t2TenantId, name: `qa-xss-004-t2-org-${stamp}` },
      })
      expect(t2OrgRes.status()).toBe(201)
      t2OrgId = expectId(
        (await readJsonSafe<{ id?: string }>(t2OrgRes))?.id,
        't2 org create should return id',
      )

      t2UserId = await createUserFixture(request, superadminToken, {
        email: t2UserEmail,
        password: 'Valid1!Pass',
        organizationId: t2OrgId,
        roles: [],
      })

      // Admin (T1/orgA) uploads a private attachment — stored with tenantId = T1, orgId = orgA.
      const uploaded = await uploadAttachmentFixture(request, adminToken, {
        entityId: 'attachments:library',
        recordId,
        fileName: 'xss-004.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(fileContent, 'utf8'),
      })
      attachmentId = uploaded.id

      // T1/orgB user is blocked — confirms the organizationId filter is active.
      const crossOrgUserToken = await getAuthToken(request, crossOrgUserEmail, 'Valid1!Pass')
      const crossOrgResponse = await request.fetch(
        `${BASE_URL}/api/attachments/file/${encodeURIComponent(attachmentId)}`,
        { method: 'GET', headers: { Authorization: `Bearer ${crossOrgUserToken}` } },
      )
      expect(crossOrgResponse.status()).toBe(404)

      // T2 user is blocked — confirms the tenantId filter is active.
      const t2UserToken = await getAuthToken(request, t2UserEmail, 'Valid1!Pass')
      const crossTenantResponse = await request.fetch(
        `${BASE_URL}/api/attachments/file/${encodeURIComponent(attachmentId)}`,
        { method: 'GET', headers: { Authorization: `Bearer ${t2UserToken}` } },
      )
      expect(crossTenantResponse.status()).toBe(404)

      // Super-admin bypasses both filters via isSuperAdminAuth() — em.findOne receives
      // no tenantId/organizationId constraint. The org-level bypass is directly guarded
      // above; the tenant-level bypass is covered at the unit level in
      // packages/core/src/modules/attachments/lib/__tests__/access.test.ts because
      // freshly created T2 tenants lack seeded roles, preventing uploads scoped to T2
      // in the integration environment.
      const superadminResponse = await request.fetch(
        `${BASE_URL}/api/attachments/file/${encodeURIComponent(attachmentId)}`,
        { method: 'GET', headers: { Authorization: `Bearer ${superadminToken}` } },
      )
      expect(superadminResponse.status()).toBe(200)
      expect(superadminResponse.headers()['content-type']).toContain('application/octet-stream')
      const body = await superadminResponse.text()
      expect(body).toBe(fileContent)
    } finally {
      await deleteAttachmentIfExists(request, superadminToken, attachmentId)
      await deleteUserIfExists(request, superadminToken, crossOrgUserId)
      await deleteUserIfExists(request, superadminToken, t2UserId)
      if (crossOrgId) {
        await apiRequest(
          request,
          'DELETE',
          `/api/directory/organizations?id=${encodeURIComponent(crossOrgId)}`,
          { token: superadminToken },
        ).catch(() => undefined)
      }
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/organizations', t2OrgId)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', t2TenantId)
    }
  })
})
