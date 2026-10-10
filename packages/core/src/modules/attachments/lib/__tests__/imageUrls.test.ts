import { resolveAttachmentThumbnailUrl } from '../imageUrls'
import { VECTOR_IMAGE_METADATA_KEY, VECTOR_IMAGE_POLICY_VERSION } from '../vector-image-record'

const vectorRecord = {
  sanitizer: 'dompurify',
  sanitizerVersion: '3.4.11',
  policyVersion: VECTOR_IMAGE_POLICY_VERSION,
  sha256: 'a'.repeat(64),
  sanitizedAt: '2026-10-05T10:00:00.000Z',
}

describe('resolveAttachmentThumbnailUrl', () => {
  it('previews a sanitised vector image through the file route', () => {
    expect(resolveAttachmentThumbnailUrl(
      { id: 'att-1', mimeType: 'image/svg+xml', storageMetadata: { [VECTOR_IMAGE_METADATA_KEY]: vectorRecord } },
      { width: 200, height: 200 },
    )).toBe('/api/attachments/file/att-1')
  })

  it('keeps raster images on the image route', () => {
    expect(resolveAttachmentThumbnailUrl(
      { id: 'att-1', mimeType: 'image/png', storageMetadata: {} },
      { width: 200, height: 200, slug: 'logo.png' },
    )).toBe('/api/attachments/image/att-1/logo.png?width=200&height=200')
  })

  it('leaves an SVG row without a vector record on its previous URL', () => {
    expect(resolveAttachmentThumbnailUrl(
      { id: 'att-1', mimeType: 'image/svg+xml', storageMetadata: { tags: [] } },
      { width: 200, height: 200 },
    )).toBe('/api/attachments/image/att-1?width=200&height=200')
  })

  it('does not treat a vector record on a non-SVG row as a vector image', () => {
    expect(resolveAttachmentThumbnailUrl(
      { id: 'att-1', mimeType: 'image/png', storageMetadata: { [VECTOR_IMAGE_METADATA_KEY]: vectorRecord } },
      { width: 200, height: 200 },
    )).toBe('/api/attachments/image/att-1?width=200&height=200')
  })
})
