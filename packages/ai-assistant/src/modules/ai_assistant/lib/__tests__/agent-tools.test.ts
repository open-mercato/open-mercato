import { withModelFactoryOverride, getModelFactoryOverride } from '../model-factory-context'
import { withToolReplayContext, getToolReplayContext, resolveToolReplayDecision, type ToolReplayFixture } from '../llm-adapters/tool-replay-context'
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
import { emitCitations } from '../citations'
import searchAiTools from '../../ai-tools/search-pack'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'

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

  it('A-3 encapsulates nested inference and tool calls in the recorded outer tool result', async () => {
    const recorded: ToolReplayFixture[] = []
    const definition = makeTool({ name: 'customers.nested_lookup', handler: async () => {
      expect(getModelFactoryOverride()).toBeUndefined()
      const nested = resolveToolReplayDecision({ toolName: 'child.lookup', args: {}, isMutation: false, toolCallId: 'child-call' })
      if (nested.kind === 'record') nested.sink({ toolName: 'child.lookup', argsKey: nested.call.argsKey, args: {}, output: {}, occurrence: 0 })
      expect(getToolReplayContext()?.mode).toBe('record')
      return { value: 'synthetic-child-output' }
    } })
    registerMcpTool(definition, { moduleId: 'customers' })
    seedAgentRegistryForTests([makeAgent({ id: 'customers.nested', moduleId: 'customers', allowedTools: [definition.name] })])
    const result = await resolveAiAgentTools({ agentId: 'customers.nested', authContext: baseAuth })
    const execute = result.tools.customers__nested_lookup as { execute: (args: unknown, options: { toolCallId: string; messages: unknown[] }) => Promise<unknown> }
    await withModelFactoryOverride(() => { throw new Error('Parent inference override must not reach the tool') }, () =>
      withToolReplayContext({ mode: 'record', sink: (fixture) => recorded.push(fixture) }, () => execute.execute({}, { toolCallId: 'outer-call', messages: [] })), { isolateTools: true })
    expect(recorded).toHaveLength(1)
    expect(recorded[0].toolName).toBe('customers.nested_lookup')
    expect(recorded[0].output).toEqual({ value: 'synthetic-child-output' })
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

  it('threads channel, mutation mode, API key and correlation id into the handler context', async () => {
    const seen: Array<Record<string, unknown>> = []
    registerMcpTool(
      makeTool({
        name: 'customers.list_people',
        handler: async (_input, ctx) => {
          seen.push({
            channel: ctx.channel,
            mutationMode: ctx.mutationMode,
            apiKeyId: ctx.apiKeyId,
            correlationId: ctx.correlationId,
          })
          return { ok: true }
        },
      }),
      { moduleId: 'customers' },
    )
    seedAgentRegistryForTests([
      makeAgent({ id: 'customers.assistant', moduleId: 'customers', allowedTools: ['customers.list_people'] }),
    ])

    const result = await resolveAiAgentTools({
      agentId: 'customers.assistant',
      authContext: baseAuth,
      channel: 'mcp',
      mutationMode: 'deny',
      apiKeyId: 'key-1',
      correlationId: 'corr-1',
    })
    const tool = result.tools.customers__list_people as { execute: (args: unknown, options?: unknown) => Promise<unknown> }
    await tool.execute({}, { toolCallId: 'call-1', messages: [] })

    expect(seen).toEqual([{ channel: 'mcp', mutationMode: 'deny', apiKeyId: 'key-1', correlationId: 'corr-1' }])
  })

  it('carries the key principal of the auth context into the handler context, apart from the requester key', async () => {
    const seen: Array<Record<string, unknown>> = []
    registerMcpTool(
      makeTool({
        name: 'customers.list_people',
        handler: async (_input, ctx) => {
          seen.push({
            principalApiKeyId: ctx.principalApiKeyId,
            apiKeyUserId: ctx.apiKeyUserId,
            apiKeyId: ctx.apiKeyId,
          })
          return { ok: true }
        },
      }),
      { moduleId: 'customers' },
    )
    seedAgentRegistryForTests([
      makeAgent({ id: 'customers.assistant', moduleId: 'customers', allowedTools: ['customers.list_people'] }),
    ])

    const result = await resolveAiAgentTools({
      agentId: 'customers.assistant',
      authContext: { ...baseAuth, principalApiKeyId: 'session-key-1', apiKeyUserId: 'session-user-1' },
    })
    const tool = result.tools.customers__list_people as { execute: (args: unknown, options?: unknown) => Promise<unknown> }
    await tool.execute({}, { toolCallId: 'call-1', messages: [] })

    expect(seen).toEqual([{ principalApiKeyId: 'session-key-1', apiKeyUserId: 'session-user-1', apiKeyId: null }])
  })

  it('leaves the verified user out of the handler context when no key principal is set', async () => {
    const seen: Array<Record<string, unknown>> = []
    registerMcpTool(
      makeTool({
        name: 'customers.list_people',
        handler: async (_input, ctx) => {
          seen.push({ ...ctx })
          return { ok: true }
        },
      }),
      { moduleId: 'customers' },
    )
    seedAgentRegistryForTests([
      makeAgent({ id: 'customers.assistant', moduleId: 'customers', allowedTools: ['customers.list_people'] }),
    ])

    const result = await resolveAiAgentTools({
      agentId: 'customers.assistant',
      authContext: { ...baseAuth, apiKeyUserId: 'session-user-1' },
    })
    const tool = result.tools.customers__list_people as { execute: (args: unknown, options?: unknown) => Promise<unknown> }
    await tool.execute({}, { toolCallId: 'call-1', messages: [] })

    expect(seen[0]).not.toHaveProperty('principalApiKeyId')
    expect(seen[0]).not.toHaveProperty('apiKeyUserId')
  })

  it('stamps the agent channel on the handler context by default', async () => {
    const seen: unknown[] = []
    registerMcpTool(
      makeTool({
        name: 'customers.list_people',
        handler: async (_input, ctx) => {
          seen.push(ctx.channel)
          return { ok: true }
        },
      }),
      { moduleId: 'customers' },
    )
    seedAgentRegistryForTests([
      makeAgent({ id: 'customers.assistant', moduleId: 'customers', allowedTools: ['customers.list_people'] }),
    ])

    const result = await resolveAiAgentTools({ agentId: 'customers.assistant', authContext: baseAuth })
    const tool = result.tools.customers__list_people as { execute: (args: unknown, options?: unknown) => Promise<unknown> }
    await tool.execute({}, { toolCallId: 'call-1', messages: [] })

    expect(seen).toEqual(['agent'])
  })

  it.each([
    { label: 'the API key when the run carries one', apiKeyId: 'key-1', expected: { sub: 'api_key:key-1', isApiKey: true, keyId: 'key-1' } },
    { label: 'the user when the run has no API key', apiKeyId: undefined, expected: { sub: 'user-1', userId: 'user-1' } },
  ])('runs search.hybrid_search as $label', async ({ apiKeyId, expected }) => {
    const searchTool = searchAiTools.find((entry) => entry.name === 'search.hybrid_search')
    if (!searchTool) throw new Error('search.hybrid_search missing')
    registerMcpTool(searchTool, { moduleId: 'search' })
    seedAgentRegistryForTests([
      makeAgent({ id: 'customers.assistant', moduleId: 'customers', allowedTools: ['search.hybrid_search'] }),
    ])
    const viewers: unknown[] = []
    const searchService = {
      search: async (_query: string, options: { viewer?: { auth: unknown } }) => {
        viewers.push(options.viewer?.auth)
        return []
      },
    }
    const searchIndexer = { getEntityConfig: () => undefined, getAllEntityConfigs: () => [] }
    ;(createRequestContainer as jest.Mock).mockResolvedValueOnce({
      resolve: (name: string) => {
        if (name === 'searchService') return searchService
        if (name === 'searchIndexer') return searchIndexer
        return undefined
      },
    })

    const result = await resolveAiAgentTools({
      agentId: 'customers.assistant',
      authContext: baseAuth,
      ...(apiKeyId ? { channel: 'mcp' as const, mutationMode: 'approval' as const, apiKeyId } : {}),
    })
    const tool = result.tools.search__hybrid_search as { execute: (args: unknown, options?: unknown) => Promise<unknown> }
    await tool.execute({ q: 'clause' }, { toolCallId: 'call-1', messages: [] })

    expect(viewers).toHaveLength(1)
    expect(viewers[0]).toMatchObject(expected)
    if (apiKeyId) expect(viewers[0]).not.toHaveProperty('userId')
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

  describe('tool UI parts', () => {
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

    it('carries emitted citations in the tool output uiParts envelope', async () => {
      const result = await resolveWithTools([
        makeTool({
          name: 'customers.list_people',
          handler: async (_input, ctx) => {
            emitCitations(ctx, [{ kind: 'record', ref: 'customers.person:1', href: '/backend/customers/people/1' }], {
              title: 'Sources',
            })
            return { items: [{ id: '1' }] }
          },
        }),
      ])
      const output = await executable(result.tools, 'customers__list_people').execute({}, { toolCallId: 'call-1' })
      expect(JSON.parse(output as string)).toEqual({
        items: [{ id: '1' }],
        uiParts: [
          {
            componentId: 'ai_assistant:citations',
            payload: {
              citations: [{ kind: 'record', ref: 'customers.person:1', href: '/backend/customers/people/1' }],
              title: 'Sources',
            },
          },
        ],
      })
      expect(result.uiPartQueue.size()).toBe(0)
    })

    it('appends emitted parts after the uiParts a tool returns itself', async () => {
      const own = { componentId: 'customers:card', payload: { id: '1' } }
      const result = await resolveWithTools([
        makeTool({
          name: 'customers.list_people',
          handler: async (_input, ctx) => {
            emitCitations(ctx, [{ kind: 'record', ref: 'a' }])
            return { ok: true, uiParts: [own] }
          },
        }),
      ])
      const output = await executable(result.tools, 'customers__list_people').execute({})
      const parsed = JSON.parse(output as string) as { uiParts: Array<{ componentId: string }> }
      expect(parsed.uiParts.map((part) => part.componentId)).toEqual(['customers:card', 'ai_assistant:citations'])
    })

    it('leaves string and primitive outputs untouched when nothing is emitted', async () => {
      const result = await resolveWithTools([
        makeTool({ name: 'customers.list_people', handler: async () => 'plain answer' }),
        makeTool({ name: 'customers.get_person', handler: async () => 42 }),
      ])
      await expect(executable(result.tools, 'customers__list_people').execute({})).resolves.toBe('plain answer')
      await expect(executable(result.tools, 'customers__get_person').execute({})).resolves.toBe('42')
    })

    it('wraps a string output when a tool emits citations', async () => {
      const result = await resolveWithTools([
        makeTool({
          name: 'customers.list_people',
          handler: async (_input, ctx) => {
            emitCitations(ctx, [{ kind: 'kb', ref: 'policy@1' }])
            return 'plain answer'
          },
        }),
      ])
      const output = await executable(result.tools, 'customers__list_people').execute({})
      expect(JSON.parse(output as string)).toMatchObject({
        result: 'plain answer',
        uiParts: [{ componentId: 'ai_assistant:citations' }],
      })
    })

    it('gives every call its own collector so concurrent calls never share parts', async () => {
      const gates: Array<() => void> = []
      const result = await resolveWithTools([
        makeTool({
          name: 'customers.list_people',
          inputSchema: z.object({ query: z.string() }),
          handler: async (input, ctx) => {
            const { query } = input as { query: string }
            emitCitations(ctx, [{ kind: 'kb', ref: `${query}-before` }])
            await new Promise<void>((resolve) => gates.push(resolve))
            emitCitations(ctx, [{ kind: 'kb', ref: `${query}-after` }])
            return { query }
          },
        }),
      ])
      const tool = executable(result.tools, 'customers__list_people')
      const first = tool.execute({ query: 'one' }, { toolCallId: 'call-1' })
      const second = tool.execute({ query: 'two' }, { toolCallId: 'call-2' })
      while (gates.length < 2) {
        await new Promise((resolve) => setImmediate(resolve))
      }
      gates.forEach((release) => release())
      const refsOf = (output: unknown) =>
        (JSON.parse(output as string) as { uiParts: Array<{ payload: { citations: Array<{ ref: string }> } }> }).uiParts
          .flatMap((part) => part.payload.citations.map((citation) => citation.ref))
      expect(refsOf(await first)).toEqual(['one-before', 'one-after'])
      expect(refsOf(await second)).toEqual(['two-before', 'two-after'])
    })

    it('does not leak parts into the next call of the same tool', async () => {
      let emit = true
      const result = await resolveWithTools([
        makeTool({
          name: 'customers.list_people',
          handler: async (_input, ctx) => {
            if (emit) emitCitations(ctx, [{ kind: 'kb', ref: 'a' }])
            return { ok: true }
          },
        }),
      ])
      const tool = executable(result.tools, 'customers__list_people')
      await tool.execute({})
      emit = false
      expect(JSON.parse((await tool.execute({})) as string)).toEqual({ ok: true })
    })
  })
})
