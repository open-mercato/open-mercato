/** @jest-environment node */

import { POST } from '@open-mercato/core/modules/inbox_ops/api/proposals/[id]/accept-all/route'
import { InboxProposal } from '@open-mercato/core/modules/inbox_ops/data/entities'

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

const mockAcceptAllActions = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/core/modules/inbox_ops/lib/eventBus', () => ({
  resolveOptionalEventBus: jest.fn(() => mockEventBus),
}))

jest.mock('@open-mercato/core/modules/inbox_ops/lib/executionEngine', () => ({
  acceptAllActions: jest.fn((...args: unknown[]) => mockAcceptAllActions(...args)),
}))

function makeRequest(proposalId = 'proposal-1') {
  return new Request(`http://localhost/api/inbox_ops/proposals/${proposalId}/accept-all`, {
    method: 'POST',
  })
}

describe('POST /api/inbox_ops/proposals/[id]/accept-all', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
  })

  it('accepts all actions and returns results', async () => {
    const proposal = {
      id: 'proposal-1',
      isActive: true,
    } as unknown as InboxProposal

    mockFindOneWithDecryption.mockResolvedValueOnce(proposal)
    mockAcceptAllActions.mockResolvedValueOnce({
      results: [
        { success: true, createdEntityId: 'order-1', createdEntityType: 'sales_order' },
        { success: true, createdEntityId: 'person-1', createdEntityType: 'customer_person' },
      ],
      stoppedOnFailure: false,
    })

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.succeeded).toBe(2)
    expect(payload.failed).toBe(0)
    expect(payload.stoppedOnFailure).toBe(false)
    expect(payload.results).toHaveLength(2)
  })

  it('stops on failure and reports partial results', async () => {
    const proposal = {
      id: 'proposal-1',
      isActive: true,
    } as unknown as InboxProposal

    mockFindOneWithDecryption.mockResolvedValueOnce(proposal)
    mockAcceptAllActions.mockResolvedValueOnce({
      results: [
        { success: true, createdEntityId: 'order-1', createdEntityType: 'sales_order' },
        { success: false, error: 'Insufficient permissions', statusCode: 403 },
      ],
      stoppedOnFailure: true,
    })

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(false)
    expect(payload.succeeded).toBe(1)
    expect(payload.failed).toBe(1)
    expect(payload.stoppedOnFailure).toBe(true)
  })

  it('returns 404 when proposal not found', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce(null)

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(404)
    expect(payload.error).toContain('not found')
    expect(mockAcceptAllActions).not.toHaveBeenCalled()
  })

  it('passes execution context with entities to acceptAllActions', async () => {
    const proposal = {
      id: 'proposal-1',
      isActive: true,
    } as unknown as InboxProposal

    mockFindOneWithDecryption.mockResolvedValueOnce(proposal)
    mockAcceptAllActions.mockResolvedValueOnce({
      results: [],
      stoppedOnFailure: false,
    })

    await POST(makeRequest())

    expect(mockAcceptAllActions).toHaveBeenCalledWith(
      'proposal-1',
      expect.objectContaining({
        userId: 'user-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      }),
    )
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
