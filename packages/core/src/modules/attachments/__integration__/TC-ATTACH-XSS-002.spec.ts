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

test.describe('TC-ATTACH-XSS-002: Cross-tenant access to private attachment via file route', () => {
  test('should return 404 when an authenticated user from tenant T2 reads a private attachment from tenant T1', async ({
    request,
  }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')

    const stamp = Date.now()
    const t2UserEmail = `qa-xss-002-t2-${stamp}@test.invalid`
    const recordId = `qa-xss-002-${stamp}`

    let t2TenantId: string | null = null
    let t2OrgId: string | null = null
    let t2UserId: string | null = null
    let attachmentId: string | null = null

    try {
      // Create a second tenant T2 — POST /api/directory/tenants is available in the
      // integration environment (pattern established by TC-AUTH-041).
      const tenantRes = await apiRequest(request, 'POST', '/api/directory/tenants', {
        token: superadminToken,
        data: { name: `qa-xss-002-tenant-${stamp}` },
      })
      expect(tenantRes.status()).toBe(201)
      t2TenantId = expectId(
        (await readJsonSafe<{ id?: string }>(tenantRes))?.id,
        'tenant create should return id',
      )

      // Create an org in T2 — tenantId in the body routes the org to T2.
      const orgRes = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token: superadminToken,
        data: { tenantId: t2TenantId, name: `qa-xss-002-org-${stamp}` },
      })
      expect(orgRes.status()).toBe(201)
      t2OrgId = expectId(
        (await readJsonSafe<{ id?: string }>(orgRes))?.id,
        'org create should return id',
      )

      // Create a user in T2 — their JWT will carry T2's tenantId.
      t2UserId = await createUserFixture(request, superadminToken, {
        email: t2UserEmail,
        password: 'Valid1!Pass',
        organizationId: t2OrgId,
        roles: [],
      })

      // Admin (T1) uploads a private attachment — stored with tenantId = T1.
      const uploaded = await uploadAttachmentFixture(request, adminToken, {
        entityId: 'attachments:library',
        recordId,
        fileName: 'xss-002.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('cross-tenant isolation test', 'utf8'),
      })
      attachmentId = uploaded.id

      // T2 user's JWT carries T2's tenantId. The file route adds
      // tenantId = T2 to em.findOne, so the T1 attachment row is never returned → 404.
      const t2UserToken = await getAuthToken(request, t2UserEmail, 'Valid1!Pass')
      const response = await request.fetch(
        `${BASE_URL}/api/attachments/file/${encodeURIComponent(attachmentId)}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${t2UserToken}` },
        },
      )
      expect(response.status()).toBe(404)
    } finally {
      await deleteAttachmentIfExists(request, superadminToken, attachmentId)
      await deleteUserIfExists(request, superadminToken, t2UserId)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/organizations', t2OrgId)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', t2TenantId)
    }
  })
})
