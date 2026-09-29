import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

export const DEFAULT_ATTACHMENT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024

export const ATTACHMENT_ACCEPT_TYPES = [
  '.avif',
  '.bmp',
  '.csv',
  '.docx',
  '.gif',
  '.jpeg',
  '.jpg',
  '.json',
  '.md',
  '.pdf',
  '.png',
  '.pptx',
  '.txt',
  '.webp',
  '.xlsx',
  '.zip',
  'application/json',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip',
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'text/markdown',
  'text/plain',
].join(',')

const BLOCKED_ATTACHMENT_MIME_TYPES = new Set([
  'application/xhtml+xml',
  'application/xml',
  'image/svg+xml',
  'text/html',
  'text/xml',
])

const ACTIVE_CONTENT_ATTACHMENT_EXTENSIONS = new Set([
  'htm',
  'html',
  'svg',
  'xhtml',
  'xml',
])

const DANGEROUS_EXECUTABLE_EXTENSIONS = new Set([
  'app',
  'apk',
  'bat',
  'cmd',
  'com',
  'dll',
  'exe',
  'hta',
  'htm',
  'html',
  'jar',
  'js',
  'jse',
  'lnk',
  'msi',
  'pif',
  'ps1',
  'psm1',
  'reg',
  'scr',
  'sh',
  'vbe',
  'vbs',
  'wsf',
  'wsh',
])

function getFileExtensionSegments(fileName: string): string[] {
  const parts = fileName.trim().split('.').filter(Boolean)
  if (parts.length < 2) return []
  return parts.slice(1).map((part) => part.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean)
}

async function fileLooksLikeActiveContent(file: File): Promise<boolean> {
  try {
    const sniff = (await file.slice(0, 512).text()).trimStart().toLowerCase()
    return sniff.startsWith('<svg') || sniff.startsWith('<?xml') || sniff.startsWith('<!doctype html') || sniff.startsWith('<html')
  } catch {
    return false
  }
}

export async function validateAttachmentFile(file: File, t: TranslateFn): Promise<string | null> {
  if (file.size > DEFAULT_ATTACHMENT_MAX_UPLOAD_BYTES) {
    return t('attachments.errors.maxUploadSize')
  }
  const extensionSegments = getFileExtensionSegments(file.name)
  const mimeType = file.type.trim().toLowerCase()
  if (extensionSegments.some((extension) => DANGEROUS_EXECUTABLE_EXTENSIONS.has(extension))) {
    return t('attachments.errors.dangerousExecutable')
  }
  if (
    extensionSegments.some((extension) => ACTIVE_CONTENT_ATTACHMENT_EXTENSIONS.has(extension)) ||
    (mimeType && BLOCKED_ATTACHMENT_MIME_TYPES.has(mimeType)) ||
    await fileLooksLikeActiveContent(file)
  ) {
    return t('attachments.errors.activeContentBlocked')
  }
  return null
}
