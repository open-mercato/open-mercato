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

jest.mock('@open-mercato/core/modules/inbox_ops/events', () => ({
  emitInboxOpsEvent: jest.fn(),
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

  it('returns 503 when RESEND_API_KEY is not set', async () => {
    delete process.env.RESEND_API_KEY

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(503)
    expect(payload.error).toContain('not configured')
  })

  it('returns 503 when email delivery is disabled', async () => {
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
})
