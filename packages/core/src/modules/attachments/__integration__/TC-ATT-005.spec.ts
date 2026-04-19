import path from 'path'
import fs from 'fs'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
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
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

// Minimal 10x10 red PNG (valid binary fixture)
function makeMinimalPng(): Buffer {
  // This is a real 10x10 solid red PNG encoded as base64
  const base64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg=='
  return Buffer.from(base64, 'base64')
}

test.describe('TC-ATT-005: S3 image thumbnail with S3-backed partition', () => {
  test('should generate a thumbnail for an image uploaded to an S3-backed partition', async ({ request }) => {
    if (!isLocalstackAvailable()) {
      test.skip()
    }

    const token = await getAuthToken(request, 'admin')
    const bucketName = `qa-att-005-${Date.now()}`
    const partitionCode = `qa_s3_img_${Date.now()}`
    const recordId = `qa-s3-img-record-${Date.now()}`
    let partitionId: string | null = null
    let attachmentId: string | null = null

    try {
      await createS3Bucket(bucketName)

      // Create an S3-backed partition
      const createPartitionResponse = await apiRequest(request, 'POST', '/api/attachments/partitions', {
        token,
        data: {
          code: partitionCode,
          title: 'QA S3 Image Partition',
          isPublic: false,
          requiresOcr: false,
          storageDriver: 's3',
          configJson: localstackS3Config(bucketName),
        },
      })

      if (createPartitionResponse.status() === 403) {
        test.skip()
      }

      expect(createPartitionResponse.status()).toBe(201)
      const createBody = await readJsonSafe<{ item?: { id?: string } }>(createPartitionResponse)
      partitionId = createBody?.item?.id ?? null

      // Upload a small PNG
      const uploaded = await uploadAttachmentFixture(request, token, {
        entityId: 'attachments:library',
        recordId,
        fileName: 'red-pixel.png',
        mimeType: 'image/png',
        buffer: makeMinimalPng(),
        partitionCode,
      })
      attachmentId = uploaded.id

      // Request a 50x50 thumbnail
      const thumbnailResponse = await request.fetch(
        `${BASE_URL}/api/attachments/image/${encodeURIComponent(attachmentId)}/50x50`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        },
      )
      expect(thumbnailResponse.status()).toBe(200)
      const contentType = thumbnailResponse.headers()['content-type'] ?? ''
      expect(contentType).toMatch(/^image\//)

      // Verify thumbnail is written to the dedicated cache directory
      const cacheRoot = path.join(process.cwd(), 'storage', '.cache', 'thumbnails')
      const cacheExists = fs.existsSync(cacheRoot)
      // Cache directory should exist (created on first thumbnail request)
      expect(cacheExists).toBe(true)
    } finally {
      await deleteAttachmentIfExists(request, token, attachmentId)
      await deleteAttachmentPartitionIfExists(request, token, partitionId)
      await deleteS3Bucket(bucketName).catch(() => undefined)
    }
  })
})
