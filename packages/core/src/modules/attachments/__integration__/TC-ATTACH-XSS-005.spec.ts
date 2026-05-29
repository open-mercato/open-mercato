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

test.describe('TC-ATTACH-XSS-005: Cross-tenant access to private attachment via image route', () => {
  test('should return 404 when an authenticated user from tenant T2 reads a private attachment from tenant T1 via the image route', async ({
    request,
  }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')

    const stamp = Date.now()
    const t2UserEmail = `qa-xss-005-t2-${stamp}@test.invalid`
    const recordId = `qa-xss-005-${stamp}`

    let t2TenantId: string | null = null
    let t2OrgId: string | null = null
    let t2UserId: string | null = null
    let attachmentId: string | null = null

    try {
      // Create T2 tenant and user — same fixture pattern as TC-ATTACH-XSS-002.
      const tenantRes = await apiRequest(request, 'POST', '/api/directory/tenants', {
        token: superadminToken,
        data: { name: `qa-xss-005-tenant-${stamp}` },
      })
      expect(tenantRes.status()).toBe(201)
      t2TenantId = expectId(
        (await readJsonSafe<{ id?: string }>(tenantRes))?.id,
        'tenant create should return id',
      )

      const orgRes = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token: superadminToken,
        data: { tenantId: t2TenantId, name: `qa-xss-005-org-${stamp}` },
      })
      expect(orgRes.status()).toBe(201)
      t2OrgId = expectId(
        (await readJsonSafe<{ id?: string }>(orgRes))?.id,
        'org create should return id',
      )

      t2UserId = await createUserFixture(request, superadminToken, {
        email: t2UserEmail,
        password: 'Valid1!Pass',
        organizationId: t2OrgId,
        roles: [],
      })

      // Admin (T1) uploads a private attachment — stored with tenantId = T1.
      // The image route applies the same em.findOne tenantId filter as the file route
      // (image route.ts lines 56-60), so the 404 is reached before any MIME-type check.
      const uploaded = await uploadAttachmentFixture(request, adminToken, {
        entityId: 'attachments:library',
        recordId,
        fileName: 'xss-005.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('cross-tenant image-route isolation test', 'utf8'),
      })
      attachmentId = uploaded.id

      // T2 user's JWT carries T2's tenantId → em.findOne({ id, tenantId: T2 }) → null → 404.
      const t2UserToken = await getAuthToken(request, t2UserEmail, 'Valid1!Pass')
      const response = await request.fetch(
        `${BASE_URL}/api/attachments/image/${encodeURIComponent(attachmentId)}`,
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
