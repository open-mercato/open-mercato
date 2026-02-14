import {
  copyAttachmentsForForward,
  getMessageAttachments,
  linkLibraryAttachmentsToMessage,
  linkAttachmentsToMessage,
} from '../attachments'

class Attachment {}

jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({
  Attachment,
}))

type AttachmentLike = {
  id: string
  tenantId: string
  organizationId: string | null
  fileName: string
  fileSize: number
  mimeType: string
  url: string
  entityId?: string
  recordId?: string
  storageDriver?: string
  storagePath?: string
  storageMetadata?: Record<string, unknown> | null
  partitionCode?: string | null
}

function createEm(overrides: Partial<Record<'find' | 'findOne' | 'create' | 'persist' | 'flush', jest.Mock>> = {}) {
  return {
    find: overrides.find ?? jest.fn(),
    findOne: overrides.findOne ?? jest.fn(),
    create: overrides.create ?? jest.fn((_entity, payload) => payload),
    persist: overrides.persist ?? jest.fn(),
    flush: overrides.flush ?? jest.fn(async () => {}),
  }
}

describe('messages attachments helpers', () => {
  it('skips linking when attachment list is empty', async () => {
    const em = createEm()

    await linkAttachmentsToMessage(
      em as never,
      'message-1',
      [],
      'org-1',
      'tenant-1',
    )

    expect(em.find).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('links attachments with org scope fallback and flushes', async () => {
    const attachments: AttachmentLike[] = [
      {
        id: 'att-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        fileName: 'a.pdf',
        fileSize: 1,
        mimeType: 'application/pdf',
        url: 'https://example/a.pdf',
      },
    ]

    const em = createEm({
      find: jest.fn(async () => attachments),
    })

    await linkAttachmentsToMessage(
      em as never,
      'message-1',
      ['att-1'],
      'org-1',
      'tenant-1',
    )

    expect(em.find).toHaveBeenCalledWith(
      Attachment,
      expect.objectContaining({
        id: { $in: ['att-1'] },
        tenantId: 'tenant-1',
        $or: [{ organizationId: 'org-1' }, { organizationId: null }],
      }),
    )
    expect(attachments[0].entityId).toBe('messages:message')
    expect(attachments[0].recordId).toBe('message-1')
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('returns mapped attachments for message', async () => {
    const em = createEm({
      find: jest.fn(async () => [
        {
          id: 'att-1',
          fileName: 'invoice.pdf',
          fileSize: 1024,
          mimeType: 'application/pdf',
          url: '/files/invoice.pdf',
        },
      ]),
    })

    const result = await getMessageAttachments(
      em as never,
      'message-1',
      null,
      'tenant-1',
    )

    expect(em.find).toHaveBeenCalledWith(
      Attachment,
      expect.objectContaining({
        entityId: 'messages:message',
        recordId: 'message-1',
        tenantId: 'tenant-1',
        organizationId: null,
      }),
    )
    expect(result).toEqual([
      {
        id: 'att-1',
        fileName: 'invoice.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
        url: '/files/invoice.pdf',
      },
    ])
  })

  it('links library attachments by temporary record id', async () => {
    const attachments: AttachmentLike[] = [
      {
        id: 'att-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        fileName: 'draft.pdf',
        fileSize: 16,
        mimeType: 'application/pdf',
        url: '/files/draft.pdf',
        entityId: 'attachments:library',
        recordId: 'messages-composer:temp-1',
      },
    ]

    const em = createEm({
      find: jest.fn(async () => attachments),
    })

    await linkLibraryAttachmentsToMessage(
      em as never,
      'message-1',
      'messages-composer:temp-1',
      'org-1',
      'tenant-1',
    )

    expect(em.find).toHaveBeenCalledWith(
      Attachment,
      expect.objectContaining({
        entityId: 'attachments:library',
        recordId: 'messages-composer:temp-1',
        tenantId: 'tenant-1',
        $or: [{ organizationId: 'org-1' }, { organizationId: null }],
      }),
    )
    expect(attachments[0].entityId).toBe('messages:message')
    expect(attachments[0].recordId).toBe('message-1')
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('copies attachments for forward and persists clones', async () => {
    const sourceAttachment = {
      id: 'att-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      fileName: 'contract.pdf',
      mimeType: 'application/pdf',
      fileSize: 12,
      storageDriver: 'local',
      storagePath: '/tmp/contract.pdf',
      storageMetadata: { key: 'v' },
      url: '/f/contract.pdf',
      partitionCode: 'messages',
    }

    const em = createEm({
      find: jest.fn(async (_entity, where) => {
        if (where.recordId === 'source-msg') {
          return [sourceAttachment]
        }
        return []
      }),
      findOne: jest.fn(async (_entity, where) =>
        where.id === 'att-1' ? sourceAttachment : null,
      ),
    })

    await copyAttachmentsForForward(
      em as never,
      'source-msg',
      'target-msg',
      'org-1',
      'tenant-1',
    )

    expect(em.create).toHaveBeenCalledWith(
      Attachment,
      expect.objectContaining({
        entityId: 'messages:message',
        recordId: 'target-msg',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        fileName: 'contract.pdf',
      }),
    )
    expect(em.persist).toHaveBeenCalledTimes(1)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })
})
