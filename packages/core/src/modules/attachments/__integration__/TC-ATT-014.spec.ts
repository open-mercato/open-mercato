import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  deleteAttachmentIfExists,
  uploadAttachmentFixture,
} from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

/**
 * TC-ATT-014: File route — public vs private cache headers, inline disposition, access model
 * Source: GitHub issue #2488 (attachments integration coverage)
 * Surface: /api/attachments/file/{id} (GET)
 *
 * The file route stamps `Cache-Control: public, max-age=86400` for public-partition
 * files and `private, max-age=60` for private ones, always sets a sandboxed CSP and
 * nosniff, and serves viewable images inline. A file lands in the public `productsMedia`
 * partition by uploading with the catalog product entityId (default routing); explicit
 * public-partition overrides are rejected by the upload route.
 *
 * Note on unauthenticated access: the upload API always tenant-scopes attachment rows,
 * and the access model returns 401 for any scoped row read without auth — even on a
 * public partition (only legacy null-scope rows are publicly readable). So this test
 * asserts the real behavior (401), not an unauthenticated 200.
 */
test.describe('TC-ATT-014: Attachment file route headers and access', () => {
  test('should set public/private cache headers, inline images, and gate unauthenticated reads', async ({
    request,
  }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()

    let privateTextId: string | null = null
    let privateImageId: string | null = null
    let publicImageId: string | null = null

    const fetchFile = (id: string, withAuth: boolean) =>
      request.fetch(`${BASE_URL}/api/attachments/file/${encodeURIComponent(id)}`, {
        method: 'GET',
        headers: withAuth ? { Authorization: `Bearer ${token}` } : undefined,
      })

    try {
      // Private text file (default privateAttachments partition).
      const privateText = await uploadAttachmentFixture(request, token, {
        entityId: 'attachments:library',
        recordId: `qa-file-014-private-${stamp}`,
        fileName: 'private-014.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('private file body', 'utf8'),
      })
      privateTextId = privateText.id

      const privateResponse = await fetchFile(privateTextId, true)
      expect(privateResponse.status(), 'authenticated private file read should be 200').toBe(200)
      expect(privateResponse.headers()['cache-control']).toBe('private, max-age=60')
      expect(privateResponse.headers()['content-security-policy'] ?? '').toContain('sandbox')
      expect(privateResponse.headers()['x-content-type-options']).toBe('nosniff')

      // Private image is served inline with its image content type.
      const privateImage = await uploadAttachmentFixture(request, token, {
        entityId: 'attachments:library',
        recordId: `qa-file-014-image-${stamp}`,
        fileName: 'inline-014.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==',
          'base64',
        ),
      })
      privateImageId = privateImage.id

      const imageResponse = await fetchFile(privateImageId, true)
      expect(imageResponse.status()).toBe(200)
      expect(imageResponse.headers()['content-type']).toBe('image/png')
      expect(imageResponse.headers()['content-disposition'] ?? '').toContain('inline')
      expect(imageResponse.headers()['cache-control']).toBe('private, max-age=60')

      // Public file: the catalog product entityId routes uploads to the public
      // `productsMedia` partition without an explicit (rejected) override.
      const publicImage = await uploadAttachmentFixture(request, token, {
        entityId: 'catalog:catalog_product',
        recordId: `qa-file-014-public-${stamp}`,
        fileName: 'public-014.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==',
          'base64',
        ),
      })
      publicImageId = publicImage.id
      expect(publicImage.partitionCode, 'catalog product upload should route to productsMedia').toBe('productsMedia')

      const publicResponse = await fetchFile(publicImageId, true)
      expect(publicResponse.status(), 'authenticated public file read should be 200').toBe(200)
      expect(publicResponse.headers()['cache-control']).toBe('public, max-age=86400')
      expect(publicResponse.headers()['content-security-policy'] ?? '').toContain('sandbox')

      // Unauthenticated reads of tenant-scoped rows are gated with 401 on both partitions.
      const privateNoAuth = await fetchFile(privateTextId, false)
      expect(privateNoAuth.status(), 'unauthenticated private read should be 401').toBe(401)

      const publicNoAuth = await fetchFile(publicImageId, false)
      expect(publicNoAuth.status(), 'unauthenticated public read of a scoped row should be 401').toBe(401)
    } finally {
      await deleteAttachmentIfExists(request, token, privateTextId)
      await deleteAttachmentIfExists(request, token, privateImageId)
      await deleteAttachmentIfExists(request, token, publicImageId)
    }
  })
})
