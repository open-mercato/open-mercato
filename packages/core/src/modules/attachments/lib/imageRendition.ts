import sharp, { type ResizeOptions } from 'sharp'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { ImageCropType } from './imageUrls'
import { isUndecodableImageError, MAX_IMAGE_SOURCE_PIXELS, validateImageDimensions, validateImageMagicBytes } from './imageSafety'
import { buildThumbnailCacheKey, readThumbnailCache, writeThumbnailCache } from './thumbnailCache'

const logger = createLogger('attachments').child({ component: 'image-rendition' })

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
  strictInputErrors?: boolean
}

/**
 * The raster pipeline behind `GET /api/attachments/image/{id}`: the per-size
 * thumbnail cache, then magic-byte and dimension checks on the stored bytes,
 * then Sharp with a source pixel limit. Callers decide beforehand that the
 * attachment is an inline-safe raster image; vector input never reaches Sharp.
 *
 * Refusals are results: a file that fails the checks keeps their status, and
 * one Sharp cannot decode at render time is a 422. Owner-scoped renditions
 * opt into propagating operational thumbnail-cache read and metadata failures.
 * Unhandled failures are logged, reported and rethrown; an HTTP error from
 * `readSource` passes through. Cache writes are best effort.
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
  const { attachment, size, strictInputErrors } = input
  const cacheKey = buildThumbnailCacheKey(size.width, size.height, size.cropType)
  if (cacheKey) {
    const cached = await readThumbnailCache(attachment.partitionCode, attachment.id, cacheKey, { strictInputErrors })
    if (cached) return { ok: true, buffer: cached }
  }
  const source = await input.readSource()
  const magicBytesValidation = validateImageMagicBytes(source, attachment.mimeType)
  if (!magicBytesValidation.ok) {
    return { ok: false, status: magicBytesValidation.status, error: magicBytesValidation.error }
  }
  const dimensionsValidation = await validateImageDimensions(source, { strictInputErrors })
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
      getTelemetryRuntime()?.reportError(cacheError, { module: 'attachments', code: 'attachments.thumbnail_cache_write_failed' })
    })
  }
  return { ok: true, buffer }
}
