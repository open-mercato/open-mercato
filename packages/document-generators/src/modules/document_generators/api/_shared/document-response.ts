import { NextResponse } from 'next/server'
import type { RenderedDocument } from '../../lib/interfaces'

function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7E]|["\\]/g, '_')
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

/** Wraps a rendered document in a downloadable HTTP response. */
export function documentResponse(document: RenderedDocument): NextResponse {
  return new NextResponse(document.buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': document.mimeType,
      'Content-Disposition': contentDisposition(document.filename),
    },
  })
}
