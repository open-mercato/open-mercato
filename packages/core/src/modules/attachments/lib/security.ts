const MIME_BY_EXTENSION: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  csv: 'text/csv',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  json: 'application/json',
  md: 'text/markdown',
  pdf: 'application/pdf',
  png: 'image/png',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  webp: 'image/webp',
  xhtml: 'application/xhtml+xml',
  xml: 'application/xml',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

const ACTIVE_CONTENT_MIME_TYPES = new Set([
  'application/xhtml+xml',
  'application/xml',
  'image/svg+xml',
  'text/html',
  'text/xml',
])

const ACTIVE_CONTENT_EXTENSIONS = new Set(['htm', 'html', 'svg', 'xhtml', 'xml'])

const SAFE_INLINE_MIME_TYPES = new Set([
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
])

export function getAttachmentExtension(fileName: string | null | undefined): string {
  const trimmed = String(fileName ?? '').trim()
  const parts = trimmed.split('.').filter(Boolean)
  if (parts.length < 2) return ''
  return parts[parts.length - 1]!.toLowerCase()
}

export function sanitizeUploadedFileName(input: string | null | undefined): string {
  const trimmed = String(input ?? '').trim()
  const sanitized = trimmed.replace(/[^a-zA-Z0-9._-]/g, '_')
  const parts = sanitized.split('.').filter(Boolean)
  if (!parts.length) return 'file'
  if (parts.length === 1) return parts[0] || 'file'

  const extension = parts.pop() || ''
  const baseName = parts.join('_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')
  const safeBaseName = baseName || 'file'
  return extension ? `${safeBaseName}.${extension.toLowerCase()}` : safeBaseName
}

function detectMimeTypeFromBuffer(buffer: Buffer): string | null {
  if (buffer.length >= 8) {
    const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    if (pngSignature.every((value, index) => buffer[index] === value)) return 'image/png'
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }
  if (buffer.length >= 6) {
    const header = buffer.subarray(0, 6).toString('ascii')
    if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif'
  }
  if (buffer.length >= 12) {
    const riff = buffer.subarray(0, 4).toString('ascii')
    const webp = buffer.subarray(8, 12).toString('ascii')
    if (riff === 'RIFF' && webp === 'WEBP') return 'image/webp'
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === '%PDF') {
    return 'application/pdf'
  }
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return 'application/zip'
  }

  const sniff = buffer.subarray(0, Math.min(buffer.length, 512)).toString('utf8').trimStart().toLowerCase()
  if (sniff.startsWith('<svg') || sniff.startsWith('<?xml') || sniff.startsWith('<!doctype html') || sniff.startsWith('<html')) {
    if (sniff.startsWith('<svg')) return 'image/svg+xml'
    if (sniff.startsWith('<!doctype html') || sniff.startsWith('<html')) return 'text/html'
    return 'application/xml'
  }

  return null
}

export function detectAttachmentMimeType(
  buffer: Buffer,
  fileName: string | null | undefined,
  clientMimeType: string | null | undefined,
): string {
  const detectedFromBuffer = detectMimeTypeFromBuffer(buffer)
  if (detectedFromBuffer) {
    if (
      detectedFromBuffer === 'application/zip' &&
      getAttachmentExtension(fileName) in MIME_BY_EXTENSION
    ) {
      return MIME_BY_EXTENSION[getAttachmentExtension(fileName)] || detectedFromBuffer
    }
    return detectedFromBuffer
  }

  const extension = getAttachmentExtension(fileName)
  if (extension && MIME_BY_EXTENSION[extension]) {
    return MIME_BY_EXTENSION[extension]
  }

  const normalizedClientMimeType = String(clientMimeType ?? '').trim().toLowerCase()
  if (normalizedClientMimeType) return normalizedClientMimeType
  return 'application/octet-stream'
}

export function isActiveContentAttachment(
  buffer: Buffer,
  fileName: string | null | undefined,
  mimeType: string | null | undefined,
): boolean {
  const extension = getAttachmentExtension(fileName)
  if (extension && ACTIVE_CONTENT_EXTENSIONS.has(extension)) return true

  const effectiveMimeType = String(mimeType ?? '').trim().toLowerCase()
  if (effectiveMimeType && ACTIVE_CONTENT_MIME_TYPES.has(effectiveMimeType)) return true

  const sniffedMimeType = detectMimeTypeFromBuffer(buffer)
  return Boolean(sniffedMimeType && ACTIVE_CONTENT_MIME_TYPES.has(sniffedMimeType))
}

export function canRenderInlineAttachment(mimeType: string | null | undefined): boolean {
  return SAFE_INLINE_MIME_TYPES.has(String(mimeType ?? '').trim().toLowerCase())
}

export function buildAttachmentContentDisposition(
  fileName: string | null | undefined,
  dispositionType: 'attachment' | 'inline' = 'attachment',
): string {
  const safeFileName = sanitizeUploadedFileName(fileName)
  return `${dispositionType}; filename="${safeFileName}"; filename*=UTF-8''${encodeURIComponent(safeFileName)}`
}
