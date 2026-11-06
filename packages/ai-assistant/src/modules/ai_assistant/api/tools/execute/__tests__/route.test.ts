import type { McpAuditAccessLogInput } from '../../../../lib/mcp-audit'

const authMock = jest.fn()
const executeToolMock = jest.fn()
const getToolMock = jest.fn()
const accessLogEntries: McpAuditAccessLogInput[] = []

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => authMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) => {
      if (name === 'rbacService') {
        return { loadAcl: jest.fn(async () => ({ features: ['customers.*'], isSuperAdmin: false })) }
      }
      if (name === 'accessLogService') {
        return {
          log: jest.fn(async (input: McpAuditAccessLogInput) => {
            accessLogEntries.push(input)
          }),
        }
      }
      return undefined
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ t: (key: string) => key })),
}))

jest.mock('../../../../lib/tool-executor', () => ({
  executeTool: (...args: unknown[]) => executeToolMock(...args),
}))

jest.mock('../../../../lib/tool-loader', () => ({
  loadAllModuleTools: jest.fn(async () => undefined),
}))

jest.mock('../../../../lib/tool-registry', () => ({
  getToolRegistry: () => ({ getTool: (name: string) => getToolMock(name) }),
}))

import { POST } from '../route'

const SECRET_ARG_VALUE = 'very-secret-customer-name'

function buildRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/ai_assistant/tools/execute', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  }) as unknown as Parameters<typeof POST>[0]
}

describe('POST /api/ai_assistant/tools/execute — audit', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    accessLogEntries.length = 0
    authMock.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    getToolMock.mockReturnValue({ name: 'customers.get_person', isMutation: false })
  })

  it('writes one tools-api row with the header correlation id and keeps the response body', async () => {
    executeToolMock.mockResolvedValue({ success: true, result: { id: 'p-1' } })

    const response = await POST(
      buildRequest(
        { toolName: 'customers.get_person', args: { name: SECRET_ARG_VALUE } },
        { 'x-correlation-id': 'corr-tools-1' },
      ),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, result: { id: 'p-1' } })
    expect(accessLogEntries).toHaveLength(1)
    expect(accessLogEntries[0]).toMatchObject({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      actorUserId: 'user-1',
      resourceId: 'customers.get_person',
      context: {
        channel: 'tools-api',
        mcpServer: null,
        principal: 'session',
        apiKeyId: null,
        outcome: 'ok',
        errorCode: null,
        isMutation: false,
        correlationId: 'corr-tools-1',
        argKeys: ['name'],
      },
    })
    expect(JSON.stringify(accessLogEntries[0])).not.toContain(SECRET_ARG_VALUE)
  })

  it('uses the API key id and the key owner as actor for API-key auth', async () => {
    authMock.mockResolvedValue({
      sub: 'api_key:key-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      isApiKey: true,
      keyId: 'key-1',
      userId: 'owner-1',
    })
    executeToolMock.mockResolvedValue({ success: false, error: 'denied', errorCode: 'UNAUTHORIZED' })

    const response = await POST(buildRequest({ toolName: 'customers.get_person', args: {} }))

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ success: false, error: 'denied' })
    expect(accessLogEntries).toHaveLength(1)
    expect(accessLogEntries[0].actorUserId).toBe('owner-1')
    expect(accessLogEntries[0].context).toMatchObject({
      principal: 'api_key',
      apiKeyId: 'key-1',
      outcome: 'denied',
      errorCode: 'UNAUTHORIZED',
    })
    expect(accessLogEntries[0].context.correlationId).toEqual(expect.any(String))
  })

  it('records error when the tool throws', async () => {
    executeToolMock.mockRejectedValue(new Error('boom'))
    jest.spyOn(console, 'error').mockImplementation(() => {})

    const response = await POST(buildRequest({ toolName: 'customers.get_person', args: {} }))

    expect(response.status).toBe(500)
    expect(accessLogEntries).toHaveLength(1)
    expect(accessLogEntries[0].context).toMatchObject({ outcome: 'error', errorCode: 'EXCEPTION' })
  })

  it('returns the agent payload and records the run ids for an agent tool', async () => {
    getToolMock.mockReturnValue({
      name: 'customers.summary_agent.run',
      agentRef: { agentId: 'customers.summary_agent', engine: 'ai-assistant' },
    })
    const payload = { result: { summary: 'ok' }, agentId: 'customers.summary_agent', runId: 'run-1', agentRunId: null }
    executeToolMock.mockResolvedValue({ success: true, result: { ...payload, internal: 'dropped' } })

    const response = await POST(
      buildRequest({ toolName: 'customers.summary_agent.run', args: { input: SECRET_ARG_VALUE } }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, result: payload })
    expect(accessLogEntries).toHaveLength(1)
    expect(accessLogEntries[0].context).toMatchObject({
      outcome: 'ok',
      isMutation: false,
      agentId: 'customers.summary_agent',
      aiAgentRunId: 'run-1',
      agentRunId: null,
      argKeys: ['input'],
    })
    expect(JSON.stringify(accessLogEntries[0])).not.toContain(SECRET_ARG_VALUE)
  })

  it('records the agent id and dispatcher_unavailable when an agent tool cannot run', async () => {
    getToolMock.mockReturnValue({
      name: 'customers.summary_agent.run',
      agentRef: { agentId: 'customers.summary_agent', engine: 'ai-assistant' },
    })
    executeToolMock.mockResolvedValue({
      success: false,
      error: 'unavailable',
      errorCode: 'AGENT_DISPATCHER_UNAVAILABLE',
    })

    const response = await POST(buildRequest({ toolName: 'customers.summary_agent.run', args: {} }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ success: false, error: 'unavailable' })
    expect(accessLogEntries[0].context).toMatchObject({
      outcome: 'dispatcher_unavailable',
      errorCode: 'AGENT_DISPATCHER_UNAVAILABLE',
      agentId: 'customers.summary_agent',
      aiAgentRunId: null,
      agentRunId: null,
    })
  })

  it('writes no row when toolName is missing', async () => {
    const response = await POST(buildRequest({ args: {} }))

    expect(response.status).toBe(400)
    expect(accessLogEntries).toHaveLength(0)
  })
})

describe('POST /api/ai_assistant/tools/execute — mutation tools', () => {
  const originalMutationMode = process.env.OM_MCP_MUTATION_MODE

  beforeEach(() => {
    jest.clearAllMocks()
    accessLogEntries.length = 0
    authMock.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    getToolMock.mockReturnValue({ name: 'customers.update_person', isMutation: true })
  })

  afterEach(() => {
    if (originalMutationMode === undefined) delete process.env.OM_MCP_MUTATION_MODE
    else process.env.OM_MCP_MUTATION_MODE = originalMutationMode
  })

  it.each([undefined, 'direct', 'deny', 'approval'])(
    'refuses a mutation tool with 403 and audits the denial when OM_MCP_MUTATION_MODE=%s',
    async (mode) => {
      if (mode === undefined) delete process.env.OM_MCP_MUTATION_MODE
      else process.env.OM_MCP_MUTATION_MODE = mode

      const response = await POST(
        buildRequest({ toolName: 'customers.update_person', args: { name: SECRET_ARG_VALUE } }, { 'x-correlation-id': 'corr-deny-1' }),
      )

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({
        success: false,
        error: 'ai_assistant.errors.directMutationDenied',
      })
      expect(executeToolMock).not.toHaveBeenCalled()
      expect(accessLogEntries).toHaveLength(1)
      expect(accessLogEntries[0].context).toMatchObject({
        channel: 'tools-api',
        outcome: 'denied',
        errorCode: 'DIRECT_MUTATION_DENIED',
        isMutation: true,
        correlationId: 'corr-deny-1',
      })
      expect(JSON.stringify(accessLogEntries[0])).not.toContain(SECRET_ARG_VALUE)
    },
  )

  it('runs read tools with the tools-api channel and the env mutation mode for agent-tool policy', async () => {
    process.env.OM_MCP_MUTATION_MODE = 'approval'
    getToolMock.mockReturnValue({ name: 'customers.get_person', isMutation: false })
    executeToolMock.mockResolvedValue({ success: true, result: {} })

    await POST(buildRequest({ toolName: 'customers.get_person', args: {} }))

    expect(executeToolMock).toHaveBeenCalledWith(
      'customers.get_person',
      {},
      expect.any(Object),
      {
        channel: 'tools-api',
        mutationMode: 'approval',
        requester: { userId: 'user-1', apiKeyId: null },
        correlationId: expect.any(String),
      },
    )
  })

  it('passes the API key owner as requester instead of the api_key subject', async () => {
    authMock.mockResolvedValue({
      sub: 'api_key:key-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      isApiKey: true,
      keyId: 'key-1',
      userId: 'owner-1',
    })
    getToolMock.mockReturnValue({ name: 'customers.get_person', isMutation: false })
    executeToolMock.mockResolvedValue({ success: true, result: {} })

    await POST(buildRequest({ toolName: 'customers.get_person', args: {} }))

    expect(executeToolMock.mock.calls[0][3]).toMatchObject({
      requester: { userId: 'owner-1', apiKeyId: 'key-1' },
    })
  })
})
