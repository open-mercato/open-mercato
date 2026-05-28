import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  expectId,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import {
  deleteAttachmentIfExists,
  uploadAttachmentFixture,
} from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

test.describe('TC-ATTACH-XSS-004: Super-admin access to any private attachment', () => {
  test('should return 200 and serve the correct file when a super-admin reads an attachment that is blocked for cross-org users', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId: adminTenantId } = getTokenScope(adminToken)

    const crossOrgUserEmail = `qa-xss-004-${Date.now()}@test.invalid`
    const recordId = `qa-xss-004-${Date.now()}`
    const fileContent = 'super-admin bypass test'

    let crossOrgId: string | null = null
    let crossOrgUserId: string | null = null
    let attachmentId: string | null = null

    try {
      // Create a second org so we can prove the org filter is active for regular users
      // but bypassed for super-admin via isSuperAdminAuth() in the route.
      const orgResponse = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token: superadminToken,
        data: { tenantId: adminTenantId, name: `qa-xss-004-org-${Date.now()}` },
      })
      expect(orgResponse.status()).toBe(201)
      const orgBody = await readJsonSafe<{ id?: string }>(orgResponse)
      crossOrgId = expectId(orgBody?.id, 'org create should return id')

      crossOrgUserId = await createUserFixture(request, superadminToken, {
        email: crossOrgUserEmail,
        password: 'Valid1!Pass',
        organizationId: crossOrgId,
        roles: ['employee'],
      })

      // Admin (org A) uploads a private attachment
      const uploaded = await uploadAttachmentFixture(request, adminToken, {
        entityId: 'attachments:library',
        recordId,
        fileName: 'xss-004.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(fileContent, 'utf8'),
      })
      attachmentId = uploaded.id

      // Cross-org user (org B) is blocked — confirms the org filter is active
      const crossOrgUserToken = await getAuthToken(request, crossOrgUserEmail, 'Valid1!Pass')
      const blockedResponse = await request.fetch(
        `${BASE_URL}/api/attachments/file/${encodeURIComponent(attachmentId)}`,
        { method: 'GET', headers: { Authorization: `Bearer ${crossOrgUserToken}` } },
      )
      expect(blockedResponse.status()).toBe(404)

      // Super-admin bypasses the org filter: isSuperAdminAuth() returns true so the
      // route skips adding tenantId/organizationId to em.findOne (route.ts lines 42-45).
      const superadminResponse = await request.fetch(
        `${BASE_URL}/api/attachments/file/${encodeURIComponent(attachmentId)}`,
        { method: 'GET', headers: { Authorization: `Bearer ${superadminToken}` } },
      )
      expect(superadminResponse.status()).toBe(200)
      expect(superadminResponse.headers()['content-type']).toContain('application/octet-stream')
      const body = await superadminResponse.text()
      expect(body).toBe(fileContent)
    } finally {
      await deleteAttachmentIfExists(request, adminToken, attachmentId)
      await deleteUserIfExists(request, superadminToken, crossOrgUserId)
      if (crossOrgId) {
        await apiRequest(
          request,
          'DELETE',
          `/api/directory/organizations?id=${encodeURIComponent(crossOrgId)}`,
          { token: superadminToken },
        ).catch(() => undefined)
      }
    }
  })
})
