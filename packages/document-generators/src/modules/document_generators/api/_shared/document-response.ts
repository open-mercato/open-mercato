import type { RenderedDocument } from '../../lib/interfaces'

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

export function buildContentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_')
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(filename)}`
}

export function documentResponse(rendered: Pick<RenderedDocument, 'buffer' | 'filename' | 'mimeType'>): Response {
  return new Response(rendered.buffer as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': rendered.mimeType,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': buildContentDisposition(rendered.filename),
    },
  })
}
