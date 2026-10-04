export function sanitizeDocumentFilename(value: string): string {
  return value.normalize('NFC').replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '-').replace(/^\.+/, '').trim().slice(0, 180)
}

export function buildDocumentFilename(data: Record<string, unknown>, prefix: string, extension: string): string {
  const document = data.document
  const number = document && typeof document === 'object' && 'number' in document ? document.number : undefined
  const suffix = typeof number === 'string' || typeof number === 'number' ? sanitizeDocumentFilename(String(number)) : ''
  const safePrefix = sanitizeDocumentFilename(prefix) || 'document'
  const safeExtension = extension.replace(/[^a-zA-Z0-9]/g, '')
  if (!safeExtension) throw new Error('[internal] Document filename requires a format extension')
  return `${safePrefix}${suffix ? `-${suffix}` : ''}.${safeExtension}`
}
