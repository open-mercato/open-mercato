import { promises as fs } from 'fs'
import path from 'path'

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}

/**
 * Resolves the thumbnail cache root. Uses a dedicated directory under
 * `storage/.cache/thumbnails/<partitionCode>/` that is independent of
 * the partition's storage backend (local or S3).
 */
function resolveCacheRoot(partitionCode: string): string {
  return path.join(process.cwd(), 'storage', '.cache', 'thumbnails', sanitizeSegment(partitionCode))
}

function resolveCachePath(partitionCode: string, attachmentId: string, cacheKey: string): string {
  return path.join(
    resolveCacheRoot(partitionCode),
    sanitizeSegment(attachmentId),
    sanitizeSegment(cacheKey),
  )
}

export function buildThumbnailCacheKey(
  width?: number,
  height?: number,
  cropType?: 'cover' | 'contain',
): string | null {
  if (!width && !height) return null
  const safeWidth = typeof width === 'number' && Number.isFinite(width) ? width : 'auto'
  const safeHeight = typeof height === 'number' && Number.isFinite(height) ? height : 'auto'
  const safeCrop = cropType === 'contain' ? 'contain' : 'cover'
  return `w${safeWidth}-h${safeHeight}-c${safeCrop}`
}

export async function readThumbnailCache(
  partitionCode: string,
  attachmentId: string,
  cacheKey: string,
): Promise<Buffer | null> {
  const cachePath = resolveCachePath(partitionCode, attachmentId, cacheKey)
  try {
    return await fs.readFile(cachePath)
  } catch {
    return null
  }
}

export async function writeThumbnailCache(
  partitionCode: string,
  attachmentId: string,
  cacheKey: string,
  data: Buffer,
): Promise<void> {
  const cachePath = resolveCachePath(partitionCode, attachmentId, cacheKey)
  await fs.mkdir(path.dirname(cachePath), { recursive: true })
  await fs.writeFile(cachePath, data)
}

export async function clearAttachmentThumbnailCache(
  partitionCode: string,
  attachmentId: string,
): Promise<void> {
  const dir = path.join(resolveCacheRoot(partitionCode), sanitizeSegment(attachmentId))
  try {
    await fs.rm(dir, { recursive: true, force: true })
  } catch {
    // ignore cache cleanup failure
  }
}
