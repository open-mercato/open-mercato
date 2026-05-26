import { z } from 'zod'
import {
  registerGeneratedAiToolEntries,
  type AiToolConfigEntry,
} from '../tool-loader'
import { toolRegistry } from '../tool-registry'
import { convertMcpToolsToAiSdk } from '../mcp-tool-adapter'
import type { InProcessMcpClient, ToolInfoWithSchema } from '../in-process-client'

function makeTool(name: string) {
  return {
    name,
    description: `Tool ${name}`,
    inputSchema: z.object({ q: z.string() }),
    requiredFeatures: [`${name}.view`],
    handler: async (input: { q: string }) => ({ echo: input.q, name }),
  }
}

describe('registerGeneratedAiToolEntries', () => {
  beforeEach(() => {
    toolRegistry.clear()
  })

  afterAll(() => {
    toolRegistry.clear()
  })

  it('registers tools from modules that populate ai-tools.ts', () => {
    const entries: AiToolConfigEntry[] = [
      { moduleId: 'search', tools: [makeTool('search_query'), makeTool('search_status')] },
    ]

    const registered = registerGeneratedAiToolEntries(entries)

    expect(registered).toBe(2)
    expect(toolRegistry.listToolsByModule('search')).toEqual([
      'search_query',
      'search_status',
    ])
    expect(toolRegistry.getTool('search_query')?.requiredFeatures).toEqual(['search_query.view'])
  })

  it('stays silent for modules without an ai-tools.ts (empty or missing tools)', () => {
    const entries: AiToolConfigEntry[] = [
      { moduleId: 'auth', tools: [] },
      { moduleId: 'catalog', tools: undefined as unknown as unknown[] },
    ]

    const registered = registerGeneratedAiToolEntries(entries)

    expect(registered).toBe(0)
    expect(toolRegistry.listToolNames()).toEqual([])
  })

  it('is idempotent — re-running does not duplicate registrations', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const entries: AiToolConfigEntry[] = [
      { moduleId: 'search', tools: [makeTool('search_query')] },
    ]

    registerGeneratedAiToolEntries(entries)
    registerGeneratedAiToolEntries(entries)

    expect(toolRegistry.listToolsByModule('search')).toEqual(['search_query'])
    expect(toolRegistry.listToolNames()).toEqual(['search_query'])
    warnSpy.mockRestore()
  })

  it('skips malformed tool objects instead of throwing', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const entries: AiToolConfigEntry[] = [
      {
        moduleId: 'broken',
        tools: [
          { name: 'missing_handler', description: 'x', inputSchema: z.object({}) } as unknown,
          null as unknown,
          makeTool('ok_tool'),
        ],
      },
    ]

    const registered = registerGeneratedAiToolEntries(entries)

    expect(registered).toBe(1)
    expect(toolRegistry.getTool('ok_tool')).toBeDefined()
    expect(toolRegistry.getTool('missing_handler')).toBeUndefined()
    warnSpy.mockRestore()
  })

  it('keeps tools resolvable through mcp-tool-adapter with identical shape', async () => {
    const entries: AiToolConfigEntry[] = [
      { moduleId: 'search', tools: [makeTool('search_query')] },
    ]
    registerGeneratedAiToolEntries(entries)

    const registered = toolRegistry.getTool('search_query')
    expect(registered).toBeDefined()
    if (!registered) return

    const mcpTools: ToolInfoWithSchema[] = [
      {
        name: registered.name,
        description: registered.description,
        inputSchema: registered.inputSchema,
      },
    ]

    const callToolMock = jest.fn(async () => ({ success: true, result: { ok: true } }))
    const fakeClient = { callTool: callToolMock } as unknown as InProcessMcpClient

    const aiSdkTools = convertMcpToolsToAiSdk(fakeClient, mcpTools)

    expect(Object.keys(aiSdkTools)).toEqual(['search_query'])
    const adapted = aiSdkTools.search_query as unknown as {
      description: string
      execute: (args: unknown) => Promise<string>
    }
    expect(adapted.description).toBe(registered.description)

    const out = await adapted.execute({ q: 'hello' })
    expect(callToolMock).toHaveBeenCalledWith('search_query', { q: 'hello' })
    expect(out).toContain('"ok": true')
  })
})
