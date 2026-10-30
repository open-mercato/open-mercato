import { z } from 'zod'

const authMock = jest.fn()
const loadAclMock = jest.fn()
const createRequestContainerMock = jest.fn()
const repoGetByIdMock = jest.fn()
const repoSetStatusMock = jest.fn()
const policyOverrideGetMock = jest.fn()
const loadAgentRegistryMock = jest.fn()
const loadAllModuleToolsMock = jest.fn()
const getAgentMock = jest.fn()
const getToolMock = jest.fn()
const attachmentFindMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => authMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainerMock(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => attachmentFindMock(...args),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({
  Attachment: class Attachment {},
  AttachmentPartition: class AttachmentPartition {},
}))

jest.mock('../../../../../../data/repositories/AiPendingActionRepository', () => {
  const actual = jest.requireActual('../../../../../../data/repositories/AiPendingActionRepository')
  return {
    ...actual,
    AiPendingActionRepository: jest.fn().mockImplementation(() => ({
      getById: repoGetByIdMock,
      getByIdForApprover: async (
        id: string,
        scope: { tenantId: string; organizationId?: string | null },
        viewer: { userId: string; canApproveAny: boolean },
      ) => {
        const row = await repoGetByIdMock(id, scope)
        return row && actual.canViewerAccessPendingAction(row, viewer) ? row : null
      },
      setStatus: repoSetStatusMock,
    })),
  }
})

jest.mock('../../../../../../data/repositories/AiAgentMutationPolicyOverrideRepository', () => ({
  AiAgentMutationPolicyOverrideRepository: jest.fn().mockImplementation(() => ({
    get: policyOverrideGetMock,
  })),
}))

jest.mock('../../../../../../lib/agent-registry', () => ({
  getAgent: (...args: unknown[]) => getAgentMock(...args),
  loadAgentRegistry: (...args: unknown[]) => loadAgentRegistryMock(...args),
}))

jest.mock('../../../../../../lib/tool-registry', () => ({
  toolRegistry: {
    getTool: (...args: unknown[]) => getToolMock(...args),
  },
}))

jest.mock('../../../../../../lib/tool-loader', () => ({
  loadAllModuleTools: (...args: unknown[]) => loadAllModuleToolsMock(...args),
}))

import { POST } from '../route'

const PENDING_ACTION_ID = '3b7e1f2a-6c4d-4a9e-8f1b-2c3d4e5f6a7b'
const MISSING_PENDING_ACTION_ID = '5e2b8c71-9d4a-4f3e-8b6c-7a1d2e3f4b5c'

function buildRequest(): Request {
  return new Request(`http://localhost/api/ai_assistant/ai/actions/${PENDING_ACTION_ID}/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  })
}

function buildContext(id: string) {
  return { params: Promise.resolve({ id }) }
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PENDING_ACTION_ID,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    agentId: 'catalog.merchandising_assistant',
    toolName: 'catalog.update_product',
    status: 'pending',
    fieldDiff: [{ field: 'title', before: 'Old', after: 'New' }],
    records: null,
    failedRecords: null,
    sideEffectsSummary: null,
    recordVersion: 'v-1',
    attachmentIds: [],
    normalizedInput: { productId: 'p-1', patch: { title: 'New' } },
    queueMode: 'inline',
    executionResult: null,
    targetEntityType: 'product',
    targetRecordId: 'p-1',
    conversationId: null,
    idempotencyKey: 'idem_1',
    createdByUserId: 'user-1',
    createdAt: new Date(Date.now() - 60_000),
    expiresAt: new Date(Date.now() + 3_600_000),
    resolvedAt: null,
    resolvedByUserId: null,
    ...overrides,
  }
}

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'catalog.merchandising_assistant',
    moduleId: 'catalog',
    label: 'Catalog',
    description: '...',
    systemPrompt: '...',
    allowedTools: ['catalog.update_product'],
    readOnly: false,
    mutationPolicy: 'confirm-required',
    ...overrides,
  }
}

function makeTool(overrides: Record<string, unknown> = {}) {
  return {
    name: 'catalog.update_product',
    description: 'Update product',
    inputSchema: z.object({
      productId: z.string(),
      patch: z.object({ title: z.string() }).partial(),
    }),
    handler: jest.fn().mockResolvedValue({ recordId: 'p-1', commandName: 'catalog.product.update' }),
    isMutation: true,
    loadBeforeRecord: jest.fn().mockResolvedValue({
      recordId: 'p-1',
      entityType: 'catalog.product',
      recordVersion: 'v-1',
      before: { title: 'Old' },
    }),
    ...overrides,
  }
}

describe('POST /api/ai/actions/:id/confirm route (Step 5.8)', () => {
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    authMock.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    loadAclMock.mockResolvedValue({
      features: ['ai_assistant.view', 'catalog.view', 'catalog.manage'],
      isSuperAdmin: false,
    })
    createRequestContainerMock.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'rbacService') {
          return {
            loadAcl: loadAclMock,
            hasAllFeatures: (required: string[], granted: string[]) =>
              required.every((feature) => granted.includes(feature)),
          }
        }
        if (name === 'em') return {}
        if (name === 'eventBus') return { emitEvent: jest.fn().mockResolvedValue(undefined) }
        return null
      },
    })
    policyOverrideGetMock.mockResolvedValue(null)
    loadAgentRegistryMock.mockResolvedValue(undefined)
    loadAllModuleToolsMock.mockResolvedValue(undefined)
    getAgentMock.mockReturnValue(makeAgent())
    getToolMock.mockReturnValue(makeTool())
    attachmentFindMock.mockResolvedValue([])

    repoSetStatusMock.mockImplementation(async (id: string, status: string, _scope: unknown, extra?: any) => {
      return { ...makeRow({ id, status }), ...(extra?.executionResult ? { executionResult: extra.executionResult } : {}) }
    })
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValueOnce(null)
    const response = await POST(buildRequest() as any, buildContext(PENDING_ACTION_ID))
    expect(response.status).toBe(401)
  })

  it('happy path: returns 200 with pendingAction.status === confirmed', async () => {
    repoGetByIdMock.mockResolvedValueOnce(makeRow())

    const response = await POST(buildRequest() as any, buildContext(PENDING_ACTION_ID))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.pendingAction.status).toBe('confirmed')
    expect(body.mutationResult).toEqual({ recordId: 'p-1', commandName: 'catalog.product.update' })
  })

  it('409 invalid_status: already cancelled', async () => {
    repoGetByIdMock.mockResolvedValueOnce(makeRow({ status: 'cancelled' }))

    const response = await POST(buildRequest() as any, buildContext(PENDING_ACTION_ID))
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('invalid_status')
  })

  it('409 expired: expiresAt in the past', async () => {
    repoGetByIdMock.mockResolvedValueOnce(
      makeRow({ expiresAt: new Date('2020-01-01T00:00:00.000Z') }),
    )

    const response = await POST(buildRequest() as any, buildContext(PENDING_ACTION_ID))
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('expired')
  })

  it('412 stale_version: record version drift on single-record action', async () => {
    repoGetByIdMock.mockResolvedValueOnce(makeRow({ recordVersion: 'v-1' }))
    getToolMock.mockReturnValueOnce(
      makeTool({
        loadBeforeRecord: jest.fn().mockResolvedValue({
          recordId: 'p-1',
          entityType: 'catalog.product',
          recordVersion: 'v-2',
          before: { title: 'x' },
        }),
      }),
    )

    const response = await POST(buildRequest() as any, buildContext(PENDING_ACTION_ID))
    expect(response.status).toBe(412)
    const body = await response.json()
    expect(body.code).toBe('stale_version')
  })

  it('403 read_only_agent when policy override downgrades to read-only', async () => {
    repoGetByIdMock.mockResolvedValueOnce(makeRow())
    policyOverrideGetMock.mockResolvedValueOnce({ mutationPolicy: 'read-only' })

    const response = await POST(buildRequest() as any, buildContext(PENDING_ACTION_ID))
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.code).toBe('read_only_agent')
  })

  it('403 tool_not_whitelisted when agent no longer whitelists the tool', async () => {
    repoGetByIdMock.mockResolvedValueOnce(makeRow())
    getAgentMock.mockReturnValueOnce(makeAgent({ allowedTools: [] }))

    const response = await POST(buildRequest() as any, buildContext(PENDING_ACTION_ID))
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.code).toBe('tool_not_whitelisted')
  })

  it('403 agent_features_denied when caller lacks agent features', async () => {
    repoGetByIdMock.mockResolvedValueOnce(makeRow())
    getAgentMock.mockReturnValueOnce(makeAgent({ requiredFeatures: ['catalog.restricted.manage'] }))

    const response = await POST(buildRequest() as any, buildContext(PENDING_ACTION_ID))
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.code).toBe('agent_features_denied')
  })

  it('403 attachment_cross_tenant when an attachment belongs to a different tenant', async () => {
    repoGetByIdMock.mockResolvedValueOnce(makeRow({ attachmentIds: ['a-1'] }))
    attachmentFindMock.mockResolvedValueOnce([
      { id: 'a-1', tenantId: 'tenant-OTHER', organizationId: 'org-OTHER' },
    ])

    const response = await POST(buildRequest() as any, buildContext(PENDING_ACTION_ID))
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.code).toBe('attachment_cross_tenant')
  })

  it('404 agent_unknown when agent has been removed from the registry', async () => {
    repoGetByIdMock.mockResolvedValueOnce(makeRow())
    getAgentMock.mockReturnValueOnce(undefined)

    const response = await POST(buildRequest() as any, buildContext(PENDING_ACTION_ID))
    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.code).toBe('agent_unknown')
  })

  it.each([
    ['a non-UUID string', 'not-a-uuid'],
    ['a 128-character string', 'a'.repeat(128)],
  ])('returns 400 validation_error without querying the database for %s', async (_label, id) => {
    const response = await POST(buildRequest() as any, buildContext(id))

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.code).toBe('validation_error')
    expect(JSON.stringify(body)).not.toContain('invalid input syntax')
    expect(repoGetByIdMock).not.toHaveBeenCalled()
  })

  it('404 pending_action_not_found when the row does not exist for the caller', async () => {
    repoGetByIdMock.mockResolvedValueOnce(null)

    const response = await POST(buildRequest() as any, buildContext(MISSING_PENDING_ACTION_ID))
    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.code).toBe('pending_action_not_found')
  })

  it('403 forbidden when caller lacks ai_assistant.view', async () => {
    loadAclMock.mockResolvedValueOnce({ features: ['catalog.view'], isSuperAdmin: false })

    const response = await POST(buildRequest() as any, buildContext(PENDING_ACTION_ID))
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.code).toBe('forbidden')
  })

  it('idempotent: second confirm on already-confirmed row returns 200 + prior executionResult without invoking handler', async () => {
    const priorResult = { recordId: 'p-1', commandName: 'catalog.product.update' }
    const priorRow = makeRow({
      status: 'confirmed',
      executionResult: priorResult,
      resolvedAt: new Date('2026-04-18T10:30:00.000Z'),
      resolvedByUserId: 'user-1',
    })
    repoGetByIdMock.mockResolvedValueOnce(priorRow)
    const handlerSpy = jest.fn()
    getToolMock.mockReturnValueOnce(makeTool({ handler: handlerSpy }))

    const response = await POST(buildRequest() as any, buildContext(PENDING_ACTION_ID))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.mutationResult).toEqual(priorResult)
    expect(handlerSpy).not.toHaveBeenCalled()
    expect(repoSetStatusMock).not.toHaveBeenCalled()
  })

  describe('owner / approver visibility', () => {
    beforeEach(() => {
      getToolMock.mockReset()
      getToolMock.mockReturnValue(makeTool())
      repoGetByIdMock.mockReset()
    })

    const rawRow = () =>
      makeRow({ channel: 'mcp', agentId: 'ai_assistant.raw_tool', correlationId: 'corr-1', apiKeyId: null })

    function aclByPrincipal(approverFeatures: string[]) {
      loadAclMock.mockImplementation(async (principal: string) => {
        if (principal === 'user-2') return { features: approverFeatures, isSuperAdmin: false }
        return { features: ['ai_assistant.view', 'catalog.manage'], isSuperAdmin: false }
      })
    }

    it('another user without the approve feature gets 404 on a chat row', async () => {
      authMock.mockResolvedValueOnce({ sub: 'user-2', tenantId: 'tenant-1', orgId: 'org-1' })
      repoGetByIdMock.mockResolvedValueOnce(makeRow({ channel: 'agent' }))

      const response = await POST(buildRequest() as any, buildContext(PENDING_ACTION_ID))

      expect(response.status).toBe(404)
      expect((await response.json()).code).toBe('pending_action_not_found')
      expect(repoSetStatusMock).not.toHaveBeenCalled()
    })

    it('another user without the approve feature gets 404 on an MCP row', async () => {
      authMock.mockResolvedValueOnce({ sub: 'user-2', tenantId: 'tenant-1', orgId: 'org-1' })
      repoGetByIdMock.mockResolvedValueOnce(rawRow())

      const response = await POST(buildRequest() as any, buildContext(PENDING_ACTION_ID))

      expect(response.status).toBe(404)
      expect(repoSetStatusMock).not.toHaveBeenCalled()
    })

    it('an approver gets 404 on someone else\'s chat row', async () => {
      authMock.mockResolvedValueOnce({ sub: 'user-2', tenantId: 'tenant-1', orgId: 'org-1' })
      aclByPrincipal(['ai_assistant.view', 'ai_assistant.pending_actions.approve', 'catalog.manage'])
      repoGetByIdMock.mockResolvedValueOnce(makeRow({ channel: 'agent' }))

      const response = await POST(buildRequest() as any, buildContext(PENDING_ACTION_ID))

      expect(response.status).toBe(404)
    })

    it('an approver confirms an MCP row under their own identity without agent lookup', async () => {
      authMock.mockResolvedValueOnce({ sub: 'user-2', tenantId: 'tenant-1', orgId: 'org-1' })
      aclByPrincipal(['ai_assistant.view', 'ai_assistant.pending_actions.approve', 'catalog.manage'])
      repoGetByIdMock.mockResolvedValueOnce(rawRow())
      const handlerSpy = jest.fn().mockResolvedValue({ recordId: 'p-1' })
      getToolMock.mockReturnValueOnce(makeTool({ handler: handlerSpy, requiredFeatures: ['catalog.manage'] }))

      const response = await POST(buildRequest() as any, buildContext(PENDING_ACTION_ID))

      expect(response.status).toBe(200)
      expect(getAgentMock).not.toHaveBeenCalled()
      expect(policyOverrideGetMock).not.toHaveBeenCalled()
      expect(handlerSpy).toHaveBeenCalledTimes(1)
      const handlerCtx = handlerSpy.mock.calls[0][1]
      expect(handlerCtx.userId).toBe('user-2')
      expect(handlerCtx.auditCorrelation).toEqual({
        correlationId: 'corr-1',
        apiKeyId: null,
        pendingActionId: PENDING_ACTION_ID,
        requestedByUserId: 'user-1',
      })
      const [, , , confirmExtra] = repoSetStatusMock.mock.calls[0]
      expect(confirmExtra).toMatchObject({ resolvedByUserId: 'user-2' })
    })

    it('an approver lacking the tool feature is denied with approver_features_denied', async () => {
      authMock.mockResolvedValueOnce({ sub: 'user-2', tenantId: 'tenant-1', orgId: 'org-1' })
      aclByPrincipal(['ai_assistant.view', 'ai_assistant.pending_actions.approve'])
      repoGetByIdMock.mockResolvedValueOnce(rawRow())
      getToolMock.mockReturnValueOnce(makeTool({ requiredFeatures: ['catalog.manage'] }))

      const response = await POST(buildRequest() as any, buildContext(PENDING_ACTION_ID))

      expect(response.status).toBe(403)
      expect((await response.json()).code).toBe('approver_features_denied')
      expect(repoSetStatusMock).not.toHaveBeenCalled()
    })

    it('the creator still confirms their own chat row', async () => {
      repoGetByIdMock.mockResolvedValueOnce(makeRow({ channel: 'agent' }))

      const response = await POST(buildRequest() as any, buildContext(PENDING_ACTION_ID))

      expect(response.status).toBe(200)
      expect(getAgentMock).toHaveBeenCalledWith('catalog.merchandising_assistant')
    })
  })

  it('500 confirm_internal_error when the repo throws unexpectedly', async () => {
    repoGetByIdMock.mockRejectedValueOnce(new Error('db down'))

    const response = await POST(buildRequest() as any, buildContext(PENDING_ACTION_ID))
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.code).toBe('confirm_internal_error')
  })
})
