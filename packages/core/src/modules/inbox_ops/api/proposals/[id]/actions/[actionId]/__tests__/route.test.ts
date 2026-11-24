/** @jest-environment node */

import { PATCH } from '@open-mercato/core/modules/inbox_ops/api/proposals/[id]/actions/[actionId]/route'
import { InboxProposal, InboxProposalAction } from '@open-mercato/core/modules/inbox_ops/data/entities'
import { LockMode } from '@mikro-orm/core'
import { emitInboxOpsEvent } from '@open-mercato/core/modules/inbox_ops/events'
import { invalidateCountsCache } from '@open-mercato/core/modules/inbox_ops/lib/cache'
import { z } from 'zod'

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

const mockTransactionEm = { flush: jest.fn() }
const mockEm = {
  fork: jest.fn(),
  transactional: jest.fn(),
}
const mockGuard = { validateMutation: jest.fn(), afterMutationSuccess: jest.fn() }

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'crudMutationGuardService') return mockGuard
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

jest.mock('@open-mercato/core/modules/inbox_ops/lib/cache', () => ({
  resolveCache: jest.fn(),
  invalidateCountsCache: jest.fn(),
}))

const mockGetInboxAction = jest.fn()

jest.mock('@/.mercato/generated/inbox-actions.generated', () => ({
  getInboxAction: (...args: unknown[]) => mockGetInboxAction(...args),
}))

const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

function makeRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/inbox_ops/proposals/proposal-1/actions/action-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/inbox_ops/proposals/[id]/actions/[actionId]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    mockEm.transactional.mockImplementation((work) => work(mockTransactionEm))
    mockTransactionEm.flush.mockResolvedValue(undefined)
    mockGuard.validateMutation.mockResolvedValue({ ok: true, shouldRunAfterSuccess: false })
    mockGetInboxAction.mockReturnValue(undefined)
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
    expect(mockFindOneWithDecryption).toHaveBeenNthCalledWith(
      1,
      mockTransactionEm,
      InboxProposalAction,
      { id: 'action-1', proposalId: 'proposal-1', tenantId: 'tenant-1', organizationId: 'org-1', deletedAt: null },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
    expect(mockTransactionEm.flush).toHaveBeenCalled()
  })

  it.each(['processing', 'executed'])('leaves a %s action unchanged at the locked read', async (status) => {
    const action = {
      id: 'action-1',
      proposalId: 'proposal-1',
      actionType: 'create_order',
      status,
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
    expect(payload).toEqual({ error: 'Action already processed' })
    expect(action.payload).toEqual({})
    expect(mockFindOneWithDecryption).toHaveBeenNthCalledWith(
      1, mockTransactionEm, InboxProposalAction, expect.anything(),
      { lockMode: LockMode.PESSIMISTIC_WRITE }, expect.anything(),
    )
    expect(mockTransactionEm.flush).not.toHaveBeenCalled()
    expect(mockGuard.validateMutation).not.toHaveBeenCalled()
    expect(mockGuard.afterMutationSuccess).not.toHaveBeenCalled()
    expect(invalidateCountsCache).not.toHaveBeenCalled()
    expect(emitInboxOpsEvent).not.toHaveBeenCalled()
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

  it('returns a 409 optimistic-lock conflict on a stale action edit instead of overwriting', async () => {
    const action = {
      id: 'action-1',
      proposalId: 'proposal-1',
      actionType: 'create_order',
      status: 'pending',
      payload: {
        customerName: 'Current Name',
        currencyCode: 'USD',
        channelId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        lineItems: [{ productName: 'Widget', quantity: '10' }],
      },
      updatedAt: new Date('2026-06-18T12:00:00.000Z'),
    } as unknown as InboxProposalAction

    const proposal = {
      id: 'proposal-1',
      isActive: true,
    } as unknown as InboxProposal

    mockFindOneWithDecryption
      .mockResolvedValueOnce(action)
      .mockResolvedValueOnce(proposal)

    const response = await PATCH(
      makeRequest(
        { payload: { customerName: 'Stale Name' } },
        { [OPTIMISTIC_LOCK_HEADER]: '2026-06-18T11:00:00.000Z' },
      ),
    )
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.code).toBe('optimistic_lock_conflict')
    expect(action.payload).toEqual(
      expect.objectContaining({ customerName: 'Current Name' }),
    )
    expect(mockTransactionEm.flush).not.toHaveBeenCalled()
  })

  it('saves the action when the expected version matches the current one', async () => {
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
      updatedAt: new Date('2026-06-18T12:00:00.000Z'),
    } as unknown as InboxProposalAction

    const proposal = {
      id: 'proposal-1',
      isActive: true,
    } as unknown as InboxProposal

    mockFindOneWithDecryption
      .mockResolvedValueOnce(action)
      .mockResolvedValueOnce(proposal)

    const response = await PATCH(
      makeRequest(
        { payload: { customerName: 'New Name' } },
        { [OPTIMISTIC_LOCK_HEADER]: '2026-06-18T12:00:00.000Z' },
      ),
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(action.payload).toEqual(
      expect.objectContaining({ customerName: 'New Name', currencyCode: 'USD' }),
    )
    expect(mockTransactionEm.flush).toHaveBeenCalled()
  })

  it('runs the mutation success hook, cache invalidation, and event after commit', async () => {
    mockFindOneWithDecryption
      .mockResolvedValueOnce({
        id: 'action-1', proposalId: 'proposal-1', actionType: 'create_quote', status: 'pending',
        payload: { customerName: 'Old Name' },
      })
      .mockResolvedValueOnce({ id: 'proposal-1', isActive: true })
    mockGetInboxAction.mockReturnValue({ payloadSchema: z.object({ customerName: z.string() }) })
    const guardMetadata = { approvalId: 'synthetic-approval' }
    mockGuard.validateMutation.mockResolvedValueOnce({ ok: true, shouldRunAfterSuccess: true, metadata: guardMetadata })
    mockEm.transactional.mockImplementationOnce(async (work) => {
      const result = await work(mockTransactionEm)
      expect(mockTransactionEm.flush).toHaveBeenCalled()
      expect(mockGuard.afterMutationSuccess).not.toHaveBeenCalled()
      expect(invalidateCountsCache).not.toHaveBeenCalled()
      expect(emitInboxOpsEvent).not.toHaveBeenCalled()
      return result
    })

    const response = await PATCH(makeRequest({ payload: { customerName: 'New Name' } }))

    expect(response.status).toBe(200)
    expect(mockGuard.afterMutationSuccess).toHaveBeenCalledWith(expect.objectContaining({ metadata: guardMetadata }))
    expect(invalidateCountsCache).toHaveBeenCalled()
    expect(emitInboxOpsEvent).toHaveBeenCalledWith('inbox_ops.action.edited', expect.objectContaining({ actionId: 'action-1' }))
  })

  it('validates the edit against an overridden action payloadSchema (#6279)', async () => {
    mockGetInboxAction.mockReturnValue({
      type: 'create_quote',
      payloadSchema: z.object({
        customerName: z.string().min(1),
        customerEmail: z.string().email(),
      }),
    })
    const action = {
      id: 'action-1',
      proposalId: 'proposal-1',
      actionType: 'create_quote',
      status: 'pending',
      payload: { customerName: 'A. Person', customerEmail: 'a@example.com' },
    } as unknown as InboxProposalAction

    mockFindOneWithDecryption
      .mockResolvedValueOnce(action)
      .mockResolvedValueOnce({ id: 'proposal-1', isActive: true } as unknown as InboxProposal)

    const response = await PATCH(makeRequest({ payload: { customerName: 'B. Person' } }))
    const payload = await response.json()

    expect(mockGetInboxAction).toHaveBeenCalledWith('create_quote')
    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(action.payload).toEqual({ customerName: 'B. Person', customerEmail: 'a@example.com' })
    expect(mockTransactionEm.flush).toHaveBeenCalled()
  })

  it('rejects an edit the overridden action payloadSchema refuses (#6279)', async () => {
    mockGetInboxAction.mockReturnValue({
      type: 'create_quote',
      payloadSchema: z.object({ customerEmail: z.string().email() }),
    })
    const action = {
      id: 'action-1',
      proposalId: 'proposal-1',
      actionType: 'create_quote',
      status: 'pending',
      payload: { customerEmail: 'a@example.com' },
    } as unknown as InboxProposalAction

    mockFindOneWithDecryption
      .mockResolvedValueOnce(action)
      .mockResolvedValueOnce({ id: 'proposal-1', isActive: true } as unknown as InboxProposal)

    const response = await PATCH(makeRequest({ payload: { customerEmail: 'not-an-email' } }))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toContain('customerEmail')
    expect(mockTransactionEm.flush).not.toHaveBeenCalled()
  })

  it('falls back to the installed schema when no action definition is registered', async () => {
    const action = {
      id: 'action-1',
      proposalId: 'proposal-1',
      actionType: 'create_quote',
      status: 'pending',
      payload: { customerName: 'A. Person', customerEmail: 'a@example.com' },
    } as unknown as InboxProposalAction

    mockFindOneWithDecryption
      .mockResolvedValueOnce(action)
      .mockResolvedValueOnce({ id: 'proposal-1', isActive: true } as unknown as InboxProposal)

    const response = await PATCH(makeRequest({ payload: { customerName: 'B. Person' } }))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toContain('Invalid payload for create_quote')
    expect(mockTransactionEm.flush).not.toHaveBeenCalled()
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
