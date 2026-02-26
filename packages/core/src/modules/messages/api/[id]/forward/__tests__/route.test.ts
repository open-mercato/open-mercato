import { POST } from '@open-mercato/core/modules/messages/api/[id]/forward/route'

const resolveMessageContextMock = jest.fn()
const canUseMessageEmailFeatureMock = jest.fn()

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
  canUseMessageEmailFeature: (...args: unknown[]) => canUseMessageEmailFeatureMock(...args),
  parseRequestBodySafe: async (req: Request) => req.json().catch(() => ({})),
}))

const VALID_USER_UUID = '550e8400-e29b-41d4-a716-446655440000'

describe('messages /api/messages/[id]/forward', () => {
  let commandBus: { execute: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()

    commandBus = {
      execute: jest.fn(async () => ({
        result: { id: 'forwarded-message-id' },
        logEntry: null,
      })),
    }

    canUseMessageEmailFeatureMock.mockResolvedValue(true)

    resolveMessageContextMock.mockResolvedValue({
      ctx: {
        container: {
          resolve: (name: string) => {
            if (name === 'commandBus') return commandBus
            return null
          },
        },
        auth: null,
      },
      scope: {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        userId: 'user-1',
      },
    })
  })

  it('forwards a message and returns 201 with the new message id', async () => {
    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ recipients: [{ userId: VALID_USER_UUID }] }),
      }),
      { params: { id: 'message-1' } },
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ id: 'forwarded-message-id' })
    expect(commandBus.execute).toHaveBeenCalledWith(
      'messages.messages.forward',
      expect.objectContaining({
        input: expect.objectContaining({
          messageId: 'message-1',
          recipients: [{ userId: VALID_USER_UUID, type: 'to' }],
          userId: 'user-1',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
        }),
      }),
    )
  })

  it('passes explicit body through to forward command', async () => {
    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({
          recipients: [{ userId: VALID_USER_UUID }],
          body: 'thread-aware forwarded body',
        }),
      }),
      { params: { id: 'message-1' } },
    )

    expect(response.status).toBe(201)
    expect(commandBus.execute).toHaveBeenCalledWith(
      'messages.messages.forward',
      expect.objectContaining({
        input: expect.objectContaining({
          body: 'thread-aware forwarded body',
        }),
      }),
    )
  })

  it('passes includeAttachments flag through to forward command', async () => {
    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({
          recipients: [{ userId: VALID_USER_UUID }],
          includeAttachments: true,
        }),
      }),
      { params: { id: 'message-1' } },
    )

    expect(response.status).toBe(201)
    expect(commandBus.execute).toHaveBeenCalledWith(
      'messages.messages.forward',
      expect.objectContaining({
        input: expect.objectContaining({
          includeAttachments: true,
        }),
      }),
    )
  })

  it('returns 403 when sendViaEmail is requested but email feature is unavailable', async () => {
    canUseMessageEmailFeatureMock.mockResolvedValue(false)

    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ recipients: [{ userId: VALID_USER_UUID }], sendViaEmail: true }),
      }),
      { params: { id: 'message-1' } },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Missing feature: messages.email' })
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('returns 404 when message is not found', async () => {
    commandBus.execute.mockRejectedValueOnce(new Error('Message not found'))

    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ recipients: [{ userId: VALID_USER_UUID }] }),
      }),
      { params: { id: 'missing-id' } },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Message not found' })
  })

  it('returns 403 when access is denied', async () => {
    commandBus.execute.mockRejectedValueOnce(new Error('Access denied'))

    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ recipients: [{ userId: VALID_USER_UUID }] }),
      }),
      { params: { id: 'message-1' } },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Access denied' })
  })

  it('returns 409 when forward is not allowed for the message type', async () => {
    commandBus.execute.mockRejectedValueOnce(new Error('Forward is not allowed for this message type'))

    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ recipients: [{ userId: VALID_USER_UUID }] }),
      }),
      { params: { id: 'message-1' } },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Forward is not allowed for this message type' })
  })

  it('returns 413 when generated forward body exceeds maximum length', async () => {
    commandBus.execute.mockRejectedValueOnce(new Error('Forward body exceeds maximum length'))

    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ recipients: [{ userId: VALID_USER_UUID }] }),
      }),
      { params: { id: 'message-1' } },
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ error: 'Forward body exceeds maximum length' })
  })

  it('rethrows unexpected errors', async () => {
    commandBus.execute.mockRejectedValueOnce(new Error('Unexpected database failure'))

    await expect(
      POST(
        new Request('http://localhost', {
          method: 'POST',
          body: JSON.stringify({ recipients: [{ userId: VALID_USER_UUID }] }),
        }),
        { params: { id: 'message-1' } },
      ),
    ).rejects.toThrow('Unexpected database failure')
  })
})
