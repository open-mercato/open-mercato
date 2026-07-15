import { existsSync } from 'node:fs'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { sanitizeRichTextHtml } from '@open-mercato/shared/lib/html/sanitizeRichText'
import { assertTier } from '../../../lib/permissions'
import { loadDocumentContent } from '../../../lib/contentService'
import {
  isDocxRenderFailedError,
  isDocxRenderOutputTooLargeError,
  isDocxRenderOverloadedError,
  isDocxRenderTimeoutError,
  renderDocxWithCapacity,
} from '../../../lib/docxRenderer'
import {
  isPdfRenderOutputTooLargeError,
  isPdfRenderOverloadedError,
  isPdfRenderTimeoutError,
  renderPdfWithChromium,
} from '../../../lib/pdfRenderer'
import { buildDocumentPdfHtml } from '../../../lib/pdfHtml'
import {
  assertDocumentContentResourceLimits,
  DOCUMENTS_MAX_CONTENT_HTML_BYTES,
  maxBase64EncodedLength,
} from '../../../lib/resourceLimits'
import { DOCUMENTS_JSON_BODY_LIMITS } from '../../../lib/requestBody'
import {
  handleDocumentsRouteError,
  loadScopedDocument,
  readBody,
  resolveDocumentsContext,
  routeErrorSchema,
} from '../../_shared'

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

type ExportFormat = 'docx' | 'pdf'

export type PdfRequestDescriptor = {
  url: string
  resourceType: string
  isNavigationRequest: boolean
}

const exportQuerySchema = z.object({
  format: z.enum(['docx', 'pdf']).optional(),
})
const docxSnapshotSchema = z.object({
  contentHtml: z.string().max(DOCUMENTS_MAX_CONTENT_HTML_BYTES),
  pageBreakMarker: z.string().regex(/^OM_DOCX_PAGE_BREAK_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
})

const fileResponseSchema = z.string().describe('Binary .docx or PDF file attachment')

const COMMON_CHROMIUM_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]

export const DOCX_MAX_EMBEDDED_IMAGE_BYTES = 1024 * 1024
export const PDF_MAX_EMBEDDED_IMAGE_BYTES = 1024 * 1024
export const MAX_EMBEDDED_RASTER_DIMENSION = 4096
export const MAX_EMBEDDED_RASTER_PIXELS = 16 * 1024 * 1024
const DATA_IMAGE_PATTERN = /^data:image\/(png|jpeg);base64,([a-z0-9+/]+={0,2})$/i
const IMAGE_TAG_PATTERN = /<img\b[^>]*>/gi
const ENTITY_REF_SPAN_PATTERN = /<span\b(?=[^>]*\bdata-entity-ref(?:\s|=|>))[^>]*>([\s\S]*?)<\/span>/gi
const HIGHLIGHT_OPEN_PATTERN = /<mark\b([^>]*)>/gi
const HIGHLIGHT_CLOSE_PATTERN = /<\/mark>/gi
const LEADING_TABLE_HEADER_ROW_PATTERN = /(<table\b[^>]*>)(\s*)<tbody>(\s*)(<tr>(?:(?:\s*)<th\b[^>]*>[\s\S]*?<\/th>)+\s*<\/tr>)([\s\S]*?)<\/tbody>/gi
const IMAGE_SOURCE_PATTERN = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['documents.view'] },
  POST: { requireAuth: true, requireFeatures: ['documents.view'] },
}

async function resolveId(context: RouteContext): Promise<string> {
  const params = await context.params
  return params.id
}

function resolveExportFormat(value: string | null): ExportFormat | null {
  if (value === null || value === 'docx') return 'docx'
  if (value === 'pdf') return 'pdf'
  return null
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildSafeFilename(title: string): string {
  return title.replace(/[^a-z0-9\-_. ]/gi, '_').slice(0, 120) || 'document'
}

type ImageSource = {
  index: number
  length: number
  value: string
}

function readSingleImageSource(tag: string): ImageSource | null {
  const matches = Array.from(tag.matchAll(IMAGE_SOURCE_PATTERN))
  if (matches.length !== 1 || matches[0].index === undefined) return null
  return {
    index: matches[0].index,
    length: matches[0][0].length,
    value: matches[0][1] ?? matches[0][2] ?? matches[0][3] ?? '',
  }
}

function replaceImageSource(tag: string, source: ImageSource, value: string): string {
  return `${tag.slice(0, source.index)}src="${escapeHtml(value)}"${tag.slice(source.index + source.length)}`
}

function hasSafeRasterDimensions(width: number, height: number): boolean {
  return Number.isSafeInteger(width)
    && Number.isSafeInteger(height)
    && width > 0
    && height > 0
    && width <= MAX_EMBEDDED_RASTER_DIMENSION
    && height <= MAX_EMBEDDED_RASTER_DIMENSION
    && width * height <= MAX_EMBEDDED_RASTER_PIXELS
}

function pngCrc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function readPngDimensions(bytes: Buffer): { width: number; height: number } | null {
  const signature = '89504e470d0a1a0a'
  if (bytes.length < 45 || bytes.subarray(0, 8).toString('hex') !== signature) return null

  let offset = 8
  let dimensions: { width: number; height: number } | null = null
  let sawImageData = false
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const chunkEnd = offset + 12 + length
    if (chunkEnd > bytes.length) return null
    const type = bytes.subarray(offset + 4, offset + 8)
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    const expectedCrc = bytes.readUInt32BE(offset + 8 + length)
    if (pngCrc32(bytes.subarray(offset + 4, offset + 8 + length)) !== expectedCrc) return null
    const chunkType = type.toString('ascii')
    if (offset === 8) {
      if (chunkType !== 'IHDR' || length !== 13) return null
      const width = data.readUInt32BE(0)
      const height = data.readUInt32BE(4)
      const bitDepth = data[8]
      const colorType = data[9]
      const validBitDepth = (
        (colorType === 0 && [1, 2, 4, 8, 16].includes(bitDepth!))
        || (colorType === 2 && [8, 16].includes(bitDepth!))
        || (colorType === 3 && [1, 2, 4, 8].includes(bitDepth!))
        || (colorType === 4 && [8, 16].includes(bitDepth!))
        || (colorType === 6 && [8, 16].includes(bitDepth!))
      )
      if (
        !validBitDepth
        || data[10] !== 0
        || data[11] !== 0
        || (data[12] !== 0 && data[12] !== 1)
        || !hasSafeRasterDimensions(width, height)
      ) return null
      dimensions = { width, height }
    } else if (chunkType === 'IHDR') {
      return null
    }
    if (chunkType === 'IDAT') sawImageData = true
    if (chunkType === 'IEND') {
      return length === 0 && chunkEnd === bytes.length && sawImageData
        ? dimensions
        : null
    }
    offset = chunkEnd
  }
  return null
}

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

function readJpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (
    bytes.length < 12
    || bytes[0] !== 0xff
    || bytes[1] !== 0xd8
    || bytes.at(-2) !== 0xff
    || bytes.at(-1) !== 0xd9
  ) return null

  let offset = 2
  while (offset + 4 <= bytes.length - 2) {
    if (bytes[offset] !== 0xff) return null
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1
    if (marker === undefined || marker === 0xda || marker === 0xd9) return null
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length - 2) return null
    const segmentLength = bytes.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.length - 2) return null
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 7) return null
      const height = bytes.readUInt16BE(offset + 3)
      const width = bytes.readUInt16BE(offset + 5)
      return hasSafeRasterDimensions(width, height) ? { width, height } : null
    }
    offset += segmentLength
  }
  return null
}

function readSafeEmbeddedImageBytes(source: string, maxDecodedBytes: number): number | null {
  const match = DATA_IMAGE_PATTERN.exec(source)
  if (!match) return null
  const mimeType = match[1].toLowerCase()
  const payload = match[2]
  if (
    !payload
    || payload.length > maxBase64EncodedLength(maxDecodedBytes)
    || payload.length % 4 !== 0
  ) return null
  const bytes = Buffer.from(payload, 'base64')
  if (
    bytes.length === 0
    || bytes.length > maxDecodedBytes
    || bytes.toString('base64') !== payload
  ) return null
  const dimensions = mimeType === 'png'
    ? readPngDimensions(bytes)
    : readJpegDimensions(bytes)
  if (!dimensions) return null
  return bytes.length
}

/**
 * html-to-docx dereferences URL-backed images with node-fetch. Replace only
 * small embedded raster images with sanitizer-safe placeholders, sanitize the
 * full rich text, then restore those in-memory payloads. Every URL, relative
 * path, blob source, malformed data URI, SVG, duplicate src attribute, and
 * aggregate payload beyond the bound is removed before conversion.
 */
function sanitizeEmbeddedRasterExportContent(
  contentHtml: string,
  maxEmbeddedBytes: number,
  placeholderNamespace: 'docx' | 'pdf',
): string {
  assertDocumentContentResourceLimits(
    { contentHtml },
    { error: 'documents.export.inputTooLarge' },
  )
  const embeddedImages = new Map<string, string>()
  let embeddedBytes = 0
  const placeholderHtml = contentHtml.replace(IMAGE_TAG_PATTERN, (tag) => {
    const source = readSingleImageSource(tag)
    if (!source) return ''
    const remainingBytes = maxEmbeddedBytes - embeddedBytes
    const imageBytes = readSafeEmbeddedImageBytes(source.value, remainingBytes)
    if (imageBytes === null || embeddedBytes + imageBytes > maxEmbeddedBytes) return ''
    embeddedBytes += imageBytes
    const placeholder = `https://${placeholderNamespace}.invalid/__embedded-image-${embeddedImages.size}`
    embeddedImages.set(placeholder, source.value)
    return replaceImageSource(tag, source, placeholder)
  })

  return sanitizeRichTextHtml(placeholderHtml).replace(IMAGE_TAG_PATTERN, (tag) => {
    const source = readSingleImageSource(tag)
    if (!source) return ''
    const embeddedSource = embeddedImages.get(source.value)
    return embeddedSource ? replaceImageSource(tag, source, embeddedSource) : ''
  })
}

export function sanitizeDocxExportContent(contentHtml: string): string {
  return sanitizeEmbeddedRasterExportContent(
    contentHtml,
    DOCX_MAX_EMBEDDED_IMAGE_BYTES,
    'docx',
  )
}

/**
 * Sanitize stored rich text and bound the decoded aggregate raster payload
 * before authored HTML reaches Chromium. Request interception remains a
 * defense-in-depth boundary, not the primary content validator.
 */
export function sanitizePdfExportContent(contentHtml: string): string {
  const semanticHtml = contentHtml
    .replace(ENTITY_REF_SPAN_PATTERN, '<strong><code><span>$1</span></code></strong>')
    .replace(HIGHLIGHT_OPEN_PATTERN, (_tag, attributes: string) => (
      /\bstyle\s*=/i.test(attributes)
        ? `<span${attributes}>`
        : `<span style="background-color:#fef08a"${attributes}>`
    ))
    .replace(HIGHLIGHT_CLOSE_PATTERN, '</span>')
  const sanitized = sanitizeEmbeddedRasterExportContent(
    semanticHtml,
    PDF_MAX_EMBEDDED_IMAGE_BYTES,
    'pdf',
  )
  return sanitized.replace(
    LEADING_TABLE_HEADER_ROW_PATTERN,
    '$1$2<thead>$4</thead><tbody>$3$5</tbody>',
  )
}

function buildExportHtml(title: string, contentHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; frame-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(title)}</title></head><body>${contentHtml}</body></html>`
}

export function applyDocxPageBreakMarkers(contentHtml: string, marker: string): string {
  const markerParagraph = `<p>${marker}</p>`
  const breakCount = contentHtml.split(markerParagraph).length - 1
  if (breakCount > 100) {
    throw new CrudHttpError(413, { error: 'documents.export.inputTooLarge' })
  }
  return contentHtml.replaceAll(
    markerParagraph,
    '<div class="page-break" style="page-break-after: always"></div>',
  )
}

function resolveChromiumExecutablePath(): string | null {
  const configured =
    process.env.DOCUMENTS_PDF_CHROMIUM_PATH?.trim() ||
    process.env.PUPPETEER_EXECUTABLE_PATH?.trim()
  if (configured) return configured
  return COMMON_CHROMIUM_PATHS.find((path) => existsSync(path)) ?? null
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(arrayBuffer).set(bytes)
  return arrayBuffer
}

/**
 * PDF rendering is an inert conversion boundary, not a browser session. Never
 * allow a top-level/frame navigation or network fetch from authored content.
 * The only request class retained is a raster image embedded entirely in the
 * HTML itself; current editor configuration normally strips those too.
 */
export function isAllowedPdfAssetRequest(request: PdfRequestDescriptor): boolean {
  if (request.isNavigationRequest || request.resourceType !== 'image') return false
  const embeddedBytes = readSafeEmbeddedImageBytes(request.url, PDF_MAX_EMBEDDED_IMAGE_BYTES)
  return embeddedBytes !== null && embeddedBytes <= PDF_MAX_EMBEDDED_IMAGE_BYTES
}

async function handleExport(
  request: Request,
  context: RouteContext,
  options?: {
    loadSnapshot?: () => Promise<z.infer<typeof docxSnapshotSchema>>
    operation?: string
  },
): Promise<Response> {
  try {
    const format = resolveExportFormat(new URL(request.url).searchParams.get('format'))
    if (!format) {
      throw new CrudHttpError(400, { error: 'documents.export.unsupportedFormat' })
    }

    const id = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    await assertTier(ctx.em, id, ctx.auth, 'viewer')
    const doc = await loadScopedDocument(ctx, id)
    // The snapshot body is buffered and validated only after the caller has
    // proven document access, so an unauthenticated request cannot make the
    // server process multi-megabyte payloads.
    const snapshot = options?.loadSnapshot ? await options.loadSnapshot() : undefined
    const content = await loadDocumentContent(ctx.em, id, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
    const contentHtml = format === 'docx' && snapshot ? snapshot.contentHtml : content?.contentHtml ?? ''
    assertDocumentContentResourceLimits(
      { contentHtml, contentText: content?.contentText },
      { error: 'documents.export.inputTooLarge' },
    )
    const safeName = buildSafeFilename(doc.title)

    if (format === 'docx') {
      const sanitized = sanitizeDocxExportContent(contentHtml)
      const paginated = snapshot
        ? applyDocxPageBreakMarkers(sanitized, snapshot.pageBreakMarker)
        : sanitized
      const docxHtml = buildExportHtml(doc.title, paginated)
      let bufferBytes: Uint8Array
      try {
        bufferBytes = await renderDocxWithCapacity(docxHtml)
      } catch (error) {
        if (isDocxRenderOverloadedError(error)) {
          throw new CrudHttpError(503, { error: 'documents.export.overloaded' })
        }
        if (isDocxRenderTimeoutError(error)) {
          throw new CrudHttpError(503, { error: 'documents.export.renderTimeout' })
        }
        if (isDocxRenderOutputTooLargeError(error)) {
          throw new CrudHttpError(413, { error: 'documents.export.outputTooLarge' })
        }
        if (isDocxRenderFailedError(error)) {
          throw new CrudHttpError(503, { error: 'documents.export.runtimeUnavailable' })
        }
        throw error
      }
      return new Response(toArrayBuffer(bufferBytes), {
        headers: {
          'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'content-disposition': `attachment; filename="${safeName}.docx"`,
          'cache-control': 'private, no-store',
        },
      })
    }

    const executablePath = resolveChromiumExecutablePath()
    if (!executablePath) {
      throw new CrudHttpError(503, { error: 'documents.export.runtimeUnavailable' })
    }

    const pdfHtml = buildDocumentPdfHtml(doc.title, sanitizePdfExportContent(contentHtml))
    let pdf: Uint8Array
    try {
      pdf = await renderPdfWithChromium({
        html: pdfHtml,
        executablePath,
        isAllowedRequest: (interceptedRequest) => isAllowedPdfAssetRequest({
          url: interceptedRequest.url(),
          resourceType: interceptedRequest.resourceType(),
          isNavigationRequest: interceptedRequest.isNavigationRequest(),
        }),
      })
    } catch (error) {
      if (isPdfRenderOverloadedError(error)) {
        throw new CrudHttpError(503, { error: 'documents.export.overloaded' })
      }
      if (isPdfRenderTimeoutError(error)) {
        throw new CrudHttpError(503, { error: 'documents.export.renderTimeout' })
      }
      if (isPdfRenderOutputTooLargeError(error)) {
        throw new CrudHttpError(413, { error: 'documents.export.outputTooLarge' })
      }
      throw new CrudHttpError(503, { error: 'documents.export.runtimeUnavailable' })
    }
    return new Response(toArrayBuffer(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${safeName}.pdf"`,
        'cache-control': 'private, no-store',
      },
    })
  } catch (error) {
    return handleDocumentsRouteError(error, options?.operation ?? 'documents.export.get')
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return handleExport(request, context)
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleExport(request, context, {
    loadSnapshot: async () => docxSnapshotSchema.parse(await readBody(
      request,
      DOCUMENTS_JSON_BODY_LIMITS.exportSnapshot,
    )),
    operation: 'documents.export.post',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Documents',
  summary: 'Document export',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'Export document',
      description: 'Returns a binary .docx or PDF file attachment for a document.',
      query: exportQuerySchema,
      responses: [
        { status: 200, description: 'Document export file', schema: fileResponseSchema, mediaType: 'application/octet-stream' },
      ],
      errors: [
        { status: 400, description: 'Unsupported format', schema: routeErrorSchema },
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 404, description: 'Not found', schema: routeErrorSchema },
        { status: 413, description: 'Document or generated export exceeds the safe resource bound', schema: routeErrorSchema },
        { status: 503, description: 'Export runtime is unavailable, overloaded, or timed out', schema: routeErrorSchema },
      ],
    },
    POST: {
      summary: 'Export a paginated DOCX document',
      description: 'Returns a DOCX attachment using the editor pagination snapshot supplied by the client.',
      query: exportQuerySchema,
      requestBody: { contentType: 'application/json', schema: docxSnapshotSchema },
      responses: [
        { status: 200, description: 'Paginated DOCX export file', schema: fileResponseSchema, mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      ],
      errors: [
        { status: 400, description: 'Invalid pagination snapshot or unsupported format', schema: routeErrorSchema },
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 404, description: 'Not found', schema: routeErrorSchema },
        { status: 413, description: 'Document or generated export exceeds the safe resource bound', schema: routeErrorSchema },
        { status: 503, description: 'Export runtime is unavailable, overloaded, or timed out', schema: routeErrorSchema },
      ],
    },
  },
}

export default { GET, POST }
