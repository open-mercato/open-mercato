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
    getToolMock.mockReturnValue({ name: 'customers.update_person', isMutation: true })
  })

  it('writes one tools-api row with the header correlation id and keeps the response body', async () => {
    executeToolMock.mockResolvedValue({ success: true, result: { id: 'p-1' } })

    const response = await POST(
      buildRequest(
        { toolName: 'customers.update_person', args: { name: SECRET_ARG_VALUE } },
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
      resourceId: 'customers.update_person',
      context: {
        channel: 'tools-api',
        mcpServer: null,
        principal: 'session',
        apiKeyId: null,
        outcome: 'ok',
        errorCode: null,
        isMutation: true,
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

    const response = await POST(buildRequest({ toolName: 'customers.update_person', args: {} }))

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

    const response = await POST(buildRequest({ toolName: 'customers.update_person', args: {} }))

    expect(response.status).toBe(500)
    expect(accessLogEntries).toHaveLength(1)
    expect(accessLogEntries[0].context).toMatchObject({ outcome: 'error', errorCode: 'EXCEPTION' })
  })

  it('writes no row when toolName is missing', async () => {
    const response = await POST(buildRequest({ args: {} }))

    expect(response.status).toBe(400)
    expect(accessLogEntries).toHaveLength(0)
  })
})

describe('POST /api/ai_assistant/tools/execute — mutation mode', () => {
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

  it('passes the tools-api channel and the env mutation mode to executeTool', async () => {
    process.env.OM_MCP_MUTATION_MODE = 'deny'
    executeToolMock.mockResolvedValue({ success: true, result: {} })

    await POST(buildRequest({ toolName: 'customers.update_person', args: {} }))

    expect(executeToolMock).toHaveBeenCalledWith(
      'customers.update_person',
      {},
      expect.any(Object),
      { channel: 'tools-api', mutationMode: 'deny' },
    )
  })

  it('defaults to direct mode when OM_MCP_MUTATION_MODE is unset', async () => {
    delete process.env.OM_MCP_MUTATION_MODE
    executeToolMock.mockResolvedValue({ success: true, result: {} })

    await POST(buildRequest({ toolName: 'customers.update_person', args: {} }))

    expect(executeToolMock.mock.calls[0][3]).toEqual({ channel: 'tools-api', mutationMode: 'direct' })
  })

  it('returns 403 with the MUTATION_REQUIRES_APPROVAL code in deny mode', async () => {
    process.env.OM_MCP_MUTATION_MODE = 'deny'
    executeToolMock.mockResolvedValue({
      success: false,
      error: 'mutation blocked',
      errorCode: 'MUTATION_REQUIRES_APPROVAL',
    })

    const response = await POST(buildRequest({ toolName: 'customers.update_person', args: {} }))

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      success: false,
      error: 'mutation blocked',
      code: 'MUTATION_REQUIRES_APPROVAL',
    })
    expect(accessLogEntries).toHaveLength(1)
    expect(accessLogEntries[0].context).toMatchObject({
      outcome: 'mutation_denied',
      errorCode: 'MUTATION_REQUIRES_APPROVAL',
      isMutation: true,
    })
  })
})
