import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  deleteAttachmentIfExists,
  uploadAttachmentFixture,
} from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

test.describe('TC-ATTACH-XSS-004: Super-admin access to any private attachment', () => {
  test('should return 200 when a super-admin reads a private attachment from any tenant', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superAdminToken = await getAuthToken(request, 'superadmin')
    const recordId = `qa-xss-004-${Date.now()}`
    let attachmentId: string | null = null

    try {
      const uploaded = await uploadAttachmentFixture(request, adminToken, {
        entityId: 'attachments:library',
        recordId,
        fileName: 'xss-004.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('super-admin bypass test', 'utf8'),
      })
      attachmentId = uploaded.id

      const response = await request.fetch(
        `${BASE_URL}/api/attachments/file/${encodeURIComponent(attachmentId)}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${superAdminToken}` },
        },
      )
      expect(response.status()).toBe(200)
    } finally {
      await deleteAttachmentIfExists(request, adminToken, attachmentId)
    }
  })
})
