/** @jest-environment node */

import { GET } from '@open-mercato/core/modules/inbox_ops/api/proposals/route'
import { InboxProposal, InboxEmail, InboxProposalAction, InboxDiscrepancy } from '@open-mercato/core/modules/inbox_ops/data/entities'

const mockFindAndCountWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findAndCountWithDecryption: (...args: unknown[]) => mockFindAndCountWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/db/escapeLikePattern', () => ({
  escapeLikePattern: (value: string) => value.replace(/\\/g, '\\\\').replace(/[%_]/g, '\\$&'),
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

function makeRequest(params?: Record<string, string>) {
  const url = new URL('http://localhost/api/inbox_ops/proposals')
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
  }
  return new Request(url.toString(), { method: 'GET' })
}

describe('GET /api/inbox_ops/proposals', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    mockFindWithDecryption.mockResolvedValue([])
  })

  it('returns paginated proposal list', async () => {
    const proposals = [
      {
        id: 'proposal-1',
        inboxEmailId: 'email-1',
        summary: 'Order for widgets',
        status: 'pending',
        createdAt: new Date('2026-02-18'),
      },
    ]
    mockFindAndCountWithDecryption.mockResolvedValueOnce([proposals, 1])

    const email = {
      id: 'email-1',
      subject: 'Order request',
      forwardedByName: 'John Doe',
      receivedAt: new Date('2026-02-18'),
    }
    mockFindWithDecryption
      .mockResolvedValueOnce([email])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const response = await GET(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.items).toHaveLength(1)
    expect(payload.total).toBe(1)
    expect(payload.items[0].emailSubject).toBe('Order request')
    expect(payload.items[0].emailFrom).toBe('John Doe')
    expect(payload.items[0].actionCount).toBe(0)
  })

  it('filters by status when provided', async () => {
    mockFindAndCountWithDecryption.mockResolvedValueOnce([[], 0])

    await GET(makeRequest({ status: 'pending' }))

    expect(mockFindAndCountWithDecryption).toHaveBeenCalledWith(
      mockEm,
      InboxProposal,
      expect.objectContaining({
        status: 'pending',
        isActive: true,
        deletedAt: null,
      }),
      expect.any(Object),
      expect.any(Object),
    )
  })

  it('escapes LIKE wildcards in search', async () => {
    mockFindAndCountWithDecryption.mockResolvedValueOnce([[], 0])

    await GET(makeRequest({ search: '100%_off' }))

    expect(mockFindAndCountWithDecryption).toHaveBeenCalledWith(
      mockEm,
      InboxProposal,
      expect.objectContaining({
        summary: { $ilike: '%100\\%\\_off%' },
      }),
      expect.any(Object),
      expect.any(Object),
    )
  })

  it('passes pagination parameters', async () => {
    mockFindAndCountWithDecryption.mockResolvedValueOnce([[], 0])

    await GET(makeRequest({ page: '2', pageSize: '10' }))

    expect(mockFindAndCountWithDecryption).toHaveBeenCalledWith(
      mockEm,
      InboxProposal,
      expect.any(Object),
      expect.objectContaining({
        limit: 10,
        offset: 10,
      }),
      expect.any(Object),
    )
  })

  it('includes tenant scope in sub-queries', async () => {
    const proposals = [{ id: 'proposal-1', inboxEmailId: 'email-1', summary: 'Test', status: 'pending', createdAt: new Date() }]
    mockFindAndCountWithDecryption.mockResolvedValueOnce([proposals, 1])
    mockFindWithDecryption
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await GET(makeRequest())

    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      mockEm,
      InboxProposalAction,
      expect.objectContaining({
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        deletedAt: null,
      }),
      expect.any(Object),
      expect.any(Object),
    )
    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      mockEm,
      InboxDiscrepancy,
      expect.objectContaining({
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      }),
      expect.any(Object),
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
})
