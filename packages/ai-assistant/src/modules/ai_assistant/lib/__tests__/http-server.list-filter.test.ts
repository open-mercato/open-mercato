import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { z } from 'zod'
import { createMcpHttpRequestHandler } from '../http-server'
import { DEFAULT_MCP_EXPOSURE_CONFIG, resolveMcpExposureConfig, type McpExposureConfig } from '../mcp-exposure'
import { buildAgentToolOutputSchema } from '../agent-tool'
import type { AiToolDefinition, McpServerConfig, McpToolDefinition } from '../types'

const mockRegisteredTools = new Map<string, McpToolDefinition>()
const mockFindApiKeyBySecret = jest.fn()
const mockFindSessionApiKeyWithSecret = jest.fn()
const mockKnownAgents = new Set<string>()
let mockDispatcher: { owns: (agentId: string) => boolean; isAvailable: () => Promise<boolean>; runObject: () => void } | null =
  null

jest.mock('../tool-registry', () => ({
  getToolRegistry: () => ({
    getTools: () => new Map(mockRegisteredTools),
    listToolNames: () => Array.from(mockRegisteredTools.keys()),
  }),
}))
jest.mock('../tool-executor', () => ({ executeTool: jest.fn() }))
jest.mock('../agent-registry', () => ({
  loadAgentRegistry: jest.fn(async () => undefined),
  getAgent: (agentId: string) => (mockKnownAgents.has(agentId) ? { id: agentId } : undefined),
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
  return {
    resolve: (key: string) => {
      if (key === 'rbacService') return rbacService
      if (key === 'aiAgentRunDispatcher' && mockDispatcher) return mockDispatcher
      return {}
    },
  }
}

const serverConfig: McpServerConfig = { name: 'test-mcp', version: '0.0.0' }

let activeServer: Server | null = null

async function startHandler(exposureConfig: McpExposureConfig): Promise<string> {
  const handler = createMcpHttpRequestHandler({
    config: serverConfig,
    container: makeContainer() as unknown as Parameters<typeof createMcpHttpRequestHandler>[0]['container'],
    exposureConfig,
  })
  activeServer = createServer(handler)
  await new Promise<void>((resolve) => activeServer?.listen(0, '127.0.0.1', resolve))
  const address = activeServer.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

type ListedTool = { name: string; outputSchema?: Record<string, unknown> }

async function listTools(
  baseUrl: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; names: string[]; body: unknown; tools: ListedTool[] }> {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'x-api-key': SERVER_SECRET,
      ...extraHeaders,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  })
  const body = (await response.json()) as { result?: { tools?: ListedTool[] } }
  const tools = body.result?.tools ?? []
  const names = tools.map((tool) => tool.name).sort()
  return { status: response.status, names, body, tools }
}

describe('MCP HTTP server — tools/list filtered per principal', () => {
  beforeEach(() => {
    mockRegisteredTools.clear()
    aclBySubject.clear()
    mockFindApiKeyBySecret.mockReset()
    mockFindSessionApiKeyWithSecret.mockReset()
    mockKnownAgents.clear()
    mockKnownAgents.add('catalog.catalog_assistant')
    mockDispatcher = null

    registerTool({ name: 'context_whoami' })
    registerTool({ name: 'customers.list_people', requiredFeatures: ['customers.people.view'] })
    registerTool({ name: 'customers.update_person', requiredFeatures: ['customers.people.manage'], isMutation: true })
    registerTool({ name: 'catalog.list_products', requiredFeatures: ['catalog.products.view'] })
    registerTool({ name: 'catalog.hidden_tool', requiredFeatures: ['catalog.products.view'], mcp: { expose: false } })
    registerTool({
      name: 'catalog.agent_tool',
      requiredFeatures: ['catalog.products.view'],
      agentRef: { agentId: 'catalog.catalog_assistant', engine: 'ai-assistant' },
      mcp: { outputSchema: buildAgentToolOutputSchema(z.object({ summary: z.string() })) },
    })

    mockFindApiKeyBySecret.mockImplementation(async (_em: unknown, secret: string) =>
      secret === SERVER_SECRET
        ? { id: SERVER_KEY_ID, tenantId: 'tenant-1', organizationId: 'org-1', createdBy: 'user-1', keyPrefix: 'omk_serv' }
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

  it('lists only tools covered by the API key ACL plus feature-free tools', async () => {
    const baseUrl = await startHandler({ ...DEFAULT_MCP_EXPOSURE_CONFIG })
    const result = await listTools(baseUrl)
    expect(result.status).toBe(200)
    expect(result.names).toEqual(['context_whoami', 'customers.list_people', 'customers.update_person'])
  })

  it('narrows the list to the session user ACL when the session token header is sent', async () => {
    const baseUrl = await startHandler({ ...DEFAULT_MCP_EXPOSURE_CONFIG })
    const result = await listTools(baseUrl, { 'x-om-session-token': SESSION_TOKEN })
    expect(result.status).toBe(200)
    expect(result.names).toEqual(['catalog.agent_tool', 'catalog.list_products', 'context_whoami'])
  })

  it('advertises the agent tool outputSchema and leaves other tools without one', async () => {
    const baseUrl = await startHandler({ ...DEFAULT_MCP_EXPOSURE_CONFIG })
    const result = await listTools(baseUrl, { 'x-om-session-token': SESSION_TOKEN })
    const agentTool = result.tools.find((tool) => tool.name === 'catalog.agent_tool')
    expect(agentTool?.outputSchema).toMatchObject({
      type: 'object',
      properties: { result: expect.any(Object), agentId: expect.any(Object), runId: expect.any(Object) },
    })
    expect(result.tools.find((tool) => tool.name === 'catalog.list_products')?.outputSchema).toBeUndefined()
  })

  it('hides an agent tool whose agent is unknown and not owned by a dispatcher', async () => {
    mockKnownAgents.clear()
    const baseUrl = await startHandler({ ...DEFAULT_MCP_EXPOSURE_CONFIG })
    const result = await listTools(baseUrl, { 'x-om-session-token': SESSION_TOKEN })
    expect(result.names).toEqual(['catalog.list_products', 'context_whoami'])
  })

  it('hides an agent tool whose owning dispatcher reports it unavailable', async () => {
    mockDispatcher = { owns: () => true, isAvailable: async () => false, runObject: () => undefined }
    const baseUrl = await startHandler({ ...DEFAULT_MCP_EXPOSURE_CONFIG })
    const result = await listTools(baseUrl, { 'x-om-session-token': SESSION_TOKEN })
    expect(result.names).toEqual(['catalog.list_products', 'context_whoami'])
  })

  it('rejects an invalid session token header with 401', async () => {
    const baseUrl = await startHandler({ ...DEFAULT_MCP_EXPOSURE_CONFIG })
    const result = await listTools(baseUrl, { 'x-om-session-token': 'sess_expired' })
    expect(result.status).toBe(401)
    expect(result.body).toEqual({ error: 'Invalid or expired session token' })
  })

  it('exposes a single tool when the allowlist env names one', async () => {
    const exposureConfig = resolveMcpExposureConfig({ OM_MCP_TOOL_ALLOWLIST: 'customers.list_people' })
    const baseUrl = await startHandler(exposureConfig)
    const result = await listTools(baseUrl)
    expect(result.names).toEqual(['customers.list_people'])
  })

  it('hides mutation tools when the mutation mode is deny', async () => {
    const baseUrl = await startHandler({ ...DEFAULT_MCP_EXPOSURE_CONFIG, mutationMode: 'deny' })
    const result = await listTools(baseUrl)
    expect(result.names).toEqual(['context_whoami', 'customers.list_people'])
  })

  it('reports the exposure block on /health', async () => {
    const baseUrl = await startHandler({ ...DEFAULT_MCP_EXPOSURE_CONFIG, deny: ['catalog.list_*'] })
    const response = await fetch(`${baseUrl}/health`)
    const body = (await response.json()) as { tools: number; exposure: unknown }
    expect(response.status).toBe(200)
    expect(body.tools).toBe(6)
    expect(body.exposure).toEqual({
      allowlist: false,
      denylistCount: 1,
      mutationMode: 'direct',
      toolCount: 4,
      agentToolCount: 1,
    })
  })
})
