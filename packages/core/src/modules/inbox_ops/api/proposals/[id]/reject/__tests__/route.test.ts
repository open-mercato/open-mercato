/** @jest-environment node */

import { POST } from '@open-mercato/core/modules/inbox_ops/api/proposals/[id]/reject/route'
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

const mockRejectProposal = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/core/modules/inbox_ops/lib/eventBus', () => ({
  resolveOptionalEventBus: jest.fn(() => mockEventBus),
}))

jest.mock('@open-mercato/core/modules/inbox_ops/lib/executionEngine', () => ({
  rejectProposal: jest.fn((...args: unknown[]) => mockRejectProposal(...args)),
}))

function makeRequest(proposalId = 'proposal-1') {
  return new Request(`http://localhost/api/inbox_ops/proposals/${proposalId}/reject`, {
    method: 'POST',
  })
}

describe('POST /api/inbox_ops/proposals/[id]/reject', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    mockRejectProposal.mockResolvedValue(undefined)
  })

  it('rejects proposal and returns ok', async () => {
    const proposal = {
      id: 'proposal-1',
      isActive: true,
      status: 'pending',
    } as unknown as InboxProposal

    mockFindOneWithDecryption.mockResolvedValueOnce(proposal)

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(mockRejectProposal).toHaveBeenCalledWith(
      'proposal-1',
      expect.objectContaining({
        userId: 'user-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      }),
    )
  })

  it('returns 404 when proposal not found', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce(null)

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(404)
    expect(payload.error).toContain('not found')
    expect(mockRejectProposal).not.toHaveBeenCalled()
  })

  it('checks isActive: true on the proposal', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce(null)

    await POST(makeRequest())

    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      mockEm,
      InboxProposal,
      expect.objectContaining({
        isActive: true,
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        deletedAt: null,
      }),
      undefined,
      expect.any(Object),
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
