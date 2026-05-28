import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  deleteGeneralEntityIfExists,
  expectId,
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
  test('should return 200 when a super-admin reads a private attachment uploaded in a different tenant', async ({
    request,
  }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')

    const stamp = Date.now()
    const t2AdminEmail = `qa-xss-004-t2-${stamp}@test.invalid`
    const recordId = `qa-xss-004-${stamp}`
    const fileContent = 'super-admin cross-tenant bypass test'

    let t2TenantId: string | null = null
    let t2OrgId: string | null = null
    let t2AdminId: string | null = null
    let attachmentId: string | null = null

    try {
      // Create tenant T2 so the attachment is owned by a different tenant than the
      // global super-admin's own tenant. This proves the bypass operates at the tenant
      // boundary, not just the org boundary.
      const tenantRes = await apiRequest(request, 'POST', '/api/directory/tenants', {
        token: superadminToken,
        data: { name: `qa-xss-004-tenant-${stamp}` },
      })
      expect(tenantRes.status()).toBe(201)
      t2TenantId = expectId(
        (await readJsonSafe<{ id?: string }>(tenantRes))?.id,
        'tenant create should return id',
      )

      const orgRes = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token: superadminToken,
        data: { tenantId: t2TenantId, name: `qa-xss-004-org-${stamp}` },
      })
      expect(orgRes.status()).toBe(201)
      t2OrgId = expectId(
        (await readJsonSafe<{ id?: string }>(orgRes))?.id,
        'org create should return id',
      )

      // Create a T2 admin to upload the attachment — their JWT carries T2's tenantId,
      // so the resulting attachment row is stored with tenantId = T2.
      t2AdminId = await createUserFixture(request, superadminToken, {
        email: t2AdminEmail,
        password: 'Valid1!Pass',
        organizationId: t2OrgId,
        roles: ['admin'],
      })

      const t2AdminToken = await getAuthToken(request, t2AdminEmail, 'Valid1!Pass')
      const uploaded = await uploadAttachmentFixture(request, t2AdminToken, {
        entityId: 'attachments:library',
        recordId,
        fileName: 'xss-004.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(fileContent, 'utf8'),
      })
      attachmentId = uploaded.id

      // T1 admin (different tenant) is blocked — confirms the tenant filter is active.
      // em.findOne({ id, tenantId: T1 }) returns null because the attachment is in T2.
      const blockedResponse = await request.fetch(
        `${BASE_URL}/api/attachments/file/${encodeURIComponent(attachmentId)}`,
        { method: 'GET', headers: { Authorization: `Bearer ${adminToken}` } },
      )
      expect(blockedResponse.status()).toBe(404)

      // Global super-admin bypasses via isSuperAdminAuth() — em.findOne receives no
      // tenantId/organizationId constraint, so the T2 row is found and served.
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
      await deleteUserIfExists(request, superadminToken, t2AdminId)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/organizations', t2OrgId)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', t2TenantId)
    }
  })
})
