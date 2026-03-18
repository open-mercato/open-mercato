/** @jest-environment node */

import { POST } from '@open-mercato/core/modules/inbox_ops/api/emails/[id]/reprocess/route'
import { InboxDiscrepancy, InboxEmail, InboxProposal, InboxProposalAction } from '@open-mercato/core/modules/inbox_ops/data/entities'

const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

const mockGetAuth = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuth(...args),
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

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/core/modules/inbox_ops/lib/eventBus', () => ({
  resolveOptionalEventBus: jest.fn(() => null),
}))

const mockEmitInboxOpsEvent = jest.fn()
jest.mock('@open-mercato/core/modules/inbox_ops/events', () => ({
  emitInboxOpsEvent: (...args: unknown[]) => mockEmitInboxOpsEvent(...args),
}))

function makeRequest() {
  return new Request('http://localhost/api/inbox_ops/emails/email-1/reprocess', {
    method: 'POST',
  })
}

describe('POST /api/inbox_ops/emails/[id]/reprocess', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    mockEm.flush.mockResolvedValue(undefined)
    mockEmitInboxOpsEvent.mockResolvedValue(undefined)
    mockGetAuth.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    mockContainer.resolve.mockImplementation((token: string) => {
      if (token === 'em') return mockEm
      return null
    })
  })

  it('returns 409 when an active proposal already has execution started', async () => {
    const email = {
      id: 'email-1',
      status: 'failed',
      processingError: 'previous error',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      forwardedByAddress: 'ops@example.com',
      subject: 'Order request',
    } as unknown as InboxEmail

    const proposal = {
      id: 'proposal-1',
      inboxEmailId: 'email-1',
      status: 'pending',
      isActive: true,
      metadata: null,
    } as unknown as InboxProposal

    const startedAction = {
      id: 'action-1',
      proposalId: 'proposal-1',
      status: 'executed',
    } as unknown as InboxProposalAction

    mockFindOneWithDecryption.mockResolvedValueOnce(email)
    mockFindWithDecryption
      .mockResolvedValueOnce([proposal])
      .mockResolvedValueOnce([startedAction])

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.error).toContain('Cannot reprocess')
    expect(email.status).toBe('failed')
    expect(email.processingError).toBe('previous error')
    expect(mockEmitInboxOpsEvent).not.toHaveBeenCalled()
  })

  it('supersedes active proposals and requeues email for processing', async () => {
    const email = {
      id: 'email-1',
      status: 'failed',
      processingError: 'previous error',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      forwardedByAddress: 'ops@example.com',
      subject: 'Order request',
    } as unknown as InboxEmail

    const proposal = {
      id: 'proposal-1',
      inboxEmailId: 'email-1',
      status: 'pending',
      isActive: true,
      metadata: {},
      reviewedAt: null,
      reviewedByUserId: null,
    } as unknown as InboxProposal

    const pendingAction = {
      id: 'action-1',
      proposalId: 'proposal-1',
      status: 'pending',
      executionError: null,
      executedAt: null,
      executedByUserId: null,
    } as unknown as InboxProposalAction

    const failedAction = {
      id: 'action-2',
      proposalId: 'proposal-1',
      status: 'failed',
      executionError: 'Failed in previous attempt',
      executedAt: null,
      executedByUserId: null,
    } as unknown as InboxProposalAction

    const discrepancy = {
      id: 'disc-1',
      proposalId: 'proposal-1',
      resolved: false,
    } as unknown as InboxDiscrepancy

    mockFindOneWithDecryption.mockResolvedValueOnce(email)
    mockFindWithDecryption
      .mockResolvedValueOnce([proposal])
      .mockResolvedValueOnce([pendingAction, failedAction])
      .mockResolvedValueOnce([discrepancy])

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      ok: true,
      retiredProposalCount: 1,
      retiredActionCount: 2,
    })

    expect(proposal.isActive).toBe(false)
    expect(proposal.status).toBe('rejected')
    expect(proposal.reviewedByUserId).toBe('user-1')
    expect(proposal.reviewedAt).toBeInstanceOf(Date)
    expect((proposal.metadata as Record<string, unknown>).supersededReason).toBe('email_reprocessed')

    expect(pendingAction.status).toBe('rejected')
    expect(failedAction.status).toBe('rejected')
    expect(failedAction.executionError).toBe('Failed in previous attempt')
    expect(discrepancy.resolved).toBe(true)

    expect(email.status).toBe('received')
    expect(email.processingError).toBeNull()

    expect(mockEmitInboxOpsEvent).toHaveBeenNthCalledWith(
      1,
      'inbox_ops.email.reprocessed',
      expect.objectContaining({ emailId: 'email-1' }),
    )
    expect(mockEmitInboxOpsEvent).toHaveBeenNthCalledWith(
      2,
      'inbox_ops.email.received',
      expect.objectContaining({ emailId: 'email-1' }),
    )
  })
})
