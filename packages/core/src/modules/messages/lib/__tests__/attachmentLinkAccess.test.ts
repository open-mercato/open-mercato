import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { linkAttachmentsToMessage, linkLibraryAttachmentsToMessage } from '../attachments'
import { resolveAttachmentLinkAccess } from '../attachmentLinkAccess'

const evaluateAttachmentRowAccessMock = jest.fn()

jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({ Attachment: class Attachment {} }))
jest.mock('@open-mercato/core/modules/attachments/lib/access-rows', () => ({
  evaluateAttachmentRowAccess: (...args: unknown[]) => evaluateAttachmentRowAccessMock(...args),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (_key: string, fallback: string) => fallback }),
}))

const auth = { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' }
const container = { resolve: jest.fn() }

function makeAttachment(id: string, entityId = 'inbox_ops:inbox_email') {
  return { id, entityId, recordId: 'email-1', partitionCode: 'privateAttachments', tenantId: 'tenant-1', organizationId: 'org-1' }
}

function makeEm(rows: ReturnType<typeof makeAttachment>[]) {
  return { find: jest.fn(async () => rows), flush: jest.fn(async () => {}) }
}

beforeEach(() => jest.clearAllMocks())

describe('message attachment linking and owner access', () => {
  it('refuses the whole link and changes nothing when any attachment is denied', async () => {
    const rows = [makeAttachment('allowed', 'attachments:library'), makeAttachment('denied')]
    const em = makeEm(rows)
    evaluateAttachmentRowAccessMock.mockResolvedValueOnce({ allowed: [rows[0]], denied: [rows[1]] })

    const link = linkAttachmentsToMessage(em as never, 'message-1', ['allowed', 'denied'], 'org-1', 'tenant-1', { auth, container: container as never })
    await expect(link).rejects.toBeInstanceOf(CrudHttpError)
    await expect(link).rejects.toMatchObject({ status: 403 })
    expect(em.flush).not.toHaveBeenCalled()
    expect(rows[0].entityId).toBe('attachments:library')
  })

  it('evaluates a reassignment onto the message for the acting principal', async () => {
    const rows = [makeAttachment('file-1', 'attachments:library')]
    const em = makeEm(rows)
    evaluateAttachmentRowAccessMock.mockResolvedValueOnce({ allowed: rows, denied: [] })

    await linkAttachmentsToMessage(em as never, 'message-1', ['file-1'], 'org-1', 'tenant-1', { auth, container: container as never })
    expect(evaluateAttachmentRowAccessMock).toHaveBeenCalledWith(expect.objectContaining({
      auth,
      container,
      action: 'reassign',
      destination: { entityId: 'messages:message', recordId: 'message-1' },
    }))
    expect(rows[0]).toMatchObject({ entityId: 'messages:message', recordId: 'message-1' })
    expect(em.flush).toHaveBeenCalled()
  })

  it('evaluates without a principal when the caller supplies no access, so protected rows are refused', async () => {
    const rows = [makeAttachment('file-1')]
    const em = makeEm(rows)
    evaluateAttachmentRowAccessMock.mockResolvedValueOnce({ allowed: [], denied: rows })

    await expect(linkAttachmentsToMessage(em as never, 'message-1', ['file-1'], 'org-1', 'tenant-1')).rejects.toMatchObject({ status: 403 })
    expect(evaluateAttachmentRowAccessMock).toHaveBeenCalledWith(expect.objectContaining({ auth: undefined, container: undefined }))
  })

  it('applies the same check to library attachments linked by a temporary record id', async () => {
    const rows = [makeAttachment('library-1', 'attachments:library')]
    const em = makeEm(rows)
    evaluateAttachmentRowAccessMock.mockResolvedValueOnce({ allowed: [], denied: rows })

    await expect(linkLibraryAttachmentsToMessage(em as never, 'message-1', 'temp-1', 'org-1', 'tenant-1', { auth, container: container as never }))
      .rejects.toMatchObject({ status: 403 })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('derives link access from the command context only when it carries an auth principal', () => {
    expect(resolveAttachmentLinkAccess({ auth, container: container as never })).toEqual({ auth, container })
    expect(resolveAttachmentLinkAccess({ auth: null, container: container as never })).toBeUndefined()
  })
})
