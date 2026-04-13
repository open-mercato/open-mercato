import sharp from 'sharp'

export const MAX_IMAGE_SOURCE_BYTES = 25 * 1024 * 1024
export const MAX_IMAGE_SOURCE_PIXELS = 40_000_000

const allowedImageMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

const mimeAliases = new Map([
  ['image/jpg', 'image/jpeg'],
  ['image/pjpeg', 'image/jpeg'],
  ['image/x-png', 'image/png'],
])

export type ImageSafetyResult =
  | { ok: true; mimeType: string }
  | { ok: false; status: 400 | 413; error: string }

function normalizeMimeType(mimeType: string | null | undefined): string | null {
  if (typeof mimeType !== 'string') return null
  const normalized = mimeType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (!normalized) return null
  return mimeAliases.get(normalized) ?? normalized
}

export function detectImageMimeType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png'
  }

  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return 'image/gif'
  }

  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }

  return null
}

export function validateImageMagicBytes(buffer: Buffer, declaredMimeType: string | null | undefined): ImageSafetyResult {
  if (buffer.length > MAX_IMAGE_SOURCE_BYTES) {
    return { ok: false, status: 413, error: 'Image exceeds source byte limit' }
  }

  const detectedMimeType = detectImageMimeType(buffer)
  if (!detectedMimeType || !allowedImageMimeTypes.has(detectedMimeType)) {
    return { ok: false, status: 400, error: 'Unsupported image format' }
  }

  const normalizedDeclaredMimeType = normalizeMimeType(declaredMimeType)
  if (!normalizedDeclaredMimeType || !allowedImageMimeTypes.has(normalizedDeclaredMimeType)) {
    return { ok: false, status: 400, error: 'Unsupported media type' }
  }

  if (normalizedDeclaredMimeType !== detectedMimeType) {
    return { ok: false, status: 400, error: 'Image MIME type does not match file content' }
  }

  return { ok: true, mimeType: detectedMimeType }
}

export async function validateImageDimensions(buffer: Buffer): Promise<ImageSafetyResult> {
  let metadata: sharp.Metadata
  try {
    metadata = await sharp(buffer, {
      failOn: 'error',
      limitInputPixels: MAX_IMAGE_SOURCE_PIXELS,
    }).metadata()
  } catch {
    return { ok: false, status: 400, error: 'Invalid image content' }
  }

  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  if (width <= 0 || height <= 0) {
    return { ok: false, status: 400, error: 'Invalid image dimensions' }
  }

  if (width * height > MAX_IMAGE_SOURCE_PIXELS) {
    return { ok: false, status: 413, error: 'Image exceeds pixel limit' }
  }

  return { ok: true, mimeType: metadata.format ? `image/${metadata.format}` : 'image/jpeg' }
}
