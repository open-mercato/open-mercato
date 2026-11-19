import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createMcpSdkRefusalAudit, type McpSdkRefusedToolCall } from '../mcp-sdk-refusal-audit'

type Handler = (request: unknown, extra: object) => Promise<unknown>

function fakeServer(toolsCall?: Handler): { server: McpServer; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>()
  if (toolsCall) handlers.set('tools/call', toolsCall)
  return { server: { server: { _requestHandlers: handlers } } as unknown as McpServer, handlers }
}

function toolsCallRequest(name: unknown, args: unknown = {}) {
  return { method: 'tools/call', params: { name, arguments: args } }
}

function recordingAudit() {
  const refusals: McpSdkRefusedToolCall[] = []
  const audit = createMcpSdkRefusalAudit(async (call) => {
    refusals.push(call)
    return 'corr-1'
  })
  return { audit, refusals }
}

describe('createMcpSdkRefusalAudit', () => {
  it('finds the tools/call handler of the installed SDK after a tool is registered', () => {
    const server = new McpServer({ name: 'canary', version: '0.0.0' }, { capabilities: { tools: {} } })
    server.registerTool('canary.tool', { inputSchema: z.object({}) }, async () => ({ content: [] }))
    const handlers = (server.server as unknown as { _requestHandlers?: unknown })._requestHandlers
    expect(handlers).toBeInstanceOf(Map)
    const original = (handlers as Map<string, Handler>).get('tools/call')
    expect(typeof original).toBe('function')

    createMcpSdkRefusalAudit(async () => 'corr-1').attach(server)

    expect((handlers as Map<string, Handler>).get('tools/call')).not.toBe(original)
  })

  it('does not throw and audits nothing when the SDK handler cannot be found', () => {
    const onRefused = jest.fn()
    const audit = createMcpSdkRefusalAudit(onRefused)
    audit.markRegistered('known.tool')
    expect(() => audit.attach({} as McpServer)).not.toThrow()
    expect(() => audit.markHandled({})).not.toThrow()
    expect(onRefused).not.toHaveBeenCalled()
  })

  it('reports an unregistered name as NOT_FOUND and attaches the correlation id', async () => {
    const { audit, refusals } = recordingAudit()
    const { server, handlers } = fakeServer(async () => ({ content: [], isError: true }))
    audit.attach(server)

    const result = await handlers.get('tools/call')!(toolsCallRequest('hidden.tool', { a: 1 }), {})

    expect(result).toEqual({ content: [], isError: true, _meta: { correlationId: 'corr-1' } })
    expect(refusals).toEqual([expect.objectContaining({ toolName: 'hidden.tool', args: { a: 1 }, errorCode: 'NOT_FOUND' })])
  })

  it('audits and rethrows when the SDK handler throws before the tool callback ran', async () => {
    const { audit, refusals } = recordingAudit()
    const { server, handlers } = fakeServer(async () => {
      throw new Error('Invalid tools/call request')
    })
    audit.markRegistered('known.tool')
    audit.attach(server)

    await expect(handlers.get('tools/call')!(toolsCallRequest('known.tool', ['not-an-object']), {})).rejects.toThrow(
      'Invalid tools/call request',
    )
    expect(refusals).toEqual([
      expect.objectContaining({ toolName: 'known.tool', args: {}, errorCode: 'VALIDATION_ERROR' }),
    ])
  })

  it('replaces control and format characters and bounds the length of a refused name', async () => {
    const { audit, refusals } = recordingAudit()
    const { server, handlers } = fakeServer(async () => ({ content: [], isError: true }))
    audit.attach(server)

    await handlers.get('tools/call')!(toolsCallRequest(`evil‮tool\n${'a'.repeat(500)}`), {})

    expect(refusals[0].toolName).toHaveLength(128)
    expect(refusals[0].toolName.startsWith('evil?tool?')).toBe(true)
  })

  it('leaves a handled call untouched and skips a call without a tool name', async () => {
    const { audit, refusals } = recordingAudit()
    const handledServer = fakeServer(async (_request, extra) => {
      audit.markHandled(extra)
      return { content: [] }
    })
    audit.attach(handledServer.server)
    expect(await handledServer.handlers.get('tools/call')!(toolsCallRequest('known.tool'), {})).toEqual({ content: [] })

    const unnamed = fakeServer(async () => ({ content: [], isError: true }))
    audit.attach(unnamed.server)
    expect(await unnamed.handlers.get('tools/call')!(toolsCallRequest(undefined), {})).toEqual({
      content: [],
      isError: true,
    })
    expect(refusals).toEqual([])
  })
})
