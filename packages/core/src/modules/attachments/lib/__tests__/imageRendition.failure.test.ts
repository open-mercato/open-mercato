/** @jest-environment node */

const mockMetadata = jest.fn()
const mockToBuffer = jest.fn()
jest.mock('sharp', () => {
  const pipeline = {
    metadata: (...args: unknown[]) => mockMetadata(...args),
    resize: () => pipeline,
    toBuffer: (...args: unknown[]) => mockToBuffer(...args),
  }
  return { __esModule: true, default: () => pipeline }
})

const mockReadFile = jest.fn()
const mockWriteFile = jest.fn()
jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs')
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: (...args: unknown[]) => mockReadFile(...args),
      mkdir: jest.fn(async () => undefined),
      writeFile: (...args: unknown[]) => mockWriteFile(...args),
    },
  }
})

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
  readSource: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  size: { width: 640, height: 240, cropType: 'contain' as const },
  strictInputErrors: true,
}
const rendered = Buffer.from('rendered-raster')
const cacheMiss = Object.assign(new Error('No cached thumbnail'), { code: 'ENOENT' })

describe('renderImageRendition with a failing Sharp pipeline', () => {
  beforeEach(() => {
    mockMetadata.mockReset().mockResolvedValue({ width: 64, height: 64, format: 'png' })
    mockToBuffer.mockReset().mockResolvedValue(rendered)
    mockReadFile.mockReset().mockRejectedValue(cacheMiss)
    mockWriteFile.mockReset().mockResolvedValue(undefined)
    mockReportError.mockClear()
  })

  it('reports and propagates failures reading the actual thumbnail cache in strict mode', async () => {
    const failure = Object.assign(new Error('Permission denied reading cache'), { code: 'EACCES' })
    mockReadFile.mockRejectedValueOnce(failure)

    await expect(renderImageRendition(input)).rejects.toBe(failure)

    expect(mockMetadata).not.toHaveBeenCalled()
    expect(mockReportError).toHaveBeenCalledWith(failure, expect.objectContaining({ code: 'attachments.image_rendition_failed' }))
  })

  it.each([true, false])('renders from storage on a cache miss with strict input errors set to %s', async (strictInputErrors) => {
    await expect(renderImageRendition({ ...input, strictInputErrors })).resolves.toEqual({ ok: true, buffer: rendered })
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it('continues to storage after cache read errors on the legacy path', async () => {
    mockReadFile.mockRejectedValueOnce(Object.assign(new Error('Permission denied reading cache'), { code: 'EACCES' }))

    await expect(renderImageRendition({ ...input, strictInputErrors: false })).resolves.toEqual({ ok: true, buffer: rendered })
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it('reports a thumbnail write failure without failing an already rendered image', async () => {
    const failure = Object.assign(new Error('Permission denied writing cache'), { code: 'EACCES' })
    mockWriteFile.mockRejectedValueOnce(failure)

    await expect(renderImageRendition(input)).resolves.toEqual({ ok: true, buffer: rendered })
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(mockReportError).toHaveBeenCalledWith(failure, expect.objectContaining({ code: 'attachments.thumbnail_cache_write_failed' }))
  })

  it('reports and propagates a Sharp metadata resource error in strict mode', async () => {
    const failure = new Error('Input buffer has corrupt header: VipsJpeg: Insufficient memory (case 4)')
    mockMetadata.mockRejectedValueOnce(failure)

    await expect(renderImageRendition(input)).rejects.toBe(failure)

    expect(mockToBuffer).not.toHaveBeenCalled()
    expect(mockReportError).toHaveBeenCalledWith(failure, expect.objectContaining({ code: 'attachments.image_rendition_failed' }))
  })

  it('preserves the legacy invalid-image response when Sharp metadata fails', async () => {
    mockMetadata.mockRejectedValueOnce(new Error('VipsJpeg: Insufficient memory (case 4)'))

    await expect(renderImageRendition({ ...input, strictInputErrors: false })).resolves.toEqual({
      ok: false, status: 400, error: 'Invalid image content',
    })
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it.each([
    ['Input buffer has corrupt header: vipspng: libpng read error', 400, 'Invalid image content'],
    ['Input image exceeds pixel limit', 413, 'Image exceeds pixel limit'],
  ])('preserves the client refusal for Sharp metadata error %j', async (message, status, error) => {
    mockMetadata.mockRejectedValueOnce(new Error(message))

    await expect(renderImageRendition(input)).resolves.toEqual({ ok: false, status, error })
    expect(mockToBuffer).not.toHaveBeenCalled()
    expect(mockReportError).not.toHaveBeenCalled()
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
