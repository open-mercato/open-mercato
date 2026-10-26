import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PDFDocument, PDFName, PDFString, StandardFonts, type PDFFont, type PDFPage, type PDFRef } from 'pdf-lib'
import {
  DocumentStructurePdfEncryptedError,
  createPdfLayoutEngine,
  isPdfPasswordError,
  layoutPdfPage,
  resolveMaxDocumentStructurePages,
  resolveOcrMinCharsPerPage,
  type PdfLayoutPage,
  type PdfLayoutSource,
  type PdfLayoutTextRun,
} from '../../engines/pdfLayout'
import { DocumentStructureAbortedError, DocumentStructureFileTooLargeError } from '../../engines/text'
import { structureDocument } from '../../structurer'
import { documentEngineResultSchema, type DocumentEngineResult } from '../../types'

const CORE_PACKAGE_ROOT = path.resolve(__dirname, '../../../../../../../..')
const ENGINE_MODULE_PATH = path.resolve(__dirname, '../../engines/pdfLayout.ts')
const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const LEFT_MARGIN = 72
const RIGHT_COLUMN_X = 322
const BODY_SIZE = 11
const BODY_LEADING = 13.5
const RUNNING_HEADER = 'Rulebook of Synthetic Testing'

const CHILD_SCRIPT = `
import { pathToFileURL } from 'node:url'
const [enginePath, ...files] = process.argv.slice(1)
const { createPdfLayoutEngine } = await import(pathToFileURL(enginePath).href)
const engine = createPdfLayoutEngine()
const results = []
for (const filePath of files) {
  try {
    results.push({ ok: true, result: await engine.extract({ filePath, mimeType: 'application/pdf', extension: 'pdf' }) })
  } catch (error) {
    results.push({ ok: false, name: error && error.name, code: error && error.code })
  }
}
process.stdout.write(JSON.stringify(results))
`

type ChildResult = { ok: true; result: DocumentEngineResult } | { ok: false; name?: string; code?: string }

type Fonts = { regular: PDFFont; bold: PDFFont }

type OutlineFixtureEntry = { title: string; page: PDFPage; children?: OutlineFixtureEntry[] }

let workDir: string

beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'om-pdf-layout-engine-'))
})

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true })
})

function drawLines(page: PDFPage, font: PDFFont, lines: readonly string[], x: number, startY: number) {
  let cursor = startY
  for (const line of lines) {
    page.drawText(line, { x, y: cursor, size: BODY_SIZE, font })
    cursor -= BODY_LEADING
  }
}

function drawRunning(page: PDFPage, fonts: Fonts, pageNumber: number) {
  page.drawText(RUNNING_HEADER, { x: LEFT_MARGIN, y: 760, size: 9, font: fonts.regular })
  page.drawText(`Page ${pageNumber}`, { x: 290, y: 30, size: 9, font: fonts.regular })
}

function addOutline(document: PDFDocument, entries: readonly OutlineFixtureEntry[]) {
  const context = document.context
  const rootRef = context.nextRef()
  const buildLevel = (items: readonly OutlineFixtureEntry[], parentRef: PDFRef): PDFRef[] => {
    const refs = items.map(() => context.nextRef())
    items.forEach((item, index) => {
      const childRefs = item.children ? buildLevel(item.children, refs[index]) : []
      const dict = context.obj({
        Title: PDFString.of(item.title),
        Parent: parentRef,
        Dest: [item.page.ref, PDFName.of('XYZ'), null, null, null],
      })
      if (index > 0) dict.set(PDFName.of('Prev'), refs[index - 1])
      if (index < refs.length - 1) dict.set(PDFName.of('Next'), refs[index + 1])
      if (childRefs.length > 0) {
        dict.set(PDFName.of('First'), childRefs[0])
        dict.set(PDFName.of('Last'), childRefs[childRefs.length - 1])
        dict.set(PDFName.of('Count'), context.obj(childRefs.length))
      }
      context.assign(refs[index], dict)
    })
    return refs
  }
  const topRefs = buildLevel(entries, rootRef)
  context.assign(
    rootRef,
    context.obj({ Type: 'Outlines', First: topRefs[0], Last: topRefs[topRefs.length - 1], Count: topRefs.length }),
  )
  document.catalog.set(PDFName.of('Outlines'), rootRef)
}

async function buildRulebookPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  const fonts: Fonts = {
    regular: await document.embedFont(StandardFonts.Helvetica),
    bold: await document.embedFont(StandardFonts.HelveticaBold),
  }

  const first = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  drawRunning(first, fonts, 1)
  first.drawText('Chapter 1 General Provisions', { x: LEFT_MARGIN, y: 700, size: 18, font: fonts.bold })
  first.drawText('1.1 Scope', { x: LEFT_MARGIN, y: 664, size: 13, font: fonts.bold })
  drawLines(first, fonts.regular, [
    'These rules apply to every synthetic document that the engine',
    'reads during the test run and they describe how the layout is',
    'grouped into lines and blocks.',
  ], LEFT_MARGIN, 644)
  first.drawText('1.2 Definitions', { x: LEFT_MARGIN, y: 590, size: 13, font: fonts.bold })
  drawLines(first, fonts.regular, ['The following terms are used throughout this rulebook:'], LEFT_MARGIN, 570)
  drawLines(first, fonts.regular, [
    '(a) a block is a run of lines that belong together;',
    '(b) a line is a run of text items that share a baseline.',
  ], LEFT_MARGIN + 18, 552)

  const second = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  drawRunning(second, fonts, 2)
  second.drawText('Chapter 2 Two Column Layout Rules', { x: LEFT_MARGIN, y: 700, size: 18, font: fonts.bold })
  second.drawText('2.1 Left column rule', { x: LEFT_MARGIN, y: 664, size: 13, font: fonts.bold })
  drawLines(second, fonts.regular, [
    'Text in the left column is read',
    'before any text in the right',
    'column of the same page.',
  ], LEFT_MARGIN, 644)
  second.drawText('2.2 Right column rule', { x: RIGHT_COLUMN_X, y: 664, size: 13, font: fonts.bold })
  drawLines(second, fonts.regular, [
    'Text in the right column is read',
    'after the left column even when',
    'the baselines line up exactly.',
  ], RIGHT_COLUMN_X, 644)

  document.addPage([PAGE_WIDTH, PAGE_HEIGHT])

  const fourth = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  drawRunning(fourth, fonts, 4)
  fourth.drawText('Chapter 3 Final Provisions', { x: LEFT_MARGIN, y: 700, size: 18, font: fonts.bold })
  fourth.drawText('3.1 Entry into force', { x: LEFT_MARGIN, y: 664, size: 13, font: fonts.bold })
  drawLines(fourth, fonts.regular, [
    'This rulebook enters into force on the day the test suite runs',
    'and it remains in force until the fixtures are regenerated.',
  ], LEFT_MARGIN, 644)

  addOutline(document, [
    {
      title: 'Chapter 1 General Provisions',
      page: first,
      children: [
        { title: '1.1 Scope', page: first },
        { title: '1.2 Definitions', page: first },
      ],
    },
    { title: 'Chapter 2 Two Column Layout Rules', page: second },
    { title: 'Chapter 3 Final Provisions', page: fourth },
  ])
  return document.save()
}

async function buildPlainPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  const regular = await document.embedFont(StandardFonts.Helvetica)
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  drawLines(page, regular, [
    'A first paragraph that spans two lines of text on a page',
    'without any outline entries or headings in a larger font.',
  ], LEFT_MARGIN, 700)
  drawLines(page, regular, [
    'A second paragraph separated from the first by a blank line',
    'so the vertical gap starts a new block.',
  ], LEFT_MARGIN, 700 - BODY_LEADING * 3)
  return document.save()
}

function writeFixture(name: string, bytes: Uint8Array): string {
  const filePath = path.join(workDir, name)
  writeFileSync(filePath, bytes)
  return filePath
}

function extractInChildProcess(filePaths: readonly string[]): ChildResult[] {
  const output = execFileSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', CHILD_SCRIPT, ENGINE_MODULE_PATH, ...filePaths],
    { cwd: CORE_PACKAGE_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 },
  )
  return JSON.parse(output) as ChildResult[]
}

function expectOk(result: ChildResult): DocumentEngineResult {
  if (!result.ok) throw new Error(`[internal] extraction failed: ${result.name ?? 'unknown'}`)
  return documentEngineResultSchema.parse(result.result)
}

describe('pdf layout engine on synthesized PDFs (real pdfjs)', () => {
  let rulebook: DocumentEngineResult
  let plain: DocumentEngineResult
  let notPdf: ChildResult

  beforeAll(async () => {
    const rulebookPath = writeFixture('rulebook.pdf', await buildRulebookPdf())
    const plainPath = writeFixture('plain.pdf', await buildPlainPdf())
    const notPdfPath = writeFixture('broken.pdf', new TextEncoder().encode('not a pdf at all'))
    const [rulebookResult, plainResult, brokenResult] = extractInChildProcess([rulebookPath, plainPath, notPdfPath])
    rulebook = expectOk(rulebookResult)
    plain = expectOk(plainResult)
    notPdf = brokenResult
  }, 90_000)

  it('records page count, per-page char counts and OCR candidate pages', () => {
    expect(rulebook.pageCount).toBe(4)
    expect(rulebook.pageCharCounts).toHaveLength(4)
    expect(rulebook.pageCharCounts[0]).toBeGreaterThan(100)
    expect(rulebook.pageCharCounts[1]).toBeGreaterThan(100)
    expect(rulebook.pageCharCounts[2]).toBe(0)
    expect(rulebook.unreadablePages).toEqual([3])
    expect(rulebook.ocrPageCount).toBe(0)
  })

  it('carries font size and weight hints on heading blocks', () => {
    const chapter = rulebook.blocks.find((block) => block.text === 'Chapter 1 General Provisions')
    const clause = rulebook.blocks.find((block) => block.text === '1.1 Scope')
    const body = rulebook.blocks.find((block) => block.text.startsWith('These rules apply'))
    expect(chapter).toMatchObject({ page: 1, source: 'text_layer', fontSize: 18, bold: true })
    expect(clause).toMatchObject({ page: 1, fontSize: 13, bold: true })
    expect(body).toMatchObject({ page: 1, fontSize: BODY_SIZE, bold: false })
    expect(body?.text.split('\n')).toHaveLength(3)
  })

  it('splits numbered points into their own blocks', () => {
    const pageOne = rulebook.blocks.filter((block) => block.page === 1).map((block) => block.text.split('\n')[0])
    expect(pageOne).toEqual([
      RUNNING_HEADER,
      'Chapter 1 General Provisions',
      '1.1 Scope',
      'These rules apply to every synthetic document that the engine',
      '1.2 Definitions',
      'The following terms are used throughout this rulebook:',
      '(a) a block is a run of lines that belong together;',
      '(b) a line is a run of text items that share a baseline.',
      'Page 1',
    ])
  })

  it('reads a two-column page left column first', () => {
    const pageTwo = rulebook.blocks.filter((block) => block.page === 2).map((block) => block.text)
    expect(pageTwo).toEqual([
      RUNNING_HEADER,
      'Chapter 2 Two Column Layout Rules',
      '2.1 Left column rule',
      'Text in the left column is read\nbefore any text in the right\ncolumn of the same page.',
      '2.2 Right column rule',
      'Text in the right column is read\nafter the left column even when\nthe baselines line up exactly.',
      'Page 2',
    ])
  })

  it('reads the document outline with resolved pages and depths', () => {
    expect(rulebook.outline).toEqual([
      { title: 'Chapter 1 General Provisions', depth: 1, page: 1 },
      { title: '1.1 Scope', depth: 2, page: 1 },
      { title: '1.2 Definitions', depth: 2, page: 1 },
      { title: 'Chapter 2 Two Column Layout Rules', depth: 1, page: 2 },
      { title: 'Chapter 3 Final Provisions', depth: 1, page: 4 },
    ])
  })

  it('separates paragraphs on a vertical gap and reports no outline when absent', () => {
    expect(plain.outline).toEqual([])
    expect(plain.unreadablePages).toEqual([])
    expect(plain.blocks.map((block) => block.text.split('\n').length)).toEqual([2, 2])
  })

  it('surfaces a non-PDF payload as an extraction error', () => {
    expect(notPdf.ok).toBe(false)
  })

  it('structures the rulebook end to end into the golden outline', () => {
    const structured = structureDocument(rulebook, { engine: 'pdf_layout', engineVersion: 1 })
    expect(structured.status).toBe('partial')
    expect(structured.pageCount).toBe(4)
    const outline = structured.sections
      .filter((section) => section.kind !== 'paragraph')
      .map((section) => [section.depth, section.kind, section.numberLabel, section.heading, section.pageStart])
    expect(outline).toEqual([
      [0, 'document', null, null, null],
      [1, 'chapter', 'Chapter 1', 'General Provisions', 1],
      [2, 'clause', '1.1', 'Scope', 1],
      [2, 'clause', '1.2', 'Definitions', 1],
      [3, 'list_item', '(a)', null, 1],
      [3, 'list_item', '(b)', null, 1],
      [1, 'chapter', 'Chapter 2', 'Two Column Layout Rules', 2],
      [2, 'clause', '2.1', 'Left column rule', 2],
      [2, 'clause', '2.2', 'Right column rule', 2],
      [3, 'page_unreadable', null, null, 3],
      [1, 'chapter', 'Chapter 3', 'Final Provisions', 4],
      [2, 'clause', '3.1', 'Entry into force', 4],
    ])
    expect(structured.normalizedText).not.toContain(RUNNING_HEADER)
    expect(structured.normalizedText).not.toContain('Page 1')
  })
})

function run(text: string, x: number, y: number, fontSize = BODY_SIZE, bold = false): PdfLayoutTextRun {
  return { text, x, y, width: text.length * fontSize * 0.5, fontSize, bold }
}

function page(runs: PdfLayoutTextRun[], pageNumber = 1): PdfLayoutPage {
  return { pageNumber, width: PAGE_WIDTH, height: PAGE_HEIGHT, runs }
}

function fakeSource(pages: PdfLayoutPage[], overrides: Partial<PdfLayoutSource> = {}): PdfLayoutSource {
  return {
    numPages: pages.length,
    readPage: async (pageNumber) => pages[pageNumber - 1],
    readOutline: async () => [],
    close: async () => undefined,
    ...overrides,
  }
}

describe('layoutPdfPage', () => {
  it('joins text runs on one baseline into a single line with word spacing', () => {
    const blocks = layoutPdfPage(page([run('Hello', 72, 100), run('world', 72 + 5 * 5.5 + 3, 100.5)]))
    expect(blocks).toEqual([
      expect.objectContaining({ text: 'Hello world', page: 1, source: 'text_layer', fontSize: BODY_SIZE, bold: false }),
    ])
  })

  it('starts a new block on a first-line indent after a short line', () => {
    const blocks = layoutPdfPage(
      page([
        run('A long first paragraph line that fills the column width', 72, 100),
        run('ends short.', 72, 100 + BODY_LEADING),
        run('An indented new paragraph begins here and runs on', 100, 100 + BODY_LEADING * 2),
        run('with a continuation line back at the margin.', 72, 100 + BODY_LEADING * 3),
      ]),
    )
    expect(blocks.map((block) => block.text.split('\n').length)).toEqual([2, 2])
  })

  it('keeps hanging-indent continuation lines in the same block', () => {
    const blocks = layoutPdfPage(
      page([
        run('(a) a point whose text is long enough to wrap onto', 72, 100),
        run('a continuation line indented under the text', 90, 100 + BODY_LEADING),
      ]),
    )
    expect(blocks).toHaveLength(1)
  })

  it('splits blocks on font size and weight changes', () => {
    const blocks = layoutPdfPage(
      page([
        run('Heading', 72, 100, 16, true),
        run('Body text right under the heading', 72, 100 + 17),
      ]),
    )
    expect(blocks.map((block) => [block.fontSize, block.bold])).toEqual([[16, true], [BODY_SIZE, false]])
  })

  it('returns no blocks for a page without text', () => {
    expect(layoutPdfPage(page([run('   ', 72, 100)]))).toEqual([])
  })
})

describe('pdf layout engine', () => {
  const envKeys = ['OM_ATTACHMENT_STRUCTURE_MAX_PAGES', 'OM_ATTACHMENT_STRUCTURE_OCR_MIN_CHARS_PER_PAGE'] as const
  const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
  })

  function pdfFile(name = 'input.pdf'): string {
    const filePath = path.join(workDir, name)
    writeFileSync(filePath, '%PDF-1.7 placeholder')
    return filePath
  }

  it('supports PDF by mime type or extension only', () => {
    const engine = createPdfLayoutEngine({ loadSource: async () => fakeSource([]) })
    expect(engine.id).toBe('pdf_layout')
    expect(engine.supports('application/pdf')).toBe(true)
    expect(engine.supports('Application/PDF; charset=binary')).toBe(true)
    expect(engine.supports('application/octet-stream', '.PDF')).toBe(true)
    expect(engine.supports('text/plain', 'txt')).toBe(false)
    expect(engine.supports('image/png')).toBe(false)
  })

  it('reads env caps with defaults', () => {
    delete process.env.OM_ATTACHMENT_STRUCTURE_MAX_PAGES
    delete process.env.OM_ATTACHMENT_STRUCTURE_OCR_MIN_CHARS_PER_PAGE
    expect(resolveMaxDocumentStructurePages()).toBe(1000)
    expect(resolveOcrMinCharsPerPage()).toBe(40)
    process.env.OM_ATTACHMENT_STRUCTURE_MAX_PAGES = '25'
    process.env.OM_ATTACHMENT_STRUCTURE_OCR_MIN_CHARS_PER_PAGE = '0'
    expect(resolveMaxDocumentStructurePages()).toBe(25)
    expect(resolveOcrMinCharsPerPage()).toBe(0)
    process.env.OM_ATTACHMENT_STRUCTURE_MAX_PAGES = 'nope'
    expect(resolveMaxDocumentStructurePages()).toBe(1000)
  })

  it('stops at the page cap and the requested page limit', async () => {
    const pages = [1, 2, 3, 4, 5].map((pageNumber) =>
      page([run(`Page body number ${pageNumber} with enough characters to be readable`, 72, 100)], pageNumber),
    )
    const readPage = jest.fn(async (pageNumber: number) => pages[pageNumber - 1])
    const close = jest.fn(async () => undefined)
    const engine = createPdfLayoutEngine({
      loadSource: async () => fakeSource(pages, { readPage, close }),
      maxPages: () => 3,
    })
    const capped = await engine.extract({ filePath: pdfFile(), mimeType: 'application/pdf' })
    expect(capped.pageCount).toBe(5)
    expect(capped.pageCharCounts).toHaveLength(3)
    expect(readPage).toHaveBeenCalledTimes(3)
    expect(close).toHaveBeenCalledTimes(1)
    const requested = await engine.extract({ filePath: pdfFile(), mimeType: 'application/pdf', maxPages: 2 })
    expect(requested.pageCharCounts).toHaveLength(2)
  })

  it('stops reading pages once the extraction signal is aborted', async () => {
    const pages = [1, 2, 3].map((pageNumber) =>
      page([run(`Page body number ${pageNumber} with enough characters to be readable`, 72, 100)], pageNumber),
    )
    const controller = new AbortController()
    const readPage = jest.fn(async (pageNumber: number) => {
      if (pageNumber === 1) controller.abort()
      return pages[pageNumber - 1]
    })
    const close = jest.fn(async () => undefined)
    const engine = createPdfLayoutEngine({ loadSource: async () => fakeSource(pages, { readPage, close }) })

    await expect(
      engine.extract({ filePath: pdfFile(), mimeType: 'application/pdf', signal: controller.signal }),
    ).rejects.toBeInstanceOf(DocumentStructureAbortedError)
    expect(readPage).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('marks pages under the OCR threshold as unreadable candidates', async () => {
    const engine = createPdfLayoutEngine({
      loadSource: async () =>
        fakeSource([
          page([run('Short', 72, 100)], 1),
          page([run('A page with a comfortably long text layer of words', 72, 100)], 2),
          page([], 3),
        ]),
      ocrMinCharsPerPage: () => 10,
    })
    const result = await engine.extract({ filePath: pdfFile(), mimeType: 'application/pdf' })
    expect(result.pageCharCounts).toEqual([5, 41, 0])
    expect(result.unreadablePages).toEqual([1, 3])
  })

  it('maps password-protected PDFs to the encrypted_pdf skip reason', async () => {
    const passwordError = Object.assign(new Error('No password given'), { name: 'PasswordException' })
    expect(isPdfPasswordError(passwordError)).toBe(true)
    expect(isPdfPasswordError(new Error('Invalid PDF structure'))).toBe(false)
    expect(isPdfPasswordError(null)).toBe(false)
    const engine = createPdfLayoutEngine({
      loadSource: async () => {
        throw new DocumentStructurePdfEncryptedError()
      },
    })
    await expect(engine.extract({ filePath: pdfFile(), mimeType: 'application/pdf' })).rejects.toMatchObject({
      code: 'encrypted_pdf',
    })
  })

  it('refuses files above the byte cap before loading them', async () => {
    const loadSource = jest.fn(async () => fakeSource([]))
    const engine = createPdfLayoutEngine({ loadSource, maxBytes: () => 4 })
    await expect(engine.extract({ filePath: pdfFile(), mimeType: 'application/pdf' })).rejects.toBeInstanceOf(
      DocumentStructureFileTooLargeError,
    )
    expect(loadSource).not.toHaveBeenCalled()
  })

  it('closes the source when a page fails to load', async () => {
    const close = jest.fn(async () => undefined)
    const engine = createPdfLayoutEngine({
      loadSource: async () =>
        fakeSource([page([], 1)], {
          readPage: async () => {
            throw new Error('[internal] broken page')
          },
          close,
        }),
    })
    await expect(engine.extract({ filePath: pdfFile(), mimeType: 'application/pdf' })).rejects.toThrow('broken page')
    expect(close).toHaveBeenCalledTimes(1)
  })
})
