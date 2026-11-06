import { z } from 'zod'
import type { AiAgentDefinition } from '../ai-agent-definition'
import type { AiToolDefinition } from '../types'

const loggerMock = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(),
}

jest.mock('@open-mercato/shared/lib/logger', () => {
  loggerMock.child.mockImplementation(() => loggerMock)
  return { createLogger: () => loggerMock }
})

const generatedAgentsModule: { allAiAgents: unknown[]; aiAgentOverrideEntries: unknown[] } = {
  allAiAgents: [],
  aiAgentOverrideEntries: [],
}

jest.mock('../generated-registry-loader', () => ({
  findGeneratedFile: () => '/virtual/ai-agents.generated.ts',
  compileAndImportGenerated: async () => generatedAgentsModule,
  ensureApiRouteManifestsRegistered: async () => 0,
}))

import { registerAgentTools } from '../tool-loader'
import { toolRegistry } from '../tool-registry'
import { resetAgentRegistryForTests } from '../agent-registry'
import { applyAiAgentOverrides, resetProgrammaticOverridesForTests } from '../ai-overrides'
import { defineAgentTool } from '../agent-tool'

const reviewSchema = z.object({ verdict: z.string() })

function buildAgent(overrides: Partial<AiAgentDefinition> = {}): AiAgentDefinition {
  return {
    id: 'catalog.product_reviewer',
    moduleId: 'catalog',
    label: 'Product reviewer',
    description: 'Reviews product listings',
    systemPrompt: 'Review the product.',
    allowedTools: [],
    executionMode: 'object',
    requiredFeatures: ['catalog.products.view'],
    output: { schemaName: 'Review', schema: reviewSchema },
    mcpTool: {},
    ...overrides,
  }
}

function seedAgents(agents: AiAgentDefinition[]): void {
  generatedAgentsModule.allAiAgents = agents
}

function getAgentTool(name: string): AiToolDefinition | undefined {
  return toolRegistry.getTool(name) as AiToolDefinition | undefined
}

function loggedErrorMessages(): string[] {
  return loggerMock.error.mock.calls.map((call: unknown[]) => String(call[0]))
}

describe('registerAgentTools', () => {
  beforeEach(() => {
    toolRegistry.clear()
    resetAgentRegistryForTests()
    resetProgrammaticOverridesForTests()
    generatedAgentsModule.allAiAgents = []
    generatedAgentsModule.aiAgentOverrideEntries = []
    loggerMock.error.mockClear()
  })

  afterAll(() => {
    toolRegistry.clear()
    resetAgentRegistryForTests()
    resetProgrammaticOverridesForTests()
  })

  it('synthesizes one agent tool with default name, schemas, features, agentRef and tags', async () => {
    seedAgents([buildAgent()])

    const count = await registerAgentTools()

    expect(count).toBe(1)
    const tool = getAgentTool('catalog.product_reviewer.run')
    expect(tool).toBeDefined()
    expect(tool?.description).toBe('Reviews product listings')
    expect(tool?.isMutation).toBe(false)
    expect(tool?.tags).toEqual(['agent', 'catalog'])
    expect(tool?.requiredFeatures).toEqual(['catalog.products.view'])
    expect(tool?.agentRef).toEqual({ agentId: 'catalog.product_reviewer', engine: 'ai-assistant' })
    expect(tool?.mcp?.expose).toBeUndefined()
    expect(tool?.inputSchema.safeParse({ input: 'review it' }).success).toBe(true)
    expect(tool?.inputSchema.safeParse({ input: '' }).success).toBe(false)
    expect(tool?.inputSchema.safeParse({ input: 'x'.repeat(8001) }).success).toBe(false)
    const outputSchema = tool?.mcp?.outputSchema
    const wrapper = { agentId: 'catalog.product_reviewer', runId: null, agentRunId: null }
    expect(outputSchema?.safeParse({ ...wrapper, result: { verdict: 'ok' } }).success).toBe(true)
    expect(outputSchema?.safeParse({ ...wrapper, result: { verdict: 1 } }).success).toBe(false)
    expect(toolRegistry.listToolsByModule('catalog')).toEqual(['catalog.product_reviewer.run'])
  })

  it('honours explicit name, description, input schema, features and expose flag', async () => {
    const inputSchema = z.object({ productId: z.string() })
    seedAgents([
      buildAgent({
        mcpTool: {
          name: 'catalog.review_product',
          description: 'Review one product',
          inputSchema,
          requiredFeatures: ['catalog.products.view', 'catalog.products.manage'],
          expose: false,
        },
      }),
    ])

    await registerAgentTools()

    const tool = getAgentTool('catalog.review_product')
    expect(tool?.description).toBe('Review one product')
    expect(tool?.inputSchema).toBe(inputSchema)
    expect(tool?.requiredFeatures).toEqual(['catalog.products.view', 'catalog.products.manage'])
    expect(tool?.mcp?.expose).toBe(false)
    expect(tool?.mcp?.outputSchema).toBeDefined()
    expect(getAgentTool('catalog.product_reviewer.run')).toBeUndefined()
  })

  it('falls back to the agent label when the agent has no description', async () => {
    seedAgents([buildAgent({ description: '' })])

    await registerAgentTools()

    expect(getAgentTool('catalog.product_reviewer.run')?.description).toBe('Product reviewer')
  })

  it('rejects and logs an mcpTool on an agent that is not object-mode', async () => {
    seedAgents([buildAgent({ executionMode: 'chat' })])

    expect(await registerAgentTools()).toBe(0)

    expect(getAgentTool('catalog.product_reviewer.run')).toBeUndefined()
    expect(loggedErrorMessages()).toContainEqual(expect.stringContaining('not an object-mode agent'))
  })

  it('rejects and logs an mcpTool on an agent without output', async () => {
    seedAgents([buildAgent({ output: undefined })])

    expect(await registerAgentTools()).toBe(0)

    expect(getAgentTool('catalog.product_reviewer.run')).toBeUndefined()
    expect(loggedErrorMessages()).toContainEqual(expect.stringContaining('no output schema'))
  })

  it('rejects and logs explicit requiredFeatures narrower than the agent features', async () => {
    seedAgents([
      buildAgent({
        requiredFeatures: ['catalog.products.view', 'catalog.products.manage'],
        mcpTool: { requiredFeatures: ['catalog.products.view'] },
      }),
    ])

    expect(await registerAgentTools()).toBe(0)

    expect(getAgentTool('catalog.product_reviewer.run')).toBeUndefined()
    expect(loggedErrorMessages()).toContainEqual(expect.stringContaining('requiredFeatures must cover'))
  })

  it('keeps the existing tool and logs when the synthesized name collides', async () => {
    const existing = {
      name: 'catalog.product_reviewer.run',
      description: 'Existing tool',
      inputSchema: z.object({}),
      handler: async () => ({}),
    }
    toolRegistry.registerTool(existing, { moduleId: 'catalog' })
    seedAgents([buildAgent()])

    expect(await registerAgentTools()).toBe(0)

    expect(toolRegistry.getTool('catalog.product_reviewer.run')).toBe(existing)
    expect(loggedErrorMessages()).toContainEqual(expect.stringContaining('already registered'))
  })

  it('does not synthesize a tool for an agent disabled by an override', async () => {
    seedAgents([buildAgent()])
    applyAiAgentOverrides({ 'catalog.product_reviewer': null })

    expect(await registerAgentTools()).toBe(0)

    expect(getAgentTool('catalog.product_reviewer.run')).toBeUndefined()
  })

  it('skips agents without mcpTool', async () => {
    seedAgents([buildAgent({ mcpTool: undefined })])

    expect(await registerAgentTools()).toBe(0)

    expect(toolRegistry.listToolNames()).toEqual([])
    expect(loggerMock.error).not.toHaveBeenCalled()
  })

  it('materializes the agent features on a defineAgentTool tool without explicit features', async () => {
    seedAgents([buildAgent({ mcpTool: undefined })])
    const tool = defineAgentTool({
      name: 'catalog.review_via_helper',
      description: 'Review through the helper',
      agentId: 'catalog.product_reviewer',
      inputSchema: z.object({ input: z.string() }),
    })
    toolRegistry.registerTool(tool, { moduleId: 'catalog' })
    expect(getAgentTool('catalog.review_via_helper')?.requiredFeatures).toBeUndefined()

    await registerAgentTools()

    expect(getAgentTool('catalog.review_via_helper')?.requiredFeatures).toEqual(['catalog.products.view'])
  })

  it('keeps declared features on agent tools whose agent id is unknown to the registry', async () => {
    seedAgents([])
    const undeclared = defineAgentTool({
      name: 'ao.undeclared',
      description: 'AO agent tool',
      agentId: 'ao.unknown_agent',
      inputSchema: z.object({ input: z.string() }),
    })
    const declared = defineAgentTool({
      name: 'ao.declared',
      description: 'AO agent tool',
      agentId: 'ao.unknown_agent',
      inputSchema: z.object({ input: z.string() }),
      requiredFeatures: ['agent_orchestrator.agents.run'],
    })
    toolRegistry.registerTool(undeclared, { moduleId: 'agent_orchestrator' })
    toolRegistry.registerTool(declared, { moduleId: 'agent_orchestrator' })

    await registerAgentTools()

    expect(getAgentTool('ao.undeclared')?.requiredFeatures).toBeUndefined()
    expect(getAgentTool('ao.declared')?.requiredFeatures).toEqual(['agent_orchestrator.agents.run'])
  })
})
