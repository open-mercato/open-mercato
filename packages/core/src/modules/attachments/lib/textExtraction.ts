import fs from 'fs/promises'
import path from 'path'
import { stripNulCharacters } from './extractedText'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveMaxOcrPages, resolvePdfPageIterationLimit } from './ocrLimits'
import { openPdfDocument } from './pdfJsLoader'
import { fitsDocxExpansionBudget } from './docxExpansionBudget'

const logger = createLogger('attachments').child({ component: 'text-extraction' })

const DEFAULT_TEXT_EXTRACTION_MAX_BYTES = 10 * 1024 * 1024
const DEFAULT_TEXT_EXTRACTION_MAX_CHARS = 500_000

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function resolveTextExtractionMaxBytes(): number {
  return parsePositiveIntEnv('OM_ATTACHMENT_TEXT_EXTRACTION_MAX_BYTES', DEFAULT_TEXT_EXTRACTION_MAX_BYTES)
}

export function resolveTextExtractionMaxChars(): number {
  return parsePositiveIntEnv('OM_ATTACHMENT_TEXT_EXTRACTION_MAX_CHARS', DEFAULT_TEXT_EXTRACTION_MAX_CHARS)
}

// NOTE: child_process is intentionally NOT imported here.
// This module MUST NOT shell out to any external binary for content extraction.
// All extraction must use pure-JS libraries. See HUNT-PARSER-01.

type ExtractParams = {
  filePath: string
  mimeType?: string | null
}

function isImage(mimeType?: string | null, filePath?: string | null): boolean {
  const normalized = (mimeType || '').toLowerCase()
  if (normalized.startsWith('image/')) return true
  if (filePath) {
    const ext = path.extname(filePath).toLowerCase()
    return ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tiff'].includes(ext)
  }
  return false
}

function isPlainText(mimeType: string, ext: string): boolean {
  return mimeType.startsWith('text/')
    || ext === '.txt'
    || ext === '.md'
    || ext === '.csv'
    || ext === '.log'
}

function isPdf(mimeType: string, ext: string): boolean {
  return mimeType === 'application/pdf' || ext === '.pdf'
}

function isDocx(mimeType: string, ext: string): boolean {
  // mammoth supports only Open XML .docx, not legacy binary .doc files.
  return (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || ext === '.docx'
  )
}

async function extractPlainText(filePath: string): Promise<string | null> {
  try {
    const stats = await fs.stat(filePath)
    const maxBytes = resolveTextExtractionMaxBytes()
    if (stats.size > maxBytes) {
      logger.warn('Plain text extraction skipped: file exceeds size budget', { filePath, size: stats.size, maxBytes })
      return null
    }
    const text = await fs.readFile(filePath, 'utf8')
    const maxChars = resolveTextExtractionMaxChars()
    if (text.length > maxChars) {
      logger.warn('Plain text extraction truncated due to character budget', { filePath, length: text.length, maxChars })
      return text.slice(0, maxChars)
    }
    const trimmed = text.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

async function extractPdfText(filePath: string): Promise<string | null> {
  try {
    const stats = await fs.stat(filePath)
    const maxBytes = resolveTextExtractionMaxBytes()
    if (stats.size > maxBytes) {
      logger.warn('PDF text extraction skipped: file exceeds size budget', { filePath, size: stats.size, maxBytes })
      return null
    }
    const data = new Uint8Array(await fs.readFile(filePath))
    const loadingTask = await openPdfDocument(data)
    const textParts: string[] = []
    let remaining = resolveTextExtractionMaxChars()
    try {
      const pdfDocument = await loadingTask.promise
      const pageLimit = resolvePdfPageIterationLimit(pdfDocument.numPages, resolveMaxOcrPages())
      if (pdfDocument.numPages > pageLimit) {
        logger.warn('PDF page count exceeds text-extraction cap; truncating', {
          numPages: pdfDocument.numPages,
          maxPages: pageLimit,
          filePath,
        })
      }
      for (let pageNumber = 1; pageNumber <= pageLimit && remaining > 0; pageNumber += 1) {
        const separator = textParts.length > 0 ? '\n' : ''
        const pageBudget = remaining - separator.length
        if (pageBudget === 0) break

        const page = await pdfDocument.getPage(pageNumber)
        try {
          type TextContent = Awaited<ReturnType<typeof page.getTextContent>>
          const stream = page.streamTextContent() as ReadableStream<TextContent>
          const reader = stream.getReader()
          let pageText = ''
          let exhausted = false
          try {
            while (!exhausted) {
              const { done, value } = await reader.read()
              if (done) break
              for (const item of value.items) {
                if (!('str' in item) || !item.str) continue
                const text = pageText ? item.str : item.str.trimStart()
                if (!text) continue
                if (pageText.length === pageBudget && text.trim()) {
                  exhausted = true
                  break
                }
                if (pageText && pageText.length < pageBudget) pageText += ' '
                const available = pageBudget - pageText.length
                pageText += text.slice(0, available)
                if (pageText.length === pageBudget && text.trimEnd().length >= Math.max(1, available)) {
                  exhausted = true
                  break
                }
              }
            }
          } finally {
            await reader.cancel()
          }
          const trimmed = pageText.trimEnd()
          if (trimmed) textParts.push(separator + trimmed)
          if (exhausted) break
          if (trimmed) remaining -= separator.length + trimmed.length
        } finally {
          page.cleanup()
        }
      }
    } finally {
      await loadingTask.destroy()
    }
    return textParts.join('') || null
  } catch {
    return null
  }
}

async function extractDocxText(filePath: string): Promise<string | null> {
  try {
    const stats = await fs.stat(filePath)
    const maxBytes = resolveTextExtractionMaxBytes()
    if (stats.size > maxBytes) {
      logger.warn('DOCX text extraction skipped: file exceeds size budget', { filePath, size: stats.size, maxBytes })
      return null
    }
    const buffer = await fs.readFile(filePath)
    if (buffer.length > maxBytes || !(await fitsDocxExpansionBudget(buffer, maxBytes))) {
      logger.warn('DOCX text extraction skipped: invalid archive or expanded size exceeds budget', { filePath, maxBytes })
      return null
    }
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    const trimmed = result.value.trim()
    if (!trimmed) return null
    const maxChars = resolveTextExtractionMaxChars()
    if (trimmed.length > maxChars) {
      logger.warn('DOCX text extraction truncated due to character budget', { filePath, length: trimmed.length, maxChars })
      return trimmed.slice(0, maxChars)
    }
    return trimmed
  } catch {
    return null
  }
}

export async function extractAttachmentContent(params: ExtractParams): Promise<string | null> {
  const extracted = await extractRawAttachmentContent(params)
  if (!extracted) return null
  const persistable = stripNulCharacters(extracted).trim()
  return persistable.length > 0 ? persistable : null
}

async function extractRawAttachmentContent(params: ExtractParams): Promise<string | null> {
  const { filePath, mimeType } = params
  if (!filePath) return null
  if (isImage(mimeType, filePath)) return null

  const normalized = (mimeType || '').toLowerCase()
  const ext = path.extname(filePath).toLowerCase()

  if (isPlainText(normalized, ext)) {
    return extractPlainText(filePath)
  }

  if (isPdf(normalized, ext)) {
    return extractPdfText(filePath)
  }

  if (isDocx(normalized, ext)) {
    return extractDocxText(filePath)
  }

  // XLSX, PPTX, MSG and other Office formats: no safe pure-JS extractor available yet.
  // Return null rather than shelling out to an external binary.
  return null
}
