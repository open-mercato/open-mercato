import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  deleteAttachmentIfExists,
  uploadAttachmentFixture,
} from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

test.describe('TC-ATT-003: Attachment security hardening', () => {
  test('should reject active content uploads and force non-image downloads to attachment mode', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const recordId = `qa-security-record-${Date.now()}`
    let attachmentId: string | null = null

    try {
      const activeContentUpload = await request.fetch(`${BASE_URL}/api/attachments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        multipart: {
          entityId: 'attachments:library',
          recordId,
          file: {
            name: 'xss.svg',
            mimeType: 'image/svg+xml',
            buffer: Buffer.from(
              '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("/api/auth/me")</script></svg>',
              'utf8',
            ),
          },
        },
      })
      expect(activeContentUpload.status()).toBe(400)
      const activeContentBody = await readJsonSafe<{ error?: string }>(activeContentUpload)
      expect(activeContentBody?.error).toContain('Active content')

      const publicPartitionUpload = await request.fetch(`${BASE_URL}/api/attachments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        multipart: {
          entityId: 'attachments:library',
          recordId,
          partitionCode: 'productsMedia',
          file: {
            name: 'note.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('public override should be rejected', 'utf8'),
          },
        },
      })
      expect(publicPartitionUpload.status()).toBe(403)
      const publicPartitionBody = await readJsonSafe<{ error?: string }>(publicPartitionUpload)
      expect(publicPartitionBody?.error).toContain('Public storage partitions')

      const uploaded = await uploadAttachmentFixture(request, token, {
        entityId: 'attachments:library',
        recordId,
        fileName: 'security-note.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('plain text attachment', 'utf8'),
      })
      attachmentId = uploaded.id

      const fileResponse = await request.fetch(`${BASE_URL}/api/attachments/file/${encodeURIComponent(attachmentId)}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      expect(fileResponse.status()).toBe(200)
      expect(fileResponse.headers()['content-type']).toBe('application/octet-stream')
      expect(fileResponse.headers()['x-content-type-options']).toBe('nosniff')
      expect(fileResponse.headers()['content-security-policy']).toContain('sandbox')
      expect(fileResponse.headers()['content-disposition']).toContain('attachment;')
    } finally {
      await deleteAttachmentIfExists(request, token, attachmentId)
    }
  })
})
