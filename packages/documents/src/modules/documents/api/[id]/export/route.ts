import { existsSync } from 'node:fs'
import { NextResponse } from 'next/server'
import puppeteer from 'puppeteer-core'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import HTMLtoDOCXDefault from 'html-to-docx'
import { assertTier } from '../../../lib/permissions'
import { loadDocumentContent } from '../../../lib/contentService'
import {
  handleDocumentsRouteError,
  loadScopedDocument,
  resolveDocumentsContext,
  routeErrorSchema,
} from '../../_shared'

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

type ExportFormat = 'docx' | 'pdf'

type HTMLtoDOCX = (html: string) => Promise<unknown> | unknown

type HTMLtoDOCXModule = {
  default?: unknown
}

const exportQuerySchema = z.object({
  format: z.enum(['docx', 'pdf']).optional(),
})

const fileResponseSchema = z.string().describe('Binary .docx or PDF file attachment')

const COMMON_CHROMIUM_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['documents.view'] },
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

async function resolveHTMLtoDOCX(): Promise<HTMLtoDOCX> {
  const staticCandidate: unknown = HTMLtoDOCXDefault
  if (typeof staticCandidate === 'function') return staticCandidate as HTMLtoDOCX
  const dynamicModule = await import('html-to-docx') as HTMLtoDOCXModule
  if (typeof dynamicModule.default === 'function') return dynamicModule.default as HTMLtoDOCX
  throw new Error('[internal] html-to-docx default export is not callable')
}

async function normalizeBinary(value: unknown): Promise<Uint8Array> {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return new Uint8Array(await value.arrayBuffer())
  }
  throw new Error('[internal] export renderer returned an unsupported binary payload')
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

async function renderDocx(html: string): Promise<Uint8Array> {
  const HTMLtoDOCX = await resolveHTMLtoDOCX()
  return await normalizeBinary(await HTMLtoDOCX(html))
}

async function renderPdf(html: string, executablePath: string): Promise<Uint8Array> {
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  try {
    const page = await browser.newPage()
    await page.setRequestInterception(true)
    page.on('request', (interceptedRequest) => {
      const isSafeRequest =
        interceptedRequest.isNavigationRequest() || interceptedRequest.url().startsWith('data:')
      void (isSafeRequest ? interceptedRequest.continue() : interceptedRequest.abort())
    })
    await page.setContent(html, { waitUntil: 'load' })
    return await page.pdf({ format: 'A4', printBackground: true })
  } finally {
    await browser.close()
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const format = resolveExportFormat(new URL(request.url).searchParams.get('format'))
    if (!format) {
      return NextResponse.json({ error: 'Unsupported format' }, { status: 400 })
    }

    const id = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    await assertTier(ctx.em, id, ctx.auth, 'viewer')
    const doc = await loadScopedDocument(ctx, id)
    const content = await loadDocumentContent(ctx.em, id, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title></head><body>${content?.contentHtml ?? ''}</body></html>`
    const safeName = buildSafeFilename(doc.title)

    if (format === 'docx') {
      const bufferBytes = await renderDocx(html)
      return new Response(toArrayBuffer(bufferBytes), {
        headers: {
          'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'content-disposition': `attachment; filename="${safeName}.docx"`,
        },
      })
    }

    const executablePath = resolveChromiumExecutablePath()
    if (!executablePath) {
      return NextResponse.json({
        error: '[internal] PDF export requires a Chromium runtime (set DOCUMENTS_PDF_CHROMIUM_PATH)',
      }, { status: 503 })
    }

    const pdf = await renderPdf(html, executablePath)
    return new Response(toArrayBuffer(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${safeName}.pdf"`,
      },
    })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.export.get')
  }
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
        { status: 503, description: 'PDF export requires Chromium', schema: routeErrorSchema },
      ],
    },
  },
}

export default { GET }
