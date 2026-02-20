import { DELETE, PUT } from '@open-mercato/core/modules/messages/api/[id]/read/route'
import { Message, MessageRecipient } from '@open-mercato/core/modules/messages/data/entities'

const resolveMessageContextMock = jest.fn()

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
  hasOrganizationAccess: jest.fn(() => true),
}))

describe('messages /api/messages/[id]/read', () => {
  let emFork: { findOne: jest.Mock; flush: jest.Mock }
  let commandBus: { execute: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()
    emFork = {
      findOne: jest.fn(),
      flush: jest.fn(async () => {}),
    }
    commandBus = {
      execute: jest.fn(async () => ({ result: { ok: true } })),
    }

    resolveMessageContextMock.mockResolvedValue({
      ctx: {
        container: {
          resolve: (name: string) => {
            if (name === 'em') return { fork: () => emFork }
            if (name === 'commandBus') return commandBus
            return null
          },
        },
      },
      scope: {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        userId: 'user-1',
      },
    })
  })

  it('returns 404 when message does not exist', async () => {
    emFork.findOne.mockResolvedValueOnce(null)

    const response = await PUT(new Request('http://localhost', { method: 'PUT' }), {
      params: { id: 'missing' },
    })

    expect(response.status).toBe(404)
  })

  it('marks recipient as read on PUT when unread', async () => {
    const recipient = { status: 'unread', readAt: null }

    emFork.findOne.mockImplementation(async (entity: unknown) => {
      if (entity === Message) return { id: 'message-1', organizationId: 'org-1' }
      if (entity === MessageRecipient) return recipient
      return null
    })

    const response = await PUT(new Request('http://localhost', { method: 'PUT' }), {
      params: { id: 'message-1' },
    })

    expect(response.status).toBe(200)
    expect(commandBus.execute).toHaveBeenCalledWith(
      'messages.recipients.mark_read',
      expect.objectContaining({
        input: expect.objectContaining({
          messageId: 'message-1',
          userId: 'user-1',
        }),
      }),
    )
  })

  it('marks recipient as unread on DELETE', async () => {
    const recipient = { status: 'read', readAt: new Date('2026-02-15T10:00:00.000Z') }

    emFork.findOne.mockImplementation(async (entity: unknown) => {
      if (entity === Message) return { id: 'message-1', organizationId: 'org-1' }
      if (entity === MessageRecipient) return recipient
      return null
    })

    const response = await DELETE(new Request('http://localhost', { method: 'DELETE' }), {
      params: { id: 'message-1' },
    })

    expect(response.status).toBe(200)
    expect(commandBus.execute).toHaveBeenCalledWith(
      'messages.recipients.mark_unread',
      expect.objectContaining({
        input: expect.objectContaining({
          messageId: 'message-1',
          userId: 'user-1',
        }),
      }),
    )
  })
})
