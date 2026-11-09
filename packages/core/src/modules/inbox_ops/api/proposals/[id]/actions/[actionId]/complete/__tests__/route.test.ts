/** @jest-environment node */

import { PATCH } from '@open-mercato/core/modules/inbox_ops/api/proposals/[id]/actions/[actionId]/complete/route'
import { InboxProposal, InboxProposalAction } from '@open-mercato/core/modules/inbox_ops/data/entities'

type StoredAction = {
  id: string
  proposalId: string
  tenantId: string
  organizationId: string
  status: string
  deletedAt: Date | null
  executedAt: Date | null
  executedByUserId: string | null
  createdEntityId: string | null
  createdEntityType: string | null
  executionError: string | null
  updatedAt: Date
}

type ActionWhere = {
  id?: string
  proposalId?: string
  tenantId?: string
  organizationId?: string
  status?: { $in: string[] }
  deletedAt?: null
}

const store: { action: StoredAction; afterFirstActionRead: ((row: StoredAction) => void) | null; actionReads: number } = {
  action: buildAction('pending'),
  afterFirstActionRead: null,
  actionReads: 0,
}

function buildAction(status: string): StoredAction {
  return {
    id: 'action-1',
    proposalId: 'proposal-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    status,
    deletedAt: null,
    executedAt: null,
    executedByUserId: null,
    createdEntityId: null,
    createdEntityType: null,
    executionError: 'previous failure',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  }
}

const mockFindOneWithDecryption = jest.fn(async (_em: unknown, entity: unknown) => {
  if (entity === InboxProposalAction) {
    store.actionReads += 1
    const row = store.action
    if (store.actionReads === 1 && store.afterFirstActionRead) {
      const snapshot = { ...row }
      store.afterFirstActionRead(row)
      return snapshot
    }
    return row.deletedAt === null ? row : null
  }
  if (entity === InboxProposal) {
    return { id: 'proposal-1', isActive: true, status: 'pending' }
  }
  return null
})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: [unknown, unknown]) => mockFindOneWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })),
}))

const mockNativeUpdate = jest.fn(async (entity: unknown, where: ActionWhere, data: Partial<StoredAction>) => {
  if (entity !== InboxProposalAction) return 0
  const row = store.action
  if (where.id !== undefined && where.id !== row.id) return 0
  if (where.proposalId !== undefined && where.proposalId !== row.proposalId) return 0
  if (where.tenantId !== undefined && where.tenantId !== row.tenantId) return 0
  if (where.organizationId !== undefined && where.organizationId !== row.organizationId) return 0
  if (where.status && !where.status.$in.includes(row.status)) return 0
  if ('deletedAt' in where && row.deletedAt !== null) return 0
  Object.assign(row, data)
  return 1
})

const mockFlushWithUpdatedAtHook = jest.fn(async () => {
  store.action.updatedAt = new Date()
})

const mockForkedEm = {
  nativeUpdate: mockNativeUpdate,
  flush: mockFlushWithUpdatedAtHook,
}

const mockRequestEm = {
  fork: jest.fn(() => mockForkedEm),
}

const mockEm = {
  fork: jest.fn(() => mockRequestEm),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: jest.fn((token: string) => (token === 'em' ? mockEm : null)),
  })),
}))

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: async (_tenantId: string, fn: () => unknown) => fn(),
}))

const mockInvalidateCountsCache = jest.fn(async () => {})

jest.mock('@open-mercato/core/modules/inbox_ops/lib/cache', () => ({
  resolveCache: jest.fn(() => null),
  invalidateCountsCache: (...args: unknown[]) => mockInvalidateCountsCache(...args),
}))

const mockRecalculateProposalStatus = jest.fn(async () => {})

jest.mock('@open-mercato/core/modules/inbox_ops/lib/executionEngine', () => ({
  ACTION_EXECUTABLE_STATUSES: ['pending', 'failed'],
  recalculateProposalStatus: (...args: unknown[]) => mockRecalculateProposalStatus(...args),
}))

const SALES_ORDER_ID = 'd290f1ee-6c54-4b01-90e6-d701748f0851'
const OTHER_ORDER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

function makeRequest(createdEntityId: string = SALES_ORDER_ID) {
  return new Request('http://localhost/api/inbox_ops/proposals/proposal-1/actions/action-1/complete', {
    method: 'PATCH',
    body: JSON.stringify({ createdEntityId, createdEntityType: 'sales_order' }),
  })
}

describe('PATCH /api/inbox_ops/proposals/[id]/actions/[actionId]/complete', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    store.action = buildAction('pending')
    store.afterFirstActionRead = null
    store.actionReads = 0
  })

  it.each(['pending', 'failed'])('completes a %s action with the submitted entity', async (status) => {
    store.action = buildAction(status)

    const response = await PATCH(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.action).toEqual(expect.objectContaining({
      id: 'action-1',
      status: 'executed',
      createdEntityId: SALES_ORDER_ID,
      createdEntityType: 'sales_order',
    }))
    expect(store.action).toEqual(expect.objectContaining({
      status: 'executed',
      executedByUserId: 'user-1',
      createdEntityId: SALES_ORDER_ID,
      createdEntityType: 'sales_order',
      executionError: null,
    }))
    expect(store.action.executedAt).toBeInstanceOf(Date)
    expect(store.action.updatedAt.getTime()).toBeGreaterThan(new Date('2026-01-01T00:00:00.000Z').getTime())
    expect(mockRecalculateProposalStatus).toHaveBeenCalledWith(mockForkedEm, 'proposal-1', { tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(mockInvalidateCountsCache).toHaveBeenCalled()
  })

  it('returns 409 for an action that is already executed', async () => {
    store.action = { ...buildAction('executed'), createdEntityId: OTHER_ORDER_ID, createdEntityType: 'sales_order' }

    const response = await PATCH(makeRequest())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Action already processed' })
    expect(store.action.createdEntityId).toBe(OTHER_ORDER_ID)
    expect(mockRecalculateProposalStatus).not.toHaveBeenCalled()
  })

  it.each([
    ['executed', OTHER_ORDER_ID],
    ['processing', null],
    ['rejected', null],
  ])('does not overwrite an action another request moved to %s after the status check', async (concurrentStatus, concurrentEntityId) => {
    store.afterFirstActionRead = (row) => {
      row.status = concurrentStatus
      row.createdEntityId = concurrentEntityId
      row.createdEntityType = concurrentEntityId ? 'sales_order' : null
    }

    const response = await PATCH(makeRequest())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Action already processed' })
    expect(store.action.status).toBe(concurrentStatus)
    expect(store.action.createdEntityId).toBe(concurrentEntityId)
    expect(store.action.executedByUserId).toBeNull()
    expect(mockRecalculateProposalStatus).not.toHaveBeenCalled()
    expect(mockInvalidateCountsCache).not.toHaveBeenCalled()
  })

  it('returns 409 when the action is deleted after the status check', async () => {
    store.afterFirstActionRead = (row) => {
      row.deletedAt = new Date()
    }

    const response = await PATCH(makeRequest())

    expect(response.status).toBe(409)
    expect(store.action.status).toBe('pending')
    expect(store.action.createdEntityId).toBeNull()
    expect(mockRecalculateProposalStatus).not.toHaveBeenCalled()
  })

  it('lets exactly one of two concurrent completions win', async () => {
    const [first, second] = await Promise.all([
      PATCH(makeRequest(SALES_ORDER_ID)),
      PATCH(makeRequest(OTHER_ORDER_ID)),
    ])

    const statuses = [first.status, second.status].sort((left, right) => left - right)
    expect(statuses).toEqual([200, 409])
    const winner = first.status === 200 ? SALES_ORDER_ID : OTHER_ORDER_ID
    const winnerPayload = await (first.status === 200 ? first : second).json()
    expect(winnerPayload.action.createdEntityId).toBe(winner)
    expect(store.action.createdEntityId).toBe(winner)
    expect(mockRecalculateProposalStatus).toHaveBeenCalledTimes(1)
  })

  it('rejects an invalid body without touching the action', async () => {
    const response = await PATCH(new Request('http://localhost/api/inbox_ops/proposals/proposal-1/actions/action-1/complete', {
      method: 'PATCH',
      body: JSON.stringify({ createdEntityId: 'not-a-uuid', createdEntityType: 'sales_order' }),
    }))

    expect(response.status).toBe(400)
    expect(store.action.status).toBe('pending')
    expect(mockNativeUpdate).not.toHaveBeenCalled()
  })
})
