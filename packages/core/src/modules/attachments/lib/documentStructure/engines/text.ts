import { promises as fs } from 'node:fs'
import type {
  DocumentBlock,
  DocumentEngineResult,
  DocumentStructureEngine,
  DocumentStructureEngineInput,
} from '../types'

const DEFAULT_MAX_STRUCTURE_BYTES = 52_428_800
const TEXT_ENGINE_VERSION = 1
const PLAIN_MIME_TYPES = new Set(['text/plain'])
const MARKDOWN_MIME_TYPES = new Set(['text/markdown', 'text/x-markdown'])
const PLAIN_EXTENSIONS = new Set(['txt', 'text'])
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown'])
const LIST_INDENT_WIDTH = 2

const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const SETEXT_LEVEL_ONE = /^ {0,3}=+[ \t]*$/
const SETEXT_LEVEL_TWO = /^ {0,3}-+[ \t]*$/
const FENCE = /^ {0,3}(```+|~~~+)/
const LIST_ITEM = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])[ \t]+(.*)$/
const THEMATIC_BREAK = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/

export class DocumentStructureFileTooLargeError extends Error {
  readonly code = 'too_large'

  constructor(
    readonly sizeBytes: number,
    readonly maxBytes: number,
  ) {
    super(`[internal] document structure input exceeds ${maxBytes} bytes (${sizeBytes})`)
    this.name = 'DocumentStructureFileTooLargeError'
  }
}

export function resolveMaxDocumentStructureBytes(): number {
  const raw = process.env.OM_ATTACHMENT_STRUCTURE_MAX_BYTES
  if (raw === undefined || raw.trim() === '') return DEFAULT_MAX_STRUCTURE_BYTES
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_STRUCTURE_BYTES
  return Math.floor(parsed)
}

export function normalizeMimeType(mimeType: string): string {
  return mimeType.split(';')[0].trim().toLowerCase()
}

export function normalizeExtension(extension?: string | null): string | null {
  if (!extension) return null
  const trimmed = extension.trim().toLowerCase().replace(/^\.+/, '')
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeTextDocument(raw: string): string {
  return raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
}

function isMarkdown(mimeType: string, extension?: string | null): boolean {
  const normalizedExtension = normalizeExtension(extension)
  if (normalizedExtension && MARKDOWN_EXTENSIONS.has(normalizedExtension)) return true
  return MARKDOWN_MIME_TYPES.has(normalizeMimeType(mimeType))
}

function textBlock(text: string, extra: Partial<DocumentBlock> = {}): DocumentBlock {
  return { text, page: null, source: 'text', ...extra }
}

function measureIndent(whitespace: string): number {
  return whitespace.replace(/\t/g, ' '.repeat(LIST_INDENT_WIDTH * 2)).length
}

export function parsePlainTextBlocks(text: string): DocumentBlock[] {
  const blocks: DocumentBlock[] = []
  let paragraph: string[] = []
  const flush = () => {
    if (paragraph.length > 0) blocks.push(textBlock(paragraph.join('\n')))
    paragraph = []
  }
  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      flush()
      continue
    }
    paragraph.push(line.trim())
  }
  flush()
  return blocks
}

export function parseMarkdownBlocks(text: string): DocumentBlock[] {
  const blocks: DocumentBlock[] = []
  let paragraph: string[] = []
  let listItem: { lines: string[]; depth: number } | null = null
  let fence: { marker: string; lines: string[] } | null = null

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push(textBlock(paragraph.join('\n')))
    paragraph = []
  }
  const flushListItem = () => {
    if (listItem && listItem.lines.length > 0) {
      blocks.push(textBlock(listItem.lines.join('\n'), { listDepth: listItem.depth }))
    }
    listItem = null
  }
  const flushAll = () => {
    flushParagraph()
    flushListItem()
  }

  for (const line of text.split('\n')) {
    if (fence) {
      if (line.trim().startsWith(fence.marker)) {
        if (fence.lines.some((codeLine) => codeLine.trim() !== '')) blocks.push(textBlock(fence.lines.join('\n')))
        fence = null
      } else {
        fence.lines.push(line)
      }
      continue
    }

    const fenceMatch = FENCE.exec(line)
    if (fenceMatch) {
      flushAll()
      fence = { marker: fenceMatch[1], lines: [] }
      continue
    }

    if (line.trim() === '') {
      flushAll()
      continue
    }

    const atxMatch = ATX_HEADING.exec(line)
    if (atxMatch) {
      flushAll()
      const headingText = (atxMatch[2] ?? '').trim()
      if (headingText.length > 0) blocks.push(textBlock(headingText, { headingLevel: atxMatch[1].length }))
      continue
    }

    if (paragraph.length > 0 && !listItem) {
      if (SETEXT_LEVEL_ONE.test(line) || SETEXT_LEVEL_TWO.test(line)) {
        const headingText = paragraph.join(' ').trim()
        paragraph = []
        blocks.push(textBlock(headingText, { headingLevel: SETEXT_LEVEL_ONE.test(line) ? 1 : 2 }))
        continue
      }
    }

    if (THEMATIC_BREAK.test(line)) {
      flushAll()
      continue
    }

    const listMatch = LIST_ITEM.exec(line)
    if (listMatch && listMatch[2].trim().length > 0) {
      flushAll()
      listItem = {
        lines: [listMatch[2].trim()],
        depth: Math.floor(measureIndent(listMatch[1]) / LIST_INDENT_WIDTH),
      }
      continue
    }

    if (listItem) {
      listItem.lines.push(line.trim())
      continue
    }

    paragraph.push(line.trim())
  }

  if (fence && fence.lines.some((codeLine) => codeLine.trim() !== '')) blocks.push(textBlock(fence.lines.join('\n')))
  flushAll()
  return blocks
}

export type TextStructureEngineOptions = {
  maxBytes?: () => number
}

export function createTextStructureEngine(options: TextStructureEngineOptions = {}): DocumentStructureEngine {
  const resolveMaxBytes = options.maxBytes ?? resolveMaxDocumentStructureBytes
  return {
    id: 'text',
    version: TEXT_ENGINE_VERSION,
    supports(mimeType: string, extension?: string | null): boolean {
      const normalizedExtension = normalizeExtension(extension)
      if (normalizedExtension && (PLAIN_EXTENSIONS.has(normalizedExtension) || MARKDOWN_EXTENSIONS.has(normalizedExtension))) {
        return true
      }
      const normalizedMime = normalizeMimeType(mimeType)
      return PLAIN_MIME_TYPES.has(normalizedMime) || MARKDOWN_MIME_TYPES.has(normalizedMime)
    },
    async extract(input: DocumentStructureEngineInput): Promise<DocumentEngineResult> {
      const maxBytes = resolveMaxBytes()
      const stats = await fs.stat(input.filePath)
      if (stats.size > maxBytes) throw new DocumentStructureFileTooLargeError(stats.size, maxBytes)
      const text = normalizeTextDocument(await fs.readFile(input.filePath, 'utf8'))
      const blocks = isMarkdown(input.mimeType, input.extension) ? parseMarkdownBlocks(text) : parsePlainTextBlocks(text)
      return {
        blocks,
        pageCount: null,
        pageCharCounts: [],
        outline: [],
        ocrPageCount: 0,
        unreadablePages: [],
      }
    },
  }
}

export const textStructureEngine: DocumentStructureEngine = createTextStructureEngine()
