import { z } from 'zod'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { createMcpServer } from '../mcp-server'
import { defineAgentTool } from '../agent-tool'
import { executeTool } from '../tool-executor'
import { filterRunnableAgentTools } from '../mcp-agent-tool-results'
import type { McpServerOptions, McpToolContext, McpToolDefinition } from '../types'

const mockCapturedHandlers = new Map<unknown, (request: unknown) => Promise<unknown>>()
const mockRegisteredTools = new Map<string, McpToolDefinition>()
const mockLoadAgentRegistry = jest.fn(async () => undefined)
const mockRecordMcpToolCall = jest.fn(async () => undefined)

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
    getTool: (name: string) => mockRegisteredTools.get(name),
    listToolNames: () => Array.from(mockRegisteredTools.keys()),
  }),
}))
jest.mock('../tool-loader', () => ({
  loadAllModuleTools: jest.fn(),
  indexToolsForSearch: jest.fn(),
}))
jest.mock('../agent-registry', () => ({
  loadAgentRegistry: () => mockLoadAgentRegistry(),
  getAgent: () => undefined,
}))
jest.mock('../mcp-audit', () => ({
  ...jest.requireActual('../mcp-audit'),
  recordMcpToolCall: (...args: unknown[]) => mockRecordMcpToolCall(...(args as [])),
}))
jest.mock('@open-mercato/core/modules/api_keys/services/apiKeyService', () => ({
  findApiKeyBySecret: jest.fn(),
  findSessionApiKeyWithSecret: jest.fn(),
}))

const CALLER_FEATURES = ['agent_orchestrator.agents.view', 'customers.people.view']
const ORCHESTRATOR_AGENT_TOOL = 'agent_examples.triage_ticket'
const PLAIN_TOOL = 'customers.list_people'

const orchestratorAgentTool = defineAgentTool({
  name: ORCHESTRATOR_AGENT_TOOL,
  description: 'Triage a support ticket',
  agentId: 'support.ticket_triage',
  inputSchema: z.object({ subject: z.string(), body: z.string() }),
  outputSchema: z.object({ category: z.string() }),
  requiredFeatures: ['agent_orchestrator.agents.view'],
})

function registerTools(): void {
  mockRegisteredTools.set(PLAIN_TOOL, {
    name: PLAIN_TOOL,
    description: 'List people',
    inputSchema: z.object({}),
    requiredFeatures: ['customers.people.view'],
    handler: async () => ({ items: [] }),
  })
  mockRegisteredTools.set(ORCHESTRATOR_AGENT_TOOL, orchestratorAgentTool as unknown as McpToolDefinition)
}

function makeContainerWithoutDispatcher(): McpServerOptions['container'] {
  return {
    resolve: (name: string) => {
      if (name === 'rbacService') {
        return { loadAcl: jest.fn(async () => ({ features: CALLER_FEATURES, isSuperAdmin: false })) }
      }
      throw new Error(`[internal] ${name} is not registered`)
    },
  } as unknown as McpServerOptions['container']
}

async function startStdioServer(): Promise<void> {
  await createMcpServer({
    config: { name: 'decoupling-mcp', version: '0.0.0' },
    container: makeContainerWithoutDispatcher(),
    context: { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' },
  })
}

function capturedHandler(schema: unknown): (request: unknown) => Promise<unknown> {
  const handler = mockCapturedHandlers.get(schema)
  if (!handler) throw new Error('[internal] MCP handler was not registered')
  return handler
}

describe('agent tools with agent_orchestrator disabled', () => {
  const originalEnv = process.env

  beforeEach(() => {
    mockCapturedHandlers.clear()
    mockRegisteredTools.clear()
    mockLoadAgentRegistry.mockClear()
    mockRecordMcpToolCall.mockClear()
    process.env = { ...originalEnv }
    delete process.env.OM_MCP_TOOL_ALLOWLIST
    delete process.env.OM_MCP_TOOL_DENYLIST
    delete process.env.OM_MCP_MUTATION_MODE
    delete process.env.OM_MCP_AGENT_TOOLS
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    registerTools()
  })

  afterEach(() => {
    process.env = originalEnv
    jest.restoreAllMocks()
  })

  it('drops the orchestrator-backed tool from the runnable list when no dispatcher is registered', async () => {
    const runnable = await filterRunnableAgentTools(
      Array.from(mockRegisteredTools.values()),
      makeContainerWithoutDispatcher(),
    )
    expect(runnable.map((tool) => tool.name)).toEqual([PLAIN_TOOL])
  })

  it('starts the stdio server cleanly and leaves the orchestrator-backed tool out of tools/list', async () => {
    await expect(startStdioServer()).resolves.toBeUndefined()
    const response = (await capturedHandler(ListToolsRequestSchema)({})) as { tools: Array<{ name: string }> }
    expect(response.tools.map((tool) => tool.name)).toEqual([PLAIN_TOOL])
  })

  it('answers a tools/call for the orchestrator-backed tool with AGENT_DISPATCHER_UNAVAILABLE', async () => {
    await startStdioServer()
    const response = (await capturedHandler(CallToolRequestSchema)({
      params: { name: ORCHESTRATOR_AGENT_TOOL, arguments: { subject: 'Charged twice', body: 'Two charges' } },
    })) as { isError?: boolean; content: Array<{ text: string }> }
    expect(response.isError).toBe(true)
    expect(JSON.parse(response.content[0].text)).toMatchObject({ code: 'AGENT_DISPATCHER_UNAVAILABLE' })
  })

  it('returns AGENT_DISPATCHER_UNAVAILABLE from a direct executeTool call', async () => {
    const context: McpToolContext = {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-1',
      container: makeContainerWithoutDispatcher() as McpToolContext['container'],
      userFeatures: CALLER_FEATURES,
      isSuperAdmin: false,
    }
    const result = await executeTool(
      ORCHESTRATOR_AGENT_TOOL,
      { subject: 'Charged twice', body: 'Two charges' },
      context,
      { channel: 'tools-api' },
    )
    expect(result).toMatchObject({ success: false, errorCode: 'AGENT_DISPATCHER_UNAVAILABLE' })
  })
})
