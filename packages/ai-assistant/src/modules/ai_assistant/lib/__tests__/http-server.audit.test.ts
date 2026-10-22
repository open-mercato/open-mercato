import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { z } from 'zod'
import { createMcpHttpRequestHandler } from '../http-server'
import { DEFAULT_MCP_EXPOSURE_CONFIG } from '../mcp-exposure'
import { MCP_AUDIT_RESOURCE_KIND, type McpAuditAccessLogInput } from '../mcp-audit'
import type { AiToolDefinition, McpServerConfig, McpToolDefinition, ToolExecutionResult } from '../types'

const mockRegisteredTools = new Map<string, McpToolDefinition>()
const mockFindApiKeyBySecret = jest.fn()
const mockFindSessionApiKeyWithSecret = jest.fn()
const mockExecuteTool = jest.fn<Promise<ToolExecutionResult>, [string, unknown, unknown]>()

jest.mock('../tool-registry', () => ({
  getToolRegistry: () => ({
    getTools: () => new Map(mockRegisteredTools),
    listToolNames: () => Array.from(mockRegisteredTools.keys()),
  }),
}))
jest.mock('../tool-executor', () => ({
  executeTool: (...args: [string, unknown, unknown]) => mockExecuteTool(...args),
}))
jest.mock('../tool-loader', () => ({
  loadAllModuleTools: jest.fn(),
  indexToolsForSearch: jest.fn(),
}))
jest.mock('@open-mercato/core/modules/api_keys/services/apiKeyService', () => ({
  findApiKeyBySecret: (...args: unknown[]) => mockFindApiKeyBySecret(...args),
  findSessionApiKeyWithSecret: (...args: unknown[]) => mockFindSessionApiKeyWithSecret(...args),
}))

type AclFixture = { features: string[]; isSuperAdmin: boolean }

const SERVER_KEY_ID = 'server-key'
const SESSION_KEY_ID = 'session-key'
const SERVER_SECRET = 'omk_server_secret'
const SESSION_TOKEN = 'sess_valid'
const SECRET_ARG_VALUE = 'very-secret-customer-name'

const aclBySubject = new Map<string, AclFixture>()
const accessLogEntries: McpAuditAccessLogInput[] = []

function registerTool(overrides: Partial<AiToolDefinition> & { name: string }): void {
  mockRegisteredTools.set(overrides.name, {
    description: `${overrides.name} description`,
    inputSchema: z.object({ id: z.string().optional() }),
    handler: async () => ({}),
    ...overrides,
  } as McpToolDefinition)
}

function makeContainer() {
  const rbacService = {
    loadAcl: jest.fn(async (subject: string) => aclBySubject.get(subject) ?? { features: [], isSuperAdmin: false }),
  }
  const accessLogService = {
    log: jest.fn(async (input: McpAuditAccessLogInput) => {
      accessLogEntries.push(input)
    }),
  }
  return {
    resolve: (key: string) => {
      if (key === 'rbacService') return rbacService
      if (key === 'accessLogService') return accessLogService
      return {}
    },
  }
}

const serverConfig: McpServerConfig = { name: 'test-mcp', version: '0.0.0' }

let activeServer: Server | null = null

async function startHandler(): Promise<string> {
  const handler = createMcpHttpRequestHandler({
    config: serverConfig,
    container: makeContainer() as unknown as Parameters<typeof createMcpHttpRequestHandler>[0]['container'],
    exposureConfig: { ...DEFAULT_MCP_EXPOSURE_CONFIG },
  })
  activeServer = createServer(handler)
  await new Promise<void>((resolve) => activeServer?.listen(0, '127.0.0.1', resolve))
  const address = activeServer.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

type CallToolBody = {
  result?: {
    content?: Array<{ type: string; text: string }>
    isError?: boolean
    _meta?: { correlationId?: string }
  }
}

async function callTool(
  baseUrl: string,
  name: string,
  toolArgs: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Promise<CallToolBody> {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'x-api-key': SERVER_SECRET,
      ...extraHeaders,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: toolArgs } }),
  })
  return (await response.json()) as CallToolBody
}

describe('MCP HTTP server — tools/call audit', () => {
  beforeEach(() => {
    mockRegisteredTools.clear()
    aclBySubject.clear()
    accessLogEntries.length = 0
    mockFindApiKeyBySecret.mockReset()
    mockFindSessionApiKeyWithSecret.mockReset()
    mockExecuteTool.mockReset()

    registerTool({ name: 'customers.list_people', requiredFeatures: ['customers.people.view'] })
    registerTool({ name: 'customers.update_person', requiredFeatures: ['customers.people.manage'], isMutation: true })

    mockFindApiKeyBySecret.mockImplementation(async (_em: unknown, secret: string) =>
      secret === SERVER_SECRET
        ? {
            id: SERVER_KEY_ID,
            tenantId: 'tenant-1',
            organizationId: 'org-1',
            createdBy: 'user-1',
            sessionUserId: null,
            keyPrefix: 'omk_serv',
          }
        : null,
    )
    mockFindSessionApiKeyWithSecret.mockImplementation(async (_em: unknown, token: string) =>
      token === SESSION_TOKEN
        ? {
            key: { id: SESSION_KEY_ID, tenantId: 'tenant-1', organizationId: 'org-1', sessionUserId: 'user-2' },
            secret: 'omk_session_secret',
          }
        : null,
    )
    aclBySubject.set(`api_key:${SERVER_KEY_ID}`, { features: ['customers.*'], isSuperAdmin: false })
    aclBySubject.set(`api_key:${SESSION_KEY_ID}`, { features: ['catalog.products.view'], isSuperAdmin: false })
  })

  afterEach(async () => {
    if (activeServer) {
      await new Promise<void>((resolve) => activeServer?.close(() => resolve()))
      activeServer = null
    }
  })

  it('writes one ok row with the header correlation id and echoes it in _meta', async () => {
    mockExecuteTool.mockResolvedValue({ success: true, result: { items: [] } })
    const baseUrl = await startHandler()

    const body = await callTool(
      baseUrl,
      'customers.list_people',
      { id: SECRET_ARG_VALUE },
      { 'x-correlation-id': 'corr-http-1' },
    )

    expect(body.result?.isError).toBeUndefined()
    expect(body.result?.content?.[0]?.text).toBe(JSON.stringify({ items: [] }, null, 2))
    expect(body.result?._meta).toEqual({ correlationId: 'corr-http-1' })
    expect(accessLogEntries).toHaveLength(1)
    const [entry] = accessLogEntries
    expect(entry).toMatchObject({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      actorUserId: 'user-1',
      resourceKind: MCP_AUDIT_RESOURCE_KIND,
      resourceId: 'customers.list_people',
      context: {
        channel: 'mcp',
        mcpServer: 'http',
        apiKeyId: SERVER_KEY_ID,
        sessionKeyId: null,
        principal: 'api_key',
        outcome: 'ok',
        errorCode: null,
        isMutation: false,
        correlationId: 'corr-http-1',
        argKeys: ['id'],
      },
    })
    expect(typeof entry.context.durationMs).toBe('number')
    expect(JSON.stringify(entry)).not.toContain(SECRET_ARG_VALUE)
  })

  it('records the session principal and drops the session token from argKeys', async () => {
    mockExecuteTool.mockResolvedValue({ success: false, error: 'bad input', errorCode: 'VALIDATION_ERROR' })
    registerTool({ name: 'catalog.list_products', requiredFeatures: ['catalog.products.view'] })
    const baseUrl = await startHandler()

    const body = await callTool(
      baseUrl,
      'catalog.list_products',
      { id: SECRET_ARG_VALUE, _sessionToken: SESSION_TOKEN },
      { 'x-om-session-token': SESSION_TOKEN },
    )

    expect(body.result?.isError).toBe(true)
    expect(JSON.parse(body.result?.content?.[0]?.text ?? '{}')).toEqual({ error: 'bad input', code: 'VALIDATION_ERROR' })
    const correlationId = body.result?._meta?.correlationId
    expect(correlationId).toEqual(expect.any(String))
    expect(accessLogEntries).toHaveLength(1)
    expect(accessLogEntries[0]).toMatchObject({
      actorUserId: 'user-2',
      context: {
        principal: 'session',
        sessionKeyId: SESSION_KEY_ID,
        apiKeyId: SERVER_KEY_ID,
        outcome: 'invalid_input',
        errorCode: 'VALIDATION_ERROR',
        correlationId,
        argKeys: ['id'],
      },
    })
    expect(JSON.stringify(accessLogEntries[0])).not.toContain(SESSION_TOKEN)
  })

  it('records denied for the per-call ACL rejection without executing the tool', async () => {
    const baseUrl = await startHandler()

    const body = await callTool(baseUrl, 'customers.update_person', { id: 'p-1', _sessionToken: SESSION_TOKEN })

    expect(body.result?.isError).toBe(true)
    expect(JSON.parse(body.result?.content?.[0]?.text ?? '{}').code).toBe('UNAUTHORIZED')
    expect(mockExecuteTool).not.toHaveBeenCalled()
    expect(accessLogEntries).toHaveLength(1)
    expect(accessLogEntries[0].context).toMatchObject({
      outcome: 'denied',
      errorCode: 'UNAUTHORIZED',
      isMutation: true,
      principal: 'session',
      correlationId: body.result?._meta?.correlationId,
    })
  })

  it('records denied for an expired session token', async () => {
    const baseUrl = await startHandler()

    const body = await callTool(baseUrl, 'customers.list_people', { _sessionToken: 'sess_expired' })

    expect(JSON.parse(body.result?.content?.[0]?.text ?? '{}').code).toBe('SESSION_EXPIRED')
    expect(body.result?._meta?.correlationId).toEqual(expect.any(String))
    expect(accessLogEntries).toHaveLength(1)
    expect(accessLogEntries[0].context).toMatchObject({
      outcome: 'denied',
      errorCode: 'SESSION_EXPIRED',
      principal: 'api_key',
    })
  })

  it('records error when the tool throws and replaces an invalid correlation header', async () => {
    mockExecuteTool.mockRejectedValue(new Error('boom'))
    const baseUrl = await startHandler()

    const body = await callTool(baseUrl, 'customers.list_people', {}, { 'x-correlation-id': 'bad id with spaces' })

    expect(JSON.parse(body.result?.content?.[0]?.text ?? '{}')).toEqual({ error: 'boom', code: 'EXCEPTION' })
    const correlationId = body.result?._meta?.correlationId
    expect(correlationId).not.toBe('bad id with spaces')
    expect(correlationId).toMatch(/^[0-9a-f-]{36}$/)
    expect(accessLogEntries).toHaveLength(1)
    expect(accessLogEntries[0].context).toMatchObject({ outcome: 'error', errorCode: 'EXCEPTION', correlationId })
  })
})
