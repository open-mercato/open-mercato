import { z } from 'zod'
import { executeTool } from '../tool-executor'
import { AgentToolError } from '../agent-tool-error'
import type { McpToolContext, McpToolDefinition } from '../types'

const mockRegisteredTools = new Map<string, McpToolDefinition>()

jest.mock('../tool-registry', () => ({
  getToolRegistry: () => ({
    getTool: (name: string) => mockRegisteredTools.get(name),
  }),
}))

const TOOL_NAME = 'catalog.review_product'
const handler = jest.fn()

function buildContext(): McpToolContext {
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    container: { resolve: () => ({}) } as unknown as McpToolContext['container'],
    userFeatures: ['catalog.products.view'],
    isSuperAdmin: false,
  }
}

describe('executeTool with agent tools', () => {
  beforeEach(() => {
    handler.mockReset()
    mockRegisteredTools.clear()
    mockRegisteredTools.set(TOOL_NAME, {
      name: TOOL_NAME,
      description: 'Review a product',
      inputSchema: z.object({ input: z.string() }),
      requiredFeatures: ['catalog.products.view'],
      handler,
    })
  })

  it('passes the channel, mutation mode, correlation id and api key id to the handler context', async () => {
    handler.mockResolvedValue({ ok: true })
    await executeTool(TOOL_NAME, { input: 'x' }, buildContext(), {
      channel: 'mcp',
      mutationMode: 'deny',
      correlationId: 'corr-1',
      requester: { userId: 'owner-1', apiKeyId: 'key-1' },
    })
    const handlerContext = handler.mock.calls[0][1] as McpToolContext
    expect(handlerContext).toMatchObject({
      channel: 'mcp',
      mutationMode: 'deny',
      correlationId: 'corr-1',
      apiKeyId: 'key-1',
      requesterUserId: 'owner-1',
    })
    expect(handlerContext.tool?.name).toBe(TOOL_NAME)
  })

  it('leaves the handler context channel unset without options', async () => {
    handler.mockResolvedValue({ ok: true })
    await executeTool(TOOL_NAME, { input: 'x' }, buildContext())
    const handlerContext = handler.mock.calls[0][1] as McpToolContext
    expect(handlerContext.channel).toBeUndefined()
    expect(handlerContext.mutationMode).toBeUndefined()
    expect(handlerContext.requesterUserId).toBeUndefined()
  })

  it('maps an agent policy denial to AGENT_POLICY_DENIED without echoing feature names', async () => {
    handler.mockRejectedValue(new AgentToolError('AGENT_POLICY_DENIED', 'catalog.reviewer', 'agent_features_denied'))
    const result = await executeTool(TOOL_NAME, { input: 'x' }, buildContext(), { channel: 'mcp' })
    expect(result).toMatchObject({ success: false, errorCode: 'AGENT_POLICY_DENIED' })
    expect(result.error).toContain('agent_features_denied')
    expect(result.error).not.toContain('catalog.products.view')
  })

  it('maps an unavailable agent to AGENT_DISPATCHER_UNAVAILABLE', async () => {
    handler.mockRejectedValue(new AgentToolError('AGENT_DISPATCHER_UNAVAILABLE', 'catalog.reviewer'))
    const result = await executeTool(TOOL_NAME, { input: 'x' }, buildContext(), { channel: 'tools-api' })
    expect(result).toMatchObject({ success: false, errorCode: 'AGENT_DISPATCHER_UNAVAILABLE' })
  })

  it('keeps other handler errors as EXECUTION_ERROR', async () => {
    handler.mockRejectedValue(new Error('boom'))
    const result = await executeTool(TOOL_NAME, { input: 'x' }, buildContext())
    expect(result).toMatchObject({ success: false, errorCode: 'EXECUTION_ERROR', error: 'boom' })
  })
})
