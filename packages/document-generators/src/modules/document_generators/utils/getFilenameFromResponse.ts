import { sanitizeDocumentFilename } from './filename'

export function getFilenameFromResponse(response: Pick<Response, 'headers'>, fallback = 'document'): string {
  const disposition = response.headers.get('content-disposition') ?? ''
  const encoded = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1]
  if (encoded) {
    try {
      const filename = sanitizeDocumentFilename(decodeURIComponent(encoded.trim()))
      if (filename) return filename
    } catch {}
  }
  const plain = disposition.match(/filename\s*=\s*(?:"([^"]*)"|([^;]*))/i)
  return sanitizeDocumentFilename(plain?.[1] ?? plain?.[2]?.trim() ?? '') || fallback
}
