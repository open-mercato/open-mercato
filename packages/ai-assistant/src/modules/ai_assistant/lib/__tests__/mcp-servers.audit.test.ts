import { z } from 'zod'
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { createMcpServer } from '../mcp-server'
import { createDevMcpServer } from '../mcp-dev-server'
import { DEFAULT_MCP_EXPOSURE_CONFIG } from '../mcp-exposure'
import type { McpAuditAccessLogInput } from '../mcp-audit'
import type { AiToolDefinition, McpServerOptions, McpToolContext, McpToolDefinition } from '../types'

type ToolCallHandler = (args: unknown) => Promise<unknown>

const mockCapturedHandlers = new Map<unknown, (request: unknown) => Promise<unknown>>()
const mockRegisteredTools = new Map<string, McpToolDefinition>()
const mockDevToolHandlers = new Map<string, ToolCallHandler>()
const mockExecuteTool = jest.fn()
const accessLogEntries: McpAuditAccessLogInput[] = []

jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: class {
    setRequestHandler(schema: unknown, handler: (request: unknown) => Promise<unknown>) {
      mockCapturedHandlers.set(schema, handler)
    }
  },
}))
jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {
    registerTool(name: string, _config: unknown, handler: ToolCallHandler) {
      mockDevToolHandlers.set(name, handler)
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
    getTool: (name: string) => mockRegisteredTools.get(name),
    listToolNames: () => Array.from(mockRegisteredTools.keys()),
  }),
}))
jest.mock('../tool-executor', () => ({
  ...jest.requireActual('../tool-executor'),
  executeTool: (...args: unknown[]) => mockExecuteTool(...args),
}))
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
const SECRET_ARG_VALUE = 'very-secret-customer-name'

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
    resolve: (name: string) => {
      if (name === 'accessLogService') {
        return {
          log: jest.fn(async (input: McpAuditAccessLogInput) => {
            accessLogEntries.push(input)
          }),
        }
      }
      return { loadAcl: jest.fn(async () => ({ features: CALLER_FEATURES, isSuperAdmin: false })) }
    },
  } as unknown as McpServerOptions['container']
}

type ToolResult = {
  content: Array<{ type: string; text: string }>
  structuredContent?: Record<string, unknown>
  isError?: boolean
  _meta?: { correlationId?: string }
}

async function callStdioTool(name: string, toolArgs: Record<string, unknown>): Promise<ToolResult> {
  await createMcpServer({
    config: { name: 'test-mcp', version: '0.0.0' },
    container: makeContainer(),
    context: { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' },
  })
  const handler = mockCapturedHandlers.get(CallToolRequestSchema)
  if (!handler) throw new Error('[internal] tools/call handler was not registered')
  return (await handler({ params: { name, arguments: toolArgs } })) as ToolResult
}

async function callDevTool(name: string, toolArgs: Record<string, unknown>): Promise<ToolResult> {
  const toolContext = {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'api_key:key-1',
    container: makeContainer(),
    userFeatures: CALLER_FEATURES,
    isSuperAdmin: false,
  } as McpToolContext
  createDevMcpServer(toolContext, CALLER_FEATURES, false, false, { ...DEFAULT_MCP_EXPOSURE_CONFIG }, {
    apiKeyId: 'key-1',
    apiKeySessionUserId: null,
    apiKeyCreatedBy: 'owner-1',
    sessionUserId: null,
  })
  const handler = mockDevToolHandlers.get(name)
  if (!handler) throw new Error('[internal] dev tool handler was not registered')
  return (await handler(toolArgs)) as ToolResult
}

describe('MCP tool-call audit in the stdio and dev servers', () => {
  beforeEach(() => {
    mockRegisteredTools.clear()
    mockCapturedHandlers.clear()
    mockDevToolHandlers.clear()
    mockExecuteTool.mockReset()
    accessLogEntries.length = 0
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    registerTool({ name: 'customers.list_people', requiredFeatures: ['customers.people.view'] })
    registerTool({ name: 'customers.update_person', requiredFeatures: ['customers.people.manage'], isMutation: true })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('writes one stdio row and echoes the correlation id in _meta', async () => {
    mockExecuteTool.mockResolvedValue({ success: true, result: { ok: true } })

    const result = await callStdioTool('customers.update_person', { id: SECRET_ARG_VALUE })

    expect(result.content[0].text).toBe(JSON.stringify({ ok: true }, null, 2))
    const correlationId = result._meta?.correlationId
    expect(correlationId).toMatch(/^[0-9a-f-]{36}$/)
    expect(accessLogEntries).toHaveLength(1)
    expect(accessLogEntries[0]).toMatchObject({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      actorUserId: 'user-1',
      resourceId: 'customers.update_person',
      context: {
        channel: 'mcp',
        mcpServer: 'stdio',
        principal: 'api_key',
        outcome: 'ok',
        isMutation: true,
        correlationId,
        argKeys: ['id'],
      },
    })
    expect(JSON.stringify(accessLogEntries[0])).not.toContain(SECRET_ARG_VALUE)
    expect(mockExecuteTool.mock.calls[0][3]).toEqual({
      channel: 'mcp',
      mutationMode: 'direct',
      requester: { userId: 'user-1', apiKeyId: null },
      correlationId,
    })
  })

  it('maps a stdio UNAUTHORIZED result to denied', async () => {
    mockExecuteTool.mockResolvedValue({ success: false, error: 'nope', errorCode: 'UNAUTHORIZED' })

    const result = await callStdioTool('customers.list_people', { id: 'p-1' })

    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text)).toEqual({ error: 'nope', code: 'UNAUTHORIZED' })
    expect(result._meta?.correlationId).toEqual(expect.any(String))
    expect(accessLogEntries).toHaveLength(1)
    expect(accessLogEntries[0].context).toMatchObject({ outcome: 'denied', errorCode: 'UNAUTHORIZED' })
  })

  it('writes one dev row with the API key identity', async () => {
    mockExecuteTool.mockResolvedValue({ success: false, error: 'bad', errorCode: 'VALIDATION_ERROR' })

    const result = await callDevTool('customers.list_people', { id: SECRET_ARG_VALUE })

    expect(result.isError).toBe(true)
    expect(mockExecuteTool.mock.calls[0][3]).toEqual({
      channel: 'mcp',
      mutationMode: 'direct',
      requester: { userId: 'owner-1', apiKeyId: 'key-1' },
      correlationId: result._meta?.correlationId,
    })
    expect(accessLogEntries).toHaveLength(1)
    expect(accessLogEntries[0]).toMatchObject({
      actorUserId: 'owner-1',
      context: {
        channel: 'mcp',
        mcpServer: 'dev',
        apiKeyId: 'key-1',
        principal: 'api_key',
        outcome: 'invalid_input',
        errorCode: 'VALIDATION_ERROR',
        isMutation: false,
        correlationId: result._meta?.correlationId,
        argKeys: ['id'],
      },
    })
  })

  it('records error and rethrows when the dev tool throws', async () => {
    mockExecuteTool.mockRejectedValue(new Error('boom'))

    await expect(callDevTool('customers.update_person', { id: 'p-1' })).rejects.toThrow('boom')
    expect(accessLogEntries).toHaveLength(1)
    expect(accessLogEntries[0].context).toMatchObject({ outcome: 'error', errorCode: 'EXCEPTION', isMutation: true })
  })

  it.each<[string, (name: string, toolArgs: Record<string, unknown>) => Promise<ToolResult>]>([
    ['stdio', callStdioTool],
    ['dev', callDevTool],
  ])('returns a pending_approval structured result from the %s server', async (_server, callTool) => {
    const pendingResult = {
      status: 'pending_approval',
      pendingActionId: 'pa-1',
      expiresAt: '2026-10-23T00:00:00.000Z',
      approvalPath: '/backend/config/ai-assistant/pending-actions/pa-1',
      summary: { toolName: 'customers.update_person', targetEntityType: null, targetRecordId: null, recordCount: 1 },
    }
    mockExecuteTool.mockResolvedValue({
      success: true,
      pendingApproval: { pendingActionId: 'pa-1', expiresAt: '2026-10-23T00:00:00.000Z' },
      result: pendingResult,
    })

    const result = await callTool('customers.update_person', { id: 'p-1' })

    expect(result.isError).toBe(false)
    expect(result.structuredContent).toEqual(pendingResult)
    expect(JSON.parse(result.content[0].text)).toEqual(pendingResult)
    expect(result._meta?.correlationId).toEqual(expect.any(String))
    expect(accessLogEntries).toHaveLength(1)
    expect(accessLogEntries[0].context).toMatchObject({
      outcome: 'pending_approval',
      errorCode: null,
      pendingActionIds: ['pa-1'],
      correlationId: result._meta?.correlationId,
    })
  })
})
