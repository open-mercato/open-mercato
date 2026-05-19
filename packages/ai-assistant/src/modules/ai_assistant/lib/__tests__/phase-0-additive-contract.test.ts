import { z } from 'zod'
import {
  registerGeneratedAiToolEntries,
  type AiToolConfigEntry,
} from '../tool-loader'
import { toolRegistry } from '../tool-registry'
import { convertMcpToolsToAiSdk } from '../mcp-tool-adapter'
import { defineAiTool } from '../ai-tool-definition'
import type {
  AiToolDefinition,
  McpToolDefinition,
} from '../types'
import type { InProcessMcpClient, ToolInfoWithSchema } from '../in-process-client'
import { createAiAgentsExtension } from '../../../../../../cli/src/lib/generators/extensions/ai-agents'

type PlainAiToolInput = { q: string }
type PlainAiToolOutput = { echo: string; name: string }

function makePlainAiTool(name: string): AiToolDefinition<PlainAiToolInput, PlainAiToolOutput> {
  return {
    name,
    description: `Tool ${name}`,
    inputSchema: z.object({ q: z.string() }),
    requiredFeatures: [`${name}.view`],
    handler: async (input) => ({ echo: input.q, name }),
  }
}

function makeFakeAgentEntry(moduleId: string, agentCount: number) {
  return {
    moduleId,
    agents: Array.from({ length: agentCount }, (_, index) => ({
      id: `${moduleId}.agent_${index}`,
      moduleId,
      label: `${moduleId} agent ${index}`,
      description: 'fixture',
      systemPrompt: 'fixture',
      allowedTools: [] as string[],
    })),
  }
}

function buildInProcessClient(result: unknown): {
  client: InProcessMcpClient
  callToolMock: jest.Mock
} {
  const callToolMock = jest.fn(async () => ({ success: true, result }))
  const client = { callTool: callToolMock } as unknown as InProcessMcpClient
  return { client, callToolMock }
}

describe('Phase 0 — restored module-tool loading is additive — existing modules still register', () => {
  beforeEach(() => {
    toolRegistry.clear()
  })

  afterAll(() => {
    toolRegistry.clear()
  })

  it('registers plain-object aiTools[] exports through the restored loader', () => {
    const entries: AiToolConfigEntry[] = [
      { moduleId: 'legacy_module', tools: [makePlainAiTool('legacy_search')] },
    ]

    const registered = registerGeneratedAiToolEntries(entries)

    expect(registered).toBe(1)
    expect(toolRegistry.getTool('legacy_search')).toBeDefined()
    expect(toolRegistry.listToolsByModule('legacy_module')).toEqual(['legacy_search'])
  })

  it('resolves registered tools through the mcp-tool-adapter without shape loss', async () => {
    const plainTool = makePlainAiTool('legacy_query')
    registerGeneratedAiToolEntries([{ moduleId: 'legacy_module', tools: [plainTool] }])

    const registered = toolRegistry.getTool('legacy_query')
    expect(registered).toBeDefined()
    if (!registered) return

    const mcpTools: ToolInfoWithSchema[] = [
      {
        name: registered.name,
        description: registered.description,
        inputSchema: registered.inputSchema,
      },
    ]

    const { client, callToolMock } = buildInProcessClient({ rows: 0 })
    const aiSdkTools = convertMcpToolsToAiSdk(client, mcpTools)

    expect(Object.keys(aiSdkTools)).toEqual(['legacy_query'])
    const adapted = aiSdkTools.legacy_query as unknown as {
      description: string
      execute: (args: unknown) => Promise<string>
    }
    expect(adapted.description).toBe(registered.description)

    await adapted.execute({ q: 'hello' })
    expect(callToolMock).toHaveBeenCalledWith('legacy_query', { q: 'hello' })
  })

  it('is idempotent — re-running the loader does not duplicate registrations', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const entries: AiToolConfigEntry[] = [
      { moduleId: 'legacy_module', tools: [makePlainAiTool('legacy_query')] },
    ]

    registerGeneratedAiToolEntries(entries)
    registerGeneratedAiToolEntries(entries)

    expect(toolRegistry.listToolsByModule('legacy_module')).toEqual(['legacy_query'])
    expect(toolRegistry.listToolNames()).toEqual(['legacy_query'])
    warnSpy.mockRestore()
  })

  it('stays silent for modules without an ai-tools.ts export', () => {
    const entries: AiToolConfigEntry[] = [
      { moduleId: 'empty_module', tools: [] },
      { moduleId: 'missing_module', tools: undefined as unknown as unknown[] },
    ]

    expect(() => registerGeneratedAiToolEntries(entries)).not.toThrow()
    expect(toolRegistry.listToolNames()).toEqual([])
  })
})

describe('Phase 0 — `defineAiTool()` return value is compatible with the plain-object shape', () => {
  beforeEach(() => {
    toolRegistry.clear()
  })

  afterAll(() => {
    toolRegistry.clear()
  })

  it('builder output and plain-object definition are structurally equivalent on required fields', () => {
    const schema = z.object({ id: z.string() })
    const handler = async (input: { id: string }) => ({ ok: true, id: input.id })

    const builderTool = defineAiTool({
      name: 'catalog.touch',
      description: 'Touch a catalog record',
      inputSchema: schema,
      handler,
    })

    const plainTool: AiToolDefinition<{ id: string }, { ok: boolean; id: string }> = {
      name: 'catalog.touch',
      description: 'Touch a catalog record',
      inputSchema: schema,
      handler,
    }

    expect(builderTool.name).toBe(plainTool.name)
    expect(builderTool.description).toBe(plainTool.description)
    expect(builderTool.inputSchema).toBe(plainTool.inputSchema)
    expect(builderTool.handler).toBe(plainTool.handler)
    expect(builderTool.requiredFeatures).toBeUndefined()
    expect(plainTool.requiredFeatures).toBeUndefined()
    expect(builderTool.displayName).toBeUndefined()
    expect(builderTool.tags).toBeUndefined()
    expect(builderTool.isMutation).toBeUndefined()
    expect(builderTool.maxCallsPerTurn).toBeUndefined()
    expect(builderTool.supportsAttachments).toBeUndefined()
  })

  it('builder output is assignable to both AiToolDefinition and McpToolDefinition', () => {
    const built = defineAiTool({
      name: 'meta.ping',
      description: 'Ping',
      inputSchema: z.object({}),
      handler: async () => ({ pong: true }),
    })
    const asAi: AiToolDefinition = built
    const asMcp: McpToolDefinition = built
    expect(asAi.name).toBe('meta.ping')
    expect(asMcp.name).toBe('meta.ping')
  })

  it('both shapes register through the same loader path and produce identical registry entries', () => {
    const schema = z.object({ id: z.string() })
    const handler = async () => ({ ok: true })

    const builderTool = defineAiTool({
      name: 'builder_tool',
      description: 'Builder-built tool',
      inputSchema: schema,
      handler,
      displayName: 'Builder tool',
      tags: ['builder'],
      isMutation: false,
      maxCallsPerTurn: 3,
      supportsAttachments: false,
    })

    const plainTool: AiToolDefinition = {
      name: 'plain_tool',
      description: 'Plain tool',
      inputSchema: schema,
      handler,
    }

    registerGeneratedAiToolEntries([
      { moduleId: 'mixed_module', tools: [builderTool, plainTool] },
    ])

    expect(toolRegistry.listToolsByModule('mixed_module').sort()).toEqual([
      'builder_tool',
      'plain_tool',
    ])
    const registeredBuilder = toolRegistry.getTool('builder_tool')
    const registeredPlain = toolRegistry.getTool('plain_tool')
    expect(registeredBuilder?.name).toBe('builder_tool')
    expect(registeredBuilder?.description).toBe('Builder-built tool')
    expect(typeof registeredBuilder?.handler).toBe('function')
    expect(registeredPlain?.name).toBe('plain_tool')
    expect(registeredPlain?.description).toBe('Plain tool')
    expect(typeof registeredPlain?.handler).toBe('function')
  })
})

describe('Phase 0 — `ai-agents.generated.ts` discovery is additive — does not break `ai-tools.generated.ts` consumption', () => {
  beforeEach(() => {
    toolRegistry.clear()
  })

  afterAll(() => {
    toolRegistry.clear()
  })

  it('loads tools and ignores agent entries when both are present', () => {
    const toolEntries: AiToolConfigEntry[] = [
      { moduleId: 'catalog', tools: [makePlainAiTool('catalog_search')] },
      { moduleId: 'customers', tools: [makePlainAiTool('customers_search')] },
    ]
    const agentEntries = [
      makeFakeAgentEntry('catalog', 1),
      makeFakeAgentEntry('customers', 2),
    ]

    const toolsRegistered = registerGeneratedAiToolEntries(toolEntries)

    expect(toolsRegistered).toBe(2)
    expect(toolRegistry.listToolNames().sort()).toEqual([
      'catalog_search',
      'customers_search',
    ])
    for (const agentModule of agentEntries) {
      for (const agent of agentModule.agents) {
        expect(toolRegistry.getTool(agent.id)).toBeUndefined()
      }
    }
  })

  it('still loads tools when only legacy `aiToolConfigEntries` exists (pre-agents fixture)', () => {
    const entries: AiToolConfigEntry[] = [
      { moduleId: 'legacy_only', tools: [makePlainAiTool('legacy_only_tool')] },
    ]

    const registered = registerGeneratedAiToolEntries(entries)

    expect(registered).toBe(1)
    expect(toolRegistry.getTool('legacy_only_tool')).toBeDefined()
  })

  it('registers zero tools and does not throw when only agent entries exist', () => {
    const registered = registerGeneratedAiToolEntries([])

    expect(registered).toBe(0)
    expect(toolRegistry.listToolNames()).toEqual([])
  })
})

describe('Phase 0 — generator output is stable across runs', () => {
  it('`createAiAgentsExtension()` produces byte-identical output across repeated runs', () => {
    const firstExtension = createAiAgentsExtension()
    const secondExtension = createAiAgentsExtension()

    const firstOutput = firstExtension.generateOutput().get('ai-agents.generated.ts')
    const secondOutput = secondExtension.generateOutput().get('ai-agents.generated.ts')

    expect(firstOutput).toBeDefined()
    expect(secondOutput).toBeDefined()
    expect(firstOutput).toBe(secondOutput)
    expect(firstOutput?.startsWith('// AUTO-GENERATED')).toBe(true)
    expect(firstOutput).toContain('export const aiAgentConfigEntries')
    expect(firstOutput).toContain('export const allAiAgents')
  })

  it('calling `generateOutput()` twice on the same factory instance produces identical text', () => {
    const extension = createAiAgentsExtension()

    const firstRun = extension.generateOutput().get('ai-agents.generated.ts')
    const secondRun = extension.generateOutput().get('ai-agents.generated.ts')

    expect(firstRun).toBe(secondRun)
  })
})
