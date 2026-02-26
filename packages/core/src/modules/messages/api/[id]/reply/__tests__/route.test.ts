import { POST } from '@open-mercato/core/modules/messages/api/[id]/reply/route'

const resolveMessageContextMock = jest.fn()
const canUseMessageEmailFeatureMock = jest.fn()

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
  canUseMessageEmailFeature: (...args: unknown[]) => canUseMessageEmailFeatureMock(...args),
}))

describe('messages /api/messages/[id]/reply', () => {
  let commandBus: { execute: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()

    commandBus = {
      execute: jest.fn(async () => ({
        result: { id: 'new-message-id' },
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

  it('creates a reply and returns 201 with the new message id', async () => {
    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ body: 'Hello there' }),
      }),
      { params: { id: 'message-1' } },
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ id: 'new-message-id' })
    expect(commandBus.execute).toHaveBeenCalledWith(
      'messages.messages.reply',
      expect.objectContaining({
        input: expect.objectContaining({
          messageId: 'message-1',
          body: 'Hello there',
          userId: 'user-1',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
        }),
      }),
    )
  })

  it('passes explicit recipients to the reply command', async () => {
    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({
          body: 'Hello there',
          recipients: [{ userId: '11111111-1111-4111-8111-111111111111', type: 'to' }],
        }),
      }),
      { params: { id: 'message-1' } },
    )

    expect(response.status).toBe(201)
    expect(commandBus.execute).toHaveBeenCalledWith(
      'messages.messages.reply',
      expect.objectContaining({
        input: expect.objectContaining({
          recipients: [{ userId: '11111111-1111-4111-8111-111111111111', type: 'to' }],
        }),
      }),
    )
  })

  it('returns 403 when sendViaEmail is requested but email feature is unavailable', async () => {
    canUseMessageEmailFeatureMock.mockResolvedValue(false)

    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ body: 'Hello', sendViaEmail: true }),
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
        body: JSON.stringify({ body: 'Hi' }),
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
        body: JSON.stringify({ body: 'Hi' }),
      }),
      { params: { id: 'message-1' } },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Access denied' })
  })

  it('returns 409 when reply is not allowed for the message type', async () => {
    commandBus.execute.mockRejectedValueOnce(new Error('Reply is not allowed for this message type'))

    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ body: 'Hi' }),
      }),
      { params: { id: 'message-1' } },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Reply is not allowed for this message type' })
  })

  it('returns 409 when there are no recipients available for reply', async () => {
    commandBus.execute.mockRejectedValueOnce(new Error('No recipients available for reply'))

    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ body: 'Hi' }),
      }),
      { params: { id: 'message-1' } },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'No recipients available for reply' })
  })

  it('rethrows unexpected errors', async () => {
    commandBus.execute.mockRejectedValueOnce(new Error('Unexpected database failure'))

    await expect(
      POST(
        new Request('http://localhost', {
          method: 'POST',
          body: JSON.stringify({ body: 'Hi' }),
        }),
        { params: { id: 'message-1' } },
      ),
    ).rejects.toThrow('Unexpected database failure')
  })
})
