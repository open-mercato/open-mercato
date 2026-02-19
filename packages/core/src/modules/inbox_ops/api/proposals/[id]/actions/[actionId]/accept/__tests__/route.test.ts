/** @jest-environment node */

import { POST } from '@open-mercato/core/modules/inbox_ops/api/proposals/[id]/actions/[actionId]/accept/route'
import { InboxProposal, InboxProposalAction } from '@open-mercato/core/modules/inbox_ops/data/entities'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'

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
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    return null
  }),
}

const mockEventBus = { emit: jest.fn() }

const mockExecuteAction = jest.fn<
  Promise<{ success: boolean; createdEntityId?: string | null; createdEntityType?: string | null; error?: string; statusCode?: number }>,
  [InboxProposalAction, { em: typeof mockEm; userId: string; tenantId: string; organizationId: string; eventBus: typeof mockEventBus | null; container: typeof mockContainer; auth: AuthContext }]
>()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/core/modules/inbox_ops/lib/eventBus', () => ({
  resolveOptionalEventBus: jest.fn(() => mockEventBus),
}))

jest.mock('@open-mercato/core/modules/inbox_ops/lib/executionEngine', () => ({
  executeAction: jest.fn((...args: unknown[]) => mockExecuteAction(...(args as Parameters<typeof mockExecuteAction>))),
}))

function makeRequest() {
  return new Request('http://localhost/api/inbox_ops/proposals/proposal-1/actions/action-1/accept', {
    method: 'POST',
  })
}

const freshActionFixture = {
  id: 'action-1',
  status: 'executed',
  createdEntityId: 'order-1',
  createdEntityType: 'sales_order',
  executedAt: new Date().toISOString(),
  executedByUserId: 'user-1',
}

const freshProposalFixture = {
  id: 'proposal-1',
  status: 'partial',
}

describe('POST /api/inbox_ops/proposals/[id]/actions/[actionId]/accept', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    mockContainer.resolve.mockImplementation((token: string) => {
      if (token === 'em') return mockEm
      return null
    })
    mockExecuteAction.mockResolvedValue({
      success: true,
      createdEntityId: 'order-1',
      createdEntityType: 'sales_order',
      statusCode: 200,
    })
  })

  function setupActionAndProposal(action: unknown, proposal: unknown) {
    mockFindOneWithDecryption
      .mockResolvedValueOnce(action)
      .mockResolvedValueOnce(proposal)
      .mockResolvedValueOnce(freshActionFixture)
      .mockResolvedValueOnce(freshProposalFixture)
  }

  it('accepts a pending action and returns enriched response', async () => {
    const pendingAction = {
      id: 'action-1',
      proposalId: 'proposal-1',
      actionType: 'create_order',
      status: 'pending',
    } as unknown as InboxProposalAction

    const activeProposal = {
      id: 'proposal-1',
      isActive: true,
    } as unknown as InboxProposal

    setupActionAndProposal(pendingAction, activeProposal)

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.action).toEqual(expect.objectContaining({
      id: 'action-1',
      status: 'executed',
      createdEntityId: 'order-1',
      createdEntityType: 'sales_order',
    }))
    expect(payload.proposal).toEqual(expect.objectContaining({
      id: 'proposal-1',
      status: 'partial',
    }))
    expect(mockExecuteAction).toHaveBeenCalledWith(
      pendingAction,
      expect.objectContaining({
        userId: 'user-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      }),
    )
  })

  it('allows retrying a failed action and delegates execution', async () => {
    const failedAction = {
      id: 'action-1',
      proposalId: 'proposal-1',
      actionType: 'create_order',
      status: 'failed',
    } as unknown as InboxProposalAction

    const activeProposal = {
      id: 'proposal-1',
      isActive: true,
    } as unknown as InboxProposal

    setupActionAndProposal(failedAction, activeProposal)

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.action.id).toBe('action-1')
    expect(mockExecuteAction).toHaveBeenCalledTimes(1)
  })

  it('returns 409 when proposal has been superseded', async () => {
    const failedAction = {
      id: 'action-1',
      proposalId: 'proposal-1',
      actionType: 'create_order',
      status: 'failed',
    } as unknown as InboxProposalAction

    mockFindOneWithDecryption
      .mockResolvedValueOnce(failedAction)
      .mockResolvedValueOnce(null)

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.error).toContain('superseded')
    expect(mockExecuteAction).not.toHaveBeenCalled()
  })

  it('returns 404 when action is not found', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce(null)

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(404)
    expect(payload.error).toContain('Action not found')
    expect(mockExecuteAction).not.toHaveBeenCalled()
  })

  it('returns 401 when not authenticated', async () => {
    const { getAuthFromRequest } = jest.requireMock('@open-mercato/shared/lib/auth/server') as {
      getAuthFromRequest: jest.Mock
    }
    getAuthFromRequest.mockResolvedValueOnce(null)

    const response = await POST(makeRequest())
    expect(response.status).toBe(401)
  })

  it('returns execution error when engine reports failure', async () => {
    const action = {
      id: 'action-1',
      proposalId: 'proposal-1',
      actionType: 'create_order',
      status: 'pending',
    } as unknown as InboxProposalAction

    const activeProposal = {
      id: 'proposal-1',
      isActive: true,
    } as unknown as InboxProposal

    mockFindOneWithDecryption
      .mockResolvedValueOnce(action)
      .mockResolvedValueOnce(activeProposal)

    mockExecuteAction.mockResolvedValueOnce({
      success: false,
      error: 'Insufficient permissions: sales.orders.manage required',
      statusCode: 403,
    })

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.error).toContain('Insufficient permissions')
  })

  it('returns 409 from engine when action was already processed', async () => {
    const action = {
      id: 'action-1',
      proposalId: 'proposal-1',
      actionType: 'create_order',
      status: 'executed',
    } as unknown as InboxProposalAction

    const activeProposal = {
      id: 'proposal-1',
      isActive: true,
    } as unknown as InboxProposal

    mockFindOneWithDecryption
      .mockResolvedValueOnce(action)
      .mockResolvedValueOnce(activeProposal)

    mockExecuteAction.mockResolvedValueOnce({
      success: false,
      error: 'Action already processed',
      statusCode: 409,
    })

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.error).toContain('already processed')
  })
})
