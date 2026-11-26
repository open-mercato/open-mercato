import { promises as fs } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import JSZip from 'jszip'

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

let fixtureDir: string

beforeEach(async () => {
  jest.replaceProperty(process, 'env', { ...process.env })
  fixtureDir = await fs.mkdtemp(join(tmpdir(), 'om-attachment-extraction-'))
})

afterEach(async () => {
  jest.restoreAllMocks()
  await fs.rm(fixtureDir, { recursive: true, force: true })
})

async function writeTempFile(name: string, content: string | Buffer): Promise<string> {
  const filePath = join(fixtureDir, name)
  await fs.writeFile(filePath, content)
  return filePath
}

function docxArchive(content = '<document/>'): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('word/document.xml', content)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

function mockPdfPage(...items: Array<{ str: string }>) {
  const reader = {
    read: jest.fn().mockResolvedValue({ done: true }).mockResolvedValueOnce({ done: false, value: { items } }),
    cancel: jest.fn().mockResolvedValue(undefined),
  }
  return {
    reader,
    streamTextContent: jest.fn().mockReturnValue({ getReader: () => reader }),
    cleanup: jest.fn(),
  }
}

// ────────────────────────────────────────────────────────────────────────────
// REGRESSION GUARD — source must not reference child_process or markitdown
// ────────────────────────────────────────────────────────────────────────────
describe('textExtraction — HUNT-PARSER-01 regression guard', () => {
  it('does not import child_process', async () => {
    const source = await fs.readFile(
      resolve(__dirname, '../textExtraction.ts'),
      'utf8',
    )
    // Must not have an import or require statement for child_process.
    // (The module may have comments mentioning it — only imports matter.)
    expect(source).not.toMatch(/from ['"]child_process['"]/)
    expect(source).not.toMatch(/require\(['"]child_process['"]\)/)
  })

  it('does not reference markitdown binary', async () => {
    const source = await fs.readFile(
      resolve(__dirname, '../textExtraction.ts'),
      'utf8',
    )
    expect(source).not.toContain('markitdown')
  })

  it('does not reference execFile or execFileAsync', async () => {
    const source = await fs.readFile(
      resolve(__dirname, '../textExtraction.ts'),
      'utf8',
    )
    expect(source).not.toContain('execFile')
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

  it('strips U+0000 from plain text and keeps every other character', async () => {
    const { extractAttachmentContent } = await import('../textExtraction')
    const filePath = await writeTempFile('nul.txt', 'AB\u0000C\n\tzażółć\u0001 \u0000')
    const result = await extractAttachmentContent({ filePath, mimeType: 'text/plain' })
    expect(result).toBe('ABC\n\tzażółć\u0001')
  })

  it('returns null when plain text holds nothing but U+0000 and whitespace', async () => {
    const { extractAttachmentContent } = await import('../textExtraction')
    const filePath = await writeTempFile('only-nul.txt', ' \u0000\u0000\n')
    const result = await extractAttachmentContent({ filePath, mimeType: 'text/plain' })
    expect(result).toBeNull()
  })

  it('strips U+0000 from the PDF text layer', async () => {
    const mockPage = mockPdfPage({ str: 'Ty\u0000pe3' }, { str: '\u0000font' })
    getPdfMock().getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage: jest.fn().mockResolvedValue(mockPage) }),
      destroy: jest.fn().mockResolvedValue(undefined),
    })
    const filePath = await writeTempFile('nul.pdf', '%PDF-1.4 placeholder')
    const { extractAttachmentContent } = await import('../textExtraction')
    const result = await extractAttachmentContent({ filePath, mimeType: 'application/pdf' })
    expect(result).toBe('Type3 font')
  })

  it('strips U+0000 from DOCX text', async () => {
    getMammothMock().extractRawText.mockResolvedValue({ value: 'wo\u0000rd\u0000' })
    const filePath = await writeTempFile('nul.docx', await docxArchive())
    const { extractAttachmentContent } = await import('../textExtraction')
    const result = await extractAttachmentContent({
      filePath,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    expect(result).toBe('word')
  })

  it('extracts DOCX content via mammoth (pure-JS) — HUNT-PARSER-01 marker path', async () => {
    getMammothMock().extractRawText.mockResolvedValue({ value: 'HUNT-PARSER-01-MARKER extracted text' })
    const filePath = await writeTempFile('document.docx', await docxArchive())
    const { extractAttachmentContent } = await import('../textExtraction')
    const result = await extractAttachmentContent({
      filePath,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    expect(getMammothMock().extractRawText).toHaveBeenCalledWith({ buffer: await fs.readFile(filePath) })
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
    const filePath = await writeTempFile('empty.docx', await docxArchive())
    const { extractAttachmentContent } = await import('../textExtraction')
    const result = await extractAttachmentContent({
      filePath,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    expect(result).toBeNull()
  })

  it('returns null when mammoth throws — does not propagate', async () => {
    getMammothMock().extractRawText.mockRejectedValue(new Error('corrupt docx'))
    const filePath = await writeTempFile('bad.docx', await docxArchive())
    const { extractAttachmentContent } = await import('../textExtraction')
    const result = await extractAttachmentContent({
      filePath,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    expect(result).toBeNull()
  })

  it('returns null for XLSX — no safe extractor, no shell-out', async () => {
    const { extractAttachmentContent } = await import('../textExtraction')
    const filePath = await writeTempFile('sheet.xlsx', 'placeholder')
    const result = await extractAttachmentContent({
      filePath,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    expect(result).toBeNull()
    expect(getMammothMock().extractRawText).not.toHaveBeenCalled()
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
    const mockPage = mockPdfPage({ str: 'hello' }, { str: ' pdf' })
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
    const mockPage = mockPdfPage({ str: 'page' })
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

  it.each(['0.5', '1.5', '0', '-1', 'NaN', 'Infinity', '9007199254740992', ''])(
    'uses default limits for invalid configuration %j',
    async (value) => {
      process.env.OM_ATTACHMENT_TEXT_EXTRACTION_MAX_BYTES = value
      process.env.OM_ATTACHMENT_TEXT_EXTRACTION_MAX_CHARS = value
      const { resolveTextExtractionMaxBytes, resolveTextExtractionMaxChars } = await import('../textExtraction')
      expect(resolveTextExtractionMaxBytes()).toBe(10 * 1024 * 1024)
      expect(resolveTextExtractionMaxChars()).toBe(500_000)
    },
  )

  it.each(['txt', 'pdf', 'docx'])('rejects oversized %s input before parsing', async (extension) => {
    process.env.OM_ATTACHMENT_TEXT_EXTRACTION_MAX_BYTES = '4'
    const filePath = await writeTempFile(`oversized.${extension}`, '12345')
    const { extractAttachmentContent } = await import('../textExtraction')
    await expect(extractAttachmentContent({ filePath })).resolves.toBeNull()
    expect(getPdfMock().getDocument).not.toHaveBeenCalled()
    expect(getMammothMock().extractRawText).not.toHaveBeenCalled()
  })

  it('counts PDF page separators and cancels the current stream when the budget is exhausted', async () => {
    process.env.OM_ATTACHMENT_TEXT_EXTRACTION_MAX_CHARS = '8'
    const firstPage = mockPdfPage({ str: 'first' })
    const secondPage = mockPdfPage({ str: 'second' })
    const getPage = jest.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage)
    const destroy = jest.fn().mockResolvedValue(undefined)
    getPdfMock().getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 3, getPage }), destroy })

    const filePath = await writeTempFile('budget.pdf', '%PDF-1.4 placeholder')
    const { extractAttachmentContent } = await import('../textExtraction')
    await expect(extractAttachmentContent({ filePath })).resolves.toBe('first\nse')
    expect(getPage).toHaveBeenCalledTimes(2)
    expect(secondPage.reader.read).toHaveBeenCalledTimes(1)
    expect(secondPage.reader.cancel).toHaveBeenCalledTimes(1)
    expect(firstPage.cleanup).toHaveBeenCalledTimes(1)
    expect(secondPage.cleanup).toHaveBeenCalledTimes(1)
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('keeps the next PDF page when trailing whitespace fills the current page budget', async () => {
    process.env.OM_ATTACHMENT_TEXT_EXTRACTION_MAX_CHARS = '8'
    const getPage = jest.fn()
      .mockResolvedValueOnce(mockPdfPage({ str: 'first     ' }))
      .mockResolvedValueOnce(mockPdfPage({ str: 'second' }))
    getPdfMock().getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 2, getPage }),
      destroy: jest.fn().mockResolvedValue(undefined),
    })

    const filePath = await writeTempFile('whitespace.pdf', '%PDF-1.4 placeholder')
    const { extractAttachmentContent } = await import('../textExtraction')
    await expect(extractAttachmentContent({ filePath })).resolves.toBe('first\nse')
  })

  it('rejects DOCX input whose expanded size exceeds the limit before invoking Mammoth', async () => {
    const archive = await docxArchive(' '.repeat(1024))
    process.env.OM_ATTACHMENT_TEXT_EXTRACTION_MAX_BYTES = String(archive.length)
    const filePath = await writeTempFile('over-budget.docx', archive)
    const { extractAttachmentContent } = await import('../textExtraction')
    await expect(extractAttachmentContent({ filePath })).resolves.toBeNull()
    expect(getMammothMock().extractRawText).not.toHaveBeenCalled()
  })

  it('counts DOCX expansion across entries', async () => {
    const zip = new JSZip()
    zip.file('word/document.xml', ' '.repeat(512))
    zip.file('word/styles.xml', ' '.repeat(512))
    const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    process.env.OM_ATTACHMENT_TEXT_EXTRACTION_MAX_BYTES = '600'
    const filePath = await writeTempFile('aggregate.docx', archive)
    const { extractAttachmentContent } = await import('../textExtraction')
    await expect(extractAttachmentContent({ filePath })).resolves.toBeNull()
    expect(getMammothMock().extractRawText).not.toHaveBeenCalled()
  })

  it('truncates Mammoth output when a DOCX passes the expanded-input check', async () => {
    process.env.OM_ATTACHMENT_TEXT_EXTRACTION_MAX_CHARS = '4'
    getMammothMock().extractRawText.mockResolvedValue({ value: 'document text' })
    const filePath = await writeTempFile('truncated.docx', await docxArchive())
    const { extractAttachmentContent } = await import('../textExtraction')
    await expect(extractAttachmentContent({ filePath })).resolves.toBe('docu')
  })

  it('returns null when PDF pdfjs extraction fails — does not propagate', async () => {
    const destroy = jest.fn().mockResolvedValue(undefined)
    getPdfMock().getDocument.mockImplementation(() => {
      const rejection = new Promise<never>((_, reject) =>
        queueMicrotask(() => reject(new Error('corrupt pdf'))),
      )
      return { promise: rejection, destroy }
    })
    const filePath = await writeTempFile('bad.pdf', 'not a pdf')
    const { extractAttachmentContent } = await import('../textExtraction')
    const result = await extractAttachmentContent({ filePath, mimeType: 'application/pdf' })
    expect(result).toBeNull()
    expect(destroy).toHaveBeenCalledTimes(1)
  })
})
