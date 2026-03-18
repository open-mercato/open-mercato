/** @jest-environment node */

import { GET } from '@open-mercato/core/modules/inbox_ops/api/proposals/[id]/route'
import { InboxProposal } from '@open-mercato/core/modules/inbox_ops/data/entities'

const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
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

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

function makeRequest(proposalId = 'proposal-1') {
  return new Request(`http://localhost/api/inbox_ops/proposals/${proposalId}`, { method: 'GET' })
}

describe('GET /api/inbox_ops/proposals/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    mockFindWithDecryption.mockResolvedValue([])
  })

  it('returns proposal detail with actions, discrepancies, and email', async () => {
    const proposal = {
      id: 'proposal-1',
      inboxEmailId: 'email-1',
      summary: 'Order for widgets',
      status: 'pending',
      isActive: true,
    }
    const actions = [{ id: 'action-1', actionType: 'create_order' }]
    const discrepancies = [{ id: 'disc-1', type: 'price_mismatch' }]
    const email = { id: 'email-1', subject: 'Order request' }

    mockFindOneWithDecryption.mockResolvedValueOnce(proposal)
    mockFindWithDecryption
      .mockResolvedValueOnce(actions)
      .mockResolvedValueOnce(discrepancies)
    mockFindOneWithDecryption.mockResolvedValueOnce(email)

    const response = await GET(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.proposal.id).toBe('proposal-1')
    expect(payload.actions).toHaveLength(1)
    expect(payload.discrepancies).toHaveLength(1)
    expect(payload.email.subject).toBe('Order request')
  })

  it('returns 404 when proposal not found', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce(null)

    const response = await GET(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(404)
    expect(payload.error).toContain('not found')
  })

  it('filters by isActive: true', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce(null)

    await GET(makeRequest())

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

    const response = await GET(makeRequest())
    expect(response.status).toBe(401)
  })

  it('returns 400 when proposal ID is missing from path', async () => {
    const response = await GET(
      new Request('http://localhost/api/inbox_ops/proposals/', { method: 'GET' }),
    )
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toContain('Missing proposal ID')
  })
})
