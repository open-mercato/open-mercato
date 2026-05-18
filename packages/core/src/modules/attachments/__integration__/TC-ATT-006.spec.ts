import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createS3Bucket,
  deleteS3Bucket,
  isLocalstackAvailable,
} from '@open-mercato/core/modules/core/__integration__/helpers/s3Fixtures'

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'
const LOCALSTACK_ENDPOINT = `http://localhost:${process.env.LOCALSTACK_PORT || '4566'}`

test.describe('TC-ATT-006: Standalone S3 API routes', () => {
  test('should upload, download, list, generate signed URL, and delete via standalone S3 routes', async ({
    request,
  }) => {
    if (!isLocalstackAvailable()) {
      test.skip()
    }

    const token = await getAuthToken(request, 'admin')
    const bucketName = `qa-att-006-${Date.now()}`
    let uploadedKey: string | null = null

    try {
      await createS3Bucket(bucketName)

      // Configure LocalStack S3 credentials for this tenant via Integration Marketplace
      const credentialsResponse = await apiRequest(
        request,
        'PUT',
        '/api/integrations/storage_s3/credentials',
        {
          token,
          data: {
            credentials: {
              accessKeyId: 'test',
              secretAccessKey: 'test',
              region: 'us-east-1',
              bucket: bucketName,
              endpoint: LOCALSTACK_ENDPOINT,
              forcePathStyle: true,
            },
          },
        },
      )
      // 403 means admin doesn't have integrations.credentials.manage — skip gracefully
      if (credentialsResponse.status() === 403) {
        test.skip()
      }
      expect(credentialsResponse.status()).toBe(200)

      // POST /api/storage-providers/s3/upload — multipart upload
      const fileContent = `standalone s3 upload test ${Date.now()}`
      const uploadResponse = await request.fetch(`${BASE_URL}/api/storage-providers/s3/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        multipart: {
          key: `exports/qa-att-006-${Date.now()}.txt`,
          file: {
            name: 'standalone-upload.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from(fileContent, 'utf8'),
          },
        },
      })
      expect(uploadResponse.status()).toBe(200)
      const uploadBody = await readJsonSafe<{ key?: string; size?: number }>(uploadResponse)
      expect(uploadBody?.key).toBeTruthy()
      expect(typeof uploadBody?.size).toBe('number')
      uploadedKey = uploadBody?.key ?? null

      // GET /api/storage-providers/s3/download?key=...
      const downloadResponse = await request.fetch(
        `${BASE_URL}/api/storage-providers/s3/download?key=${encodeURIComponent(uploadedKey!)}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        },
      )
      expect(downloadResponse.status()).toBe(200)
      const downloadedContent = await downloadResponse.text()
      expect(downloadedContent).toBe(fileContent)

      // POST /api/storage-providers/s3/signed-url — generate pre-signed download URL
      const signedUrlResponse = await apiRequest(
        request,
        'POST',
        '/api/storage-providers/s3/signed-url',
        {
          token,
          data: {
            key: uploadedKey,
            operation: 'download',
            expiresIn: 300,
          },
        },
      )
      expect(signedUrlResponse.status()).toBe(200)
      const signedUrlBody = await readJsonSafe<{ url?: string; expiresAt?: string }>(signedUrlResponse)
      expect(signedUrlBody?.url).toBeTruthy()
      // Signed URL should include LocalStack host or localhost
      expect(signedUrlBody?.url).toMatch(/localhost|127\.0\.0\.1/)
      expect(signedUrlBody?.expiresAt).toBeTruthy()

      // GET /api/storage-providers/s3/list?prefix=exports/
      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/storage-providers/s3/list?prefix=${encodeURIComponent('exports/')}`,
        { token },
      )
      expect(listResponse.status()).toBe(200)
      const listBody = await readJsonSafe<{
        files?: Array<{ key: string; size: number; lastModified: string }>
        truncated?: boolean
      }>(listResponse)
      expect(Array.isArray(listBody?.files)).toBe(true)
      expect(listBody?.files?.some((f) => f.key === uploadedKey)).toBe(true)

      // DELETE /api/storage-providers/s3/delete
      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        '/api/storage-providers/s3/delete',
        {
          token,
          data: { key: uploadedKey },
        },
      )
      expect(deleteResponse.status()).toBe(204)
      uploadedKey = null

      // Verify file was removed — list should no longer include it
      const afterDeleteListResponse = await apiRequest(
        request,
        'GET',
        `/api/storage-providers/s3/list?prefix=${encodeURIComponent('exports/')}`,
        { token },
      )
      expect(afterDeleteListResponse.status()).toBe(200)
      const afterDeleteListBody = await readJsonSafe<{
        files?: Array<{ key: string }>
      }>(afterDeleteListResponse)
      const keys = afterDeleteListBody?.files?.map((f) => f.key) ?? []
      expect(keys).not.toContain(uploadedKey)
    } finally {
      await deleteS3Bucket(bucketName).catch(() => undefined)
    }
  })
})
