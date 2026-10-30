const repoGetByIdMock = jest.fn()
const repoConstructorMock = jest.fn()

jest.mock('../../data/repositories/AiPendingActionRepository', () => {
  const actual = jest.requireActual('../../data/repositories/AiPendingActionRepository')
  return {
    ...actual,
    AiPendingActionRepository: jest.fn().mockImplementation((em: unknown) => {
      repoConstructorMock(em)
      return {
        getByIdForApprover: async (
          id: string,
          scope: { tenantId: string; organizationId?: string | null },
          viewer: { userId: string; canApproveAny: boolean },
        ) => {
          const row = await repoGetByIdMock(id, scope)
          return row && actual.canViewerAccessPendingAction(row, viewer) ? row : null
        },
      }
    }),
  }
})

import metaAiTools from '../meta-pack'
import type { AiToolDefinition } from '../../lib/types'

type PendingActionTool = AiToolDefinition<{ pendingActionId: string }, Record<string, unknown>>

const PENDING_ACTION_ID = '3b7e1f2a-6c4d-4a9e-8f1b-2c3d4e5f6a7b'
const entityManager = { marker: 'em' }

function findTool() {
  const tool = metaAiTools.find((entry) => entry.name === 'ai_assistant.get_pending_action')
  if (!tool) throw new Error('tool ai_assistant.get_pending_action missing')
  return tool as unknown as PendingActionTool
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    container: { resolve: jest.fn((name: string) => (name === 'em' ? entityManager : null)) },
    userFeatures: ['ai_assistant.view'],
    isSuperAdmin: false,
    ...overrides,
  }
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PENDING_ACTION_ID,
    agentId: 'ai_assistant.raw_tool',
    toolName: 'catalog.update_product',
    status: 'pending',
    fieldDiff: [],
    records: null,
    failedRecords: null,
    executionResult: null,
    createdAt: new Date('2026-10-22T10:00:00.000Z'),
    expiresAt: new Date('2026-10-23T10:00:00.000Z'),
    resolvedAt: null,
    resolvedByUserId: null,
    normalizedInput: { secret: 'do-not-leak' },
    createdByUserId: 'user-1',
    idempotencyKey: 'idem_abc',
    channel: 'mcp',
    apiKeyId: 'key-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    ...overrides,
  }
}

describe('ai_assistant.get_pending_action', () => {
  const tool = findTool()

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('is a read-only tool gated by ai_assistant.view', () => {
    expect(tool.isMutation).toBe(false)
    expect(tool.requiredFeatures).toEqual(['ai_assistant.view'])
    expect(tool.inputSchema.safeParse({ pendingActionId: 'nope' }).success).toBe(false)
    expect(tool.inputSchema.safeParse({ pendingActionId: PENDING_ACTION_ID }).success).toBe(true)
  })

  it('returns the status shape for the owner of a pending row', async () => {
    repoGetByIdMock.mockResolvedValueOnce(makeRow())

    const result = await tool.handler({ pendingActionId: PENDING_ACTION_ID }, makeCtx() as never)

    expect(repoConstructorMock).toHaveBeenCalledWith(entityManager)
    expect(repoGetByIdMock).toHaveBeenCalledWith(PENDING_ACTION_ID, {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(result).toEqual({
      status: 'pending',
      expiresAt: '2026-10-23T10:00:00.000Z',
      resolvedAt: null,
    })
  })

  it('includes executionResult and failedRecords once resolved', async () => {
    repoGetByIdMock.mockResolvedValueOnce(
      makeRow({
        status: 'failed',
        resolvedAt: new Date('2026-10-22T11:00:00.000Z'),
        executionResult: { error: { code: 'boom', message: 'Failed' } },
        failedRecords: [{ recordId: 'prod_1', error: { code: 'stale', message: 'Stale' } }],
      }),
    )

    const result = (await tool.handler(
      { pendingActionId: PENDING_ACTION_ID },
      makeCtx() as never,
    ))

    expect(Object.keys(result).sort()).toEqual(
      ['executionResult', 'expiresAt', 'failedRecords', 'resolvedAt', 'status'].sort(),
    )
    expect(result.status).toBe('failed')
    expect(result.resolvedAt).toBe('2026-10-22T11:00:00.000Z')
    expect(result).not.toHaveProperty('normalizedInput')
    expect(result).not.toHaveProperty('idempotencyKey')
  })

  it('lets an approver read another user mcp row', async () => {
    repoGetByIdMock.mockResolvedValueOnce(makeRow({ createdByUserId: 'user-2' }))

    const result = (await tool.handler(
      { pendingActionId: PENDING_ACTION_ID },
      makeCtx({ userFeatures: ['ai_assistant.*'] }) as never,
    ))

    expect(result.status).toBe('pending')
  })

  it('reports not found for another user row without the approver feature', async () => {
    repoGetByIdMock.mockResolvedValueOnce(makeRow({ createdByUserId: 'user-2' }))

    await expect(
      tool.handler({ pendingActionId: PENDING_ACTION_ID }, makeCtx() as never),
    ).rejects.toThrow('is not accessible to the caller')
  })

  it('reports not found for another user chat row even for approvers', async () => {
    repoGetByIdMock.mockResolvedValueOnce(makeRow({ createdByUserId: 'user-2', channel: 'agent' }))

    await expect(
      tool.handler(
        { pendingActionId: PENDING_ACTION_ID },
        makeCtx({ userFeatures: ['ai_assistant.view', 'ai_assistant.pending_actions.approve'] }) as never,
      ),
    ).rejects.toThrow('is not accessible to the caller')
  })

  it('reports not found for a missing row', async () => {
    repoGetByIdMock.mockResolvedValueOnce(null)

    await expect(
      tool.handler({ pendingActionId: PENDING_ACTION_ID }, makeCtx() as never),
    ).rejects.toThrow('is not accessible to the caller')
  })

  it('reports not found without a tenant or user and never queries', async () => {
    await expect(
      tool.handler({ pendingActionId: PENDING_ACTION_ID }, makeCtx({ tenantId: null }) as never),
    ).rejects.toThrow('is not accessible to the caller')
    await expect(
      tool.handler({ pendingActionId: PENDING_ACTION_ID }, makeCtx({ userId: null }) as never),
    ).rejects.toThrow('is not accessible to the caller')
    expect(repoGetByIdMock).not.toHaveBeenCalled()
  })
})
