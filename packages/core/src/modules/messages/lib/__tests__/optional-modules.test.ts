import {
  copyAttachmentsForForwardMessages,
  deleteMessageAttachmentRows,
  getMessageAttachments,
  getMessageEmailAttachments,
  linkAttachmentsToMessage,
  linkLibraryAttachmentsToMessage,
} from '../attachments'
import { isAttachmentsModuleAvailable, isNotificationsModuleAvailable } from '../optionalModules'
import { getAttachmentIdsForMessage, restoreMessageAggregateSnapshot, type MessageAggregateSnapshot } from '../../commands/shared'

class Attachment {}
class Notification {}

jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({ Attachment }))
jest.mock('@open-mercato/core/modules/notifications/data/entities', () => ({ Notification }))

function createEm(registered: unknown[]) {
  return {
    getMetadata: () => ({ has: (entity: unknown) => registered.includes(entity) }),
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => null),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(),
    flush: jest.fn(async () => {}),
    nativeDelete: jest.fn(async () => 0),
    getKysely: jest.fn(() => {
      throw new Error('relation "attachments" does not exist')
    }),
    transactional: jest.fn(),
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
  }
}

describe('messages optional-module availability (#9201)', () => {
  it('reports registration from the ORM metadata', async () => {
    const em = createEm([Attachment])
    await expect(isAttachmentsModuleAvailable(em as never)).resolves.toBe(true)
    await expect(isNotificationsModuleAvailable(em as never)).resolves.toBe(false)
  })

  it('treats an entity manager without metadata as having the module', async () => {
    await expect(isAttachmentsModuleAvailable({} as never)).resolves.toBe(true)
  })
})

describe('messages attachment helpers without the attachments module (#9201)', () => {
  const em = createEm([])

  beforeEach(() => jest.clearAllMocks())

  it('turns every read into an empty result and every write into a no-op', async () => {
    await linkAttachmentsToMessage(em as never, 'message-1', ['att-1'], 'org-1', 'tenant-1')
    await linkLibraryAttachmentsToMessage(em as never, 'message-1', 'library-record', 'org-1', 'tenant-1')
    await expect(getMessageAttachments(em as never, 'message-1', 'org-1', 'tenant-1')).resolves.toEqual([])
    await expect(getMessageEmailAttachments(em as never, 'message-1', 'org-1', 'tenant-1')).resolves.toEqual([])
    await expect(copyAttachmentsForForwardMessages(em as never, ['message-0'], 'message-1', 'tenant-1')).resolves.toBe(0)
    await expect(
      deleteMessageAttachmentRows(em as never, { messageId: 'message-1', tenantId: 'tenant-1', organizationId: 'org-1', excludeIds: [] }),
    ).resolves.toEqual({ deletedCount: 0, purgedSections: [] })

    expect(em.find).not.toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
    expect(em.getKysely).not.toHaveBeenCalled()
    expect(em.transactional).not.toHaveBeenCalled()
  })

  it('snapshots a message with no attachment ids', async () => {
    await expect(
      getAttachmentIdsForMessage(em as never, 'message-1', { tenantId: 'tenant-1', organizationId: 'org-1' }),
    ).resolves.toEqual([])
    expect(em.find).not.toHaveBeenCalled()
  })

  it('restores a snapshot (undo) without touching Attachment', async () => {
    const restoreEm = createEm([])
    const snapshot = {
      message: { id: 'message-1', tenantId: 'tenant-1', organizationId: 'org-1' },
      recipients: [],
      objects: [],
      attachmentIds: ['att-1'],
    } as unknown as MessageAggregateSnapshot

    await restoreMessageAggregateSnapshot(restoreEm as never, snapshot)

    expect(restoreEm.find.mock.calls.some(([entity]) => entity === Attachment)).toBe(false)
    expect(restoreEm.getKysely).not.toHaveBeenCalled()
    expect(restoreEm.nativeDelete).not.toHaveBeenCalled()
    expect(restoreEm.commit).toHaveBeenCalled()
  })
})
