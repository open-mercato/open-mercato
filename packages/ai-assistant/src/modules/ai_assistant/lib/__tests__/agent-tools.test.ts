import { z } from 'zod'
import type { AiAgentDefinition } from '../ai-agent-definition'
import type { AiToolDefinition } from '../types'
import { resolveAiAgentTools, AgentPolicyError } from '../agent-tools'
import {
  resetAgentRegistryForTests,
  seedAgentRegistryForTests,
} from '../agent-registry'
import { toolRegistry, registerMcpTool } from '../tool-registry'

function makeAgent(
  overrides: Partial<AiAgentDefinition> & Pick<AiAgentDefinition, 'id' | 'moduleId'>,
): AiAgentDefinition {
  return {
    label: `${overrides.id} label`,
    description: `${overrides.id} description`,
    systemPrompt: 'You are a test agent.',
    allowedTools: [],
    ...overrides,
  }
}

function makeTool(
  overrides: Partial<AiToolDefinition> & Pick<AiToolDefinition, 'name'>,
): AiToolDefinition {
  return {
    description: `${overrides.name} description`,
    inputSchema: z.object({ query: z.string().optional() }),
    handler: async () => ({ ok: true }),
    ...overrides,
  }
}

const baseAuth = {
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  userId: 'user-1',
  features: ['*'],
  isSuperAdmin: true,
}

describe('resolveAiAgentTools', () => {
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  afterAll(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  it('throws AgentPolicyError with structured deny code when the agent is unknown', async () => {
    await expect(
      resolveAiAgentTools({
        agentId: 'missing.agent',
        authContext: baseAuth,
      }),
    ).rejects.toMatchObject({
      name: 'AgentPolicyError',
      code: 'agent_unknown',
    })
  })

  it('throws AgentPolicyError when the agent requires features the caller lacks', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.assistant',
        moduleId: 'customers',
        requiredFeatures: ['customers.assistant.use'],
      }),
    ])

    await expect(
      resolveAiAgentTools({
        agentId: 'customers.assistant',
        authContext: { ...baseAuth, features: [], isSuperAdmin: false },
      }),
    ).rejects.toBeInstanceOf(AgentPolicyError)
  })

  it('returns whitelisted tools adapted to the AI SDK shape', async () => {
    registerMcpTool(makeTool({ name: 'customers.list_people' }), { moduleId: 'customers' })
    registerMcpTool(makeTool({ name: 'customers.get_person' }), { moduleId: 'customers' })
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.assistant',
        moduleId: 'customers',
        allowedTools: ['customers.list_people', 'customers.get_person'],
      }),
    ])

    const result = await resolveAiAgentTools({
      agentId: 'customers.assistant',
      authContext: baseAuth,
    })

    expect(result.agent.id).toBe('customers.assistant')
    expect(Object.keys(result.tools).sort()).toEqual([
      'customers__get_person',
      'customers__list_people',
    ])
    for (const [, tool] of Object.entries(result.tools)) {
      expect(tool).toBeDefined()
      expect(typeof (tool as { execute?: unknown }).execute).toBe('function')
    }
  })

  it('skips tools the caller lacks features for and still returns the rest', async () => {
    registerMcpTool(
      makeTool({
        name: 'customers.list_people',
        requiredFeatures: ['customers.people.view'],
      }),
      { moduleId: 'customers' },
    )
    registerMcpTool(
      makeTool({
        name: 'catalog.list_products',
        requiredFeatures: ['catalog.products.view'],
      }),
      { moduleId: 'catalog' },
    )
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.assistant',
        moduleId: 'customers',
        allowedTools: ['customers.list_people', 'catalog.list_products'],
      }),
    ])

    const result = await resolveAiAgentTools({
      agentId: 'customers.assistant',
      authContext: {
        ...baseAuth,
        features: ['customers.people.view'],
        isSuperAdmin: false,
      },
    })

    expect(Object.keys(result.tools)).toEqual(['customers__list_people'])
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('catalog.list_products'),
    )
  })

  it('skips a whitelisted tool that vanished from the registry between checks', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.assistant',
        moduleId: 'customers',
        allowedTools: ['customers.list_people'],
      }),
    ])

    const result = await resolveAiAgentTools({
      agentId: 'customers.assistant',
      authContext: baseAuth,
    })

    // Tool never registered -> policy gate returns tool_unknown -> warn + skip.
    expect(result.tools).toEqual({})
    expect(warnSpy).toHaveBeenCalled()
  })
})
