import { promises as fs } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'

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

  it('extracts DOC content via mammoth when MIME type is application/msword', async () => {
    getMammothMock().extractRawText.mockResolvedValue({ value: 'doc text' })
    const filePath = await writeTempFile('legacy.doc', 'placeholder')
    const { extractAttachmentContent } = await import('../textExtraction')
    const result = await extractAttachmentContent({ filePath, mimeType: 'application/msword' })
    expect(getMammothMock().extractRawText).toHaveBeenCalledWith({ path: filePath })
    expect(result).toBe('doc text')
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
    const mockPage = {
      getTextContent: jest.fn().mockResolvedValue({ items: [{ str: 'hello' }, { str: ' pdf' }] }),
      cleanup: jest.fn(),
    }
    const mockPdfDoc = {
      numPages: 1,
      getPage: jest.fn().mockResolvedValue(mockPage),
      destroy: jest.fn().mockResolvedValue(undefined),
    }
    getPdfMock().getDocument.mockReturnValue({ promise: Promise.resolve(mockPdfDoc) })

    const filePath = await writeTempFile('file.pdf', '%PDF-1.4 placeholder')
    const { extractAttachmentContent } = await import('../textExtraction')
    const result = await extractAttachmentContent({ filePath, mimeType: 'application/pdf' })
    expect(getPdfMock().getDocument).toHaveBeenCalled()
    expect(result).toContain('hello')
    expect(result).toContain('pdf')
    expect(getMammothMock().extractRawText).not.toHaveBeenCalled()
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
