/** @jest-environment node */
import {
  getAttachmentExtension,
  hasDangerousExecutableExtension,
  sanitizeUploadedFileName,
} from '@open-mercato/core/modules/attachments/lib/security'

describe('hasDangerousExecutableExtension', () => {
  it('flags files whose final extension is executable', () => {
    expect(hasDangerousExecutableExtension('malware.exe')).toBe(true)
    expect(hasDangerousExecutableExtension('script.BAT')).toBe(true)
    expect(hasDangerousExecutableExtension('setup.msi')).toBe(true)
    expect(hasDangerousExecutableExtension('macro.vbs')).toBe(true)
  })

  it('flags double-extension payloads where the final extension is executable', () => {
    expect(hasDangerousExecutableExtension('faktura.pdf.exe')).toBe(true)
    expect(hasDangerousExecutableExtension('invoice.PDF.EXE')).toBe(true)
    expect(hasDangerousExecutableExtension('contract.docx.js')).toBe(true)
  })

  it('flags files that hide an executable segment before a seemingly safe extension', () => {
    expect(hasDangerousExecutableExtension('report.exe.pdf')).toBe(true)
    expect(hasDangerousExecutableExtension('archive.bat.zip')).toBe(true)
  })

  it('does not flag legitimate filenames', () => {
    expect(hasDangerousExecutableExtension('doc.pdf')).toBe(false)
    expect(hasDangerousExecutableExtension('photo.jpeg')).toBe(false)
    expect(hasDangerousExecutableExtension('report.final.pdf')).toBe(false)
    expect(hasDangerousExecutableExtension('notes.docx')).toBe(false)
    expect(hasDangerousExecutableExtension('archive.tar.gz')).toBe(false)
  })

  it('returns false for empty or extensionless inputs', () => {
    expect(hasDangerousExecutableExtension('')).toBe(false)
    expect(hasDangerousExecutableExtension(null)).toBe(false)
    expect(hasDangerousExecutableExtension(undefined)).toBe(false)
    expect(hasDangerousExecutableExtension('README')).toBe(false)
    expect(hasDangerousExecutableExtension('   ')).toBe(false)
  })

  it('does not rely on MIME type — detection is filename-only', () => {
    expect(hasDangerousExecutableExtension('faktura.pdf.exe')).toBe(true)
  })

  it('remains aligned with filename sanitization', () => {
    const raw = 'faktura.pdf.exe'
    expect(hasDangerousExecutableExtension(raw)).toBe(true)
    expect(sanitizeUploadedFileName(raw)).toBe('faktura_pdf.exe')
    expect(getAttachmentExtension(sanitizeUploadedFileName(raw))).toBe('exe')
  })
})
