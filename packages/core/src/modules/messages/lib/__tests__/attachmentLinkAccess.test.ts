import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { linkAttachmentsToMessage, linkLibraryAttachmentsToMessage } from '../attachments'
import { resolveAttachmentLinkAccess } from '../attachmentLinkAccess'

const evaluateAttachmentRowAccessMock = jest.fn()

jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({ Attachment: class Attachment {} }))
jest.mock('@open-mercato/core/modules/attachments/lib/access-rows', () => ({
  ATTACHMENT_ROW_WRITE_LOCK: { lockMode: 'write-lock' },
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
  return {
    find: jest.fn(async () => rows),
    flush: jest.fn(async () => {}),
    isInTransaction: jest.fn(() => true),
    transactional: jest.fn(),
  }
}

beforeEach(() => jest.clearAllMocks())

describe('message attachment linking and owner access', () => {
  it('evaluates a key as the key, without the user who created it', () => {
    const keyAuth = { sub: 'api_key:key-1', isApiKey: true, keyId: 'key-1', userId: 'creator-1', tenantId: 'tenant-1', orgId: 'org-1' }
    const access = resolveAttachmentLinkAccess({ auth: keyAuth as never, container: container as never })
    expect(access?.auth).toMatchObject({ sub: 'api_key:key-1', keyId: 'key-1' })
    expect(access?.auth.userId).toBeUndefined()
  })

  it('locks the rows inside the caller transaction before evaluating them', async () => {
    const rows = [makeAttachment('file-1', 'attachments:library')]
    const em = makeEm(rows)
    evaluateAttachmentRowAccessMock.mockResolvedValueOnce({ allowed: rows, denied: [] })

    await linkAttachmentsToMessage(em as never, 'message-1', ['file-1'], 'org-1', 'tenant-1', { auth, container: container as never })

    expect(em.find).toHaveBeenCalledWith(expect.anything(), expect.anything(), { lockMode: 'write-lock' })
    expect(em.transactional).not.toHaveBeenCalled()
  })

  it('opens a transaction for the move when the caller has none', async () => {
    const rows = [makeAttachment('file-1', 'attachments:library')]
    const tx = makeEm(rows)
    const em = { ...makeEm([]), isInTransaction: jest.fn(() => false), transactional: jest.fn(async (work: (manager: unknown) => Promise<void>) => work(tx)) }
    evaluateAttachmentRowAccessMock.mockResolvedValueOnce({ allowed: rows, denied: [] })

    await linkLibraryAttachmentsToMessage(em as never, 'message-1', 'library-1', 'org-1', 'tenant-1', { auth, container: container as never })

    expect(em.find).not.toHaveBeenCalled()
    expect(tx.find).toHaveBeenCalledWith(expect.anything(), expect.anything(), { lockMode: 'write-lock' })
    expect(tx.flush).toHaveBeenCalled()
    expect(rows[0]).toMatchObject({ entityId: 'messages:message', recordId: 'message-1' })
  })

  it('does not re-evaluate rows already on this message, so an unchanged draft still saves', async () => {
    const onMessage = { ...makeAttachment('kept', 'messages:message'), recordId: 'message-1' }
    const em = makeEm([onMessage])

    await linkAttachmentsToMessage(em as never, 'message-1', ['kept'], 'org-1', 'tenant-1', { auth, container: container as never })

    expect(evaluateAttachmentRowAccessMock).not.toHaveBeenCalled()
  })

  it('evaluates only the rows that actually move', async () => {
    const onMessage = { ...makeAttachment('kept', 'messages:message'), recordId: 'message-1' }
    const incoming = makeAttachment('new', 'attachments:library')
    const em = makeEm([onMessage, incoming])
    evaluateAttachmentRowAccessMock.mockResolvedValueOnce({ allowed: [incoming], denied: [] })

    await linkAttachmentsToMessage(em as never, 'message-1', ['kept', 'new'], 'org-1', 'tenant-1', { auth, container: container as never })

    expect(evaluateAttachmentRowAccessMock).toHaveBeenCalledWith(expect.objectContaining({ rows: [incoming] }))
  })

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
