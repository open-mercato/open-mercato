import { POST } from '@open-mercato/core/modules/messages/api/[id]/resend-failed/route'
import { conflict, forbidden, notFound } from '@open-mercato/shared/lib/crud/errors'

const resolveMessageContextMock = jest.fn()
const canUseMessageEmailFeatureMock = jest.fn(async () => true)

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
  canUseMessageEmailFeature: (...args: unknown[]) => canUseMessageEmailFeatureMock(...args),
}))

const MESSAGE_ID = '550e8400-e29b-41d4-a716-446655440001'
const PARTICIPANT_ID = '550e8400-e29b-41d4-a716-446655440002'

describe('POST /api/messages/[id]/resend-failed', () => {
  let commandBus: { execute: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()
    commandBus = { execute: jest.fn(async () => ({ result: { id: 'new-1', threadId: 'thread-1', sourceMessageId: MESSAGE_ID }, logEntry: null })) }
    resolveMessageContextMock.mockResolvedValue({
      ctx: {
        container: {
          resolve: (name: string) => {
            if (name === 'commandBus') return commandBus
            return null
          },
        },
        auth: { sub: 'user-1', features: ['messages.compose'] },
      },
      scope: { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' },
    })
  })

  function request(body: unknown) {
    return new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) })
  }

  it('creates the resend message through the command and returns 201', async () => {
    const response = await POST(request({ participantIds: [PARTICIPANT_ID] }), { params: { id: MESSAGE_ID } })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ id: 'new-1', threadId: 'thread-1' })
    expect(commandBus.execute).toHaveBeenCalledWith(
      'messages.messages.resend_failed',
      expect.objectContaining({
        input: { participantIds: [PARTICIPANT_ID], messageId: MESSAGE_ID, tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' },
      }),
    )
  })

  it.each([
    ['404 for an unknown message', notFound('Message not found'), 404],
    ['403 for someone other than the sender', forbidden('Only the sender can resend a message.'), 403],
    ['409 when nothing failed', conflict('There are no failed recipients to resend to.'), 409],
  ])('returns %s', async (_label, error, status) => {
    commandBus.execute.mockRejectedValueOnce(error)

    const response = await POST(request({}), { params: { id: MESSAGE_ID } })

    expect(response.status).toBe(status)
  })

  it('rejects an invalid payload with 400 before running the command', async () => {
    const response = await POST(request({ participantIds: ['not-a-uuid'] }), { params: { id: MESSAGE_ID } })

    expect(response.status).toBe(400)
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('treats an empty body as resending to every failed participant', async () => {
    const response = await POST(new Request('http://localhost', { method: 'POST' }), { params: { id: MESSAGE_ID } })

    expect(response.status).toBe(201)
    expect(commandBus.execute).toHaveBeenCalledWith(
      'messages.messages.resend_failed',
      expect.objectContaining({ input: expect.not.objectContaining({ participantIds: expect.anything() }) }),
    )
  })

  it('rejects malformed JSON with 400 before running the command', async () => {
    const response = await POST(new Request('http://localhost', { method: 'POST', body: '{"participantIds":' }), { params: { id: MESSAGE_ID } })

    expect(response.status).toBe(400)
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('requires the messages.email feature', async () => {
    canUseMessageEmailFeatureMock.mockResolvedValueOnce(false)

    const response = await POST(request({}), { params: { id: MESSAGE_ID } })

    expect(response.status).toBe(403)
    expect(commandBus.execute).not.toHaveBeenCalled()
  })
})
