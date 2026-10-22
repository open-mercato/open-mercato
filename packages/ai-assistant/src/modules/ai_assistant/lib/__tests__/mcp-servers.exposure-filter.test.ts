import { z } from 'zod'
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { createMcpServer } from '../mcp-server'
import { createDevMcpServer } from '../mcp-dev-server'
import { DEFAULT_MCP_EXPOSURE_CONFIG, resolveMcpExposureConfig, type McpExposureConfig } from '../mcp-exposure'
import type { AiToolDefinition, McpServerOptions, McpToolContext, McpToolDefinition } from '../types'

const mockCapturedHandlers = new Map<unknown, (request: unknown) => Promise<unknown>>()
const mockRegisteredTools = new Map<string, McpToolDefinition>()
const mockDevRegisteredNames: string[] = []

jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: class {
    setRequestHandler(schema: unknown, handler: (request: unknown) => Promise<unknown>) {
      mockCapturedHandlers.set(schema, handler)
    }
  },
}))
jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {
    registerTool(name: string) {
      mockDevRegisteredNames.push(name)
    }
  },
}))
jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {},
}))
jest.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: class {},
}))
jest.mock('@modelcontextprotocol/sdk/types.js', () => ({
  ListToolsRequestSchema: { id: 'tools/list' },
  CallToolRequestSchema: { id: 'tools/call' },
}))
jest.mock('../tool-registry', () => ({
  getToolRegistry: () => ({
    getTools: () => mockRegisteredTools,
    listToolNames: () => Array.from(mockRegisteredTools.keys()),
  }),
}))
jest.mock('../tool-executor', () => ({ executeTool: jest.fn() }))
jest.mock('../tool-loader', () => ({
  loadAllModuleTools: jest.fn(),
  indexToolsForSearch: jest.fn(),
}))
jest.mock('../mcp-dev-key-resolution', () => ({ getApiKeyFromMcpJson: jest.fn() }))
jest.mock('@open-mercato/core/modules/api_keys/services/apiKeyService', () => ({
  findApiKeyBySecret: jest.fn(),
  findSessionApiKeyWithSecret: jest.fn(),
}))

const CALLER_FEATURES = ['customers.people.view', 'customers.people.manage']

function registerTool(overrides: Partial<AiToolDefinition> & { name: string }): void {
  mockRegisteredTools.set(overrides.name, {
    description: `${overrides.name} description`,
    inputSchema: z.object({ id: z.string() }),
    handler: async () => ({}),
    ...overrides,
  } as McpToolDefinition)
}

function registerFixtureTools(): void {
  registerTool({ name: 'customers.list_people', requiredFeatures: ['customers.people.view'] })
  registerTool({ name: 'customers.update_person', requiredFeatures: ['customers.people.manage'], isMutation: true })
  registerTool({ name: 'catalog.list_products', requiredFeatures: ['catalog.products.view'] })
  registerTool({ name: 'search_status' })
}

function makeContainer(): McpServerOptions['container'] {
  return {
    resolve: () => ({
      loadAcl: jest.fn(async () => ({ features: CALLER_FEATURES, isSuperAdmin: false })),
    }),
  } as unknown as McpServerOptions['container']
}

async function listStdioToolNames(exposureConfig?: McpExposureConfig): Promise<string[]> {
  await createMcpServer({
    config: { name: 'test-mcp', version: '0.0.0' },
    container: makeContainer(),
    context: { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' },
    exposureConfig,
  })
  const handler = mockCapturedHandlers.get(ListToolsRequestSchema)
  if (!handler) throw new Error('[internal] tools/list handler was not registered')
  const response = (await handler({})) as { tools: Array<{ name: string }> }
  return response.tools.map((tool) => tool.name).sort()
}

function listDevToolNames(exposureConfig: McpExposureConfig): string[] {
  const toolContext = {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    container: makeContainer(),
    userFeatures: CALLER_FEATURES,
    isSuperAdmin: false,
  } as McpToolContext
  createDevMcpServer(toolContext, CALLER_FEATURES, false, false, exposureConfig)
  return [...mockDevRegisteredNames].sort()
}

describe('MCP exposure filter in the stdio and dev servers', () => {
  const originalEnv = process.env

  beforeEach(() => {
    mockRegisteredTools.clear()
    mockCapturedHandlers.clear()
    mockDevRegisteredNames.length = 0
    process.env = { ...originalEnv }
    delete process.env.OM_MCP_TOOL_ALLOWLIST
    delete process.env.OM_MCP_TOOL_DENYLIST
    delete process.env.OM_MCP_MUTATION_MODE
    delete process.env.OM_MCP_AGENT_TOOLS
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    registerFixtureTools()
  })

  afterEach(() => {
    process.env = originalEnv
    jest.restoreAllMocks()
  })

  it('keeps feature-only filtering in the stdio server when no exposure env is set', async () => {
    expect(await listStdioToolNames()).toEqual([
      'customers.list_people',
      'customers.update_person',
      'search_status',
    ])
  })

  it('narrows the stdio tools/list with the OM_MCP_TOOL_ALLOWLIST env', async () => {
    process.env.OM_MCP_TOOL_ALLOWLIST = 'customers.*'
    expect(await listStdioToolNames()).toEqual(['customers.list_people', 'customers.update_person'])
  })

  it('keeps feature-only filtering in the dev server with the default config', () => {
    expect(listDevToolNames({ ...DEFAULT_MCP_EXPOSURE_CONFIG })).toEqual([
      'customers.list_people',
      'customers.update_person',
      'search_status',
    ])
  })

  it('hides mutation tools in the dev server when mutation mode is deny', () => {
    const exposureConfig = resolveMcpExposureConfig({ OM_MCP_MUTATION_MODE: 'deny' })
    expect(listDevToolNames(exposureConfig)).toEqual(['customers.list_people', 'search_status'])
  })

  it('applies the denylist in the dev server', () => {
    const exposureConfig = resolveMcpExposureConfig({ OM_MCP_TOOL_DENYLIST: 'search_status' })
    expect(listDevToolNames(exposureConfig)).toEqual(['customers.list_people', 'customers.update_person'])
  })
})
