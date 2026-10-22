import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  DocumentStructureFileTooLargeError,
  createTextStructureEngine,
  normalizeTextDocument,
  resolveMaxDocumentStructureBytes,
  textStructureEngine,
} from '../../engines/text'
import {
  createDocumentStructureEngineRegistry,
  defaultDocumentStructureEngines,
  resolveEngine,
} from '../../engines/registry'
import { documentEngineResultSchema, type DocumentStructureEngine } from '../../types'

let workDir: string

beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'om-text-engine-'))
})

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true })
})

function writeFixture(name: string, content: string): string {
  const filePath = path.join(workDir, name)
  writeFileSync(filePath, content, 'utf8')
  return filePath
}

function expectBlocksInOrder(normalized: string, texts: string[]) {
  let cursor = 0
  for (const text of texts) {
    const index = normalized.indexOf(text, cursor)
    expect(index).toBeGreaterThanOrEqual(cursor)
    cursor = index + text.length
  }
}

describe('textStructureEngine.supports', () => {
  it('accepts plain text and markdown by mime type or extension', () => {
    expect(textStructureEngine.supports('text/plain')).toBe(true)
    expect(textStructureEngine.supports('text/plain; charset=utf-8')).toBe(true)
    expect(textStructureEngine.supports('text/markdown')).toBe(true)
    expect(textStructureEngine.supports('application/octet-stream', '.MD')).toBe(true)
    expect(textStructureEngine.supports('application/octet-stream', 'txt')).toBe(true)
  })

  it('rejects other types', () => {
    expect(textStructureEngine.supports('application/pdf', 'pdf')).toBe(false)
    expect(textStructureEngine.supports('text/csv', 'csv')).toBe(false)
    expect(textStructureEngine.supports('text/html')).toBe(false)
  })
})

describe('textStructureEngine.extract', () => {
  it('maps ATX and Setext markdown headings to levels', async () => {
    const filePath = writeFixture(
      'rules.md',
      [
        '# Rulebook',
        '',
        'Intro paragraph line one',
        'line two.',
        '',
        '## Chapter 8 ##',
        '',
        '### 8.12 Fouls',
        '',
        'Setext Title',
        '============',
        '',
        'Setext Sub',
        '----------',
        '',
        '- first point',
        '  - nested point',
        '1. numbered point',
        '',
        '```',
        '# not a heading',
        '```',
      ].join('\n'),
    )
    const result = await textStructureEngine.extract({ filePath, mimeType: 'text/markdown', extension: 'md' })
    expect(documentEngineResultSchema.parse(result)).toEqual(result)
    expect(result.blocks.map((block) => [block.text, block.headingLevel ?? null, block.listDepth ?? null])).toEqual([
      ['Rulebook', 1, null],
      ['Intro paragraph line one\nline two.', null, null],
      ['Chapter 8', 2, null],
      ['8.12 Fouls', 3, null],
      ['Setext Title', 1, null],
      ['Setext Sub', 2, null],
      ['first point', null, 0],
      ['nested point', null, 1],
      ['numbered point', null, 0],
      ['# not a heading', null, null],
    ])
    expect(result.blocks.every((block) => block.page === null && block.source === 'text')).toBe(true)
    expect(result.pageCount).toBeNull()
    expect(result.pageCharCounts).toEqual([])
    expect(result.ocrPageCount).toBe(0)
  })

  it('splits plain text into paragraphs without headings', async () => {
    const filePath = writeFixture('plain.txt', '# Not markdown here\n\n1. Scope\nThis applies.\n\n\n2. Terms')
    const result = await textStructureEngine.extract({ filePath, mimeType: 'text/plain', extension: 'txt' })
    expect(result.blocks).toEqual([
      { text: '# Not markdown here', page: null, source: 'text' },
      { text: '1. Scope\nThis applies.', page: null, source: 'text' },
      { text: '2. Terms', page: null, source: 'text' },
    ])
  })

  it('normalizes CRLF, CR and a leading BOM', async () => {
    const raw = '\uFEFF# Title\r\n\r\nBody one\r\nBody two\r\rTail'
    const filePath = writeFixture('crlf.md', raw)
    const result = await textStructureEngine.extract({ filePath, mimeType: 'text/markdown' })
    expect(normalizeTextDocument(raw)).toBe('# Title\n\nBody one\nBody two\n\nTail')
    expect(result.blocks.map((block) => block.text)).toEqual(['Title', 'Body one\nBody two', 'Tail'])
    expect(result.blocks.some((block) => block.text.includes('\r'))).toBe(false)
  })

  it('keeps block text consistent with the normalized document order', async () => {
    const raw = 'First paragraph.\r\n\r\nSecond paragraph\r\nwrapped.\r\n\r\nThird.'
    const filePath = writeFixture('order.txt', raw)
    const result = await textStructureEngine.extract({ filePath, mimeType: 'text/plain' })
    expectBlocksInOrder(normalizeTextDocument(raw), result.blocks.map((block) => block.text))
  })

  it('returns no blocks for an empty or whitespace-only file', async () => {
    const emptyPath = writeFixture('empty.txt', '')
    const blankPath = writeFixture('blank.md', '\n \r\n\t\n')
    const empty = await textStructureEngine.extract({ filePath: emptyPath, mimeType: 'text/plain' })
    const blank = await textStructureEngine.extract({ filePath: blankPath, mimeType: 'text/markdown' })
    expect(empty.blocks).toEqual([])
    expect(blank.blocks).toEqual([])
  })

  it('refuses files above the byte cap', async () => {
    const filePath = writeFixture('large.txt', 'x'.repeat(2048))
    const engine = createTextStructureEngine({ maxBytes: () => 1024 })
    await expect(engine.extract({ filePath, mimeType: 'text/plain' })).rejects.toBeInstanceOf(
      DocumentStructureFileTooLargeError,
    )
    const withinCap = createTextStructureEngine({ maxBytes: () => 4096 })
    await expect(withinCap.extract({ filePath, mimeType: 'text/plain' })).resolves.toMatchObject({
      blocks: [{ text: 'x'.repeat(2048) }],
    })
  })

  it('reads the byte cap from OM_ATTACHMENT_STRUCTURE_MAX_BYTES with a 50 MiB default', () => {
    const previous = process.env.OM_ATTACHMENT_STRUCTURE_MAX_BYTES
    try {
      delete process.env.OM_ATTACHMENT_STRUCTURE_MAX_BYTES
      expect(resolveMaxDocumentStructureBytes()).toBe(52_428_800)
      process.env.OM_ATTACHMENT_STRUCTURE_MAX_BYTES = '2048'
      expect(resolveMaxDocumentStructureBytes()).toBe(2048)
      process.env.OM_ATTACHMENT_STRUCTURE_MAX_BYTES = 'nope'
      expect(resolveMaxDocumentStructureBytes()).toBe(52_428_800)
    } finally {
      if (previous === undefined) delete process.env.OM_ATTACHMENT_STRUCTURE_MAX_BYTES
      else process.env.OM_ATTACHMENT_STRUCTURE_MAX_BYTES = previous
    }
  })
})

function fakeEngine(id: DocumentStructureEngine['id'], mimeTypes: string[]): DocumentStructureEngine {
  return {
    id,
    version: 1,
    supports: (mimeType) => mimeTypes.includes(mimeType),
    extract: async () => ({ blocks: [], pageCount: null, pageCharCounts: [], outline: [], ocrPageCount: 0, unreadablePages: [] }),
  }
}

describe('document structure engine registry', () => {
  it('registers only the text engine by default', () => {
    expect(defaultDocumentStructureEngines().map((engine) => engine.id)).toEqual(['text'])
    const registry = createDocumentStructureEngineRegistry()
    expect(registry.resolve('text/markdown', 'md')).toBe(textStructureEngine)
    expect(registry.resolve('application/pdf', 'pdf')).toBeNull()
  })

  it('resolves the first supporting engine in order', () => {
    const pdfEngine = fakeEngine('pdf_layout', ['application/pdf', 'text/plain'])
    expect(resolveEngine([textStructureEngine, pdfEngine], 'text/plain')).toBe(textStructureEngine)
    expect(resolveEngine([pdfEngine, textStructureEngine], 'text/plain')).toBe(pdfEngine)
    expect(resolveEngine([textStructureEngine, pdfEngine], 'application/pdf')).toBe(pdfEngine)
  })

  it('appends, prepends, overrides by id and unregisters', () => {
    const registry = createDocumentStructureEngineRegistry()
    const pdfEngine = fakeEngine('pdf_layout', ['application/pdf'])
    registry.register(pdfEngine)
    expect(registry.list().map((engine) => engine.id)).toEqual(['text', 'pdf_layout'])

    const ocrEngine = fakeEngine('ocr', ['text/plain'])
    registry.register(ocrEngine, { prepend: true })
    expect(registry.list().map((engine) => engine.id)).toEqual(['ocr', 'text', 'pdf_layout'])
    expect(registry.resolve('text/plain')).toBe(ocrEngine)

    const textOverride = fakeEngine('text', ['text/markdown'])
    registry.register(textOverride)
    expect(registry.list().map((engine) => engine.id)).toEqual(['ocr', 'text', 'pdf_layout'])
    expect(registry.resolve('text/markdown')).toBe(textOverride)

    expect(registry.unregister('ocr')).toBe(true)
    expect(registry.unregister('ocr')).toBe(false)
    expect(registry.list().map((engine) => engine.id)).toEqual(['text', 'pdf_layout'])
  })
})
