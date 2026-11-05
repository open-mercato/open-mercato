/** @jest-environment node */

import {
  MAX_IMAGE_SOURCE_BYTES,
  detectImageMimeType,
  validateImageMagicBytes,
} from '../imageSafety'

describe('attachment image safety helpers', () => {
  it('detects supported image formats from magic bytes', () => {
    expect(detectImageMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xdb]))).toBe('image/jpeg')
    expect(detectImageMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png')
    expect(detectImageMimeType(Buffer.from('GIF89a', 'ascii'))).toBe('image/gif')
    expect(detectImageMimeType(Buffer.from('RIFF0000WEBP', 'ascii'))).toBe('image/webp')
  })

  it('rejects spoofed image MIME types before sharp processes content', () => {
    const webpPayload = Buffer.from('RIFF0000WEBP', 'ascii')

    expect(validateImageMagicBytes(webpPayload, 'image/png')).toEqual({
      ok: false,
      status: 400,
      error: 'Image MIME type does not match file content',
    })
  })

  it('rejects formats outside the thumbnail rendering allowlist', () => {
    const tiffPayload = Buffer.from([0x49, 0x49, 0x2a, 0x00])

    expect(validateImageMagicBytes(tiffPayload, 'image/png')).toEqual({
      ok: false,
      status: 400,
      error: 'Unsupported image format',
    })
  })

  it('rejects source images above the byte limit before format parsing', () => {
    const oversized = Buffer.alloc(MAX_IMAGE_SOURCE_BYTES + 1)

    expect(validateImageMagicBytes(oversized, 'image/png')).toEqual({
      ok: false,
      status: 413,
      error: 'Image exceeds source byte limit',
    })
  })

  it('accepts common MIME aliases only when content matches', () => {
    const jpegPayload = Buffer.from([0xff, 0xd8, 0xff, 0xdb])

    expect(validateImageMagicBytes(jpegPayload, 'image/jpg')).toEqual({
      ok: true,
      mimeType: 'image/jpeg',
    })
  })
})
