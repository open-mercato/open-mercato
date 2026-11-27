const prepareMutationMock = jest.fn()

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

jest.mock('../tool-loader', () => ({
  ensureModuleToolsLoaded: jest.fn(async () => undefined),
}))

jest.mock('../prepare-mutation', () => {
  const actual = jest.requireActual('../prepare-mutation')
  return {
    ...actual,
    prepareMutation: (...args: unknown[]) => prepareMutationMock(...args),
  }
})

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

import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import type { AiAgentDefinition } from '../ai-agent-definition'
import type { AiChatRequestContext } from '../attachment-bridge-types'
import type { AiToolDefinition } from '../types'
import { resolveAiAgentTools } from '../agent-tools'
import { resetAgentRegistryForTests, seedAgentRegistryForTests } from '../agent-registry'
import { toolRegistry, registerMcpTool } from '../tool-registry'
import { emitCitations } from '../citations'
import {
  computeToolArgsKey,
  getToolReplayContext,
  withToolReplayContext,
  type ToolReplayCall,
  type ToolReplayFixture,
  type ToolReplayHitSource,
  type ToolReplayMiss,
} from '../llm-adapters/tool-replay-context'

type ExecutableTool = {
  execute: (args: unknown, options?: { toolCallId?: string; messages?: unknown[] }) => Promise<unknown>
}

const baseAuth = {
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  userId: 'user-1',
  features: ['*'],
  isSuperAdmin: true,
}

const container = {
  resolve: (name: string) => {
    throw new Error(`unknown dependency ${name}`)
  },
} as unknown as AwilixContainer

function makeAgent(overrides: Partial<AiAgentDefinition> & Pick<AiAgentDefinition, 'id' | 'moduleId'>): AiAgentDefinition {
  return {
    label: `${overrides.id} label`,
    description: `${overrides.id} description`,
    systemPrompt: 'You are a test agent.',
    allowedTools: [],
    ...overrides,
  }
}

function makeTool(overrides: Partial<AiToolDefinition> & Pick<AiToolDefinition, 'name'>): AiToolDefinition {
  return {
    description: `${overrides.name} description`,
    inputSchema: z.object({ query: z.string().optional() }),
    handler: async () => ({ ok: true }),
    ...overrides,
  }
}

async function resolveWithTools(
  tools: AiToolDefinition[],
  options: { mutationPolicy?: AiAgentDefinition['mutationPolicy']; withContainer?: boolean; authContext?: AiChatRequestContext } = {},
) {
  for (const definition of tools) {
    registerMcpTool(definition, { moduleId: 'customers' })
  }
  seedAgentRegistryForTests([
    makeAgent({
      id: 'customers.assistant',
      moduleId: 'customers',
      allowedTools: tools.map((definition) => definition.name),
      ...(options.mutationPolicy ? { mutationPolicy: options.mutationPolicy, readOnly: false } : {}),
    }),
  ])
  return resolveAiAgentTools({
    agentId: 'customers.assistant',
    authContext: options.authContext ?? baseAuth,
    ...(options.withContainer ? { container } : {}),
  })
}

function executable(tools: Record<string, unknown>, name: string): ExecutableTool {
  return tools[name] as ExecutableTool
}

function fixture(overrides: Partial<ToolReplayFixture> & Pick<ToolReplayFixture, 'toolName' | 'args'>): ToolReplayFixture {
  return {
    argsKey: computeToolArgsKey(overrides.args),
    output: null,
    error: null,
    occurrence: 0,
    ...overrides,
  }
}

describe('tool replay seam', () => {
  beforeEach(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
    prepareMutationMock.mockReset()
  })

  afterAll(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  it('leaves execution unchanged when no context is bound', async () => {
    const handler = jest.fn(async () => ({ items: [1] }))
    const result = await resolveWithTools([makeTool({ name: 'customers.list_people', handler })])
    expect(getToolReplayContext()).toBeNull()
    const output = await executable(result.tools, 'customers__list_people').execute({ query: 'a' }, { toolCallId: 'c1' })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(output).toBe(JSON.stringify({ items: [1] }, null, 2))
  })

  it('computes an args key that ignores object key order', () => {
    expect(computeToolArgsKey({ a: 1, b: { c: 2, d: 3 } })).toBe(computeToolArgsKey({ b: { d: 3, c: 2 }, a: 1 }))
    expect(computeToolArgsKey({ a: 1 })).not.toBe(computeToolArgsKey({ a: 2 }))
  })

  describe('record mode', () => {
    it('captures every call with output, error, occurrence and call id', async () => {
      const recorded: ToolReplayFixture[] = []
      const result = await resolveWithTools([
        makeTool({ name: 'customers.list_people', handler: async (input) => ({ hits: (input as { query?: string }).query }) }),
        makeTool({
          name: 'customers.get_person',
          handler: async () => {
            throw new Error('not found')
          },
        }),
      ])
      await withToolReplayContext({ mode: 'record', sink: (entry) => recorded.push(entry) }, async () => {
        await executable(result.tools, 'customers__list_people').execute({ query: 'x' }, { toolCallId: 'c1' })
        await executable(result.tools, 'customers__list_people').execute({ query: 'x' }, { toolCallId: 'c2' })
        await expect(
          executable(result.tools, 'customers__get_person').execute({ query: 'y' }, { toolCallId: 'c3' }),
        ).rejects.toThrow('Tool "customers.get_person" failed: not found')
      })
      expect(recorded).toEqual([
        {
          toolName: 'customers.list_people',
          argsKey: computeToolArgsKey({ query: 'x' }),
          args: { query: 'x' },
          output: { hits: 'x' },
          error: null,
          occurrence: 0,
          toolCallId: 'c1',
        },
        expect.objectContaining({ toolName: 'customers.list_people', occurrence: 1, toolCallId: 'c2' }),
        expect.objectContaining({
          toolName: 'customers.get_person',
          output: null,
          error: { message: 'not found' },
          occurrence: 0,
          toolCallId: 'c3',
        }),
      ])
    })

    it('records the merged uiParts envelope and still returns it to the model', async () => {
      const recorded: ToolReplayFixture[] = []
      const result = await resolveWithTools([
        makeTool({
          name: 'customers.list_people',
          handler: async (_input, ctx) => {
            emitCitations(ctx, [{ kind: 'record', ref: 'customers.person:1' }])
            return { items: [{ id: '1' }] }
          },
        }),
      ])
      const output = await withToolReplayContext({ mode: 'record', sink: (entry) => recorded.push(entry) }, () =>
        executable(result.tools, 'customers__list_people').execute({}, { toolCallId: 'c1' }),
      )
      const parsed = JSON.parse(output as string)
      expect(parsed.uiParts).toEqual([
        { componentId: 'ai_assistant:citations', payload: { citations: [{ kind: 'record', ref: 'customers.person:1' }] } },
      ])
      expect(recorded[0].output).toEqual(parsed)
    })

    it('does not let a throwing sink break the tool call', async () => {
      const result = await resolveWithTools([makeTool({ name: 'customers.list_people' })])
      const output = await withToolReplayContext(
        {
          mode: 'record',
          sink: () => {
            throw new Error('disk full')
          },
        },
        () => executable(result.tools, 'customers__list_people').execute({}),
      )
      expect(JSON.parse(output as string)).toEqual({ ok: true })
    })

    it('does not record approval-gated mutation calls', async () => {
      prepareMutationMock.mockResolvedValue({
        uiPart: { componentId: 'mutation-preview-card', payload: {} },
        pendingAction: {
          id: 'pa-1',
          expiresAt: new Date(Date.now() + 60_000),
          status: 'pending',
          executionResult: null,
        },
        reused: false,
      })
      const handler = jest.fn(async () => ({ ok: true }))
      const recorded: ToolReplayFixture[] = []
      const result = await resolveWithTools(
        [makeTool({ name: 'customers.update_person', isMutation: true, handler })],
        { mutationPolicy: 'confirm-required', withContainer: true },
      )
      const output = await withToolReplayContext({ mode: 'record', sink: (entry) => recorded.push(entry) }, () =>
        executable(result.tools, 'customers__update_person').execute({}),
      )
      expect(JSON.parse(output as string)).toMatchObject({ status: 'pending-confirmation', pendingActionId: 'pa-1' })
      expect(handler).not.toHaveBeenCalled()
      expect(recorded).toEqual([])
    })
  })

  describe('replay authorization', () => {
    const toolName = 'customers.list_people'
    const requiredFeatures = ['customers.people.view', 'customers.companies.view']

    it.each([
      { match: 'strict' as const, onMiss: 'error' as const },
      { match: 'ordered' as const, onMiss: 'live' as const },
    ])('refuses recorded output after a required grant is revoked ($match, $onMiss)', async ({ match, onMiss }) => {
      const handler = jest.fn()
      const authContext = { ...baseAuth, features: [...requiredFeatures], isSuperAdmin: false }
      const result = await resolveWithTools([makeTool({ name: toolName, requiredFeatures, handler })], { authContext })
      authContext.features = ['customers.people.view']
      const misses: ToolReplayMiss[] = []
      const observeHit = jest.fn()
      await withToolReplayContext({
        mode: 'replay',
        fixtures: [fixture({ toolName, args: {}, output: { secret: 'recorded data' } })],
        match,
        onMiss,
        observeMiss: (miss) => misses.push(miss),
        observeHit,
      }, async () => {
        await expect(executable(result.tools, 'customers__list_people').execute({}, { toolCallId: 'denied' }))
          .rejects.toMatchObject({ code: 'tool_replay_forbidden', toolName })
      })
      expect(misses).toEqual([expect.objectContaining({
        toolName, reason: 'forbidden', resolution: 'error', occurrence: 0, toolCallId: 'denied',
      })])
      expect(observeHit).not.toHaveBeenCalled()
      expect(handler).not.toHaveBeenCalled()
    })

    it.each(['replay', 'record'] as const)('checks authorization before lookup in %s mode', async (mode) => {
      const handler = jest.fn()
      const authContext = { ...baseAuth, features: [...requiredFeatures], isSuperAdmin: false }
      const result = await resolveWithTools([makeTool({ name: toolName, requiredFeatures, handler })], { authContext })
      authContext.features = []
      const lookup = jest.fn(() => fixture({ toolName, args: {}, output: 'private mock' }))
      const observeHit = jest.fn()
      const sink = jest.fn()
      const context = mode === 'record'
        ? { mode, lookup, observeHit, sink }
        : { mode, lookup, observeHit, fixtures: [], match: 'strict' as const, onMiss: 'live' as const }
      await expect(withToolReplayContext(context, () => executable(result.tools, 'customers__list_people').execute({})))
        .rejects.toMatchObject({ code: 'tool_replay_forbidden', toolName })
      expect(lookup).not.toHaveBeenCalled()
      expect(observeHit).not.toHaveBeenCalled()
      expect(sink).not.toHaveBeenCalled()
      expect(handler).not.toHaveBeenCalled()
    })

    it.each([
      { features: requiredFeatures, isSuperAdmin: false },
      { features: ['customers.*'], isSuperAdmin: false },
      { features: ['*'], isSuperAdmin: false },
      { features: [], isSuperAdmin: true },
    ])('replays for authorized callers: %j', async (grants) => {
      const handler = jest.fn()
      const result = await resolveWithTools([makeTool({ name: toolName, requiredFeatures, handler })], {
        authContext: { ...baseAuth, ...grants },
      })
      const output = await withToolReplayContext({
        mode: 'replay', fixtures: [fixture({ toolName, args: {}, output: 'authorized data' })],
        match: 'strict', onMiss: 'error',
      }, () => executable(result.tools, 'customers__list_people').execute({}))
      expect(output).toBe('authorized data')
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('replay mode', () => {
    it('returns the recorded output without calling the handler (strict)', async () => {
      const handler = jest.fn(async () => ({ live: true }))
      const result = await resolveWithTools([makeTool({ name: 'customers.list_people', handler })])
      const fixtures = [
        fixture({ toolName: 'customers.list_people', args: { query: 'x' }, output: { recorded: 0 } }),
        fixture({ toolName: 'customers.list_people', args: { query: 'x' }, output: { recorded: 1 }, occurrence: 1 }),
      ]
      const outputs = await withToolReplayContext(
        { mode: 'replay', fixtures, match: 'strict', onMiss: 'error' },
        async () => [
          await executable(result.tools, 'customers__list_people').execute({ query: 'x' }, { toolCallId: 'c1' }),
          await executable(result.tools, 'customers__list_people').execute({ query: 'x' }, { toolCallId: 'c2' }),
        ],
      )
      expect(handler).not.toHaveBeenCalled()
      expect(outputs.map((output) => JSON.parse(output as string))).toEqual([{ recorded: 0 }, { recorded: 1 }])
      expect(result.toolCallTimings.has('c1')).toBe(true)
    })

    it('replays recorded string outputs and recorded errors', async () => {
      const handler = jest.fn(async () => 'live')
      const result = await resolveWithTools([makeTool({ name: 'customers.list_people', handler })])
      const fixtures = [
        fixture({ toolName: 'customers.list_people', args: { query: 'a' }, output: 'recorded answer' }),
        fixture({ toolName: 'customers.list_people', args: { query: 'b' }, error: { message: 'not found' } }),
      ]
      await withToolReplayContext({ mode: 'replay', fixtures, match: 'strict', onMiss: 'error' }, async () => {
        await expect(executable(result.tools, 'customers__list_people').execute({ query: 'a' })).resolves.toBe(
          'recorded answer',
        )
        await expect(executable(result.tools, 'customers__list_people').execute({ query: 'b' })).rejects.toThrow(
          'Tool "customers.list_people" failed: not found',
        )
      })
      expect(handler).not.toHaveBeenCalled()
    })

    it('matches the n-th call of a tool regardless of args in ordered mode', async () => {
      const result = await resolveWithTools([makeTool({ name: 'customers.list_people' })])
      const fixtures = [
        fixture({ toolName: 'customers.list_people', args: { query: 'id-1' }, output: 'first' }),
        fixture({ toolName: 'customers.list_people', args: { query: 'id-2' }, output: 'second' }),
      ]
      const outputs = await withToolReplayContext({ mode: 'replay', fixtures, match: 'ordered', onMiss: 'error' }, async () => [
        await executable(result.tools, 'customers__list_people').execute({ query: 'generated-a' }),
        await executable(result.tools, 'customers__list_people').execute({ query: 'generated-b' }),
      ])
      expect(outputs).toEqual(['first', 'second'])
    })

    it('throws tool_fixture_missing on a miss and never runs the handler', async () => {
      const handler = jest.fn(async () => ({ live: true }))
      const misses: ToolReplayMiss[] = []
      const result = await resolveWithTools([makeTool({ name: 'customers.list_people', handler })])
      await withToolReplayContext(
        {
          mode: 'replay',
          fixtures: [fixture({ toolName: 'customers.list_people', args: { query: 'x' }, output: 'recorded' })],
          match: 'strict',
          onMiss: 'error',
          observeMiss: (miss) => misses.push(miss),
        },
        async () => {
          await expect(
            executable(result.tools, 'customers__list_people').execute({ query: 'other' }, { toolCallId: 'c9' }),
          ).rejects.toMatchObject({ name: 'ToolReplayError', code: 'tool_fixture_missing' })
        },
      )
      expect(handler).not.toHaveBeenCalled()
      expect(misses).toEqual([
        expect.objectContaining({
          toolName: 'customers.list_people',
          toolCallId: 'c9',
          reason: 'fixture_missing',
          resolution: 'error',
        }),
      ])
    })

    it('runs the real tool on a miss when onMiss is live and reports it', async () => {
      const handler = jest.fn(async () => ({ live: true }))
      const misses: ToolReplayMiss[] = []
      const result = await resolveWithTools([makeTool({ name: 'customers.list_people', handler })])
      const output = await withToolReplayContext(
        { mode: 'replay', fixtures: [], match: 'strict', onMiss: 'live', observeMiss: (miss) => misses.push(miss) },
        () => executable(result.tools, 'customers__list_people').execute({}),
      )
      expect(handler).toHaveBeenCalledTimes(1)
      expect(JSON.parse(output as string)).toEqual({ live: true })
      expect(misses).toEqual([expect.objectContaining({ reason: 'fixture_missing', resolution: 'live' })])
    })

    it('refuses mutation tools even when a fixture matches', async () => {
      const handler = jest.fn(async () => ({ ok: true }))
      const misses: ToolReplayMiss[] = []
      const result = await resolveWithTools(
        [makeTool({ name: 'customers.update_person', isMutation: true, handler })],
        { mutationPolicy: 'confirm-required' },
      )
      await withToolReplayContext(
        {
          mode: 'replay',
          fixtures: [fixture({ toolName: 'customers.update_person', args: {}, output: { ok: true } })],
          match: 'strict',
          onMiss: 'live',
          observeMiss: (miss) => misses.push(miss),
        },
        async () => {
          await expect(executable(result.tools, 'customers__update_person').execute({})).rejects.toMatchObject({
            code: 'tool_replay_mutation_refused',
          })
        },
      )
      expect(handler).not.toHaveBeenCalled()
      expect(misses).toEqual([expect.objectContaining({ reason: 'mutation_refused', resolution: 'error' })])
    })

    it('refuses approval-gated mutation tools without queueing a pending action', async () => {
      const result = await resolveWithTools(
        [makeTool({ name: 'customers.update_person', isMutation: true })],
        { mutationPolicy: 'confirm-required', withContainer: true },
      )
      await withToolReplayContext({ mode: 'replay', fixtures: [], match: 'strict', onMiss: 'live' }, async () => {
        await expect(executable(result.tools, 'customers__update_person').execute({})).rejects.toMatchObject({
          code: 'tool_replay_mutation_refused',
        })
      })
      expect(prepareMutationMock).not.toHaveBeenCalled()
      expect(result.uiPartQueue.size()).toBe(0)
      expect(result.pendingActionIds).toEqual([])
    })

    it('keeps occurrence counters isolated per bound context, even concurrently', async () => {
      const result = await resolveWithTools([makeTool({ name: 'customers.list_people' })])
      const fixtures = [fixture({ toolName: 'customers.list_people', args: {}, output: 'only-once' })]
      const runOnce = () =>
        withToolReplayContext({ mode: 'replay', fixtures, match: 'strict', onMiss: 'error' }, async () => {
          await new Promise((resolve) => setImmediate(resolve))
          return executable(result.tools, 'customers__list_people').execute({})
        })
      await expect(Promise.all([runOnce(), runOnce()])).resolves.toEqual(['only-once', 'only-once'])
      await expect(runOnce()).resolves.toBe('only-once')
    })

    it('restores live execution after the bound scope ends', async () => {
      const handler = jest.fn(async () => 'live')
      const result = await resolveWithTools([makeTool({ name: 'customers.list_people', handler })])
      await withToolReplayContext(
        {
          mode: 'replay',
          fixtures: [fixture({ toolName: 'customers.list_people', args: {}, output: 'recorded' })],
          match: 'strict',
          onMiss: 'error',
        },
        () => executable(result.tools, 'customers__list_people').execute({}),
      )
      await expect(executable(result.tools, 'customers__list_people').execute({})).resolves.toBe('live')
      expect(handler).toHaveBeenCalledTimes(1)
    })
  })

  describe('lookup hooks', () => {
    const mockFixture = (call: ToolReplayCall, output: unknown): ToolReplayFixture => ({
      toolName: call.toolName,
      argsKey: call.argsKey,
      args: call.args,
      output,
      error: null,
      occurrence: call.occurrence,
    })

    it('answers from lookup before recorded fixtures in replay mode and reports the hit', async () => {
      const handler = jest.fn(async () => 'live')
      const hits: Array<{ toolName: string; source: ToolReplayHitSource }> = []
      const result = await resolveWithTools([makeTool({ name: 'customers.list_people', handler })])
      const output = await withToolReplayContext(
        {
          mode: 'replay',
          fixtures: [fixture({ toolName: 'customers.list_people', args: { query: 'x' }, output: 'recorded' })],
          match: 'strict',
          onMiss: 'error',
          lookup: (call) => mockFixture(call, 'mocked'),
          observeHit: (call, source) => hits.push({ toolName: call.toolName, source }),
        },
        () => executable(result.tools, 'customers__list_people').execute({ query: 'x' }),
      )
      expect(output).toBe('mocked')
      expect(handler).not.toHaveBeenCalled()
      expect(hits).toEqual([{ toolName: 'customers.list_people', source: 'lookup' }])
    })

    it('reports a recorded fixture hit when lookup has no answer', async () => {
      const hits: ToolReplayHitSource[] = []
      const result = await resolveWithTools([makeTool({ name: 'customers.list_people' })])
      const output = await withToolReplayContext(
        {
          mode: 'replay',
          fixtures: [fixture({ toolName: 'customers.list_people', args: { query: 'x' }, output: 'recorded' })],
          match: 'strict',
          onMiss: 'error',
          lookup: () => null,
          observeHit: (_call, source) => hits.push(source),
        },
        () => executable(result.tools, 'customers__list_people').execute({ query: 'x' }),
      )
      expect(output).toBe('recorded')
      expect(hits).toEqual(['fixture'])
    })

    it('answers from lookup in record mode without sending the call to the sink', async () => {
      const handler = jest.fn(async () => 'live')
      const recorded: ToolReplayFixture[] = []
      const hits: ToolReplayHitSource[] = []
      const result = await resolveWithTools([makeTool({ name: 'customers.list_people', handler })])
      const outputs = await withToolReplayContext(
        {
          mode: 'record',
          sink: (entry) => recorded.push(entry),
          lookup: (call) => ((call.args as { query?: string }).query === 'mocked' ? mockFixture(call, 'from mock') : null),
          observeHit: (_call, source) => hits.push(source),
        },
        async () => [
          await executable(result.tools, 'customers__list_people').execute({ query: 'mocked' }),
          await executable(result.tools, 'customers__list_people').execute({ query: 'live' }),
        ],
      )
      expect(outputs[0]).toBe('from mock')
      expect(outputs[1]).toBe('live')
      expect(handler).toHaveBeenCalledTimes(1)
      expect(hits).toEqual(['lookup'])
      expect(recorded).toEqual([expect.objectContaining({ args: { query: 'live' }, output: 'live' })])
    })

    it('never consults lookup for a mutation call in either mode', async () => {
      const lookup = jest.fn((call: ToolReplayCall) => mockFixture(call, 'mocked'))
      const handler = jest.fn(async () => ({ ok: true }))
      const result = await resolveWithTools(
        [makeTool({ name: 'customers.update_person', isMutation: true, handler })],
        { mutationPolicy: 'confirm-required' },
      )
      await withToolReplayContext({ mode: 'replay', fixtures: [], match: 'strict', onMiss: 'live', lookup }, async () => {
        await expect(executable(result.tools, 'customers__update_person').execute({})).rejects.toMatchObject({
          code: 'tool_replay_mutation_refused',
        })
      })
      const recorded: ToolReplayFixture[] = []
      await withToolReplayContext({ mode: 'record', sink: (entry) => recorded.push(entry), lookup }, async () => {
        await executable(result.tools, 'customers__update_person').execute({})
      })
      expect(lookup).not.toHaveBeenCalled()
      expect(handler).toHaveBeenCalledTimes(1)
      expect(recorded).toEqual([expect.objectContaining({ toolName: 'customers.update_person' })])
    })

    it('treats a throwing lookup as no hit and ignores a throwing observeHit', async () => {
      const result = await resolveWithTools([makeTool({ name: 'customers.list_people' })])
      const output = await withToolReplayContext(
        {
          mode: 'replay',
          fixtures: [fixture({ toolName: 'customers.list_people', args: {}, output: 'recorded' })],
          match: 'strict',
          onMiss: 'error',
          lookup: () => {
            throw new Error('broken lookup')
          },
          observeHit: () => {
            throw new Error('broken observer')
          },
        },
        () => executable(result.tools, 'customers__list_people').execute({}),
      )
      expect(output).toBe('recorded')
    })
  })
})
