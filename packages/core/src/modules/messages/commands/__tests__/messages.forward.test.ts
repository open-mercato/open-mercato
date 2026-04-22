import '@open-mercato/core/modules/messages/commands/messages'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { Message, MessageObject, MessageRecipient } from '@open-mercato/core/modules/messages/data/entities'

const emitMessagesEventMock = jest.fn(async () => {})
const buildForwardThreadSliceMock = jest.fn(async () => ([
  {
    id: '11111111-1111-4111-8111-111111111111',
    senderUserId: '66666666-6666-4666-8666-666666666666',
    subject: 'Original subject',
    body: 'Original body',
    sentAt: new Date('2026-02-24T10:00:00.000Z'),
    createdAt: new Date('2026-02-24T10:00:00.000Z'),
  },
]))
const buildForwardPreviewFromThreadSliceMock = jest.fn(async () => ({ subject: 'Forward preview', body: 'Forward preview body' }))
const copyAttachmentsForForwardMessagesMock = jest.fn(async () => 0)

jest.mock('@open-mercato/core/modules/messages/events', () => ({
  emitMessagesEvent: (...args: unknown[]) => emitMessagesEventMock(...args),
}))

jest.mock('@open-mercato/core/modules/messages/lib/forwarding', () => ({
  buildForwardThreadSlice: (...args: unknown[]) => buildForwardThreadSliceMock(...args),
  buildForwardPreviewFromThreadSlice: (...args: unknown[]) => buildForwardPreviewFromThreadSliceMock(...args),
  buildForwardBodyFromLegacyInput: jest.fn((_generatedBody: string, additionalBody?: string) => (
    additionalBody ?? ''
  )),
}))

jest.mock('@open-mercato/core/modules/messages/lib/attachments', () => ({
  linkAttachmentsToMessage: jest.fn(),
  linkLibraryAttachmentsToMessage: jest.fn(),
  copyAttachmentsForForwardMessages: (...args: unknown[]) => copyAttachmentsForForwardMessagesMock(...args),
}))

describe('messages.messages.forward command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('persists forwarded message in source thread and links parent message', async () => {
    const command = commandRegistry.get('messages.messages.forward')
    expect(command).toBeTruthy()

    const sourceMessageId = '11111111-1111-4111-8111-111111111111'
    const sourceThreadId = '22222222-2222-4222-8222-222222222222'
    const forwardedMessageId = '33333333-3333-4333-8333-333333333333'
    const tenantId = '44444444-4444-4444-8444-444444444444'
    const organizationId = '55555555-5555-4555-8555-555555555555'
    const userId = '66666666-6666-4666-8666-666666666666'
    const recipientUserId = '77777777-7777-4777-8777-777777777777'

    const trx = {
      create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
        if (entity === Message) return { id: forwardedMessageId, ...data }
        return { ...data }
      }),
      persistAndFlush: jest.fn(async () => {}),
      persist: jest.fn(() => {}),
      flush: jest.fn(async () => {}),
    }

    const emFork = {
      findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
        if (entity === Message && where.id === sourceMessageId) {
          return {
            id: sourceMessageId,
            threadId: sourceThreadId,
            senderUserId: userId,
            subject: 'Original subject',
            type: 'system',
            visibility: 'internal',
            sourceEntityType: null,
            sourceEntityId: null,
            externalEmail: null,
            externalName: null,
            bodyFormat: 'markdown',
            priority: 'normal',
            deletedAt: null,
            tenantId,
            organizationId,
          }
        }
        if (entity === MessageRecipient) return null
        return null
      }),
      find: jest.fn(async (entity: unknown) => {
        if (entity === MessageObject) return []
        return []
      }),
      transactional: jest.fn(async (callback: (em: typeof trx) => Promise<void>) => callback(trx)),
      fork: jest.fn(),
    }

    const result = await command!.execute(
      {
        messageId: sourceMessageId,
        recipients: [{ userId: recipientUserId, type: 'to' }],
        body: 'forwarded body',
        includeAttachments: false,
        sendViaEmail: false,
        tenantId,
        organizationId,
        userId,
      },
      {
        container: { resolve: () => ({ fork: () => emFork }) } as never,
        auth: { sub: userId, tenantId } as never,
        organizationScope: null,
        selectedOrganizationId: organizationId,
        organizationIds: [organizationId],
      },
    )

    expect(result.id).toBe(forwardedMessageId)
    expect(trx.create).toHaveBeenCalledWith(
      Message,
      expect.objectContaining({
        threadId: sourceThreadId,
        parentMessageId: sourceMessageId,
      }),
    )
  })

  it('falls back to original message id when source threadId is missing', async () => {
    const command = commandRegistry.get('messages.messages.forward')
    expect(command).toBeTruthy()

    const sourceMessageId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const forwardedMessageId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const tenantId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const organizationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const userId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    const recipientUserId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

    const trx = {
      create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
        if (entity === Message) return { id: forwardedMessageId, ...data }
        return { ...data }
      }),
      persistAndFlush: jest.fn(async () => {}),
      persist: jest.fn(() => {}),
      flush: jest.fn(async () => {}),
    }

    const emFork = {
      findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
        if (entity === Message && where.id === sourceMessageId) {
          return {
            id: sourceMessageId,
            threadId: null,
            senderUserId: userId,
            subject: 'Original subject',
            type: 'system',
            visibility: 'internal',
            sourceEntityType: null,
            sourceEntityId: null,
            externalEmail: null,
            externalName: null,
            bodyFormat: 'markdown',
            priority: 'normal',
            deletedAt: null,
            tenantId,
            organizationId,
          }
        }
        if (entity === MessageRecipient) return null
        return null
      }),
      find: jest.fn(async (entity: unknown) => {
        if (entity === MessageObject) return []
        return []
      }),
      transactional: jest.fn(async (callback: (em: typeof trx) => Promise<void>) => callback(trx)),
      fork: jest.fn(),
    }

    await command!.execute(
      {
        messageId: sourceMessageId,
        recipients: [{ userId: recipientUserId, type: 'to' }],
        body: 'forwarded body',
        includeAttachments: false,
        sendViaEmail: false,
        tenantId,
        organizationId,
        userId,
      },
      {
        container: { resolve: () => ({ fork: () => emFork }) } as never,
        auth: { sub: userId, tenantId } as never,
        organizationScope: null,
        selectedOrganizationId: organizationId,
        organizationIds: [organizationId],
      },
    )

    expect(trx.create).toHaveBeenCalledWith(
      Message,
      expect.objectContaining({
        threadId: sourceMessageId,
        parentMessageId: sourceMessageId,
      }),
    )
  })

  it('copies attachments from the forward thread slice when includeAttachments is enabled', async () => {
    const command = commandRegistry.get('messages.messages.forward')
    expect(command).toBeTruthy()

    const sourceMessageId = '11111111-1111-4111-8111-111111111111'
    const sourceThreadId = '22222222-2222-4222-8222-222222222222'
    const forwardedMessageId = '33333333-3333-4333-8333-333333333333'
    const tenantId = '44444444-4444-4444-8444-444444444444'
    const organizationId = '55555555-5555-4555-8555-555555555555'
    const userId = '66666666-6666-4666-8666-666666666666'
    const recipientUserId = '77777777-7777-4777-8777-777777777777'
    const rootMessageId = '88888888-8888-4888-8888-888888888888'

    buildForwardThreadSliceMock.mockResolvedValueOnce([
      {
        id: rootMessageId,
        senderUserId: userId,
        subject: 'Thread root',
        body: 'Thread body root',
        sentAt: new Date('2026-02-24T10:00:00.000Z'),
        createdAt: new Date('2026-02-24T10:00:00.000Z'),
      },
      {
        id: sourceMessageId,
        senderUserId: userId,
        subject: 'Original subject',
        body: 'Original body',
        sentAt: new Date('2026-02-24T11:00:00.000Z'),
        createdAt: new Date('2026-02-24T11:00:00.000Z'),
      },
    ])

    const trx = {
      create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
        if (entity === Message) return { id: forwardedMessageId, ...data }
        return { ...data }
      }),
      persistAndFlush: jest.fn(async () => {}),
      persist: jest.fn(() => {}),
      flush: jest.fn(async () => {}),
    }

    const emFork = {
      findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
        if (entity === Message && where.id === sourceMessageId) {
          return {
            id: sourceMessageId,
            threadId: sourceThreadId,
            senderUserId: userId,
            subject: 'Original subject',
            type: 'system',
            visibility: 'internal',
            sourceEntityType: null,
            sourceEntityId: null,
            externalEmail: null,
            externalName: null,
            bodyFormat: 'markdown',
            priority: 'normal',
            deletedAt: null,
            tenantId,
            organizationId,
          }
        }
        if (entity === MessageRecipient) return null
        return null
      }),
      find: jest.fn(async (entity: unknown) => {
        if (entity === MessageObject) return []
        return []
      }),
      transactional: jest.fn(async (callback: (em: typeof trx) => Promise<void>) => callback(trx)),
      fork: jest.fn(),
    }

    await command!.execute(
      {
        messageId: sourceMessageId,
        recipients: [{ userId: recipientUserId, type: 'to' }],
        includeAttachments: true,
        sendViaEmail: false,
        tenantId,
        organizationId,
        userId,
      },
      {
        container: { resolve: () => ({ fork: () => emFork }) } as never,
        auth: { sub: userId, tenantId } as never,
        organizationScope: null,
        selectedOrganizationId: organizationId,
        organizationIds: [organizationId],
      },
    )

    expect(copyAttachmentsForForwardMessagesMock).toHaveBeenCalledWith(
      trx,
      [rootMessageId, sourceMessageId],
      forwardedMessageId,
      organizationId,
      tenantId,
    )
  })
})
