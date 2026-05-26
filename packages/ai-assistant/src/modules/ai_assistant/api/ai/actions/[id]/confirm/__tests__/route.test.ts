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

jest.mock('../../../../../../data/repositories/AiPendingActionRepository', () => ({
  AiPendingActionRepository: jest.fn().mockImplementation(() => ({
    getById: repoGetByIdMock,
    setStatus: repoSetStatusMock,
  })),
}))

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

function buildRequest(): Request {
  return new Request('http://localhost/api/ai_assistant/ai/actions/pa_123/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  })
}

function buildContext(id: string) {
  return { params: Promise.resolve({ id }) }
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pa_123',
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
    const response = await POST(buildRequest() as any, buildContext('pa_123'))
    expect(response.status).toBe(401)
  })

  it('happy path: returns 200 with pendingAction.status === confirmed', async () => {
    repoGetByIdMock.mockResolvedValueOnce(makeRow())

    const response = await POST(buildRequest() as any, buildContext('pa_123'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.pendingAction.status).toBe('confirmed')
    expect(body.mutationResult).toEqual({ recordId: 'p-1', commandName: 'catalog.product.update' })
  })

  it('409 invalid_status: already cancelled', async () => {
    repoGetByIdMock.mockResolvedValueOnce(makeRow({ status: 'cancelled' }))

    const response = await POST(buildRequest() as any, buildContext('pa_123'))
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('invalid_status')
  })

  it('409 expired: expiresAt in the past', async () => {
    repoGetByIdMock.mockResolvedValueOnce(
      makeRow({ expiresAt: new Date('2020-01-01T00:00:00.000Z') }),
    )

    const response = await POST(buildRequest() as any, buildContext('pa_123'))
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

    const response = await POST(buildRequest() as any, buildContext('pa_123'))
    expect(response.status).toBe(412)
    const body = await response.json()
    expect(body.code).toBe('stale_version')
  })

  it('403 read_only_agent when policy override downgrades to read-only', async () => {
    repoGetByIdMock.mockResolvedValueOnce(makeRow())
    policyOverrideGetMock.mockResolvedValueOnce({ mutationPolicy: 'read-only' })

    const response = await POST(buildRequest() as any, buildContext('pa_123'))
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.code).toBe('read_only_agent')
  })

  it('403 tool_not_whitelisted when agent no longer whitelists the tool', async () => {
    repoGetByIdMock.mockResolvedValueOnce(makeRow())
    getAgentMock.mockReturnValueOnce(makeAgent({ allowedTools: [] }))

    const response = await POST(buildRequest() as any, buildContext('pa_123'))
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.code).toBe('tool_not_whitelisted')
  })

  it('403 agent_features_denied when caller lacks agent features', async () => {
    repoGetByIdMock.mockResolvedValueOnce(makeRow())
    getAgentMock.mockReturnValueOnce(makeAgent({ requiredFeatures: ['catalog.restricted.manage'] }))

    const response = await POST(buildRequest() as any, buildContext('pa_123'))
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.code).toBe('agent_features_denied')
  })

  it('403 attachment_cross_tenant when an attachment belongs to a different tenant', async () => {
    repoGetByIdMock.mockResolvedValueOnce(makeRow({ attachmentIds: ['a-1'] }))
    attachmentFindMock.mockResolvedValueOnce([
      { id: 'a-1', tenantId: 'tenant-OTHER', organizationId: 'org-OTHER' },
    ])

    const response = await POST(buildRequest() as any, buildContext('pa_123'))
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.code).toBe('attachment_cross_tenant')
  })

  it('404 agent_unknown when agent has been removed from the registry', async () => {
    repoGetByIdMock.mockResolvedValueOnce(makeRow())
    getAgentMock.mockReturnValueOnce(undefined)

    const response = await POST(buildRequest() as any, buildContext('pa_123'))
    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.code).toBe('agent_unknown')
  })

  it('404 pending_action_not_found when the row does not exist for the caller', async () => {
    repoGetByIdMock.mockResolvedValueOnce(null)

    const response = await POST(buildRequest() as any, buildContext('pa_missing'))
    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.code).toBe('pending_action_not_found')
  })

  it('403 forbidden when caller lacks ai_assistant.view', async () => {
    loadAclMock.mockResolvedValueOnce({ features: ['catalog.view'], isSuperAdmin: false })

    const response = await POST(buildRequest() as any, buildContext('pa_123'))
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

    const response = await POST(buildRequest() as any, buildContext('pa_123'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.mutationResult).toEqual(priorResult)
    expect(handlerSpy).not.toHaveBeenCalled()
    expect(repoSetStatusMock).not.toHaveBeenCalled()
  })

  it('500 confirm_internal_error when the repo throws unexpectedly', async () => {
    repoGetByIdMock.mockRejectedValueOnce(new Error('db down'))

    const response = await POST(buildRequest() as any, buildContext('pa_123'))
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.code).toBe('confirm_internal_error')
  })
})
