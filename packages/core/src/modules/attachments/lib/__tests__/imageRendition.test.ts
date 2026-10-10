/** @jest-environment node */
import sharp from 'sharp'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const mockLoggerError = jest.fn()
jest.mock('@open-mercato/shared/lib/logger', () => {
  const logger = {
    error: (...args: unknown[]) => mockLoggerError(...args),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    child: () => logger,
  }
  return { createLogger: () => logger }
})

const mockReportError = jest.fn()
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }),
}))

const mockReadThumbnailCache = jest.fn()
jest.mock('../thumbnailCache', () => ({
  buildThumbnailCacheKey: () => '640x240-contain',
  readThumbnailCache: (...args: unknown[]) => mockReadThumbnailCache(...args),
  writeThumbnailCache: jest.fn(async () => undefined),
}))

import { isUndecodableImageError, renderImageRendition } from '../imageRendition'

const attachment = { id: '7f1c2a9e-5b3d-4e8f-9a1b-2c3d4e5f6a7b', partitionCode: 'privateAttachments', mimeType: 'image/png' }
const size = { width: 640, height: 240, cropType: 'contain' as const }

async function validPng(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 42, g: 157, b: 143 } } }).png().toBuffer()
}

async function corruptPng(): Promise<Buffer> {
  const png = await validPng()
  const pixelDataStart = png.indexOf(Buffer.from('IDAT')) + 4
  return Buffer.concat([
    png.subarray(0, pixelDataStart),
    Buffer.alloc(png.length - pixelDataStart - 12, 0xff),
    png.subarray(png.length - 12),
  ])
}

function systemError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

describe('renderImageRendition', () => {
  beforeEach(() => {
    mockLoggerError.mockClear()
    mockReportError.mockClear()
    mockReadThumbnailCache.mockReset()
    mockReadThumbnailCache.mockResolvedValue(null)
  })

  it('renders a valid raster image', async () => {
    const source = await validPng()

    const result = await renderImageRendition({ attachment, readSource: async () => source, size })

    expect(result.ok).toBe(true)
  })

  it('answers a corrupt PNG that passes the header checks as undecodable (422), without reporting it', async () => {
    const source = await corruptPng()

    const result = await renderImageRendition({ attachment, readSource: async () => source, size })

    expect(result).toEqual({ ok: false, status: 422, error: 'Image could not be rendered' })
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it('propagates a thumbnail-cache I/O error, logged and reported, instead of calling it undecodable', async () => {
    const accessDenied = systemError('EACCES: permission denied, open thumbnail', 'EACCES')
    mockReadThumbnailCache.mockRejectedValueOnce(accessDenied)

    await expect(renderImageRendition({ attachment, readSource: validPng, size })).rejects.toBe(accessDenied)

    expect(mockLoggerError).toHaveBeenCalledWith('Image rendition failed', expect.objectContaining({ err: accessDenied }))
    expect(mockReportError).toHaveBeenCalledWith(accessDenied, expect.objectContaining({
      module: 'attachments',
      code: 'attachments.image_rendition_failed',
    }))
  })

  it('propagates a storage read error, logged and reported', async () => {
    const readFailure = systemError('EIO: i/o error, read', 'EIO')

    await expect(renderImageRendition({
      attachment,
      readSource: async () => {
        throw readFailure
      },
      size,
    })).rejects.toBe(readFailure)

    expect(mockReportError).toHaveBeenCalledWith(readFailure, expect.objectContaining({ code: 'attachments.image_rendition_failed' }))
  })

  it('passes an HTTP error raised by the caller through without reporting it', async () => {
    const missing = new CrudHttpError(404, { error: 'File not available' })

    await expect(renderImageRendition({
      attachment,
      readSource: async () => {
        throw missing
      },
      size,
    })).rejects.toBe(missing)

    expect(mockReportError).not.toHaveBeenCalled()
  })
})

describe('isUndecodableImageError', () => {
  it.each([
    'vipspng: libpng read error\nvips2png: unable to write to target target',
    'VipsJpeg: premature end of JPEG image',
    'Input buffer has corrupt header: webp: unable to parse image',
    'Input buffer has corrupt header: gifload_buffer: Unexpected end of GIF source data',
    'Input buffer contains unsupported image format',
  ])('classifies the Sharp decode error %j as undecodable', (message) => {
    expect(isUndecodableImageError(new Error(message))).toBe(true)
  })

  it.each([
    'EACCES: permission denied, open thumbnail',
    'vips_malloc: out of memory --- size == 1048576',
    'VipsJpeg: out of memory',
    'VipsJpeg: Insufficient memory (case 4)',
    'VipsJpeg: Maximum supported image dimension is 65500 pixels',
    'pngsave: unable to write to target',
    'Unexpected failure',
  ])('treats %j as an operational failure', (message) => {
    expect(isUndecodableImageError(new Error(message))).toBe(false)
  })

  it('treats a value that is not an Error as an operational failure', () => {
    expect(isUndecodableImageError('vipspng: libpng read error')).toBe(false)
  })
})
