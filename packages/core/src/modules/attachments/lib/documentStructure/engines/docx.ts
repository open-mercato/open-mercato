import { promises as fs } from 'node:fs'
import type {
  DocumentBlock,
  DocumentEngineResult,
  DocumentStructureEngine,
  DocumentStructureEngineInput,
} from '../types'
import {
  DocumentStructureFileTooLargeError,
  normalizeExtension,
  normalizeMimeType,
  resolveMaxDocumentStructureBytes,
} from './text'

const DOCX_ENGINE_VERSION = 1
const DOCX_MIME_TYPES = new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
const DOCX_EXTENSIONS = new Set(['docx'])
const TABLE_CELL_SEPARATOR = ' | '
const HEADING_TAG = /^h([1-6])$/

const HTML_TOKEN = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>|[^<]+|</g
const HTML_ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,8}));/g
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
}

export function decodeHtmlEntities(text: string): string {
  return text.replace(HTML_ENTITY, (entity, decimal: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (name !== undefined) return NAMED_ENTITIES[name.toLowerCase()] ?? entity
    const codePoint = decimal !== undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hex ?? '', 16)
    if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return entity
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) return entity
    return String.fromCodePoint(codePoint)
  })
}

function collapseInlineWhitespace(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\r\f\v\u00a0]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
}

type PendingBlock = {
  parts: string[]
  headingLevel: number | null
  listDepth: number | null
}

type TableState = {
  rows: string[]
  row: string[] | null
  cell: string[] | null
}

function docxBlock(text: string, extra: Partial<DocumentBlock> = {}): DocumentBlock {
  return { text, page: null, source: 'docx', ...extra }
}

export function parseMammothHtmlBlocks(html: string): DocumentBlock[] {
  const blocks: DocumentBlock[] = []
  let pending: PendingBlock | null = null
  let listDepth = 0
  let openListItems = 0
  let tableDepth = 0
  let table: TableState | null = null

  const flush = () => {
    if (!pending) return
    const text = collapseInlineWhitespace(pending.parts.join(''))
    if (text.length > 0) {
      const extra: Partial<DocumentBlock> = {}
      if (pending.headingLevel !== null) extra.headingLevel = pending.headingLevel
      if (pending.listDepth !== null) extra.listDepth = pending.listDepth
      blocks.push(docxBlock(text, extra))
    }
    pending = null
  }

  const startBlock = (headingLevel: number | null, depth: number | null) => {
    flush()
    pending = { parts: [], headingLevel, listDepth: depth }
  }

  const currentListItemDepth = () => (openListItems > 0 && listDepth > 0 ? listDepth - 1 : null)

  const appendText = (text: string) => {
    if (table) {
      if (table.cell) table.cell.push(text)
      return
    }
    if (!pending) pending = { parts: [], headingLevel: null, listDepth: currentListItemDepth() }
    pending.parts.push(text)
  }

  const closeCell = () => {
    if (!table || !table.cell) return
    const cellText = collapseInlineWhitespace(table.cell.join('')).replace(/\n/g, ' ')
    if (!table.row) table.row = []
    table.row.push(cellText)
    table.cell = null
  }

  const closeRow = () => {
    if (!table) return
    closeCell()
    if (table.row && table.row.some((cell) => cell.length > 0)) table.rows.push(table.row.join(TABLE_CELL_SEPARATOR))
    table.row = null
  }

  for (const match of html.matchAll(HTML_TOKEN)) {
    const token = match[0]
    if (token.startsWith('<!--')) continue
    const tagName = match[2]?.toLowerCase()
    if (tagName === undefined) {
      if (token === '<') appendText('<')
      else appendText(decodeHtmlEntities(token))
      continue
    }
    const closing = match[1] === '/'

    if (tableDepth > 0 && tagName !== 'table') {
      if (tableDepth > 1) {
        if (!closing && (tagName === 'td' || tagName === 'th' || tagName === 'p' || tagName === 'br' || tagName === 'li')) {
          appendText(' ')
        }
        continue
      }
      if (tagName === 'tr') {
        if (closing) closeRow()
        else {
          closeRow()
          if (table) table.row = []
        }
      } else if (tagName === 'td' || tagName === 'th') {
        if (closing) closeCell()
        else {
          closeCell()
          if (table) table.cell = []
        }
      } else if (!closing && (tagName === 'p' || tagName === 'br' || tagName === 'li')) {
        appendText(' ')
      }
      continue
    }

    const headingMatch = HEADING_TAG.exec(tagName)
    if (headingMatch) {
      if (closing) flush()
      else startBlock(Number(headingMatch[1]), null)
      continue
    }

    switch (tagName) {
      case 'p':
        if (closing) {
          if (openListItems === 0) flush()
        } else if (openListItems > 0 && pending) {
          appendText('\n')
        } else {
          startBlock(null, currentListItemDepth())
        }
        break
      case 'br':
        appendText('\n')
        break
      case 'ul':
      case 'ol':
        flush()
        if (closing) {
          listDepth = Math.max(0, listDepth - 1)
        } else {
          listDepth += 1
        }
        break
      case 'li':
        flush()
        if (closing) {
          openListItems = Math.max(0, openListItems - 1)
        } else {
          openListItems += 1
          pending = { parts: [], headingLevel: null, listDepth: currentListItemDepth() }
        }
        break
      case 'table':
        if (closing) {
          if (tableDepth === 1 && table) {
            closeRow()
            if (table.rows.length > 0) blocks.push(docxBlock(table.rows.join('\n'), { isTable: true }))
            table = null
          }
          tableDepth = Math.max(0, tableDepth - 1)
        } else {
          if (tableDepth === 0) {
            flush()
            table = { rows: [], row: null, cell: null }
          } else {
            appendText(' ')
          }
          tableDepth += 1
        }
        break
      default:
        break
    }
  }

  if (table) {
    closeRow()
    if (table.rows.length > 0) blocks.push(docxBlock(table.rows.join('\n'), { isTable: true }))
  }
  flush()
  return blocks
}

export type DocxStructureEngineOptions = {
  maxBytes?: () => number
  convertToHtml?: (filePath: string) => Promise<string>
}

async function convertDocxToHtml(filePath: string): Promise<string> {
  const mammoth = await import('mammoth')
  const result = await mammoth.convertToHtml(
    { path: filePath },
    {
      externalFileAccess: false,
      convertImage: mammoth.images.imgElement(async () => ({ src: '' })),
    },
  )
  return result.value
}

export function createDocxStructureEngine(options: DocxStructureEngineOptions = {}): DocumentStructureEngine {
  const resolveMaxBytes = options.maxBytes ?? resolveMaxDocumentStructureBytes
  const convertToHtml = options.convertToHtml ?? convertDocxToHtml
  return {
    id: 'docx',
    version: DOCX_ENGINE_VERSION,
    supports(mimeType: string, extension?: string | null): boolean {
      const normalizedExtension = normalizeExtension(extension)
      if (normalizedExtension && DOCX_EXTENSIONS.has(normalizedExtension)) return true
      return DOCX_MIME_TYPES.has(normalizeMimeType(mimeType))
    },
    async extract(input: DocumentStructureEngineInput): Promise<DocumentEngineResult> {
      const maxBytes = resolveMaxBytes()
      const stats = await fs.stat(input.filePath)
      if (stats.size > maxBytes) throw new DocumentStructureFileTooLargeError(stats.size, maxBytes)
      const html = await convertToHtml(input.filePath)
      return {
        blocks: parseMammothHtmlBlocks(html),
        pageCount: null,
        pageCharCounts: [],
        outline: [],
        ocrPageCount: 0,
        unreadablePages: [],
      }
    },
  }
}

export const docxStructureEngine: DocumentStructureEngine = createDocxStructureEngine()
