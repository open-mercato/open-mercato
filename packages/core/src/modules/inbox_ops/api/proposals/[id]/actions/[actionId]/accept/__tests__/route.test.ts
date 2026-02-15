/** @jest-environment node */

import { POST } from '@open-mercato/core/modules/inbox_ops/api/proposals/[id]/actions/[actionId]/accept/route'
import { InboxProposal, InboxProposalAction } from '@open-mercato/core/modules/inbox_ops/data/entities'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'

interface MockEntityManager {
  fork: jest.Mock<MockEntityManager, []>
  findOne: jest.Mock<Promise<unknown>, [unknown, Record<string, unknown>?]>
}

type AuthFixture = {
  userId?: string | null
  sub?: string | null
  tenantId?: string | null
  organizationId?: string | null
}

const mockEm: MockEntityManager = {
  fork: jest.fn<MockEntityManager, []>(),
  findOne: jest.fn<Promise<unknown>, [unknown, Record<string, unknown>?]>(),
}

const authFixture: AuthFixture = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'auth') return authFixture
    return null
  }),
}

const mockEventBus = { emit: jest.fn<Promise<void>, [string, Record<string, unknown>]>() }

const mockExecuteAction = jest.fn<
  Promise<{ success: boolean; createdEntityId?: string | null; createdEntityType?: string | null; error?: string; statusCode?: number }>,
  [InboxProposalAction, { em: MockEntityManager; userId: string; tenantId: string; organizationId: string; eventBus: typeof mockEventBus | null; container: typeof mockContainer; auth: AuthContext }]
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

describe('POST /api/inbox_ops/proposals/[id]/actions/[actionId]/accept', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    authFixture.userId = 'user-1'
    authFixture.sub = null
    authFixture.tenantId = 'tenant-1'
    authFixture.organizationId = 'org-1'
    mockExecuteAction.mockResolvedValue({
      success: true,
      createdEntityId: 'order-1',
      createdEntityType: 'sales_order',
      statusCode: 200,
    })
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

    mockEm.findOne
      .mockResolvedValueOnce(failedAction)
      .mockResolvedValueOnce(activeProposal)

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      ok: true,
      createdEntityId: 'order-1',
      createdEntityType: 'sales_order',
    })

    expect(mockExecuteAction).toHaveBeenCalledTimes(1)
    expect(mockExecuteAction).toHaveBeenCalledWith(
      failedAction,
      expect.objectContaining({
        userId: 'user-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      }),
    )
  })

  it('returns 409 when proposal has been superseded', async () => {
    const failedAction = {
      id: 'action-1',
      proposalId: 'proposal-1',
      actionType: 'create_order',
      status: 'failed',
    } as unknown as InboxProposalAction

    mockEm.findOne
      .mockResolvedValueOnce(failedAction)
      .mockResolvedValueOnce(null)

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.error).toContain('superseded')
    expect(mockExecuteAction).not.toHaveBeenCalled()
  })
})
