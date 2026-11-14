/** @jest-environment node */
import {
  buildAttachmentContentDisposition,
  getAttachmentExtension,
  hasDangerousExecutableExtension,
  sanitizeAttachmentDisplayName,
  sanitizeUploadedFileName,
} from '@open-mercato/core/modules/attachments/lib/security'

const NUL = String.fromCharCode(0)
const TAB = String.fromCharCode(9)
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b)

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

  it('flags executable segments laced with a NUL byte (control-character deny-list bypass)', () => {
    expect(hasDangerousExecutableExtension(`evil.exe${NUL}.png`)).toBe(true)
    expect(hasDangerousExecutableExtension(`payload.${NUL}bat.txt`)).toBe(true)
    expect(hasDangerousExecutableExtension(`shell.s${NUL}h`)).toBe(true)
  })

  it('flags executable segments laced with other control or invisible characters', () => {
    expect(hasDangerousExecutableExtension(`evil.e${TAB}xe.png`)).toBe(true)
    expect(hasDangerousExecutableExtension(`evil.e${ZERO_WIDTH_SPACE}xe.png`)).toBe(true)
  })

  it('flags executable segments with stray non-filename characters between dots', () => {
    expect(hasDangerousExecutableExtension('evil.e!xe.png')).toBe(true)
    expect(hasDangerousExecutableExtension('evil.ex e.png')).toBe(true)
  })

  it('stays aligned with the sanitized filename for control-character payloads', () => {
    const raw = `evil.exe${NUL}.png`
    expect(hasDangerousExecutableExtension(raw)).toBe(true)
    expect(sanitizeUploadedFileName(raw)).toBe('evil_exe.png')
  })
})

describe('sanitizeAttachmentDisplayName (#8727)', () => {
  const RIGHT_TO_LEFT_OVERRIDE = String.fromCharCode(0x202e)

  it('keeps non-ASCII letters and spaces that the storage name replaces', () => {
    expect(sanitizeUploadedFileName('Karta techniczna źródło.pdf')).toBe('Karta_techniczna_r_d_o.pdf')
    expect(sanitizeAttachmentDisplayName('Karta techniczna źródło.pdf')).toBe('Karta techniczna źródło.pdf')
    expect(sanitizeAttachmentDisplayName('Größenübersicht.xlsx')).toBe('Größenübersicht.xlsx')
    expect(sanitizeAttachmentDisplayName('견적서.docx')).toBe('견적서.docx')
  })

  it('normalizes decomposed characters to NFC', () => {
    expect(sanitizeAttachmentDisplayName('z\u0301ro\u0301dło.pdf')).toBe('źródło.pdf')
  })

  it('drops path, control and bidi-override characters', () => {
    expect(sanitizeAttachmentDisplayName('../../etc/passwd')).toBe(sanitizeUploadedFileName('../../etc/passwd'))
    expect(sanitizeAttachmentDisplayName('reports/2026/raport.pdf')).toBe('reports 2026 raport.pdf')
    expect(sanitizeAttachmentDisplayName('C:\\temp\\raport.pdf')).toBe('C temp raport.pdf')
    expect(sanitizeAttachmentDisplayName(`a${NUL}b${TAB}c${ZERO_WIDTH_SPACE}.txt`)).toBe('a b c.txt')
    expect(sanitizeAttachmentDisplayName(`invoice${RIGHT_TO_LEFT_OVERRIDE}fdp.exe`)).toBe('invoice fdp.exe')
  })

  it('carries the extension the security checks resolve, so double extensions stay visible', () => {
    expect(sanitizeAttachmentDisplayName('faktura.pdf.exe')).toBe('faktura_pdf.exe')
    expect(sanitizeAttachmentDisplayName('Zdjęcie.JPG')).toBe('Zdjęcie.jpg')
    expect(getAttachmentExtension(sanitizeAttachmentDisplayName('raport.exe.pdf'))).toBe(
      getAttachmentExtension(sanitizeUploadedFileName('raport.exe.pdf')),
    )
  })

  it('falls back to the storage name when nothing readable is left', () => {
    expect(sanitizeAttachmentDisplayName('')).toBe('file')
    expect(sanitizeAttachmentDisplayName(null)).toBe('file')
    expect(sanitizeAttachmentDisplayName('///.pdf')).toBe('file.pdf')
  })
})

describe('buildAttachmentContentDisposition (#8727)', () => {
  it('sends an ASCII fallback and the UTF-8 display name', () => {
    expect(buildAttachmentContentDisposition('Karta techniczna źródło.pdf')).toBe(
      `attachment; filename="Karta_techniczna_r_d_o.pdf"; filename*=UTF-8''Karta%20techniczna%20%C5%BAr%C3%B3d%C5%82o.pdf`,
    )
  })

  it('percent-encodes the RFC 5987 reserved characters left by encodeURIComponent', () => {
    expect(buildAttachmentContentDisposition("O'Brien (draft).txt", 'inline')).toBe(
      `inline; filename="O_Brien_draft.txt"; filename*=UTF-8''O%27Brien%20%28draft%29.txt`,
    )
  })
})
