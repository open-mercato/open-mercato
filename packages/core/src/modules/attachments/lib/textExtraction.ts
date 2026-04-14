import fs from 'fs/promises'
import path from 'path'
import { createRequire } from 'module'

// NOTE: child_process is intentionally NOT imported here.
// This module MUST NOT shell out to any external binary for content extraction.
// All extraction must use pure-JS libraries. See HUNT-PARSER-01.

const moduleRequire = createRequire(path.join(process.cwd(), 'package.json'))
const pdfJsPackageRoot = path.dirname(moduleRequire.resolve('pdfjs-dist/package.json'))
const PDF_CMAP_URL = `${path.join(pdfJsPackageRoot, 'cmaps')}${path.sep}`
const PDF_STANDARD_FONT_DATA_URL = `${path.join(pdfJsPackageRoot, 'standard_fonts')}${path.sep}`

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
    const text = await fs.readFile(filePath, 'utf8')
    const trimmed = text.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

async function extractPdfText(filePath: string): Promise<string | null> {
  try {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const data = new Uint8Array(await fs.readFile(filePath))
    const loadingTask = getDocument({
      data,
      cMapUrl: PDF_CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: PDF_STANDARD_FONT_DATA_URL,
    })
    const pdfDocument = await loadingTask.promise
    const textParts: string[] = []
    try {
      for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
        const page = await pdfDocument.getPage(pageNumber)
        try {
          const textContent = await page.getTextContent()
          const items = (textContent as any).items as Array<{ str?: string }> | undefined
          if (Array.isArray(items)) {
            const pageText = items
              .map((item) => (typeof item?.str === 'string' ? item.str : ''))
              .filter((s) => s.length > 0)
              .join(' ')
            if (pageText.trim()) textParts.push(pageText.trim())
          }
        } finally {
          page.cleanup()
        }
      }
    } finally {
      await pdfDocument.destroy()
    }
    const result = textParts.join('\n').trim()
    return result.length > 0 ? result : null
  } catch {
    return null
  }
}

async function extractDocxText(filePath: string): Promise<string | null> {
  try {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ path: filePath })
    const trimmed = result.value.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

export async function extractAttachmentContent(params: ExtractParams): Promise<string | null> {
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
