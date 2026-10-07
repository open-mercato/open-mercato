import sharp, { type ResizeOptions } from 'sharp'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { ImageCropType } from './imageUrls'
import { MAX_IMAGE_SOURCE_PIXELS, validateImageDimensions, validateImageMagicBytes } from './imageSafety'
import { buildThumbnailCacheKey, readThumbnailCache, writeThumbnailCache } from './thumbnailCache'

const logger = createLogger('attachments').child({ component: 'image-rendition' })

const UNDECODABLE_IMAGE_ERROR =
  /^(?:Input (?:buffer|file) (?:has corrupt header|contains unsupported image format)|(?:vips|lib)?(?:png|spng|jpe?g|gif|webp|heif|avif|tiff?)(?!\w*save)\w*:|Vips(?:Jpeg|Png|Gif|Webp|Heif|Tiff|ForeignLoad\w*)\b|\w+load(?:_buffer|_source)?:)/i
const RESOURCE_ERROR = /out of memory|insufficient memory|cannot allocate|memory allocation|maximum supported image dimension/i

/**
 * True for Sharp's report that the stored bytes cannot be decoded: a libvips
 * loader error (`vipspng:`, `VipsJpeg:`, `gifload_buffer:`, …) or Sharp's own
 * input error, named on the first line of the message. Memory exhaustion
 * (including libjpeg's `Insufficient memory`), the JPEG encoder's maximum
 * dimension, I/O and other encoder errors are operational failures, not a
 * property of the file.
 */
export function isUndecodableImageError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const firstLine = error.message.split('\n', 1)[0] ?? ''
  return UNDECODABLE_IMAGE_ERROR.test(firstLine) && !RESOURCE_ERROR.test(error.message)
}

export type ImageRenditionSize = {
  width?: number
  height?: number
  cropType?: ImageCropType
}

export type ImageRenditionResult =
  | { ok: true; buffer: Buffer }
  | { ok: false; status: number; error: string }

type ImageRenditionInput = {
  attachment: { id: string; partitionCode: string; mimeType: string | null | undefined }
  readSource: () => Promise<Buffer>
  size: ImageRenditionSize
}

/**
 * The raster pipeline behind `GET /api/attachments/image/{id}`: the per-size
 * thumbnail cache, then magic-byte and dimension checks on the stored bytes,
 * then Sharp with a source pixel limit. Callers decide beforehand that the
 * attachment is an inline-safe raster image; vector input never reaches Sharp.
 *
 * Refusals are results: a file that fails the checks keeps their status, and
 * one Sharp cannot decode (`isUndecodableImageError`) is a 422. Every other
 * failure — cache or storage I/O, memory, encoding — is logged, reported and
 * rethrown for the caller to answer as a server error; an HTTP error the
 * caller's `readSource` raises passes through untouched.
 */
export async function renderImageRendition(input: ImageRenditionInput): Promise<ImageRenditionResult> {
  try {
    return await renderCheckedImage(input)
  } catch (error) {
    if (isCrudHttpError(error)) throw error
    logger.error('Image rendition failed', { err: error, attachmentId: input.attachment.id })
    getTelemetryRuntime()?.reportError(error, { module: 'attachments', code: 'attachments.image_rendition_failed' })
    throw error
  }
}

async function renderCheckedImage(input: ImageRenditionInput): Promise<ImageRenditionResult> {
  const { attachment, size } = input
  const cacheKey = buildThumbnailCacheKey(size.width, size.height, size.cropType)
  if (cacheKey) {
    const cached = await readThumbnailCache(attachment.partitionCode, attachment.id, cacheKey)
    if (cached) return { ok: true, buffer: cached }
  }
  const source = await input.readSource()
  const magicBytesValidation = validateImageMagicBytes(source, attachment.mimeType)
  if (!magicBytesValidation.ok) {
    return { ok: false, status: magicBytesValidation.status, error: magicBytesValidation.error }
  }
  const dimensionsValidation = await validateImageDimensions(source)
  if (!dimensionsValidation.ok) {
    return { ok: false, status: dimensionsValidation.status, error: dimensionsValidation.error }
  }
  let transformer = sharp(source, {
    failOn: 'error',
    limitInputPixels: MAX_IMAGE_SOURCE_PIXELS,
  })
  if (size.width || size.height) {
    const resizeOptions: ResizeOptions = {
      width: size.width || undefined,
      height: size.height || undefined,
      fit: size.cropType === 'contain' ? 'contain' : 'cover',
    }
    if (size.cropType === 'contain') {
      resizeOptions.background = { r: 0, g: 0, b: 0, alpha: 0 }
    }
    transformer = transformer.resize(resizeOptions)
  }
  let buffer: Buffer
  try {
    buffer = await transformer.toBuffer()
  } catch (error) {
    if (isUndecodableImageError(error)) return { ok: false, status: 422, error: 'Image could not be rendered' }
    throw error
  }
  if (cacheKey) {
    void writeThumbnailCache(attachment.partitionCode, attachment.id, cacheKey, buffer).catch((cacheError) => {
      logger.error('Thumbnail cache write failed', { err: cacheError })
    })
  }
  return { ok: true, buffer }
}
