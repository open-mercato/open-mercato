import { z } from 'zod'
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { createMcpServer } from '../mcp-server'
import type { AiToolDefinition, McpServerOptions, McpToolDefinition } from '../types'

const mockCapturedHandlers = new Map<unknown, (request: unknown) => Promise<unknown>>()
const mockRegisteredTools = new Map<string, McpToolDefinition>()

jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: class {
    setRequestHandler(schema: unknown, handler: (request: unknown) => Promise<unknown>) {
      mockCapturedHandlers.set(schema, handler)
    }
  },
}))
jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {},
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
jest.mock('../auth', () => ({
  authenticateMcpRequest: jest.fn(),
  hasRequiredFeatures: jest.fn(() => true),
}))

function registerTool(overrides: Partial<AiToolDefinition> & { name: string }): void {
  mockRegisteredTools.set(overrides.name, {
    description: `${overrides.name} description`,
    inputSchema: z.object({ id: z.string() }),
    handler: async () => ({}),
    ...overrides,
  } as McpToolDefinition)
}

function makeContainer(): McpServerOptions['container'] {
  return {
    resolve: () => ({ loadAcl: jest.fn() }),
  } as unknown as McpServerOptions['container']
}

type ListedTool = {
  name: string
  description: string
  inputSchema: unknown
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
}

async function listTools(): Promise<ListedTool[]> {
  await createMcpServer({
    config: { name: 'test-mcp', version: '0.0.0' },
    container: makeContainer(),
    allowUnauthenticatedSuperadmin: true,
  })
  const handler = mockCapturedHandlers.get(ListToolsRequestSchema)
  if (!handler) throw new Error('[internal] tools/list handler was not registered')
  const response = (await handler({})) as { tools: ListedTool[] }
  return response.tools
}

describe('issue #5283 — MCP tools/list publishes readOnlyHint annotations', () => {
  beforeEach(() => {
    mockRegisteredTools.clear()
    mockCapturedHandlers.clear()
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('marks read operations as read-only so clients can skip approval', async () => {
    registerTool({ name: 'customers.get_company' })
    registerTool({ name: 'customers.list_people' })
    registerTool({ name: 'search_status', isMutation: false })

    const tools = await listTools()

    expect(tools).toHaveLength(3)
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true)
    }
  })

  it('never marks mutating operations as read-only', async () => {
    registerTool({ name: 'catalog.update_product', isMutation: true })
    registerTool({ name: 'customers.manage_deal_comment', isMutation: true, isDestructive: true })

    const tools = await listTools()

    const byName = new Map(tools.map((tool) => [tool.name, tool]))
    expect(byName.get('catalog.update_product')?.annotations?.readOnlyHint).toBe(false)
    expect(byName.get('customers.manage_deal_comment')?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
    })
  })

  it('keeps the existing name / description / inputSchema fields intact', async () => {
    registerTool({ name: 'customers.get_company' })

    const [tool] = await listTools()

    expect(tool.name).toBe('customers.get_company')
    expect(tool.description).toBe('customers.get_company description')
    expect(tool.inputSchema).toBeDefined()
  })
})
