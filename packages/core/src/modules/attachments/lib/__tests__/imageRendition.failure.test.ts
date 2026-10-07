/** @jest-environment node */

const mockToBuffer = jest.fn()
jest.mock('sharp', () => {
  const pipeline = {
    resize: () => pipeline,
    toBuffer: (...args: unknown[]) => mockToBuffer(...args),
  }
  return { __esModule: true, default: () => pipeline }
})

jest.mock('../imageSafety', () => ({
  MAX_IMAGE_SOURCE_PIXELS: 100_000_000,
  validateImageMagicBytes: () => ({ ok: true }),
  validateImageDimensions: async () => ({ ok: true, mimeType: 'image/png' }),
}))

jest.mock('../thumbnailCache', () => ({
  buildThumbnailCacheKey: () => null,
  readThumbnailCache: jest.fn(async () => null),
  writeThumbnailCache: jest.fn(async () => undefined),
}))

const mockReportError = jest.fn()
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger }
  return { createLogger: () => logger }
})

import { renderImageRendition } from '../imageRendition'

const input = {
  attachment: { id: '7f1c2a9e-5b3d-4e8f-9a1b-2c3d4e5f6a7b', partitionCode: 'privateAttachments', mimeType: 'image/png' },
  readSource: async () => Buffer.from('png'),
  size: { width: 640, height: 240, cropType: 'contain' as const },
}

describe('renderImageRendition with a failing Sharp pipeline', () => {
  beforeEach(() => {
    mockToBuffer.mockReset()
    mockReportError.mockClear()
  })

  it.each([
    'vips_malloc: out of memory --- size == 1048576',
    'VipsJpeg: Insufficient memory (case 4)',
    'VipsJpeg: Maximum supported image dimension is 65500 pixels',
    'Unexpected error while encoding',
  ])('rethrows the non-decode failure %j and reports it, rather than answering 422', async (message) => {
    const failure = new Error(message)
    mockToBuffer.mockRejectedValueOnce(failure)

    await expect(renderImageRendition(input)).rejects.toBe(failure)

    expect(mockReportError).toHaveBeenCalledWith(failure, expect.objectContaining({ code: 'attachments.image_rendition_failed' }))
  })

  it('answers a decode failure as an undecodable image', async () => {
    mockToBuffer.mockRejectedValueOnce(new Error('vipspng: libpng read error'))

    await expect(renderImageRendition(input)).resolves.toEqual({ ok: false, status: 422, error: 'Image could not be rendered' })
    expect(mockReportError).not.toHaveBeenCalled()
  })
})
