import { promises as fs } from 'fs'
import { join, resolve, sep } from 'path'
import { tmpdir } from 'os'
import { buildWorkbook } from '../../__integration__/helpers/xlsxWorkbook'

// Mock mammoth for DOCX extraction tests.
jest.mock('mammoth', () => ({
  extractRawText: jest.fn().mockResolvedValue({ value: '' }),
}))

// Mock pdfjs-dist for PDF extraction tests.
// The mock must cover both the dynamic import path and the module resolve call
// used at module initialisation to locate CMap/font data.
jest.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: jest.fn(),
}))

async function writeTempFile(name: string, content: string): Promise<string> {
  const filePath = join(tmpdir(), name)
  await fs.writeFile(filePath, content, 'utf8')
  return filePath
}

async function writeTempWorkbook(name: string, rows: string[][]): Promise<string> {
  const filePath = join(tmpdir(), name)
  await fs.writeFile(filePath, await buildWorkbook([{ name: 'Oferta', rows }]))
  return filePath
}

const extractionSources = ['../textExtraction.ts', '../spreadsheetText.ts']

// ────────────────────────────────────────────────────────────────────────────
// REGRESSION GUARD — source must not reference child_process or markitdown
// ────────────────────────────────────────────────────────────────────────────
describe('textExtraction — HUNT-PARSER-01 regression guard', () => {
  it.each(extractionSources)('%s does not import child_process', async (sourcePath) => {
    const source = await fs.readFile(resolve(__dirname, sourcePath), 'utf8')
    // Must not have an import or require statement for child_process.
    // (The module may have comments mentioning it — only imports matter.)
    expect(source).not.toMatch(/from ['"]child_process['"]/)
    expect(source).not.toMatch(/require\(['"]child_process['"]\)/)
  })

  it.each(extractionSources)('%s does not reference markitdown binary', async (sourcePath) => {
    const source = await fs.readFile(resolve(__dirname, sourcePath), 'utf8')
    expect(source).not.toContain('markitdown')
  })

  it.each(extractionSources)('%s does not reference execFile or execFileAsync', async (sourcePath) => {
    const source = await fs.readFile(resolve(__dirname, sourcePath), 'utf8')
    expect(source).not.toContain('execFile')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// SPREADSHEET LIBRARY BOUNDARY — one runtime importer, one test fixture builder
// ────────────────────────────────────────────────────────────────────────────
const coreSourceRoot = resolve(__dirname, '../../../..')
const spreadsheetLibraryImporters = [
  'modules/attachments/__integration__/helpers/xlsxWorkbook.ts',
  'modules/attachments/lib/spreadsheetText.ts',
]
const spreadsheetLibraryImport = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]hucre(?:\/[^'"]*)?['"]/

describe('spreadsheet library boundary', () => {
  it('is imported only by the spreadsheet text wrapper and the workbook fixture builder', async () => {
    const entries = await fs.readdir(coreSourceRoot, { recursive: true })
    const importers: string[] = []
    for (const entry of entries) {
      if (!/\.(?:ts|tsx|mts|cts)$/.test(entry)) continue
      const source = await fs.readFile(join(coreSourceRoot, entry), 'utf8')
      if (spreadsheetLibraryImport.test(source)) importers.push(entry.split(sep).join('/'))
    }
    expect(importers.sort()).toEqual(spreadsheetLibraryImporters)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Extraction behaviour
// ────────────────────────────────────────────────────────────────────────────
describe('extractAttachmentContent', () => {
  const getMammothMock = () => jest.requireMock<{ extractRawText: jest.Mock }>('mammoth')
  const getPdfMock = () => jest.requireMock<{ getDocument: jest.Mock }>('pdfjs-dist/legacy/build/pdf.mjs')

  afterEach(() => {
    getMammothMock().extractRawText.mockReset()
    getPdfMock().getDocument.mockReset()
  })

  it('returns null for image MIME types without any extraction', async () => {
    const { extractAttachmentContent } = await import('../textExtraction')
    const filePath = await writeTempFile('photo.png', 'binary')
    const result = await extractAttachmentContent({ filePath, mimeType: 'image/png' })
    expect(result).toBeNull()
    expect(getMammothMock().extractRawText).not.toHaveBeenCalled()
  })

  it('reads plain text files directly from disk — no shell-out', async () => {
    const { extractAttachmentContent } = await import('../textExtraction')
    const filePath = await writeTempFile('readme.txt', 'hello world')
    const result = await extractAttachmentContent({ filePath, mimeType: 'text/plain' })
    expect(result).toBe('hello world')
    expect(getMammothMock().extractRawText).not.toHaveBeenCalled()
  })

  it('reads text/csv directly — no shell-out', async () => {
    const { extractAttachmentContent } = await import('../textExtraction')
    const filePath = await writeTempFile('data.csv', 'a,b\n1,2')
    const result = await extractAttachmentContent({ filePath, mimeType: 'text/csv' })
    expect(result).toBe('a,b\n1,2')
    expect(getMammothMock().extractRawText).not.toHaveBeenCalled()
  })

  it('extracts DOCX content via mammoth (pure-JS) — HUNT-PARSER-01 marker path', async () => {
    getMammothMock().extractRawText.mockResolvedValue({ value: 'HUNT-PARSER-01-MARKER extracted text' })
    const filePath = await writeTempFile('document.docx', 'placeholder')
    const { extractAttachmentContent } = await import('../textExtraction')
    const result = await extractAttachmentContent({
      filePath,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    expect(getMammothMock().extractRawText).toHaveBeenCalledWith({ path: filePath })
    expect(result).toBe('HUNT-PARSER-01-MARKER extracted text')
  })

  it('returns null for legacy .doc — mammoth does not support binary Word format', async () => {
    const filePath = await writeTempFile('legacy.doc', 'placeholder')
    const { extractAttachmentContent } = await import('../textExtraction')
    const result = await extractAttachmentContent({ filePath, mimeType: 'application/msword' })
    expect(result).toBeNull()
    expect(getMammothMock().extractRawText).not.toHaveBeenCalled()
  })

  it('returns null for .doc by extension regardless of mime type', async () => {
    const filePath = await writeTempFile('legacy2.doc', 'placeholder')
    const { extractAttachmentContent } = await import('../textExtraction')
    const result = await extractAttachmentContent({ filePath, mimeType: 'application/vnd.ms-word' })
    expect(result).toBeNull()
    expect(getMammothMock().extractRawText).not.toHaveBeenCalled()
  })

  it('returns null when mammoth returns empty string for DOCX', async () => {
    getMammothMock().extractRawText.mockResolvedValue({ value: '   ' })
    const filePath = await writeTempFile('empty.docx', 'placeholder')
    const { extractAttachmentContent } = await import('../textExtraction')
    const result = await extractAttachmentContent({
      filePath,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    expect(result).toBeNull()
  })

  it('returns null when mammoth throws — does not propagate', async () => {
    getMammothMock().extractRawText.mockRejectedValue(new Error('corrupt docx'))
    const filePath = await writeTempFile('bad.docx', 'placeholder')
    const { extractAttachmentContent } = await import('../textExtraction')
    const result = await extractAttachmentContent({
      filePath,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    expect(result).toBeNull()
  })

  it('extracts XLSX content in-process — no shell-out', async () => {
    const filePath = await writeTempWorkbook('sheet.xlsx', [['Indeks', 'Cena'], ['CEM-42', '23.50']])
    const { extractAttachmentContent } = await import('../textExtraction')
    const result = await extractAttachmentContent({
      filePath,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    expect(result).toBe('## Oferta\nIndeks\tCena\nCEM-42\t23.50')
    expect(getMammothMock().extractRawText).not.toHaveBeenCalled()
  })

  it('detects macro-enabled workbooks by extension when the MIME type is generic', async () => {
    const filePath = await writeTempWorkbook('sheet.xlsm', [['makro']])
    const { extractAttachmentContent } = await import('../textExtraction')
    const result = await extractAttachmentContent({ filePath, mimeType: 'application/octet-stream' })
    expect(result).toBe('## Oferta\nmakro')
  })

  it('applies OM_ATTACHMENT_SPREADSHEET_MAX_SHEETS to XLSX extraction', async () => {
    process.env.OM_ATTACHMENT_SPREADSHEET_MAX_SHEETS = '1'
    try {
      const filePath = join(tmpdir(), 'two-sheets.xlsx')
      await fs.writeFile(
        filePath,
        await buildWorkbook([{ name: 'Pierwszy', rows: [['1']] }, { name: 'Drugi', rows: [['2']] }]),
      )
      const { extractAttachmentContent } = await import('../textExtraction')
      const result = await extractAttachmentContent({ filePath, mimeType: null })
      expect(result).toBe('## Pierwszy\n1')
    } finally {
      delete process.env.OM_ATTACHMENT_SPREADSHEET_MAX_SHEETS
    }
  })

  it('returns null for a corrupt XLSX — does not propagate', async () => {
    const filePath = await writeTempFile('corrupt.xlsx', 'placeholder')
    const { extractAttachmentContent } = await import('../textExtraction')
    const result = await extractAttachmentContent({
      filePath,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    expect(result).toBeNull()
  })

  it.each([
    ['legacy.xls', 'application/vnd.ms-excel'],
    ['binary.xlsb', 'application/vnd.ms-excel.sheet.binary.macroenabled.12'],
    ['open.ods', 'application/vnd.oasis.opendocument.spreadsheet'],
  ])('returns null for %s — not yet supported, no shell-out', async (name, mimeType) => {
    const filePath = await writeTempFile(name, 'placeholder')
    const { extractAttachmentContent } = await import('../textExtraction')
    const result = await extractAttachmentContent({ filePath, mimeType })
    expect(result).toBeNull()
  })

  it('returns null for PPTX — no safe extractor, no shell-out', async () => {
    const { extractAttachmentContent } = await import('../textExtraction')
    const filePath = await writeTempFile('slides.pptx', 'placeholder')
    const result = await extractAttachmentContent({
      filePath,
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    })
    expect(result).toBeNull()
    expect(getMammothMock().extractRawText).not.toHaveBeenCalled()
  })

  it('returns null for MSG (Outlook) — no safe extractor, no shell-out', async () => {
    const { extractAttachmentContent } = await import('../textExtraction')
    const filePath = await writeTempFile('email.msg', 'placeholder')
    const result = await extractAttachmentContent({ filePath, mimeType: 'application/vnd.ms-outlook' })
    expect(result).toBeNull()
    expect(getMammothMock().extractRawText).not.toHaveBeenCalled()
  })

  it('returns null for unknown binary MIME types', async () => {
    const { extractAttachmentContent } = await import('../textExtraction')
    const filePath = await writeTempFile('binary.bin', 'some bytes')
    const result = await extractAttachmentContent({ filePath, mimeType: 'application/x-custom-binary' })
    expect(result).toBeNull()
    expect(getMammothMock().extractRawText).not.toHaveBeenCalled()
  })

  it('extracts PDF text via pdfjs-dist — no shell-out', async () => {
    const mockPage = {
      getTextContent: jest.fn().mockResolvedValue({ items: [{ str: 'hello' }, { str: ' pdf' }] }),
      cleanup: jest.fn(),
    }
    const mockPdfDoc = {
      numPages: 1,
      getPage: jest.fn().mockResolvedValue(mockPage),
    }
    getPdfMock().getDocument.mockReturnValue({
      promise: Promise.resolve(mockPdfDoc),
      destroy: jest.fn().mockResolvedValue(undefined),
    })

    const filePath = await writeTempFile('file.pdf', '%PDF-1.4 placeholder')
    const { extractAttachmentContent } = await import('../textExtraction')
    const result = await extractAttachmentContent({ filePath, mimeType: 'application/pdf' })
    expect(getPdfMock().getDocument).toHaveBeenCalled()
    expect(result).toContain('hello')
    expect(result).toContain('pdf')
    expect(getMammothMock().extractRawText).not.toHaveBeenCalled()
  })

  it('caps PDF page iteration at OM_ATTACHMENT_OCR_MAX_PAGES', async () => {
    process.env.OM_ATTACHMENT_OCR_MAX_PAGES = '2'
    const mockPage = {
      getTextContent: jest.fn().mockResolvedValue({ items: [{ str: 'page' }] }),
      cleanup: jest.fn(),
    }
    const getPage = jest.fn().mockResolvedValue(mockPage)
    getPdfMock().getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 9, getPage }),
      destroy: jest.fn().mockResolvedValue(undefined),
    })

    const filePath = await writeTempFile('long.pdf', '%PDF-1.4 placeholder')
    const { extractAttachmentContent } = await import('../textExtraction')
    await extractAttachmentContent({ filePath, mimeType: 'application/pdf' })
    expect(getPage).toHaveBeenCalledTimes(2)
    expect(getPage).toHaveBeenCalledWith(1)
    expect(getPage).toHaveBeenCalledWith(2)
    delete process.env.OM_ATTACHMENT_OCR_MAX_PAGES
  })

  it('returns null when PDF pdfjs extraction fails — does not propagate', async () => {
    // Create a lazily-rejected promise to avoid an unhandled-rejection warning
    // before the implementation's try/catch can attach its handler.
    getPdfMock().getDocument.mockImplementation(() => {
      const rejection = new Promise<never>((_, reject) =>
        queueMicrotask(() => reject(new Error('corrupt pdf'))),
      )
      return { promise: rejection }
    })
    const filePath = await writeTempFile('bad.pdf', 'not a pdf')
    const { extractAttachmentContent } = await import('../textExtraction')
    const result = await extractAttachmentContent({ filePath, mimeType: 'application/pdf' })
    expect(result).toBeNull()
  })
})
