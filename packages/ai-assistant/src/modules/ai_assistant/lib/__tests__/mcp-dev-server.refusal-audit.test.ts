import { z } from 'zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createDevMcpServer } from '../mcp-dev-server'
import { DEFAULT_MCP_EXPOSURE_CONFIG } from '../mcp-exposure'
import { MCP_AUDIT_RESOURCE_KIND, type McpAuditAccessLogInput } from '../mcp-audit'
import type { AiToolDefinition, McpToolContext, McpToolDefinition, ToolExecutionResult } from '../types'

const mockRegisteredTools = new Map<string, McpToolDefinition>()
const mockExecuteTool = jest.fn<Promise<ToolExecutionResult>, [string, unknown, unknown, unknown?]>()

jest.mock('../tool-registry', () => ({
  getToolRegistry: () => ({
    getTools: () => new Map(mockRegisteredTools),
    getTool: (name: string) => mockRegisteredTools.get(name),
    listToolNames: () => Array.from(mockRegisteredTools.keys()),
  }),
}))
jest.mock('../tool-executor', () => ({
  ...jest.requireActual('../tool-executor'),
  executeTool: (...args: [string, unknown, unknown, unknown?]) => mockExecuteTool(...args),
}))
jest.mock('../tool-loader', () => ({
  loadAllModuleTools: jest.fn(),
  indexToolsForSearch: jest.fn(),
}))
jest.mock('../mcp-dev-key-resolution', () => ({ getApiKeyFromMcpJson: jest.fn() }))

const CALLER_FEATURES = ['customers.people.view']
const SECRET_ARG_VALUE = 'very-secret-customer-name'
const accessLogEntries: McpAuditAccessLogInput[] = []

function registerTool(overrides: Partial<AiToolDefinition> & { name: string }): void {
  mockRegisteredTools.set(overrides.name, {
    description: `${overrides.name} description`,
    inputSchema: z.object({ id: z.string() }),
    handler: async () => ({}),
    ...overrides,
  } as McpToolDefinition)
}

type ToolResult = {
  content: Array<{ type: string; text: string }>
  isError?: boolean
  _meta?: { correlationId?: string }
}

async function callDevTool(name: string, toolArgs: Record<string, unknown>): Promise<ToolResult> {
  const container = {
    resolve: (key: string) => {
      if (key === 'accessLogService') {
        return { log: async (input: McpAuditAccessLogInput) => void accessLogEntries.push(input) }
      }
      throw new Error(`[internal] ${key} not registered`)
    },
  }
  const toolContext = {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'api_key:key-1',
    container,
    userFeatures: CALLER_FEATURES,
    isSuperAdmin: false,
  } as unknown as McpToolContext
  const server = createDevMcpServer(toolContext, CALLER_FEATURES, false, false, { ...DEFAULT_MCP_EXPOSURE_CONFIG }, {
    apiKeyId: 'key-1',
    apiKeySessionUserId: null,
    apiKeyCreatedBy: 'owner-1',
    sessionUserId: null,
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  try {
    return (await client.callTool({ name, arguments: toolArgs })) as ToolResult
  } finally {
    await client.close()
    await server.close()
  }
}

describe('MCP dev server — tools/call refused by the SDK is audited', () => {
  beforeEach(() => {
    mockRegisteredTools.clear()
    mockExecuteTool.mockReset()
    accessLogEntries.length = 0
    registerTool({ name: 'customers.list_people', requiredFeatures: ['customers.people.view'] })
    registerTool({ name: 'customers.update_person', requiredFeatures: ['customers.people.manage'], isMutation: true })
  })

  it('records denied NOT_FOUND for a tool hidden by the API key ACL', async () => {
    const result = await callDevTool('customers.update_person', { id: SECRET_ARG_VALUE })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Tool customers.update_person not found')
    expect(mockExecuteTool).not.toHaveBeenCalled()
    expect(accessLogEntries).toHaveLength(1)
    expect(accessLogEntries[0]).toMatchObject({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      actorUserId: 'owner-1',
      resourceKind: MCP_AUDIT_RESOURCE_KIND,
      resourceId: 'customers.update_person',
      context: {
        channel: 'mcp',
        mcpServer: 'dev',
        apiKeyId: 'key-1',
        principal: 'api_key',
        outcome: 'denied',
        errorCode: 'NOT_FOUND',
        isMutation: true,
        correlationId: result._meta?.correlationId,
        argKeys: ['id'],
      },
    })
    expect(JSON.stringify(accessLogEntries[0])).not.toContain(SECRET_ARG_VALUE)
  })

  it('records denied NOT_FOUND for an unknown tool', async () => {
    const result = await callDevTool('does.not_exist', {})

    expect(result.isError).toBe(true)
    expect(accessLogEntries).toHaveLength(1)
    expect(accessLogEntries[0].context).toMatchObject({ outcome: 'denied', errorCode: 'NOT_FOUND', isMutation: false })
  })

  it('records invalid_input for arguments rejected by the input schema', async () => {
    const result = await callDevTool('customers.list_people', { id: 42 })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Input validation error')
    expect(mockExecuteTool).not.toHaveBeenCalled()
    expect(accessLogEntries).toHaveLength(1)
    expect(accessLogEntries[0].context).toMatchObject({ outcome: 'invalid_input', errorCode: 'VALIDATION_ERROR' })
  })

  it('writes exactly one row for a call the tool handler handled', async () => {
    mockExecuteTool.mockResolvedValue({ success: true, result: { items: [] } })

    const result = await callDevTool('customers.list_people', { id: 'p-1' })

    expect(result.isError).toBeUndefined()
    expect(accessLogEntries).toHaveLength(1)
    expect(accessLogEntries[0].context).toMatchObject({ outcome: 'ok', errorCode: null })
  })
})
