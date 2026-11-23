import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { z } from 'zod'
import type { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import { createMcpHttpRequestHandler, isSessionKeyBoundToApiKey } from '../http-server'
import { DEFAULT_MCP_KEY_NAME } from '../mcp-ensure-api-key'
import { DEFAULT_MCP_EXPOSURE_CONFIG, type McpExposureConfig } from '../mcp-exposure'
import { MCP_AUDIT_RESOURCE_KIND, type McpAuditAccessLogInput } from '../mcp-audit'
import type { AiToolDefinition, McpServerConfig, McpToolDefinition, ToolExecutionResult } from '../types'

const mockRegisteredTools = new Map<string, McpToolDefinition>()
const mockFindApiKeyBySecret = jest.fn()
const mockFindSessionApiKeyWithSecret = jest.fn()
const mockExecuteTool = jest.fn<Promise<ToolExecutionResult>, [string, unknown, unknown, unknown?]>()

jest.mock('../tool-registry', () => ({
  getToolRegistry: () => ({
    getTools: () => new Map(mockRegisteredTools),
    listToolNames: () => Array.from(mockRegisteredTools.keys()),
  }),
}))
jest.mock('../tool-executor', () => ({
  ...jest.requireActual('../tool-executor'),
  executeTool: (...args: [string, unknown, unknown, unknown?]) => mockExecuteTool(...args),
}))
jest.mock('../agent-registry', () => ({
  loadAgentRegistry: jest.fn(async () => undefined),
  getAgent: () => undefined,
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

const aclBySubject = new Map<string, AclFixture>()
const accessLogEntries: McpAuditAccessLogInput[] = []
let loadAclMock: jest.Mock = jest.fn()

function registerTool(overrides: Partial<AiToolDefinition> & { name: string }): void {
  mockRegisteredTools.set(overrides.name, {
    description: `${overrides.name} description`,
    inputSchema: z.object({ id: z.string().optional() }),
    handler: async () => ({}),
    ...overrides,
  } as McpToolDefinition)
}

function apiKeyFixture(overrides: Partial<ApiKey>): ApiKey {
  return {
    id: 'key-id',
    name: 'key',
    tenantId: null,
    organizationId: null,
    keyHash: 'hash',
    keyPrefix: 'omk_pref',
    ...overrides,
  } as ApiKey
}

function makeContainer() {
  loadAclMock = jest.fn(async (subject: string) => aclBySubject.get(subject) ?? { features: [], isSuperAdmin: false })
  const rbacService = { loadAcl: loadAclMock }
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
    exposureConfig: { ...DEFAULT_MCP_EXPOSURE_CONFIG } as McpExposureConfig,
  })
  activeServer = createServer(handler)
  await new Promise<void>((resolve) => activeServer?.listen(0, '127.0.0.1', resolve))
  const address = activeServer.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

async function postRpc(baseUrl: string, method: string, params: Record<string, unknown>, extraHeaders: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'x-api-key': SERVER_SECRET,
      ...extraHeaders,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const text = await response.text()
  let body: any = null
  try {
    body = JSON.parse(text)
  } catch {
    const dataLine = text.split('\n').find((line) => line.startsWith('data:'))
    body = dataLine ? JSON.parse(dataLine.slice('data:'.length)) : null
  }
  return { status: response.status, body }
}

function defaultServerKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return apiKeyFixture({
    id: SERVER_KEY_ID,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    createdBy: 'user-1',
    sessionUserId: null,
    ...overrides,
  })
}

function defaultSessionKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return apiKeyFixture({
    id: SESSION_KEY_ID,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    sessionUserId: 'user-2',
    ...overrides,
  })
}

describe('isSessionKeyBoundToApiKey — fail-closed transport binding predicate (GHSA-2hrh-c89p-42qv)', () => {
  it('binds a session key that shares the transport API key tenant', () => {
    expect(isSessionKeyBoundToApiKey(defaultSessionKey(), defaultServerKey())).toBe(true)
  })

  it('fails closed when the session key belongs to another tenant', () => {
    expect(isSessionKeyBoundToApiKey(defaultSessionKey({ tenantId: 'tenant-2' }), defaultServerKey())).toBe(false)
  })

  it('fails closed when the transport API key is not tenant-scoped', () => {
    expect(isSessionKeyBoundToApiKey(defaultSessionKey(), defaultServerKey({ tenantId: null }))).toBe(false)
    expect(isSessionKeyBoundToApiKey(defaultSessionKey({ tenantId: null }), defaultServerKey({ tenantId: null }))).toBe(false)
  })

  it('lets the designated MCP server key refine any tenant when provisioned instance-globally', () => {
    const designatedServerKey = defaultServerKey({ tenantId: null, name: DEFAULT_MCP_KEY_NAME })
    expect(isSessionKeyBoundToApiKey(defaultSessionKey({ tenantId: 'tenant-9' }), designatedServerKey)).toBe(true)
    expect(isSessionKeyBoundToApiKey(defaultSessionKey({ tenantId: null }), designatedServerKey)).toBe(true)
  })

  it('does not extend the designated-key allowance to a tenant-scoped transport key', () => {
    expect(
      isSessionKeyBoundToApiKey(defaultSessionKey({ tenantId: 'tenant-2' }), defaultServerKey({ name: DEFAULT_MCP_KEY_NAME })),
    ).toBe(false)
  })

  it('fails closed when the session key is not tenant-scoped', () => {
    expect(isSessionKeyBoundToApiKey(defaultSessionKey({ tenantId: null }), defaultServerKey())).toBe(false)
    expect(isSessionKeyBoundToApiKey(defaultSessionKey({ tenantId: undefined }), defaultServerKey())).toBe(false)
  })
})

describe('MCP HTTP server — session tokens bound to the transport API key (GHSA-2hrh-c89p-42qv)', () => {
  beforeEach(() => {
    mockRegisteredTools.clear()
    aclBySubject.clear()
    accessLogEntries.length = 0
    mockFindApiKeyBySecret.mockReset()
    mockFindSessionApiKeyWithSecret.mockReset()
    mockExecuteTool.mockReset()
    loadAclMock.mockClear()

    registerTool({ name: 'context_whoami' })
    registerTool({ name: 'customers.list_people', requiredFeatures: ['customers.people.view'] })
    registerTool({ name: 'catalog.list_products', requiredFeatures: ['catalog.products.view'] })

    mockFindApiKeyBySecret.mockImplementation(async (_em: unknown, secret: string) =>
      secret === SERVER_SECRET ? defaultServerKey() : null)
    mockFindSessionApiKeyWithSecret.mockImplementation(async (_em: unknown, token: string) =>
      token === SESSION_TOKEN ? { key: defaultSessionKey(), secret: 'omk_session_secret' } : null)

    aclBySubject.set(`api_key:${SERVER_KEY_ID}`, { features: ['customers.*'], isSuperAdmin: false })
    aclBySubject.set(`api_key:${SESSION_KEY_ID}`, { features: ['catalog.products.view'], isSuperAdmin: false })
  })

  afterEach(async () => {
    if (activeServer) {
      await new Promise<void>((resolve) => activeServer?.close(() => resolve()))
      activeServer = null
    }
  })

  describe('tools/list principal resolution (resolveListPrincipal)', () => {
    it('keeps filtering by the session ACL when the session key is bound to the transport key tenant', async () => {
      const baseUrl = await startHandler()
      const result = await postRpc(baseUrl, 'tools/list', {}, { 'x-om-session-token': SESSION_TOKEN })
      expect(result.status).toBe(200)
      const names = (result.body.result?.tools ?? []).map((tool: { name: string }) => tool.name).sort()
      expect(names).toEqual(['catalog.list_products', 'context_whoami'])
    })

    it('rejects a cross-tenant session token header with 401 and never loads its ACL', async () => {
      mockFindSessionApiKeyWithSecret.mockImplementation(async (_em: unknown, token: string) =>
        token === SESSION_TOKEN ? { key: defaultSessionKey({ tenantId: 'tenant-2' }), secret: 'omk_session_secret' } : null)

      const baseUrl = await startHandler()
      const result = await postRpc(baseUrl, 'tools/list', {}, { 'x-om-session-token': SESSION_TOKEN })

      expect(result.status).toBe(401)
      expect(result.body).toEqual({ error: 'Invalid or expired session token' })
      expect(loadAclMock).not.toHaveBeenCalled()
    })

    it('rejects every session token when the transport API key is not tenant-scoped', async () => {
      mockFindApiKeyBySecret.mockImplementation(async (_em: unknown, secret: string) =>
        secret === SERVER_SECRET ? defaultServerKey({ tenantId: null }) : null)

      const baseUrl = await startHandler()
      const result = await postRpc(baseUrl, 'tools/list', {}, { 'x-om-session-token': SESSION_TOKEN })

      expect(result.status).toBe(401)
      expect(result.body).toEqual({ error: 'Invalid or expired session token' })
      expect(loadAclMock).not.toHaveBeenCalled()
    })

    it('keeps session ACL filtering when the designated MCP server key is provisioned instance-globally', async () => {
      mockFindApiKeyBySecret.mockImplementation(async (_em: unknown, secret: string) =>
        secret === SERVER_SECRET ? defaultServerKey({ tenantId: null, name: DEFAULT_MCP_KEY_NAME }) : null)

      const baseUrl = await startHandler()
      const result = await postRpc(baseUrl, 'tools/list', {}, { 'x-om-session-token': SESSION_TOKEN })

      expect(result.status).toBe(200)
      const names = (result.body.result?.tools ?? []).map((tool: { name: string }) => tool.name).sort()
      expect(names).toEqual(['catalog.list_products', 'context_whoami'])
    })
  })

  describe('tools/call session resolution (resolveSessionContext)', () => {
    it('executes the tool under the session principal when the session key is bound to the transport key tenant', async () => {
      mockExecuteTool.mockResolvedValue({ success: true, result: { items: [] } })
      const baseUrl = await startHandler()

      const result = await postRpc(
        baseUrl,
        'tools/call',
        { name: 'catalog.list_products', arguments: { _sessionToken: SESSION_TOKEN } },
        { 'x-om-session-token': SESSION_TOKEN },
      )

      expect(result.body.result?.isError).toBeUndefined()
      expect(mockExecuteTool).toHaveBeenCalledTimes(1)
      expect(mockExecuteTool.mock.calls[0][2]).toMatchObject({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        userId: 'user-2',
        apiKeySecret: 'omk_session_secret',
      })
      expect(mockExecuteTool.mock.calls[0][3]).toMatchObject({
        requester: { userId: 'user-2', apiKeyId: null },
      })
    })

    it('answers SESSION_EXPIRED without executing when the session token belongs to another tenant', async () => {
      mockFindSessionApiKeyWithSecret.mockImplementation(async (_em: unknown, token: string) =>
        token === SESSION_TOKEN ? { key: defaultSessionKey({ tenantId: 'tenant-2' }), secret: 'omk_session_secret' } : null)

      const baseUrl = await startHandler()
      const result = await postRpc(baseUrl, 'tools/call', {
        name: 'customers.list_people',
        arguments: { _sessionToken: SESSION_TOKEN },
      })

      expect(JSON.parse(result.body.result?.content?.[0]?.text ?? '{}')).toEqual({
        error: 'Your chat session has expired. Please close and reopen the chat window to continue.',
        code: 'SESSION_EXPIRED',
      })
      expect(mockExecuteTool).not.toHaveBeenCalled()
      expect(accessLogEntries).toHaveLength(1)
      expect(accessLogEntries[0]).toMatchObject({
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
          outcome: 'denied',
          errorCode: 'SESSION_EXPIRED',
        },
      })
      expect(JSON.stringify(accessLogEntries[0])).not.toContain(SESSION_TOKEN)
    })

    it('answers SESSION_EXPIRED when the transport API key is not tenant-scoped, even for a live session token', async () => {
      mockFindApiKeyBySecret.mockImplementation(async (_em: unknown, secret: string) =>
        secret === SERVER_SECRET ? defaultServerKey({ tenantId: null }) : null)

      const baseUrl = await startHandler()
      const result = await postRpc(baseUrl, 'tools/call', {
        name: 'customers.list_people',
        arguments: { _sessionToken: SESSION_TOKEN },
      })

      expect(JSON.parse(result.body.result?.content?.[0]?.text ?? '{}').code).toBe('SESSION_EXPIRED')
      expect(mockExecuteTool).not.toHaveBeenCalled()
    })

    it('executes under the session principal when the designated MCP server key is provisioned instance-globally', async () => {
      mockExecuteTool.mockResolvedValue({ success: true, result: { items: [] } })
      mockFindApiKeyBySecret.mockImplementation(async (_em: unknown, secret: string) =>
        secret === SERVER_SECRET ? defaultServerKey({ tenantId: null, name: DEFAULT_MCP_KEY_NAME }) : null)

      const baseUrl = await startHandler()
      const result = await postRpc(
        baseUrl,
        'tools/call',
        { name: 'catalog.list_products', arguments: { _sessionToken: SESSION_TOKEN } },
        { 'x-om-session-token': SESSION_TOKEN },
      )

      expect(result.body.result?.isError).toBeUndefined()
      expect(mockExecuteTool).toHaveBeenCalledTimes(1)
      expect(mockExecuteTool.mock.calls[0][2]).toMatchObject({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        userId: 'user-2',
      })
    })
  })
})