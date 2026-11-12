import type { AwilixContainer } from 'awilix'

/**
 * Swappable OCR / layout provider contract (context overlay, Phase 3).
 *
 * Elevates the existing hardcoded OpenAI vision-OCR path in `attachments`
 * (`lib/ocrService.ts`, `gpt-4o`) into a provider-agnostic seam: the default
 * `OpenAiVisionOcrProvider` WRAPS that service (it does not reimplement the model
 * call), and an `idp` (Textract / Azure DI) or `tesseract` engine can be dropped
 * in later behind the SAME interface with no change to the extraction schema or
 * the `ContextResolver` consumer.
 *
 * Tenancy: the scope is passed on every call and is the authority — a provider
 * MUST NOT read raw bytes for one tenant under another's scope. The default
 * provider only sees the buffer the caller hands it.
 *
 * Output is text + per-page blocks with geometry. The `llm` engine asserts a
 * single page-1 block (model-asserted geometry, weaker than IDP bbox but enough
 * for v1 provenance); an IDP engine returns native bbox per block.
 */
export type DocumentOcrScope = {
  tenantId: string
  organizationId: string
}

export type DocumentOcrInput = {
  buffer: Buffer
  mimeType: string
  /** Optional file name — lets a provider infer type when the mime is missing. */
  fileName?: string
  scope: DocumentOcrScope
}

/** A region within a page: `[x0, y0, x1, y1]` (native bbox for IDP; whole-page for `llm`). */
export type DocumentOcrBlock = {
  text: string
  page: number
  region?: [number, number, number, number]
}

export type DocumentOcrResult = {
  text: string
  pages: Array<{ page: number; blocks: DocumentOcrBlock[] }>
  /** Provider-level confidence in [0,1] when available (IDP); undefined for `llm`. */
  confidence?: number
}

export interface DocumentOcrProvider {
  /** Stable provider id — `ocr_openai_vision` | `ocr_azure_di` | `ocr_aws_textract` | `ocr_tesseract`. */
  readonly id: string
  extract(input: DocumentOcrInput): Promise<DocumentOcrResult>
}

/**
 * The thin adapter shape the default provider drives. Mirrors the public surface
 * of `attachments` `OcrService.processFile` WITHOUT importing the AI SDK here —
 * the wiring resolves the real service from the container (or env) at call time,
 * so this module never reimplements the OpenAI vision-OCR model call.
 */
export type OcrServiceLike = {
  available: boolean
  processFile(input: {
    filePath: string
    mimeType: string | null
  }): Promise<{ content: string; pageCount?: number } | null>
}

/**
 * The default OCR provider — the elevated OpenAI vision-OCR path. It writes the
 * caller's buffer to a temp file (the existing `OcrService` is path-based),
 * delegates extraction to that service, then maps the markdown/text result into
 * the provider-agnostic block shape with model-asserted page geometry.
 *
 * The geometry is page-scoped only (`page:N`, no bbox) because the LLM path
 * returns text per page, not native bounding boxes — honest about its fidelity
 * (an IDP engine returns real bbox under the same interface).
 */
export class OpenAiVisionOcrProvider implements DocumentOcrProvider {
  readonly id = 'ocr_openai_vision'

  constructor(private readonly ocrService: OcrServiceLike) {}

  async extract(input: DocumentOcrInput): Promise<DocumentOcrResult> {
    if (!this.ocrService.available) {
      throw new Error('[internal] agent_orchestrator: OpenAI vision-OCR provider is not configured (missing OPENAI_API_KEY)')
    }

    const { writeFile, mkdtemp, rm } = await import('fs/promises')
    const { tmpdir } = await import('os')
    const { join } = await import('path')

    const dir = await mkdtemp(join(tmpdir(), 'agent-doc-ingest-'))
    const ext = extensionForMime(input.mimeType, input.fileName)
    const filePath = join(dir, `source${ext}`)
    try {
      await writeFile(filePath, input.buffer)
      const ocr = await this.ocrService.processFile({ filePath, mimeType: input.mimeType })
      const text = (ocr?.content ?? '').trim()
      const pageCount = Math.max(1, ocr?.pageCount ?? 1)
      return {
        text,
        pages: splitMarkdownPages(text, pageCount),
      }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

/**
 * Split the OcrService's markdown blob into per-page blocks. The service emits
 * `--- Page N ---` separators for multi-page PDFs; single-page output is one
 * page-1 block. Geometry is page-scoped (model-asserted), no bbox.
 */
function splitMarkdownPages(text: string, pageCount: number): DocumentOcrResult['pages'] {
  if (!text) {
    return Array.from({ length: pageCount }, (_unused, index) => ({ page: index + 1, blocks: [] }))
  }
  const PAGE_MARKER = /^---\s*Page\s+(\d+)\s*---$/gm
  const matches = [...text.matchAll(PAGE_MARKER)]
  if (matches.length === 0) {
    return [{ page: 1, blocks: [{ text, page: 1 }] }]
  }
  const pages: DocumentOcrResult['pages'] = []
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const pageNumber = Number.parseInt(match[1] ?? `${index + 1}`, 10)
    const start = (match.index ?? 0) + match[0].length
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? text.length) : text.length
    const body = text.slice(start, end).trim()
    pages.push({ page: pageNumber, blocks: body ? [{ text: body, page: pageNumber }] : [] })
  }
  return pages
}

function extensionForMime(mimeType: string, fileName?: string): string {
  const normalized = (mimeType || '').toLowerCase()
  if (normalized === 'application/pdf') return '.pdf'
  if (normalized === 'image/png') return '.png'
  if (normalized === 'image/jpeg') return '.jpg'
  if (normalized === 'image/webp') return '.webp'
  if (normalized === 'image/gif') return '.gif'
  if (normalized === 'image/tiff') return '.tiff'
  if (fileName && fileName.includes('.')) return fileName.slice(fileName.lastIndexOf('.'))
  return '.bin'
}

/**
 * Resolve the default OCR provider from the container. The real `OcrService`
 * lives in `attachments`; we consume it structurally (never modify its surface).
 * When attachments / OPENAI is absent the provider is still constructed but its
 * `extract` fails closed — ingest then yields no facts (optional fill).
 */
export function resolveDefaultOcrProvider(container: AwilixContainer): DocumentOcrProvider {
  const service = resolveOcrService(container)
  return new OpenAiVisionOcrProvider(service)
}

function resolveOcrService(container: AwilixContainer): OcrServiceLike {
  const hasRegistration =
    typeof container.hasRegistration === 'function' ? container.hasRegistration.bind(container) : null
  if (!hasRegistration || hasRegistration('ocrService')) {
    try {
      const resolved = container.resolve('ocrService') as OcrServiceLike
      if (resolved && typeof resolved.processFile === 'function') return resolved
    } catch {
      // fall through to env-backed lazy construction
    }
  }
  return new LazyEnvOcrService()
}

/**
 * Lazily constructs the attachments `OcrService` from env when the container has
 * no `ocrService` registration. The import is deferred so this module never pulls
 * the AI SDK into a context-only build, and so tests can inject a fake provider
 * without touching the OpenAI path at all.
 */
class LazyEnvOcrService implements OcrServiceLike {
  get available(): boolean {
    return Boolean(process.env.OPENAI_API_KEY)
  }

  async processFile(input: { filePath: string; mimeType: string | null }): Promise<{ content: string; pageCount?: number } | null> {
    const { OcrService } = await import('@open-mercato/core/modules/attachments/lib/ocrService')
    const service = new OcrService()
    return service.processFile({ filePath: input.filePath, mimeType: input.mimeType })
  }
}
