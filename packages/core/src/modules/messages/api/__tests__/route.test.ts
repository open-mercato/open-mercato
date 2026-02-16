import { POST } from '@open-mercato/core/modules/messages/api/route'
import { Message } from '@open-mercato/core/modules/messages/data/entities'

const resolveMessageContextMock = jest.fn()
const isMessageTypeCreateableByUserMock = jest.fn()
const createBatchMock = jest.fn(async () => [])
const resolveNotificationServiceMock = jest.fn(() => ({ createBatch: createBatchMock }))
const buildBatchNotificationFromTypeMock = jest.fn()

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
}))

jest.mock('@open-mercato/core/modules/messages/lib/message-types-registry', () => ({
  getMessageType: jest.fn(),
  isMessageTypeCreateableByUser: (...args: unknown[]) => isMessageTypeCreateableByUserMock(...args),
}))

jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: (...args: Parameters<typeof resolveNotificationServiceMock>) => resolveNotificationServiceMock(...args),
}))

jest.mock('@open-mercato/core/modules/notifications/lib/notificationBuilder', () => ({
  buildBatchNotificationFromType: (...args: unknown[]) => buildBatchNotificationFromTypeMock(...args),
}))

jest.mock('@open-mercato/core/modules/messages/notifications', () => ({
  notificationTypes: [{ type: 'messages.new', module: 'messages', titleKey: 'messages.notifications.new.title' }],
}))

describe('messages /api/messages POST', () => {
  let emFork: {
    findOne: jest.Mock
    create: jest.Mock
    persist: jest.Mock
    persistAndFlush: jest.Mock
    flush: jest.Mock
    transactional: jest.Mock
  }
  let eventBus: { emit: jest.Mock }
  let commandBus: { execute: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()

    emFork = {
      findOne: jest.fn(),
      create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
        if (entity === Message) {
          return { id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', ...data }
        }
        return { ...data }
      }),
      persist: jest.fn(),
      persistAndFlush: jest.fn(async () => {}),
      flush: jest.fn(async () => {}),
      transactional: jest.fn(async (fn: (trx: typeof emFork) => Promise<void>) => fn(emFork)),
    }

    eventBus = {
      emit: jest.fn(async () => {}),
    }
    commandBus = {
      execute: jest.fn(async () => ({
        result: {
          id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          threadId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          externalEmail: null,
          recipientUserIds: [
            'afe11af0-1afe-40a2-b6b6-5f6d95c29c4a',
            '2ce61514-c312-4a54-8ec0-cd9b70d7e76f',
          ],
        },
      })),
    }

    isMessageTypeCreateableByUserMock.mockReturnValue(true)
    buildBatchNotificationFromTypeMock.mockReturnValue({
      recipientUserIds: [
        'afe11af0-1afe-40a2-b6b6-5f6d95c29c4a',
        '2ce61514-c312-4a54-8ec0-cd9b70d7e76f',
      ],
      type: 'messages.new',
      titleKey: 'messages.notifications.new.title',
      title: 'messages.notifications.new.title',
      sourceModule: 'messages',
      sourceEntityType: 'message',
      sourceEntityId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      linkHref: '/backend/messages/f47ac10b-58cc-4372-a567-0e02b2c3d479',
    })

    resolveMessageContextMock.mockResolvedValue({
      ctx: {
        auth: { orgId: 'd5aa0e9a-4359-49a0-89a3-fdec0785fdb8' },
        container: {
          resolve: (name: string) => {
            if (name === 'em') return { fork: () => emFork }
            if (name === 'eventBus') return eventBus
            if (name === 'commandBus') return commandBus
            return null
          },
        },
      },
      scope: {
        tenantId: '7fb7fe47-ddf6-4f65-b5ae-b08e2df2fdb7',
        organizationId: '2045013f-8977-4f57-a1cc-9bb7d2f42a0e',
        userId: '5be8e4d6-14d2-4352-8f55-b95f95fd9205',
      },
    })
  })

  it('enqueues notification creation jobs for recipients when message is sent', async () => {
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        type: 'default',
        recipients: [
          { userId: 'afe11af0-1afe-40a2-b6b6-5f6d95c29c4a', type: 'to' },
          { userId: '2ce61514-c312-4a54-8ec0-cd9b70d7e76f', type: 'cc' },
        ],
        subject: 'Subject',
        body: 'Body',
      }),
    }))

    expect(response.status).toBe(201)
    expect(resolveNotificationServiceMock).toHaveBeenCalledTimes(1)
    expect(buildBatchNotificationFromTypeMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'messages.new' }),
      expect.objectContaining({
        recipientUserIds: [
          'afe11af0-1afe-40a2-b6b6-5f6d95c29c4a',
          '2ce61514-c312-4a54-8ec0-cd9b70d7e76f',
        ],
        sourceEntityType: 'message',
        sourceEntityId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        linkHref: '/backend/messages/f47ac10b-58cc-4372-a567-0e02b2c3d479',
      }),
    )
    expect(createBatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'messages.new',
      }),
      {
        tenantId: '7fb7fe47-ddf6-4f65-b5ae-b08e2df2fdb7',
        organizationId: '2045013f-8977-4f57-a1cc-9bb7d2f42a0e',
      },
    )
    expect(commandBus.execute).toHaveBeenCalledWith(
      'messages.messages.compose',
      expect.objectContaining({
        input: expect.objectContaining({
          subject: 'Subject',
          body: 'Body',
          tenantId: '7fb7fe47-ddf6-4f65-b5ae-b08e2df2fdb7',
          organizationId: '2045013f-8977-4f57-a1cc-9bb7d2f42a0e',
          userId: '5be8e4d6-14d2-4352-8f55-b95f95fd9205',
        }),
      }),
    )
    expect(eventBus.emit).toHaveBeenCalledWith(
      'messages.sent',
      expect.objectContaining({
        messageId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      }),
      { persistent: true },
    )
  })

  it('does not enqueue notifications when message is draft', async () => {
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        type: 'default',
        recipients: [
          { userId: 'afe11af0-1afe-40a2-b6b6-5f6d95c29c4a', type: 'to' },
        ],
        subject: 'Subject',
        body: 'Body',
        isDraft: true,
      }),
    }))

    expect(response.status).toBe(201)
    expect(resolveNotificationServiceMock).not.toHaveBeenCalled()
    expect(eventBus.emit).not.toHaveBeenCalled()
    expect(commandBus.execute).toHaveBeenCalledTimes(1)
  })
})
