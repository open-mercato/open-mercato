import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

jest.mock('child_process', () => ({
  execFile: jest.fn(),
}))

const mockExecFile = jest.requireMock('child_process').execFile as jest.Mock

async function writeTempFile(name: string, content: string): Promise<string> {
  const filePath = join(tmpdir(), name)
  await fs.writeFile(filePath, content, 'utf8')
  return filePath
}

describe('extractAttachmentContent', () => {
  afterEach(() => {
    mockExecFile.mockReset()
    jest.resetModules()
  })

  it('runs markitdown for non-image files and returns text', async () => {
    const filePath = await writeTempFile('sample.txt', 'hello world')
    mockExecFile.mockImplementation((_bin, _args, cb) => cb(null, 'converted text'))
    const { extractAttachmentContent } = await import('../textExtraction')
    const result = await extractAttachmentContent({ filePath, mimeType: 'text/plain' })
    expect(mockExecFile).toHaveBeenCalled()
    expect(result).toBe('converted text')
  })

  it('skips extraction for images', async () => {
    const filePath = await writeTempFile('image.png', 'binary')
    const { extractAttachmentContent } = await import('../textExtraction')
    const result = await extractAttachmentContent({ filePath, mimeType: 'image/png' })
    expect(mockExecFile).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('returns null when markitdown fails', async () => {
    const filePath = await writeTempFile('doc.pdf', 'pdf')
    mockExecFile.mockImplementation((_bin, _args, cb) => cb(new Error('boom')))
    const { extractAttachmentContent } = await import('../textExtraction')
    const result = await extractAttachmentContent({ filePath, mimeType: 'application/pdf' })
    expect(mockExecFile).toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('allows markitdown for supported office/pdf/outlook types', async () => {
    const filePath = await writeTempFile('slides.pptx', 'content')
    mockExecFile.mockImplementation((_bin, _args, cb) => cb(null, 'converted text'))
    const { extractAttachmentContent } = await import('../textExtraction')
    const result = await extractAttachmentContent({ filePath, mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
    expect(mockExecFile).toHaveBeenCalled()
    expect(result).toBe('converted text')
  })

  it('skips unsupported binary mime types', async () => {
    const filePath = await writeTempFile('binary.bin', 'bin')
    const { extractAttachmentContent } = await import('../textExtraction')
    const result = await extractAttachmentContent({ filePath, mimeType: 'application/x-custom-binary' })
    expect(mockExecFile).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })
})
