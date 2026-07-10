import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import {
  DEFAULT_ATTACHMENT_MAX_UPLOAD_BYTES,
  validateAttachmentFile,
} from '../lib/portalAttachmentValidation'

const t: TranslateFn = (key) => key

function makeFile(name: string, content: string | Uint8Array, type: string): File {
  return new File([content], name, { type })
}

function withSize(file: File, size: number): File {
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('validateAttachmentFile', () => {
  it('rejects files above the maximum upload size', async () => {
    const file = withSize(makeFile('huge.jpg', 'x', 'image/jpeg'), DEFAULT_ATTACHMENT_MAX_UPLOAD_BYTES + 1)
    await expect(validateAttachmentFile(file, t)).resolves.toBe('attachments.errors.maxUploadSize')
  })

  it('accepts a file exactly at the maximum upload size', async () => {
    const file = withSize(
      makeFile('boundary.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'),
      DEFAULT_ATTACHMENT_MAX_UPLOAD_BYTES,
    )
    await expect(validateAttachmentFile(file, t)).resolves.toBeNull()
  })

  it('rejects executable extensions', async () => {
    const file = makeFile('malware.exe', 'MZ fake executable', 'application/octet-stream')
    await expect(validateAttachmentFile(file, t)).resolves.toBe('attachments.errors.dangerousExecutable')
  })

  it('rejects double-extension names that end in an executable extension', async () => {
    const file = makeFile('invoice.pdf.exe', '%PDF-1.4 fake', 'application/pdf')
    await expect(validateAttachmentFile(file, t)).resolves.toBe('attachments.errors.dangerousExecutable')
  })

  it('rejects svg files by extension', async () => {
    const file = makeFile('image.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'image/svg+xml')
    await expect(validateAttachmentFile(file, t)).resolves.toBe('attachments.errors.activeContentBlocked')
  })

  it('rejects active-content MIME types even with an innocuous extension', async () => {
    const file = makeFile('diagram.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/svg+xml')
    await expect(validateAttachmentFile(file, t)).resolves.toBe('attachments.errors.activeContentBlocked')
  })

  it('rejects files whose sniffed content looks like HTML', async () => {
    const html = makeFile('notes.txt', '<html><body>payload</body></html>', 'text/plain')
    await expect(validateAttachmentFile(html, t)).resolves.toBe('attachments.errors.activeContentBlocked')

    const doctype = makeFile('report.txt', '  \n<!DOCTYPE html><html></html>', 'text/plain')
    await expect(validateAttachmentFile(doctype, t)).resolves.toBe('attachments.errors.activeContentBlocked')
  })

  it('accepts a normal jpg upload', async () => {
    const file = makeFile('photo.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), 'image/jpeg')
    await expect(validateAttachmentFile(file, t)).resolves.toBeNull()
  })

  it('accepts a normal pdf upload', async () => {
    const file = makeFile('invoice.pdf', '%PDF-1.7 minimal fixture body', 'application/pdf')
    await expect(validateAttachmentFile(file, t)).resolves.toBeNull()
  })
})
