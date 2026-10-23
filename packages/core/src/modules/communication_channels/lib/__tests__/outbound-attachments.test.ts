import type { AttachmentService } from '@open-mercato/core/modules/attachments'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { ChannelCapabilities } from '../adapter'
import { baseEmailCapabilities } from '../email-capabilities'
import {
  OUTBOUND_ATTACHMENTS_MAX_COUNT,
  OUTBOUND_ATTACHMENTS_METADATA_KEY,
  OutboundAttachmentDeliveryError,
  loadOutboundAttachments,
  omitOutboundAttachments,
  outboundAttachmentRefsSchema,
  parseOutboundAttachmentRefs,
  readStoredOutboundAttachments,
  resolveOutboundAttachmentBytes,
  validateOutboundAttachments,
  type OutboundAttachmentRef,
} from '../outbound-attachments'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
      fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? '')),
  }),
}))

const scope = { userId: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' }
const owner = { entityId: 'purchase_orders:purchase_order', recordId: 'record-1' }
const fileSharingCapabilities: ChannelCapabilities = { ...baseEmailCapabilities, fileSharing: true }

function ref(attachmentId: string, extra: Partial<OutboundAttachmentRef> = {}): OutboundAttachmentRef {
  return { kind: 'attachment', attachmentId, owner, ...extra }
}

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

type FileRecord = { fileName: string; mimeType: string; fileSize: number; bytes?: Buffer }

function createContainer(files: Record<string, FileRecord>) {
  const describeScoped = jest.fn(async ({ attachmentId, expectedOwner }: { attachmentId: string; expectedOwner: typeof owner }) => {
    const file = files[attachmentId]
    if (!file || expectedOwner.recordId !== owner.recordId) throw new CrudHttpError(404, { error: 'Attachment not found' })
    return { id: attachmentId, fileName: file.fileName, mimeType: file.mimeType, fileSize: file.fileSize, partitionCode: 'privateAttachments' }
  })
  const readScoped = jest.fn(async ({ attachmentId }: { attachmentId: string }) => {
    const file = files[attachmentId]
    if (!file) throw new CrudHttpError(404, { error: 'Attachment not found' })
    return {
      buffer: file.bytes ?? Buffer.alloc(file.fileSize),
      contentType: 'application/octet-stream',
      contentDisposition: 'attachment',
      fileName: file.fileName,
      mimeType: file.mimeType,
    }
  })
  const service = { describeScoped, readScoped } as unknown as AttachmentService
  return {
    container: { resolve: (name: string) => (name === 'attachmentService' ? service : undefined) },
    describeScoped,
    readScoped,
  }
}

describe('outboundAttachmentRefsSchema', () => {
  it('requires an owner and refuses inline refs', () => {
    expect(outboundAttachmentRefsSchema.safeParse([ref(uuid(1))]).success).toBe(true)
    expect(outboundAttachmentRefsSchema.safeParse([{ kind: 'attachment', attachmentId: uuid(1) }]).success).toBe(false)
    expect(
      outboundAttachmentRefsSchema.safeParse([{ kind: 'inline', filename: 'a.txt', mimeType: 'text/plain', contentBase64: 'YQ==' }]).success,
    ).toBe(false)
    expect(outboundAttachmentRefsSchema.safeParse([ref(uuid(1), { filename: 'x'.repeat(256) })]).success).toBe(false)
  })

  it('refuses display names that break the upload rules with attachment_type_not_allowed', async () => {
    const { container, describeScoped } = createContainer({
      [uuid(1)]: { fileName: 'stored.pdf', mimeType: 'application/pdf', fileSize: 10 },
    })
    const validate = (filename: string) =>
      validateOutboundAttachments({ container, scope, refs: [ref(uuid(1), { filename })], capabilities: fileSharingCapabilities })
    await expect(validate('  Faktura 2026-10.pdf ')).resolves.toEqual({
      ok: true,
      stored: [{ attachmentId: uuid(1), owner, filename: 'Faktura 2026-10.pdf' }],
    })
    describeScoped.mockClear()
    for (const filename of [
      'Invoice 2026-10.pdf.vbs',
      'Invoice.exe.pdf',
      'setup.EXE',
      'Invoice\u202Efdp.vbs',
      'Invoice\u202Efdp.pdf',
      'tab\tname.pdf',
      'line\u2028break.pdf',
      'c1\u0085control.pdf',
      'a\r\nBcc: x.pdf',
      '   ',
    ]) {
      await expect(validate(filename)).resolves.toMatchObject({ ok: false, status: 422, code: 'attachment_type_not_allowed' })
    }
    expect(describeScoped).not.toHaveBeenCalled()
  })

  it('applies the upload rules to stored display names at delivery', () => {
    expect(readStoredOutboundAttachments({ [OUTBOUND_ATTACHMENTS_METADATA_KEY]: [{ attachmentId: uuid(1), owner, filename: 'a.pdf' }] })).toHaveLength(1)
    expect(() =>
      readStoredOutboundAttachments({ [OUTBOUND_ATTACHMENTS_METADATA_KEY]: [{ attachmentId: uuid(1), owner, filename: 'a.pdf.js' }] }),
    ).toThrow(OutboundAttachmentDeliveryError)
  })

  it('parses refs passed in-process and leaves the count to the validator', () => {
    const refs = Array.from({ length: OUTBOUND_ATTACHMENTS_MAX_COUNT + 1 }, (_value, index) => ref(uuid(index + 1)))
    expect(parseOutboundAttachmentRefs(refs)).toHaveLength(OUTBOUND_ATTACHMENTS_MAX_COUNT + 1)
    expect(parseOutboundAttachmentRefs([{ ...ref(uuid(1)), attachmentId: 'not-a-uuid' }])).toBeNull()
    expect(parseOutboundAttachmentRefs([ref(uuid(1), { filename: 'a\nb.pdf' })])).toHaveLength(1)
    expect(parseOutboundAttachmentRefs('nope')).toBeNull()
  })
})

describe('validateOutboundAttachments', () => {
  it('stores only the reference, owner and filename of readable files', async () => {
    const { container, describeScoped } = createContainer({
      [uuid(1)]: { fileName: 'order.pdf', mimeType: 'application/pdf', fileSize: 1000 },
    })
    const result = await validateOutboundAttachments({
      container,
      scope,
      refs: [ref(uuid(1), { filename: 'Order 42.pdf' })],
      capabilities: fileSharingCapabilities,
    })
    expect(result).toEqual({ ok: true, stored: [{ attachmentId: uuid(1), owner, filename: 'Order 42.pdf' }] })
    expect(describeScoped).toHaveBeenCalledWith({
      attachmentId: uuid(1),
      auth: { sub: 'user-1', userId: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' },
      expectedOwner: owner,
    })
  })

  it('refuses attachments when the adapter does not share files, before reading anything', async () => {
    const { container, describeScoped } = createContainer({})
    const result = await validateOutboundAttachments({
      container,
      scope,
      refs: [ref(uuid(1))],
      capabilities: { ...baseEmailCapabilities, fileSharing: false },
    })
    expect(result).toMatchObject({ ok: false, status: 422, code: 'attachments_unsupported' })
    expect(describeScoped).not.toHaveBeenCalled()
  })

  it('refuses too many and duplicate refs', async () => {
    const { container } = createContainer({})
    const many = Array.from({ length: OUTBOUND_ATTACHMENTS_MAX_COUNT + 1 }, (_value, index) => ref(uuid(index + 1)))
    await expect(
      validateOutboundAttachments({ container, scope, refs: many, capabilities: fileSharingCapabilities }),
    ).resolves.toMatchObject({ ok: false, code: 'too_many_attachments' })
    await expect(
      validateOutboundAttachments({ container, scope, refs: [ref(uuid(1)), ref(uuid(1))], capabilities: fileSharingCapabilities }),
    ).resolves.toMatchObject({ ok: false, code: 'duplicate_attachment' })
  })

  it('reports an unreadable or foreign-owned file as not found', async () => {
    const { container } = createContainer({ [uuid(1)]: { fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 10 } })
    await expect(
      validateOutboundAttachments({ container, scope, refs: [ref(uuid(2))], capabilities: fileSharingCapabilities }),
    ).resolves.toMatchObject({ ok: false, code: 'attachment_not_found' })
    await expect(
      validateOutboundAttachments({
        container,
        scope,
        refs: [ref(uuid(1), { owner: { entityId: owner.entityId, recordId: 'record-2' } })],
        capabilities: fileSharingCapabilities,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'attachment_not_found' })
  })

  it('surfaces a failure that is not a verdict on the file instead of reporting it as not found', async () => {
    const { container, describeScoped } = createContainer({})
    describeScoped.mockRejectedValueOnce(Object.assign(new Error('could not serialize access'), { code: '40001' }))
    await expect(
      validateOutboundAttachments({ container, scope, refs: [ref(uuid(1))], capabilities: fileSharingCapabilities }),
    ).rejects.toMatchObject({ code: '40001' })
  })

  it('falls back to readScoped when the service does not describe files', async () => {
    const { readScoped } = createContainer({ [uuid(1)]: { fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 10 } })
    const service = { readScoped } as unknown as AttachmentService
    const result = await validateOutboundAttachments({
      container: { resolve: () => service },
      scope,
      refs: [ref(uuid(1))],
      capabilities: fileSharingCapabilities,
    })
    expect(result).toEqual({ ok: true, stored: [{ attachmentId: uuid(1), owner }] })
    expect(readScoped).toHaveBeenCalledWith(expect.objectContaining({ attachmentId: uuid(1), expectedOwner: owner }))
  })

  it('refuses a display name that changes the file extension', async () => {
    const { container } = createContainer({ [uuid(1)]: { fileName: 'notes.txt', mimeType: 'text/plain', fileSize: 10 } })
    await expect(
      validateOutboundAttachments({
        container,
        scope,
        refs: [ref(uuid(1), { filename: 'Invoice.pdf' })],
        capabilities: fileSharingCapabilities,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'attachment_type_not_allowed' })
    await expect(
      validateOutboundAttachments({
        container,
        scope,
        refs: [ref(uuid(1), { filename: 'Meeting notes.TXT' })],
        capabilities: fileSharingCapabilities,
      }),
    ).resolves.toMatchObject({ ok: true })
  })

  it('refuses a type the adapter does not send', async () => {
    const { container } = createContainer({ [uuid(1)]: { fileName: 'run.exe', mimeType: 'application/x-msdownload', fileSize: 10 } })
    await expect(
      validateOutboundAttachments({ container, scope, refs: [ref(uuid(1))], capabilities: fileSharingCapabilities }),
    ).resolves.toMatchObject({ ok: false, code: 'attachment_type_not_allowed' })
  })

  it('refuses files above the per-file or total limit and names the limit', async () => {
    const { container } = createContainer({
      [uuid(1)]: { fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 15_000_000 },
      [uuid(2)]: { fileName: 'b.pdf', mimeType: 'application/pdf', fileSize: 15_000_000 },
    })
    const result = await validateOutboundAttachments({
      container,
      scope,
      refs: [ref(uuid(1)), ref(uuid(2))],
      capabilities: fileSharingCapabilities,
    })
    expect(result).toMatchObject({ ok: false, code: 'attachments_too_large' })
    expect(result.ok ? '' : result.error).toContain('25 MB')
    const perFile = await validateOutboundAttachments({
      container,
      scope,
      refs: [ref(uuid(1))],
      capabilities: { ...fileSharingCapabilities, maxFileSize: 10_000_000 },
    })
    expect(perFile).toMatchObject({ ok: false, code: 'attachments_too_large' })
    expect(perFile.ok ? '' : perFile.error).toContain('10 MB')
  })

  it('uses the adapter total limit when it declares one', async () => {
    const { container } = createContainer({
      [uuid(1)]: { fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 6_000_000 },
      [uuid(2)]: { fileName: 'b.pdf', mimeType: 'application/pdf', fileSize: 6_000_000 },
      [uuid(3)]: { fileName: 'c.pdf', mimeType: 'application/pdf', fileSize: 15_000_000 },
      [uuid(4)]: { fileName: 'd.pdf', mimeType: 'application/pdf', fileSize: 15_000_000 },
    })
    const { maxFileSize: _maxFileSize, ...withoutPerFile } = fileSharingCapabilities
    const smaller = await validateOutboundAttachments({
      container,
      scope,
      refs: [ref(uuid(1)), ref(uuid(2))],
      capabilities: { ...withoutPerFile, maxTotalBytes: 10_000_000 },
    })
    expect(smaller).toMatchObject({ ok: false, code: 'attachments_too_large' })
    expect(smaller.ok ? '' : smaller.error).toContain('10 MB')
    await expect(
      validateOutboundAttachments({
        container,
        scope,
        refs: [ref(uuid(3)), ref(uuid(4))],
        capabilities: { ...fileSharingCapabilities, maxTotalBytes: 40_000_000 },
      }),
    ).resolves.toMatchObject({ ok: true })
    await expect(
      loadOutboundAttachments({
        container,
        scope,
        stored: [
          { attachmentId: uuid(1), owner },
          { attachmentId: uuid(2), owner },
        ],
        capabilities: { ...withoutPerFile, maxTotalBytes: 10_000_000 },
      }),
    ).rejects.toMatchObject({ code: 'attachments_too_large', transient: false })
  })

  it('caps the total at 25 MB, not at a lower per-file limit', async () => {
    const { container } = createContainer({
      [uuid(1)]: { fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 8_000_000 },
      [uuid(2)]: { fileName: 'b.pdf', mimeType: 'application/pdf', fileSize: 8_000_000 },
    })
    const capabilities = { ...fileSharingCapabilities, maxFileSize: 10_000_000 }
    await expect(
      validateOutboundAttachments({ container, scope, refs: [ref(uuid(1)), ref(uuid(2))], capabilities }),
    ).resolves.toMatchObject({ ok: true })
    await expect(
      loadOutboundAttachments({
        container,
        scope,
        stored: [
          { attachmentId: uuid(1), owner },
          { attachmentId: uuid(2), owner },
        ],
        capabilities,
      }),
    ).resolves.toHaveLength(2)
  })
})

describe('stored outbound attachment metadata', () => {
  it('reads valid refs back and treats a malformed value as unavailable', () => {
    const stored = [{ attachmentId: uuid(1), owner }]
    expect(readStoredOutboundAttachments({ [OUTBOUND_ATTACHMENTS_METADATA_KEY]: stored })).toEqual(stored)
    expect(readStoredOutboundAttachments({})).toEqual([])
    expect(() => readStoredOutboundAttachments({ [OUTBOUND_ATTACHMENTS_METADATA_KEY]: [{ attachmentId: 'nope' }] })).toThrow(
      OutboundAttachmentDeliveryError,
    )
  })

  it('drops the hub-owned key and keeps everything else', () => {
    expect(omitOutboundAttachments({ [OUTBOUND_ATTACHMENTS_METADATA_KEY]: [], crmVisibility: 'private' })).toEqual({
      crmVisibility: 'private',
    })
  })
})

describe('loadOutboundAttachments', () => {
  it('reads the bytes as the channel owner, pinned to the stored owner', async () => {
    const bytes = Buffer.from('%PDF-1.7 order')
    const { container, readScoped } = createContainer({
      [uuid(1)]: { fileName: 'order.pdf', mimeType: 'application/pdf', fileSize: bytes.byteLength, bytes },
    })
    const attachments = await loadOutboundAttachments({
      container,
      scope,
      stored: [{ attachmentId: uuid(1), owner, filename: 'Order 42.pdf' }],
      capabilities: fileSharingCapabilities,
    })
    expect(readScoped).toHaveBeenCalledWith(
      expect.objectContaining({ attachmentId: uuid(1), expectedOwner: owner, auth: expect.objectContaining({ tenantId: 'tenant-1', orgId: 'org-1' }) }),
    )
    expect(attachments).toHaveLength(1)
    expect(attachments[0]).toMatchObject({ fileName: 'Order 42.pdf', mimeType: 'application/pdf', fileSize: bytes.byteLength })
    expect(Buffer.from(attachments[0].content as Uint8Array).equals(bytes)).toBe(true)
  })

  it('fails permanently when a file is gone or now too large', async () => {
    const { container } = createContainer({
      [uuid(2)]: { fileName: 'big.pdf', mimeType: 'application/pdf', fileSize: 30_000_000 },
    })
    const missing = loadOutboundAttachments({
      container,
      scope,
      stored: [{ attachmentId: uuid(1), owner }],
      capabilities: fileSharingCapabilities,
    })
    await expect(missing).rejects.toMatchObject({ code: 'attachment_unavailable', transient: false })
    await expect(
      loadOutboundAttachments({ container, scope, stored: [{ attachmentId: uuid(2), owner }], capabilities: fileSharingCapabilities }),
    ).rejects.toMatchObject({ code: 'attachments_too_large', transient: false })
  })

  it('lets a database failure through so the delivery is retried', async () => {
    const { container, readScoped } = createContainer({})
    readScoped.mockRejectedValueOnce(Object.assign(new Error('deadlock detected'), { code: '40P01' }))
    await expect(
      loadOutboundAttachments({ container, scope, stored: [{ attachmentId: uuid(1), owner }], capabilities: fileSharingCapabilities }),
    ).rejects.toMatchObject({ code: '40P01' })
  })
})

describe('resolveOutboundAttachmentBytes', () => {
  it('prefers the hub bytes, decodes data URLs and refuses remote URLs', () => {
    const content = Buffer.from('bytes')
    expect(resolveOutboundAttachmentBytes({ url: 'https://evil.example/x', mimeType: 'text/plain', fileName: 'a', content })).toBe(content)
    expect(Buffer.from(resolveOutboundAttachmentBytes({ url: 'data:text/plain;base64,aGk=', mimeType: 'text/plain', fileName: 'a' })).toString()).toBe('hi')
    expect(Buffer.from(resolveOutboundAttachmentBytes({ url: 'data:text/plain,a%20b', mimeType: 'text/plain', fileName: 'a' })).toString()).toBe('a b')
    expect(() => resolveOutboundAttachmentBytes({ url: 'https://evil.example/x', mimeType: 'text/plain', fileName: 'a' })).toThrow()
  })
})
