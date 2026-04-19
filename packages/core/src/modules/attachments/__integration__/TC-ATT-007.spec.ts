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

test.describe('TC-ATT-007: S3 partition storageDriver update via API', () => {
  test('should update a partition storageDriver from local to s3 and upload a new file to S3', async ({ request }) => {
    if (!isLocalstackAvailable()) {
      test.skip()
    }

    const token = await getAuthToken(request, 'admin')
    const bucketName = `qa-att-007-${Date.now()}`
    const partitionCode = `qa_s3_upd_${Date.now()}`
    const recordId = `qa-s3-upd-record-${Date.now()}`
    let partitionId: string | null = null
    let attachmentId: string | null = null

    try {
      await createS3Bucket(bucketName)

      // Create a local partition first
      const createResponse = await apiRequest(request, 'POST', '/api/attachments/partitions', {
        token,
        data: {
          code: partitionCode,
          title: 'QA Local Partition',
          isPublic: false,
          requiresOcr: false,
          storageDriver: 'local',
        },
      })

      if (createResponse.status() === 403) {
        test.skip()
      }

      expect(createResponse.status()).toBe(201)
      const createBody = await readJsonSafe<{
        item?: { id?: string; storageDriver?: string }
      }>(createResponse)
      partitionId = createBody?.item?.id ?? null
      expect(createBody?.item?.storageDriver).toBe('local')

      // Update the partition to use S3
      const updateResponse = await apiRequest(request, 'PUT', '/api/attachments/partitions', {
        token,
        data: {
          id: partitionId,
          code: partitionCode,
          title: 'QA S3 Updated Partition',
          isPublic: false,
          requiresOcr: false,
          storageDriver: 's3',
          configJson: localstackS3Config(bucketName),
        },
      })
      expect(updateResponse.status()).toBe(200)
      const updateBody = await readJsonSafe<{
        item?: { storageDriver?: string; configJson?: Record<string, unknown> }
      }>(updateResponse)
      expect(updateBody?.item?.storageDriver).toBe('s3')
      expect(updateBody?.item?.configJson).toMatchObject({ bucket: bucketName })

      // Upload a file to the now-S3-backed partition
      const fileContent = `S3 partition update test ${Date.now()}`
      const uploaded = await uploadAttachmentFixture(request, token, {
        entityId: 'attachments:library',
        recordId,
        fileName: 'post-update.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(fileContent, 'utf8'),
        partitionCode,
      })
      attachmentId = uploaded.id
      expect(uploaded.partitionCode).toBe(partitionCode)

      // Verify the file is retrievable (content matches)
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
    } finally {
      await deleteAttachmentIfExists(request, token, attachmentId)
      await deleteAttachmentPartitionIfExists(request, token, partitionId)
      await deleteS3Bucket(bucketName).catch(() => undefined)
    }
  })
})
