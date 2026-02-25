/** @jest-environment node */

import { PATCH } from '@open-mercato/core/modules/inbox_ops/api/proposals/[id]/actions/[actionId]/route'
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

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/core/modules/inbox_ops/lib/eventBus', () => ({
  resolveOptionalEventBus: jest.fn(() => mockEventBus),
}))

jest.mock('@open-mercato/core/modules/inbox_ops/events', () => ({
  emitInboxOpsEvent: jest.fn(),
}))

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/inbox_ops/proposals/proposal-1/actions/action-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/inbox_ops/proposals/[id]/actions/[actionId]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    mockEm.flush.mockResolvedValue(undefined)
  })

  it('merges payload and saves the action', async () => {
    const action = {
      id: 'action-1',
      proposalId: 'proposal-1',
      actionType: 'create_order',
      status: 'pending',
      payload: {
        customerName: 'Old Name',
        currencyCode: 'USD',
        channelId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        lineItems: [{ productName: 'Widget', quantity: '10' }],
      },
    } as unknown as InboxProposalAction

    const proposal = {
      id: 'proposal-1',
      isActive: true,
    } as unknown as InboxProposal

    mockFindOneWithDecryption
      .mockResolvedValueOnce(action)
      .mockResolvedValueOnce(proposal)

    const response = await PATCH(makeRequest({ payload: { customerName: 'New Name' } }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(action.payload).toEqual(
      expect.objectContaining({ customerName: 'New Name', currencyCode: 'USD' }),
    )
    expect(mockEm.flush).toHaveBeenCalled()
  })

  it('returns 409 when action is already executed', async () => {
    const action = {
      id: 'action-1',
      proposalId: 'proposal-1',
      actionType: 'create_order',
      status: 'executed',
      payload: {},
    } as unknown as InboxProposalAction

    const proposal = {
      id: 'proposal-1',
      isActive: true,
    } as unknown as InboxProposal

    mockFindOneWithDecryption
      .mockResolvedValueOnce(action)
      .mockResolvedValueOnce(proposal)

    const response = await PATCH(makeRequest({ payload: { customerName: 'New Name' } }))
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.error).toContain('already processed')
    expect(mockEm.flush).not.toHaveBeenCalled()
  })

  it('returns 404 when action not found', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce(null)

    const response = await PATCH(makeRequest({ payload: { customerName: 'Test' } }))
    const payload = await response.json()

    expect(response.status).toBe(404)
    expect(payload.error).toContain('Action not found')
  })

  it('returns 409 when proposal has been superseded', async () => {
    const action = {
      id: 'action-1',
      proposalId: 'proposal-1',
      actionType: 'create_order',
      status: 'pending',
      payload: {},
    } as unknown as InboxProposalAction

    mockFindOneWithDecryption
      .mockResolvedValueOnce(action)
      .mockResolvedValueOnce(null)

    const response = await PATCH(makeRequest({ payload: { customerName: 'Test' } }))
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.error).toContain('superseded')
  })

  it('returns 400 for invalid edit payload', async () => {
    const response = await PATCH(makeRequest({ invalid: 'field' }))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toContain('Invalid payload')
  })

  it('allows editing a failed action', async () => {
    const action = {
      id: 'action-1',
      proposalId: 'proposal-1',
      actionType: 'create_order',
      status: 'failed',
      payload: {
        customerName: 'Old',
        currencyCode: 'EUR',
        channelId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        lineItems: [{ productName: 'Item', quantity: '5' }],
      },
    } as unknown as InboxProposalAction

    const proposal = {
      id: 'proposal-1',
      isActive: true,
    } as unknown as InboxProposal

    mockFindOneWithDecryption
      .mockResolvedValueOnce(action)
      .mockResolvedValueOnce(proposal)

    const response = await PATCH(makeRequest({ payload: { customerName: 'Fixed Name' } }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
  })

  it('returns 401 when not authenticated', async () => {
    const { getAuthFromRequest } = jest.requireMock('@open-mercato/shared/lib/auth/server') as {
      getAuthFromRequest: jest.Mock
    }
    getAuthFromRequest.mockResolvedValueOnce(null)

    const response = await PATCH(makeRequest({ payload: {} }))
    expect(response.status).toBe(401)
  })
})
