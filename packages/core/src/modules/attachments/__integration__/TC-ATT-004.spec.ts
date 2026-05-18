import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  deleteAttachmentIfExists,
  deleteAttachmentPartitionIfExists,
  uploadAttachmentFixture,
} from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'
import {
  createS3Bucket,
  deleteS3Bucket,
  isLocalstackAvailable,
  localstackS3Config,
} from '@open-mercato/core/modules/core/__integration__/helpers/s3Fixtures'

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

test.describe('TC-ATT-004: S3 partition upload and download roundtrip', () => {
  test('should upload and download a file through an S3-backed attachment partition', async ({ request }) => {
    if (!isLocalstackAvailable()) {
      test.skip()
    }

    const token = await getAuthToken(request, 'admin')
    const bucketName = `qa-att-004-${Date.now()}`
    const partitionCode = `qa_s3_${Date.now()}`
    const recordId = `qa-s3-record-${Date.now()}`
    let partitionId: string | null = null
    let attachmentId: string | null = null

    try {
      await createS3Bucket(bucketName)

      // Create an S3-backed partition
      const createPartitionResponse = await apiRequest(request, 'POST', '/api/attachments/partitions', {
        token,
        data: {
          code: partitionCode,
          title: 'QA S3 Partition',
          isPublic: false,
          requiresOcr: false,
          storageDriver: 's3',
          configJson: localstackS3Config(bucketName),
        },
      })

      if (createPartitionResponse.status() === 403) {
        // Partitions are environment-locked; skip
        test.skip()
      }

      expect(createPartitionResponse.status()).toBe(201)
      const createBody = await readJsonSafe<{
        item?: { id?: string; storageDriver?: string }
      }>(createPartitionResponse)
      partitionId = createBody?.item?.id ?? null
      expect(createBody?.item?.storageDriver).toBe('s3')

      // Upload a file into the S3 partition
      const fileContent = `S3 roundtrip test content ${Date.now()}`
      const uploaded = await uploadAttachmentFixture(request, token, {
        entityId: 'attachments:library',
        recordId,
        fileName: 'roundtrip.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(fileContent, 'utf8'),
        partitionCode,
      })
      attachmentId = uploaded.id
      expect(uploaded.partitionCode).toBe(partitionCode)

      // Download the file and verify content matches
      const fileResponse = await request.fetch(
        `${BASE_URL}/api/attachments/file/${encodeURIComponent(attachmentId)}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        },
      )
      expect(fileResponse.status()).toBe(200)
      const downloadedContent = await fileResponse.text()
      expect(downloadedContent).toBe(fileContent)

      // Delete the attachment
      const deleteAttResponse = await apiRequest(
        request,
        'DELETE',
        `/api/attachments?id=${encodeURIComponent(attachmentId)}`,
        { token },
      )
      expect(deleteAttResponse.status()).toBe(200)
      attachmentId = null

      // Verify the attachment is gone from the library
      const afterDeleteResponse = await apiRequest(
        request,
        'GET',
        `/api/attachments/library/${encodeURIComponent(uploaded.id)}`,
        { token },
      )
      expect(afterDeleteResponse.status()).toBe(404)
    } finally {
      await deleteAttachmentIfExists(request, token, attachmentId)
      await deleteAttachmentPartitionIfExists(request, token, partitionId)
      await deleteS3Bucket(bucketName).catch(() => undefined)
    }
  })
})
