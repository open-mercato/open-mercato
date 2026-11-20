type RegisteredCommand = {
  id: string
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
  undo: (args: { logEntry: unknown; ctx: unknown }) => Promise<void>
}

const mockRegisteredCommands = new Map<string, RegisteredCommand>()
const deleteMessageAttachmentRowsMock = jest.fn()
const enqueueMessageAttachmentSectionCleanupMock = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand: (command: RegisteredCommand) => mockRegisteredCommands.set(command.id, command),
}))

jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({
  Attachment: class Attachment {},
}))

const detachMessageAttachmentsMock = jest.fn()

jest.mock('../../lib/attachments', () => ({
  linkAttachmentsToMessage: jest.fn(),
  detachMessageAttachments: (...args: unknown[]) => detachMessageAttachmentsMock(...args),
  deleteMessageAttachmentRows: (...args: unknown[]) => deleteMessageAttachmentRowsMock(...args),
  enqueueMessageAttachmentSectionCleanup: (...args: unknown[]) => enqueueMessageAttachmentSectionCleanupMock(...args),
}))

const messageId = '11111111-1111-4111-8111-111111111111'
const tenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'
const userId = '44444444-4444-4444-8444-444444444444'
const attachmentId = '55555555-5555-4555-8555-555555555555'
const keptAttachmentId = '66666666-6666-4666-8666-666666666666'

const deleted = {
  deletedCount: 1,
  purgedSections: [{ scope: { tenantId, organizationId }, sectionIds: ['section-1'] }],
}

function createCtx() {
  const em = {
    findOne: jest.fn(async () => ({ id: messageId, tenantId, organizationId, senderUserId: userId, isDraft: true })),
    find: jest.fn(async () => []),
    flush: jest.fn(async () => {}),
    nativeDelete: jest.fn(),
    nativeUpdate: jest.fn(async () => 1),
  }
  const auth = { sub: userId, tenantId, orgId: organizationId }
  return { em, auth, ctx: { container: { resolve: () => ({ fork: () => em }) }, auth } }
}

describe('message draft attachment commands detach instead of deleting and purging', () => {
  beforeAll(() => {
    require('../attachments')
  })

  beforeEach(() => {
    jest.clearAllMocks()
    deleteMessageAttachmentRowsMock.mockResolvedValue(deleted)
  })

  it('unlinking detaches the exact message references without deleting rows or purging document structure', async () => {
    const { em, ctx, auth } = createCtx()
    const command = mockRegisteredCommands.get('messages.attachments.unlink_from_draft')!

    await command.execute({ messageId, tenantId, organizationId, userId, attachmentIds: [attachmentId] }, ctx)

    expect(detachMessageAttachmentsMock).toHaveBeenCalledWith(
      em,
      messageId,
      [attachmentId],
      organizationId,
      tenantId,
      expect.objectContaining({ auth }),
    )
    expect(em.nativeDelete).not.toHaveBeenCalled()
    expect(deleteMessageAttachmentRowsMock).not.toHaveBeenCalled()
    expect(enqueueMessageAttachmentSectionCleanupMock).not.toHaveBeenCalled()
  })

  it.each(['messages.attachments.link_to_draft', 'messages.attachments.unlink_from_draft'])(
    'undo of %s detaches the attachments it drops without deleting or purging them',
    async (commandId) => {
      const { em, ctx } = createCtx()
      const command = mockRegisteredCommands.get(commandId)!
      const logEntry = {
        resourceId: messageId,
        tenantId,
        organizationId,
        commandPayload: { undo: { before: { attachmentIds: [keptAttachmentId] } } },
      }

      await command.undo({ logEntry, ctx })

      expect(em.nativeUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ recordId: messageId, tenantId, organizationId, id: { $nin: [keptAttachmentId] } }),
        { entityId: 'attachments:library', recordId: `messages-detached:${messageId}` },
      )
      expect(em.nativeDelete).not.toHaveBeenCalled()
      expect(deleteMessageAttachmentRowsMock).not.toHaveBeenCalled()
      expect(enqueueMessageAttachmentSectionCleanupMock).not.toHaveBeenCalled()
      expect(em.flush).toHaveBeenCalled()
    },
  )
})
