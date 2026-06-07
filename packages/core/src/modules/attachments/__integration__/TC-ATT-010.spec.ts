import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  deleteAttachmentIfExists,
  uploadAttachmentFixture,
} from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

/**
 * TC-ATT-010: Image route — dimension validation and unsupported media types
 * Source: GitHub issue #2488 (attachments integration coverage)
 * Surface: /api/attachments/image/{id} (GET)
 *
 * The route rejects non-image attachments with 400 "Unsupported media type" and
 * out-of-range width/height (zod min 1, max 4000) with 400 "Invalid size parameters".
 * A valid in-range request returns 200 with binary image content.
 */

// A 32x32 solid PNG re-encoded by sharp/libvips. The image route resizes with
// sharp's `failOn: 'error'`, which rejects PNGs whose pixel data trips libspng's
// strict decoder. A sharp-encoded buffer decodes cleanly through that path.
function makeRenderablePng(): Buffer {
  const base64 =
    'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAKklEQVR42mO4o6FBU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAIahsD0l4r5QAAAAAElFTkSuQmCC'
  return Buffer.from(base64, 'base64')
}

test.describe('TC-ATT-010: Attachment image route validation', () => {
  test('should reject non-images and out-of-range dimensions, and serve valid sizes', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let textAttachmentId: string | null = null
    let imageAttachmentId: string | null = null

    const fetchImage = (id: string, query = '') =>
      request.fetch(`${BASE_URL}/api/attachments/image/${encodeURIComponent(id)}${query}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      })

    try {
      // A text attachment is not renderable as an image → 400 "Unsupported media type".
      const textUpload = await uploadAttachmentFixture(request, token, {
        entityId: 'attachments:library',
        recordId: `qa-image-010-text-${stamp}`,
        fileName: 'not-an-image.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('definitely not an image', 'utf8'),
      })
      textAttachmentId = textUpload.id

      const unsupported = await fetchImage(textAttachmentId)
      expect(unsupported.status(), 'image route on text file should be 400').toBe(400)
      const unsupportedBody = await readJsonSafe<{ error?: string }>(unsupported)
      expect(unsupportedBody?.error ?? '').toContain('Unsupported media type')

      // A real PNG is renderable.
      const imageUpload = await uploadAttachmentFixture(request, token, {
        entityId: 'attachments:library',
        recordId: `qa-image-010-png-${stamp}`,
        fileName: 'red-pixel.png',
        mimeType: 'image/png',
        buffer: makeRenderablePng(),
      })
      imageAttachmentId = imageUpload.id

      // width above the 4000 ceiling → 400.
      const tooWide = await fetchImage(imageAttachmentId, '?width=5000')
      expect(tooWide.status(), 'width=5000 should be 400').toBe(400)

      // height above the 4000 ceiling → 400.
      const tooTall = await fetchImage(imageAttachmentId, '?height=5000')
      expect(tooTall.status(), 'height=5000 should be 400').toBe(400)

      // zero width → 400.
      const zeroWidth = await fetchImage(imageAttachmentId, '?width=0')
      expect(zeroWidth.status(), 'width=0 should be 400').toBe(400)

      // negative width → 400.
      const negativeWidth = await fetchImage(imageAttachmentId, '?width=-1')
      expect(negativeWidth.status(), 'width=-1 should be 400').toBe(400)

      // valid in-range dimensions → 200 with image content.
      const validResize = await fetchImage(imageAttachmentId, '?width=100&height=100')
      expect(validResize.status(), 'width=100&height=100 should be 200').toBe(200)
      expect(validResize.headers()['content-type'] ?? '').toMatch(/^image\//)
      const imageBytes = await validResize.body()
      expect(imageBytes.length, 'resized image should have a non-empty body').toBeGreaterThan(0)
    } finally {
      await deleteAttachmentIfExists(request, token, textAttachmentId)
      await deleteAttachmentIfExists(request, token, imageAttachmentId)
    }
  })
})
