import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
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

test.describe('TC-ATTACH-XSS-006: Cross-org access to private attachment via image route within the same tenant', () => {
  test('should return 404 when an authenticated user from org B reads a private attachment uploaded by org A via the image route', async ({
    request,
  }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId: adminTenantId } = getTokenScope(adminToken)

    const crossOrgUserEmail = `qa-xss-006-${Date.now()}@test.invalid`
    const recordId = `qa-xss-006-${Date.now()}`

    let crossOrgId: string | null = null
    let crossOrgUserId: string | null = null
    let attachmentId: string | null = null

    try {
      // Create a second org in the same tenant — same fixture pattern as TC-ATTACH-XSS-003.
      const orgResponse = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token: superadminToken,
        data: { tenantId: adminTenantId, name: `qa-xss-006-org-${Date.now()}` },
      })
      expect(orgResponse.status()).toBe(201)
      crossOrgId = expectId(
        (await readJsonSafe<{ id?: string }>(orgResponse))?.id,
        'org create should return id',
      )

      crossOrgUserId = await createUserFixture(request, superadminToken, {
        email: crossOrgUserEmail,
        password: 'Valid1!Pass',
        organizationId: crossOrgId,
        roles: ['employee'],
      })

      // Admin (org A) uploads a private attachment.
      const uploaded = await uploadAttachmentFixture(request, adminToken, {
        entityId: 'attachments:library',
        recordId,
        fileName: 'xss-006.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('cross-org image-route isolation test', 'utf8'),
      })
      attachmentId = uploaded.id

      // Cross-org user (org B, same tenant) tries the image route.
      // em.findOne({ id, organizationId: orgB }) → null → 404,
      // reached before any MIME-type check.
      const crossOrgUserToken = await getAuthToken(request, crossOrgUserEmail, 'Valid1!Pass')
      const response = await request.fetch(
        `${BASE_URL}/api/attachments/image/${encodeURIComponent(attachmentId)}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${crossOrgUserToken}` },
        },
      )
      expect(response.status()).toBe(404)
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
