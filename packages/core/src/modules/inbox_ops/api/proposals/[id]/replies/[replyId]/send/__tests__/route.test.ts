/** @jest-environment node */

import { POST } from '@open-mercato/core/modules/inbox_ops/api/proposals/[id]/replies/[replyId]/send/route'
import { InboxProposal, InboxProposalAction, InboxEmail } from '@open-mercato/core/modules/inbox_ops/data/entities'

const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

const authResult = {
  sub: 'user-1',
  tenantId: 'tenant-1',
  orgId: 'org-1',
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => authResult),
}))

const mockEm = {
  fork: jest.fn(),
  flush: jest.fn(),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    return null
  }),
}

const mockEventBus = { emit: jest.fn() }

const mockResendSend = jest.fn()

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: (...args: unknown[]) => mockResendSend(...args) },
  })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/core/modules/inbox_ops/lib/eventBus', () => ({
  resolveOptionalEventBus: jest.fn(() => mockEventBus),
}))

const mockEmitInboxOpsEvent = jest.fn()
jest.mock('@open-mercato/core/modules/inbox_ops/events', () => ({
  emitInboxOpsEvent: (...args: unknown[]) => mockEmitInboxOpsEvent(...args),
}))

const mockCreateMessageRecordForReply = jest.fn()
jest.mock('@open-mercato/core/modules/inbox_ops/lib/messagesIntegration', () => ({
  createMessageRecordForReply: (...args: unknown[]) => mockCreateMessageRecordForReply(...args),
}))

const originalEnv = process.env

function makeRequest() {
  return new Request('http://localhost/api/inbox_ops/proposals/proposal-1/replies/reply-1/send', {
    method: 'POST',
  })
}

function setupHappyPath() {
  const proposal = {
    id: 'proposal-1',
    inboxEmailId: 'email-1',
    isActive: true,
  } as unknown as InboxProposal

  const action = {
    id: 'reply-1',
    proposalId: 'proposal-1',
    actionType: 'draft_reply',
    status: 'executed',
    payload: {
      to: 'customer@example.com',
      subject: 'Re: Order inquiry',
      body: 'Thank you for your order.',
    },
    metadata: {},
  } as unknown as InboxProposalAction

  const email = {
    id: 'email-1',
    messageId: '<msg-123@example.com>',
    emailReferences: ['<ref-1@example.com>'],
  } as unknown as InboxEmail

  mockFindOneWithDecryption
    .mockResolvedValueOnce(proposal)
    .mockResolvedValueOnce(action)
    .mockResolvedValueOnce(email)

  return { proposal, action, email }
}

describe('POST /api/inbox_ops/proposals/[id]/replies/[replyId]/send', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    mockEm.flush.mockResolvedValue(undefined)
    mockEmitInboxOpsEvent.mockResolvedValue(undefined)
    mockCreateMessageRecordForReply.mockResolvedValue(null)
    process.env = { ...originalEnv, RESEND_API_KEY: 'test-api-key' }
    mockResendSend.mockResolvedValue({ data: { id: 'sent-msg-1' }, error: null })
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('sends reply and returns sentMessageId', async () => {
    setupHappyPath()

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.sentMessageId).toBe('sent-msg-1')
    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'customer@example.com',
        subject: 'Re: Order inquiry',
        text: 'Thank you for your order.',
        headers: expect.objectContaining({
          'In-Reply-To': '<msg-123@example.com>',
          'References': '<ref-1@example.com>',
        }),
      }),
    )
  })

  it('returns 503 when RESEND_API_KEY is not set and messages module unavailable', async () => {
    setupHappyPath()
    delete process.env.RESEND_API_KEY

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(503)
    expect(payload.error).toContain('not configured')
  })

  it('returns 503 when email delivery is disabled and messages module unavailable', async () => {
    setupHappyPath()
    process.env.OM_DISABLE_EMAIL_DELIVERY = 'true'

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(503)
    expect(payload.error).toContain('disabled')

    delete process.env.OM_DISABLE_EMAIL_DELIVERY
  })

  it('returns 404 when proposal not found', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce(null)

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(404)
    expect(payload.error).toContain('not found')
  })

  it('returns 404 when reply action not found', async () => {
    const proposal = {
      id: 'proposal-1',
      inboxEmailId: 'email-1',
      isActive: true,
    } as unknown as InboxProposal

    mockFindOneWithDecryption
      .mockResolvedValueOnce(proposal)
      .mockResolvedValueOnce(null)

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(404)
    expect(payload.error).toContain('Reply action not found')
  })

  it('returns 409 when action not yet accepted', async () => {
    const proposal = {
      id: 'proposal-1',
      inboxEmailId: 'email-1',
      isActive: true,
    } as unknown as InboxProposal

    const action = {
      id: 'reply-1',
      proposalId: 'proposal-1',
      actionType: 'draft_reply',
      status: 'pending',
      payload: { to: 'test@test.com', subject: 'Test', body: 'Body' },
    } as unknown as InboxProposalAction

    mockFindOneWithDecryption
      .mockResolvedValueOnce(proposal)
      .mockResolvedValueOnce(action)

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.error).toContain('must be accepted first')
  })

  it('returns 502 when Resend fails', async () => {
    setupHappyPath()
    mockResendSend.mockResolvedValueOnce({
      data: null,
      error: { message: 'Invalid API key' },
    })

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(502)
    expect(payload.error).toContain('Failed to send email')
  })

  it('returns 401 when not authenticated', async () => {
    const { getAuthFromRequest } = jest.requireMock('@open-mercato/shared/lib/auth/server') as {
      getAuthFromRequest: jest.Mock
    }
    getAuthFromRequest.mockResolvedValueOnce(null)

    const response = await POST(makeRequest())
    expect(response.status).toBe(401)
  })

  describe('messages registration', () => {
    it('records the sent reply in messages after external delivery succeeds', async () => {
      const { action } = setupHappyPath()
      mockCreateMessageRecordForReply.mockResolvedValueOnce({ messageId: 'msg-record-123' })

      const response = await POST(makeRequest())
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(payload.ok).toBe(true)
      expect(payload.sentMessageId).toBe('sent-msg-1')
      expect(payload.messageRecordId).toBe('msg-record-123')
      expect(mockResendSend).toHaveBeenCalled()
      expect(action.metadata).toEqual(expect.objectContaining({
        sentMessageId: 'sent-msg-1',
        messageRecordId: 'msg-record-123',
      }))
      expect(mockResendSend.mock.invocationCallOrder[0]).toBeLessThan(
        mockCreateMessageRecordForReply.mock.invocationCallOrder[0],
      )
    })

    it('emits reply.sent event with delivery and message record identifiers', async () => {
      setupHappyPath()
      mockCreateMessageRecordForReply.mockResolvedValueOnce({ messageId: 'msg-record-456' })

      await POST(makeRequest())

      expect(mockEmitInboxOpsEvent).toHaveBeenCalledWith(
        'inbox_ops.reply.sent',
        expect.objectContaining({
          proposalId: 'proposal-1',
          actionId: 'reply-1',
          toAddress: 'customer@example.com',
          sentMessageId: 'sent-msg-1',
          messageRecordId: 'msg-record-456',
        }),
      )
    })

    it('calls createMessageRecordForReply with correct arguments', async () => {
      setupHappyPath()
      mockCreateMessageRecordForReply.mockResolvedValueOnce({ messageId: 'msg-123' })

      await POST(makeRequest())

      expect(mockCreateMessageRecordForReply).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'customer@example.com',
          subject: 'Re: Order inquiry',
          body: 'Thank you for your order.',
        }),
        'email-1',
        expect.objectContaining({
          scope: expect.objectContaining({
            tenantId: 'tenant-1',
            organizationId: 'org-1',
            userId: 'user-1',
          }),
        }),
      )
    })

    it('falls back to Resend when messages integration returns null', async () => {
      setupHappyPath()
      mockCreateMessageRecordForReply.mockResolvedValueOnce(null)

      const response = await POST(makeRequest())
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(payload.ok).toBe(true)
      expect(payload.messageRecordId).toBeUndefined()
      expect(mockResendSend).toHaveBeenCalled()
    })

    it('does not create a message record when external delivery fails', async () => {
      setupHappyPath()
      mockResendSend.mockResolvedValueOnce({
        data: null,
        error: { message: 'Invalid API key' },
      })

      const response = await POST(makeRequest())
      const payload = await response.json()

      expect(response.status).toBe(502)
      expect(payload.error).toContain('Failed to send email')
      expect(mockCreateMessageRecordForReply).not.toHaveBeenCalled()
    })
  })
})
