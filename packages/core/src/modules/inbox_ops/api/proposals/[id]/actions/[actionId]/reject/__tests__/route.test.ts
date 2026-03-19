/** @jest-environment node */

import { POST } from '@open-mercato/core/modules/inbox_ops/api/proposals/[id]/actions/[actionId]/reject/route'
import { InboxProposal, InboxProposalAction } from '@open-mercato/core/modules/inbox_ops/data/entities'

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

const mockEm = { fork: jest.fn() }

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    return null
  }),
}

const mockEventBus = { emit: jest.fn() }

const mockRejectAction = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/core/modules/inbox_ops/lib/eventBus', () => ({
  resolveOptionalEventBus: jest.fn(() => mockEventBus),
}))

jest.mock('@open-mercato/core/modules/inbox_ops/lib/executionEngine', () => ({
  rejectAction: jest.fn((...args: unknown[]) => mockRejectAction(...args)),
}))

function makeRequest() {
  return new Request('http://localhost/api/inbox_ops/proposals/proposal-1/actions/action-1/reject', {
    method: 'POST',
  })
}

describe('POST /api/inbox_ops/proposals/[id]/actions/[actionId]/reject', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    mockRejectAction.mockResolvedValue(undefined)
  })

  it('rejects a pending action and returns ok', async () => {
    const action = {
      id: 'action-1',
      proposalId: 'proposal-1',
      actionType: 'create_order',
      status: 'pending',
    } as unknown as InboxProposalAction

    const proposal = {
      id: 'proposal-1',
      isActive: true,
    } as unknown as InboxProposal

    mockFindOneWithDecryption
      .mockResolvedValueOnce(action)
      .mockResolvedValueOnce(proposal)

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(mockRejectAction).toHaveBeenCalledWith(
      action,
      expect.objectContaining({
        userId: 'user-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      }),
    )
  })

  it('allows rejecting a failed action', async () => {
    const action = {
      id: 'action-1',
      proposalId: 'proposal-1',
      actionType: 'create_order',
      status: 'failed',
    } as unknown as InboxProposalAction

    const proposal = {
      id: 'proposal-1',
      isActive: true,
    } as unknown as InboxProposal

    mockFindOneWithDecryption
      .mockResolvedValueOnce(action)
      .mockResolvedValueOnce(proposal)

    const response = await POST(makeRequest())
    expect(response.status).toBe(200)
    expect(mockRejectAction).toHaveBeenCalled()
  })

  it('returns 409 when action is already executed', async () => {
    const action = {
      id: 'action-1',
      proposalId: 'proposal-1',
      actionType: 'create_order',
      status: 'executed',
    } as unknown as InboxProposalAction

    const proposal = {
      id: 'proposal-1',
      isActive: true,
    } as unknown as InboxProposal

    mockFindOneWithDecryption
      .mockResolvedValueOnce(action)
      .mockResolvedValueOnce(proposal)

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.error).toContain('already processed')
    expect(mockRejectAction).not.toHaveBeenCalled()
  })

  it('returns 409 when action is already rejected', async () => {
    const action = {
      id: 'action-1',
      proposalId: 'proposal-1',
      actionType: 'create_order',
      status: 'rejected',
    } as unknown as InboxProposalAction

    const proposal = {
      id: 'proposal-1',
      isActive: true,
    } as unknown as InboxProposal

    mockFindOneWithDecryption
      .mockResolvedValueOnce(action)
      .mockResolvedValueOnce(proposal)

    const response = await POST(makeRequest())
    expect(response.status).toBe(409)
    expect(mockRejectAction).not.toHaveBeenCalled()
  })

  it('returns 404 when action not found', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce(null)

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(404)
    expect(payload.error).toContain('Action not found')
    expect(mockRejectAction).not.toHaveBeenCalled()
  })

  it('returns 409 when proposal has been superseded', async () => {
    const action = {
      id: 'action-1',
      proposalId: 'proposal-1',
      actionType: 'create_order',
      status: 'pending',
    } as unknown as InboxProposalAction

    mockFindOneWithDecryption
      .mockResolvedValueOnce(action)
      .mockResolvedValueOnce(null)

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.error).toContain('superseded')
    expect(mockRejectAction).not.toHaveBeenCalled()
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
