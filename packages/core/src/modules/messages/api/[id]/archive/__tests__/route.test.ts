import { DELETE, PUT } from '@open-mercato/core/modules/messages/api/[id]/archive/route'
import { Message, MessageRecipient } from '@open-mercato/core/modules/messages/data/entities'

const resolveMessageContextMock = jest.fn()

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
}))

describe('messages /api/messages/[id]/archive', () => {
  let emFork: { findOne: jest.Mock; flush: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()

    emFork = {
      findOne: jest.fn(),
      flush: jest.fn(async () => {}),
    }

    resolveMessageContextMock.mockResolvedValue({
      ctx: {
        container: {
          resolve: (name: string) => (name === 'em' ? { fork: () => emFork } : null),
        },
      },
      scope: {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        userId: 'user-1',
      },
    })
  })

  it('archives recipient message on PUT', async () => {
    const recipient = { archivedAt: null, status: 'unread' }

    emFork.findOne.mockImplementation(async (entity: unknown) => {
      if (entity === Message) return { id: 'message-1', organizationId: 'org-1' }
      if (entity === MessageRecipient) return recipient
      return null
    })

    const response = await PUT(new Request('http://localhost', { method: 'PUT' }), {
      params: { id: 'message-1' },
    })

    expect(response.status).toBe(200)
    expect(recipient.status).toBe('archived')
    expect(recipient.archivedAt).toBeInstanceOf(Date)
    expect(emFork.flush).toHaveBeenCalledTimes(1)
  })

  it('restores read status on DELETE when readAt exists', async () => {
    const recipient = {
      archivedAt: new Date('2026-02-15T10:00:00.000Z'),
      status: 'archived',
      readAt: new Date('2026-02-15T08:00:00.000Z'),
    }

    emFork.findOne.mockImplementation(async (entity: unknown) => {
      if (entity === Message) return { id: 'message-1', organizationId: 'org-1' }
      if (entity === MessageRecipient) return recipient
      return null
    })

    const response = await DELETE(new Request('http://localhost', { method: 'DELETE' }), {
      params: { id: 'message-1' },
    })

    expect(response.status).toBe(200)
    expect(recipient.archivedAt).toBeNull()
    expect(recipient.status).toBe('read')
    expect(emFork.flush).toHaveBeenCalledTimes(1)
  })

  it('restores unread status on DELETE when readAt is missing', async () => {
    const recipient = {
      archivedAt: new Date('2026-02-15T10:00:00.000Z'),
      status: 'archived',
      readAt: null,
    }

    emFork.findOne.mockImplementation(async (entity: unknown) => {
      if (entity === Message) return { id: 'message-1', organizationId: 'org-1' }
      if (entity === MessageRecipient) return recipient
      return null
    })

    const response = await DELETE(new Request('http://localhost', { method: 'DELETE' }), {
      params: { id: 'message-1' },
    })

    expect(response.status).toBe(200)
    expect(recipient.archivedAt).toBeNull()
    expect(recipient.status).toBe('unread')
    expect(emFork.flush).toHaveBeenCalledTimes(1)
  })
})
