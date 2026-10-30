import { DELETE, PUT } from '@open-mercato/core/modules/messages/api/[id]/archive/route'
import { Message, MessageRecipient } from '@open-mercato/core/modules/messages/data/entities'

const resolveMessageContextMock = jest.fn()
const ensureChannelInboxRecipientMock = jest.fn(async (..._args: unknown[]) => null as unknown)

jest.mock('@open-mercato/core/modules/messages/lib/channelInboxRecipient', () => ({
  ensureChannelInboxRecipient: (...args: unknown[]) => ensureChannelInboxRecipientMock(...args),
}))

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
  hasOrganizationAccess: jest.fn(() => true),
  // Channel-inbox widening (#6106) off: the caller holds no channel-inbox row.
  canUseChannelThreadFallback: jest.fn(async () => false),
}))

describe('messages /api/messages/[id]/archive', () => {
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
    expect(commandBus.execute).toHaveBeenCalledWith(
      'messages.recipients.archive',
      expect.objectContaining({
        input: expect.objectContaining({
          messageId: 'message-1',
          userId: 'user-1',
        }),
      }),
    )
  })

  it('returns a domain-specific error when sender archives a sent message without a recipient row', async () => {
    emFork.findOne.mockImplementation(async (entity: unknown) => {
      if (entity === Message) return { id: 'message-1', organizationId: 'org-1', senderUserId: 'user-1' }
      if (entity === MessageRecipient) return null
      return null
    })

    const response = await PUT(new Request('http://localhost', { method: 'PUT' }), {
      params: { id: 'message-1' },
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      code: 'messages_sender_archive_unsupported',
      error: 'You cannot archive messages you sent.',
    })
    expect(commandBus.execute).not.toHaveBeenCalled()
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
    expect(commandBus.execute).toHaveBeenCalledWith(
      'messages.recipients.unarchive',
      expect.objectContaining({
        input: expect.objectContaining({
          messageId: 'message-1',
          userId: 'user-1',
        }),
      }),
    )
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
    expect(commandBus.execute).toHaveBeenCalledWith(
      'messages.recipients.unarchive',
      expect.objectContaining({
        input: expect.objectContaining({
          messageId: 'message-1',
          userId: 'user-1',
        }),
      }),
    )
  })
})

describe('messages /api/messages/[id]/archive on a channel-inbox message (#6106)', () => {
  const container = {
    resolve: (name: string) => {
      if (name === 'em') return { fork: () => emFork }
      if (name === 'commandBus') return commandBus
      return null
    },
  }
  const emFork = { findOne: jest.fn() }
  const commandBus = { execute: jest.fn(async () => ({ result: { ok: true } })) }

  beforeEach(() => {
    jest.clearAllMocks()
    ensureChannelInboxRecipientMock.mockResolvedValue(null)
    emFork.findOne.mockImplementation(async (entity: unknown) => {
      if (entity === Message) return { id: 'message-1', organizationId: 'org-1', senderUserId: 'system-user' }
      return null
    })
    resolveMessageContextMock.mockResolvedValue({
      ctx: { container },
      scope: { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' },
    })
  })

  it('creates the caller recipient row on first action instead of answering 403', async () => {
    ensureChannelInboxRecipientMock.mockResolvedValueOnce({ id: 'recipient-1', status: 'unread' })

    const response = await PUT(new Request('http://localhost', { method: 'PUT' }), {
      params: { id: 'message-1' },
    })

    expect(response.status).toBe(200)
    expect(ensureChannelInboxRecipientMock).toHaveBeenCalledWith(
      container,
      expect.anything(),
      { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' },
      'message-1',
    )
    expect(commandBus.execute).toHaveBeenCalledWith(
      'messages.recipients.archive',
      expect.objectContaining({ input: expect.objectContaining({ messageId: 'message-1', userId: 'user-1' }) }),
    )
  })

  it('still answers 403 when the message is not a channel-inbox message for the caller', async () => {
    const response = await PUT(new Request('http://localhost', { method: 'PUT' }), {
      params: { id: 'message-1' },
    })

    expect(response.status).toBe(403)
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('does not look for a channel-inbox row when the caller already has one', async () => {
    emFork.findOne.mockImplementation(async (entity: unknown) => {
      if (entity === Message) return { id: 'message-1', organizationId: 'org-1', senderUserId: 'system-user' }
      if (entity === MessageRecipient) return { id: 'recipient-1', status: 'read', archivedAt: null }
      return null
    })

    const response = await PUT(new Request('http://localhost', { method: 'PUT' }), {
      params: { id: 'message-1' },
    })

    expect(response.status).toBe(200)
    expect(ensureChannelInboxRecipientMock).not.toHaveBeenCalled()
  })
})
