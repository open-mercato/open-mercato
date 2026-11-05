import { GET } from '@open-mercato/core/modules/messages/api/[id]/confirmation/route'
import { Message, MessageConfirmation, MessageRecipient } from '@open-mercato/core/modules/messages/data/entities'

const resolveMessageContextMock = jest.fn()

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
}))

function createMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'message-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    senderUserId: 'sender-1',
    deletedAt: null,
    ...overrides,
  }
}

describe('messages confirmation route', () => {
  let emFork: {
    findOne: jest.Mock
  }

  beforeEach(() => {
    jest.clearAllMocks()

    emFork = {
      findOne: jest.fn(),
    }

    resolveMessageContextMock.mockResolvedValue({
      ctx: {
        container: {
          resolve: (name: string) => {
            if (name === 'em') return { fork: () => emFork }
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

  it('returns default not confirmed payload when confirmation row is missing', async () => {
    emFork.findOne.mockImplementation(async (entity: unknown) => {
      if (entity === Message) return createMessage()
      if (entity === MessageRecipient) return { messageId: 'message-1', recipientUserId: 'user-1' }
      if (entity === MessageConfirmation) return null
      return null
    })

    const response = await GET(new Request('http://localhost', { method: 'GET' }), {
      params: { id: 'message-1' },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      messageId: 'message-1',
      confirmed: false,
      confirmedAt: null,
      confirmedByUserId: null,
    })
  })

  it('returns persisted confirmation status', async () => {
    const confirmedAt = new Date('2026-02-15T10:00:00.000Z')
    emFork.findOne.mockImplementation(async (entity: unknown) => {
      if (entity === Message) return createMessage()
      if (entity === MessageRecipient) return { messageId: 'message-1', recipientUserId: 'user-1' }
      if (entity === MessageConfirmation) {
        return {
          messageId: 'message-1',
          confirmed: true,
          confirmedAt,
          confirmedByUserId: 'user-1',
        }
      }
      return null
    })

    const response = await GET(new Request('http://localhost', { method: 'GET' }), {
      params: { id: 'message-1' },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      messageId: 'message-1',
      confirmed: true,
      confirmedAt: confirmedAt.toISOString(),
      confirmedByUserId: 'user-1',
    })
  })

  it('returns 403 when user has no access to message', async () => {
    emFork.findOne.mockImplementation(async (entity: unknown) => {
      if (entity === Message) return createMessage({ senderUserId: 'sender-2' })
      if (entity === MessageRecipient) return null
      return null
    })

    const response = await GET(new Request('http://localhost', { method: 'GET' }), {
      params: { id: 'message-1' },
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Access denied' })
  })
})
