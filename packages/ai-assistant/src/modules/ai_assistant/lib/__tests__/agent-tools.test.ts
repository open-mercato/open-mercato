jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: () => null,
  })),
}))

jest.mock('../tool-executor', () => ({
  executeTool: jest.fn(async (name: string, args: unknown, context: unknown) => {
    const { toolRegistry: registry } = await import('../tool-registry')
    const registered = registry.getTool(name)
    if (!registered) {
      return { success: false, error: `Tool "${name}" not found` }
    }
    try {
      const result = await registered.handler(args as never, context as never)
      return { success: true, result }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  }),
}))

import { z } from 'zod'
import type { AiAgentDefinition } from '../ai-agent-definition'
import type { AiToolDefinition } from '../types'
import { resolveAiAgentTools, AgentPolicyError } from '../agent-tools'
import {
  resetAgentRegistryForTests,
  seedAgentRegistryForTests,
} from '../agent-registry'
import { toolRegistry, registerMcpTool } from '../tool-registry'

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

const testLogger = jest
  .requireMock('@open-mercato/shared/lib/logger')
  .createLogger('test') as Record<'debug' | 'info' | 'warn' | 'error', jest.Mock>


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
  let warnSpy: jest.Mock

  beforeEach(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
    warnSpy = testLogger.warn
    warnSpy.mockClear()
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
      expect.any(String),
      expect.objectContaining({ toolName: 'catalog.list_products' }),
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

  describe('tool call timings', () => {
    type ExecutableTool = {
      execute: (args: unknown, options?: { toolCallId?: string; messages?: unknown[] }) => Promise<unknown>
    }

    async function resolveWithTools(tools: AiToolDefinition[]) {
      for (const definition of tools) {
        registerMcpTool(definition, { moduleId: 'customers' })
      }
      seedAgentRegistryForTests([
        makeAgent({
          id: 'customers.assistant',
          moduleId: 'customers',
          allowedTools: tools.map((definition) => definition.name),
        }),
      ])
      return resolveAiAgentTools({ agentId: 'customers.assistant', authContext: baseAuth })
    }

    function executable(tools: Record<string, unknown>, name: string): ExecutableTool {
      return tools[name] as ExecutableTool
    }

    it('starts with an empty timings map', async () => {
      const result = await resolveWithTools([makeTool({ name: 'customers.list_people' })])
      expect(result.toolCallTimings.size).toBe(0)
    })

    it('records start and end for a tool call keyed by toolCallId', async () => {
      const result = await resolveWithTools([makeTool({ name: 'customers.list_people' })])
      await executable(result.tools, 'customers__list_people').execute(
        {},
        { toolCallId: 'call-1', messages: [] },
      )
      const timing = result.toolCallTimings.get('call-1')
      expect(timing).toBeDefined()
      expect(typeof timing?.startedAt).toBe('number')
      expect(typeof timing?.endedAt).toBe('number')
      expect((timing?.endedAt ?? 0) >= (timing?.startedAt ?? Infinity)).toBe(true)
    })

    it('records the end timestamp when the tool throws', async () => {
      const result = await resolveWithTools([
        makeTool({
          name: 'customers.list_people',
          handler: async () => {
            throw new Error('boom')
          },
        }),
      ])
      await expect(
        executable(result.tools, 'customers__list_people').execute(
          {},
          { toolCallId: 'call-err', messages: [] },
        ),
      ).rejects.toThrow('boom')
      const timing = result.toolCallTimings.get('call-err')
      expect(typeof timing?.startedAt).toBe('number')
      expect(typeof timing?.endedAt).toBe('number')
    })

    it('keeps separate entries for concurrent calls in one step', async () => {
      const releases: Array<() => void> = []
      const result = await resolveWithTools([
        makeTool({
          name: 'customers.list_people',
          handler: () =>
            new Promise((resolve) => {
              releases.push(() => resolve({ ok: true }))
            }),
        }),
        makeTool({ name: 'customers.get_person' }),
      ])
      const slowCall = executable(result.tools, 'customers__list_people').execute(
        {},
        { toolCallId: 'call-a', messages: [] },
      )
      await executable(result.tools, 'customers__get_person').execute(
        {},
        { toolCallId: 'call-b', messages: [] },
      )
      await new Promise((resolve) => setImmediate(resolve))
      expect(result.toolCallTimings.get('call-a')?.endedAt).toBeUndefined()
      expect(typeof result.toolCallTimings.get('call-b')?.endedAt).toBe('number')
      releases.forEach((release) => release())
      await slowCall
      expect(typeof result.toolCallTimings.get('call-a')?.endedAt).toBe('number')
      expect(result.toolCallTimings.size).toBe(2)
    })

    it('records nothing and does not crash when no toolCallId is provided', async () => {
      const result = await resolveWithTools([makeTool({ name: 'customers.list_people' })])
      await expect(
        executable(result.tools, 'customers__list_people').execute({}),
      ).resolves.toBeDefined()
      expect(result.toolCallTimings.size).toBe(0)
    })

    it('does not share timings between separate resolutions', async () => {
      const first = await resolveWithTools([makeTool({ name: 'customers.list_people' })])
      toolRegistry.clear()
      const second = await resolveWithTools([makeTool({ name: 'customers.list_people' })])
      await executable(first.tools, 'customers__list_people').execute(
        {},
        { toolCallId: 'call-1', messages: [] },
      )
      expect(first.toolCallTimings.has('call-1')).toBe(true)
      expect(second.toolCallTimings.size).toBe(0)
    })
  })
})
