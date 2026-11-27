import { restoreMessageAggregateSnapshot, type MessageAggregateSnapshot } from '../shared'

const deleteMessageAttachmentRowsMock = jest.fn()
const enqueueMessageAttachmentSectionCleanupMock = jest.fn()

jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({
  Attachment: class Attachment {},
}))

jest.mock('../../lib/attachments', () => ({
  deleteMessageAttachmentRows: (...args: unknown[]) => deleteMessageAttachmentRowsMock(...args),
  enqueueMessageAttachmentSectionCleanup: (...args: unknown[]) => enqueueMessageAttachmentSectionCleanupMock(...args),
}))

const messageId = '11111111-1111-4111-8111-111111111111'
const tenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'
const keptAttachmentId = '66666666-6666-4666-8666-666666666666'

function createEm() {
  return {
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => ({ id: messageId })),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(),
    flush: jest.fn(async () => {}),
    nativeDelete: jest.fn(),
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
  }
}

function snapshot(): MessageAggregateSnapshot {
  return {
    message: { id: messageId, tenantId, organizationId },
    recipients: [],
    objects: [],
    attachmentIds: [keptAttachmentId],
  } as unknown as MessageAggregateSnapshot
}

describe('restoreMessageAggregateSnapshot attachment cleanup', () => {
  beforeEach(() => jest.clearAllMocks())

  it('purges attachments missing from the snapshot and queues search cleanup after commit', async () => {
    const em = createEm()
    const deleted = { deletedCount: 1, purgedSections: [{ scope: { tenantId, organizationId }, sectionIds: ['section-1'] }] }
    deleteMessageAttachmentRowsMock.mockResolvedValue(deleted)

    await restoreMessageAggregateSnapshot(em as never, snapshot())

    expect(em.nativeDelete).not.toHaveBeenCalled()
    expect(deleteMessageAttachmentRowsMock).toHaveBeenCalledWith(em, {
      messageId,
      tenantId,
      organizationId,
      excludeIds: [keptAttachmentId],
    })
    expect(enqueueMessageAttachmentSectionCleanupMock).toHaveBeenCalledWith(deleted)
    expect(em.commit.mock.invocationCallOrder[0]).toBeLessThan(
      enqueueMessageAttachmentSectionCleanupMock.mock.invocationCallOrder[0],
    )
  })

  it('queues nothing when the restore rolls back', async () => {
    const em = createEm()
    deleteMessageAttachmentRowsMock.mockResolvedValue({ deletedCount: 0, purgedSections: [] })
    em.flush.mockRejectedValueOnce(new Error('[internal] flush failed'))

    await expect(restoreMessageAggregateSnapshot(em as never, snapshot())).rejects.toThrow('flush failed')

    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(enqueueMessageAttachmentSectionCleanupMock).not.toHaveBeenCalled()
  })
})
