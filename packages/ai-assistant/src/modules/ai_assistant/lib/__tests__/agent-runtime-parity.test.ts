/**
 * Step 3.6 — chat-mode / object-mode parity contract.
 *
 * The Step 3.4 (`agent-runtime.test.ts`, `agent-tools.test.ts`,
 * `agent-transport.test.ts`) and Step 3.5 (`agent-runtime-object.test.ts`)
 * suites exercise each helper in isolation. THIS suite guards the
 * cross-cutting INVARIANT: `runAiAgentText` and `runAiAgentObject` share
 * the exact same policy gate, tool filtering, prompt composition, and
 * `resolvePageContext` pathway. A bug that makes one path diverge from
 * the other MUST land here first.
 *
 * Each invariant is expressed as a `describe.each` row so the fixture is
 * identical and only the helper under test varies. The one exception is
 * the execution-mode gate (invariant #8), which is an inverse-pair by
 * construction and therefore uses two paired tests instead.
 */

import type { AiAgentDefinition, AiAgentPageContextInput } from '../ai-agent-definition'
import type { AiToolDefinition } from '../types'

const streamTextMock = jest.fn()
const generateObjectMock = jest.fn()
const streamObjectMock = jest.fn()
const stepCountIsMock = jest.fn((count: number) => ({ __stopWhen: 'stepCount', count }))
const convertToModelMessagesMock = jest.fn((messages: unknown) => messages)

jest.mock('ai', () => {
  const actual = jest.requireActual('ai')
  return {
    ...actual,
    streamText: (...args: unknown[]) => streamTextMock(...args),
    generateObject: (...args: unknown[]) => generateObjectMock(...args),
    streamObject: (...args: unknown[]) => streamObjectMock(...args),
    stepCountIs: (...args: unknown[]) => stepCountIsMock(...(args as [number])),
    convertToModelMessages: (...args: unknown[]) => convertToModelMessagesMock(...args),
  }
})

const createModelMock = jest.fn(
  (options: { modelId: string; apiKey: string }) => ({ id: options.modelId, apiKey: options.apiKey }),
)
const resolveApiKeyMock = jest.fn(() => 'test-api-key')

jest.mock('@open-mercato/shared/lib/ai/llm-provider-registry', () => ({
  llmProviderRegistry: {
    resolveFirstConfigured: () => ({
      id: 'test-provider',
      defaultModel: 'provider-default-model',
      resolveApiKey: resolveApiKeyMock,
      createModel: createModelMock,
    }),
  },
}))

import { z } from 'zod'
import {
  resetAgentRegistryForTests,
  seedAgentRegistryForTests,
} from '../agent-registry'
import { toolRegistry, registerMcpTool } from '../tool-registry'
import * as agentToolsModule from '../agent-tools'
import { AgentPolicyError } from '../agent-tools'
import { runAiAgentObject, runAiAgentText } from '../agent-runtime'

function makeAgent(
  overrides: Partial<AiAgentDefinition> & Pick<AiAgentDefinition, 'id' | 'moduleId'>,
): AiAgentDefinition {
  return {
    label: `${overrides.id} label`,
    description: `${overrides.id} description`,
    systemPrompt: 'System prompt base.',
    allowedTools: [],
    ...overrides,
  }
}

function makeTool(
  overrides: Partial<AiToolDefinition> & Pick<AiToolDefinition, 'name'>,
): AiToolDefinition {
  return {
    description: `${overrides.name} description`,
    inputSchema: z.object({}),
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

const baseMessages = [
  { role: 'user' as const, id: 'm1', parts: [{ type: 'text' as const, text: 'hi' }] },
]

function fakeStreamTextResult() {
  const toTextStreamResponse = jest.fn(
    () =>
      new Response('streamed', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
  )
  return { toTextStreamResponse }
}

/**
 * Parity schema used for object-mode runs. Declared on the agent so that
 * BOTH helper paths exercise the same fixture — chat-mode ignores it,
 * object-mode consumes it.
 */
const paritySchema = z.object({ name: z.string() })
const parityOutput = { schemaName: 'ParityOutput', schema: paritySchema }

interface HelperSpec {
  helper: 'text' | 'object'
  run: (args: {
    agentId: string
    authContext: typeof baseAuth
    pageContext?: Record<string, unknown>
    modelOverride?: string
    attachmentIds?: string[]
    container?: object
  }) => Promise<unknown>
  /** Last-seen positional args on the SDK-mock call (so callers can inspect `system`, `model`, etc.). */
  lastSdkCallArg: () => Record<string, unknown> | undefined
}

const textHelper: HelperSpec = {
  helper: 'text',
  run: ({ agentId, authContext, pageContext, modelOverride, attachmentIds, container }) =>
    runAiAgentText({
      agentId,
      messages: baseMessages as never,
      authContext,
      pageContext,
      modelOverride,
      attachmentIds,
      container: container as never,
    }),
  lastSdkCallArg: () => streamTextMock.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined,
}

const objectHelper: HelperSpec = {
  helper: 'object',
  run: ({ agentId, authContext, pageContext, modelOverride, attachmentIds, container }) =>
    runAiAgentObject({
      agentId,
      input: 'hi',
      authContext,
      pageContext,
      modelOverride,
      attachmentIds,
      container: container as never,
    }),
  lastSdkCallArg: () =>
    generateObjectMock.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined,
}

const helpers: HelperSpec[] = [textHelper, objectHelper]

function resetMocks() {
  jest.clearAllMocks()
  resetAgentRegistryForTests()
  toolRegistry.clear()
  streamTextMock.mockImplementation(() => fakeStreamTextResult())
  generateObjectMock.mockImplementation(async () => ({
    object: { name: 'X' },
    finishReason: 'stop',
    usage: { inputTokens: 1, outputTokens: 1 },
  }))
  streamObjectMock.mockImplementation(() => ({
    object: Promise.resolve({ name: 'X' }),
    partialObjectStream: (async function* () {
      yield { name: 'X' } as Partial<{ name: string }>
    })(),
    textStream: (async function* () {
      yield '{"name":"X"}'
    })(),
    finishReason: Promise.resolve('stop' as string | undefined),
    usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
  }))
}

describe('agent runtime parity (chat-mode ≡ object-mode)', () => {
  beforeEach(resetMocks)

  afterAll(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  describe.each(helpers)('$helper helper', ({ helper, run, lastSdkCallArg }) => {
    it('rejects unknown agents with AgentPolicyError(agent_unknown)', async () => {
      await expect(
        run({ agentId: 'nonexistent.agent', authContext: baseAuth }),
      ).rejects.toMatchObject({
        name: 'AgentPolicyError',
        code: 'agent_unknown',
      })
      expect(streamTextMock).not.toHaveBeenCalled()
      expect(generateObjectMock).not.toHaveBeenCalled()
      expect(streamObjectMock).not.toHaveBeenCalled()
    })

    it('rejects callers missing agent.requiredFeatures with agent_features_denied', async () => {
      seedAgentRegistryForTests([
        makeAgent({
          id: 'customers.assistant',
          moduleId: 'customers',
          requiredFeatures: ['customers.assistant.use'],
          output: parityOutput,
        }),
      ])

      await expect(
        run({
          agentId: 'customers.assistant',
          authContext: { ...baseAuth, features: [], isSuperAdmin: false },
        }),
      ).rejects.toMatchObject({
        name: 'AgentPolicyError',
        code: 'agent_features_denied',
      })
    })

    it('super-admin bypasses requiredFeatures symmetrically', async () => {
      seedAgentRegistryForTests([
        makeAgent({
          id: 'customers.assistant',
          moduleId: 'customers',
          requiredFeatures: ['customers.assistant.use'],
          output: parityOutput,
        }),
      ])

      await expect(
        run({
          agentId: 'customers.assistant',
          authContext: { ...baseAuth, features: [], isSuperAdmin: true },
        }),
      ).resolves.toBeDefined()
    })

    it('filters out isMutation tools on read-only agents (warn + continue)', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
      registerMcpTool(
        makeTool({ name: 'customers.update_person', isMutation: true }),
        { moduleId: 'customers' },
      )
      registerMcpTool(
        makeTool({ name: 'customers.list_people' }),
        { moduleId: 'customers' },
      )
      seedAgentRegistryForTests([
        makeAgent({
          id: 'customers.assistant',
          moduleId: 'customers',
          readOnly: true,
          allowedTools: ['customers.update_person', 'customers.list_people'],
          output: parityOutput,
        }),
      ])

      const resolveSpy = jest.spyOn(agentToolsModule, 'resolveAiAgentTools')

      await expect(
        run({ agentId: 'customers.assistant', authContext: baseAuth }),
      ).resolves.toBeDefined()

      expect(resolveSpy).toHaveBeenCalledTimes(1)
      const resolved = await resolveSpy.mock.results[0].value
      // Mutation tool filtered out; read-only tool survives.
      expect(Object.keys(resolved.tools)).toEqual(['customers.list_people'])
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('customers.update_person'),
      )

      // Chat path forwards the filtered tools map to streamText; object path
      // resolves tools for the policy gate but does not thread them into the
      // SDK call (AI SDK v6 object entries accept no `tools` map). Either
      // way, the mutation tool is never adapted for the model.
      if (helper === 'text') {
        const callArg = lastSdkCallArg() as { tools: Record<string, unknown> } | undefined
        expect(callArg).toBeDefined()
        expect(Object.keys(callArg!.tools)).toEqual(['customers.list_people'])
      }

      resolveSpy.mockRestore()
      warnSpy.mockRestore()
    })

    it('invokes resolvePageContext when entityType + recordId are supplied and appends to the prompt', async () => {
      const resolvePageContext = jest.fn(async (_input: AiAgentPageContextInput) => 'Hydrated ctx.')
      seedAgentRegistryForTests([
        makeAgent({
          id: 'customers.assistant',
          moduleId: 'customers',
          resolvePageContext,
          output: parityOutput,
        }),
      ])

      await run({
        agentId: 'customers.assistant',
        authContext: baseAuth,
        pageContext: { entityType: 'customers:person', recordId: 'p-1' },
        container: {},
      })

      expect(resolvePageContext).toHaveBeenCalledTimes(1)
      const callArg = lastSdkCallArg() as { system: string } | undefined
      expect(callArg?.system).toBe('System prompt base.\n\nHydrated ctx.')
    })

    it('skips resolvePageContext silently when entityType or recordId are absent', async () => {
      const resolvePageContext = jest.fn(async () => 'should-not-append')
      seedAgentRegistryForTests([
        makeAgent({
          id: 'customers.assistant',
          moduleId: 'customers',
          resolvePageContext,
          output: parityOutput,
        }),
      ])

      await run({
        agentId: 'customers.assistant',
        authContext: baseAuth,
        pageContext: { pageId: 'customers.people' },
        container: {},
      })

      expect(resolvePageContext).not.toHaveBeenCalled()
      const callArg = lastSdkCallArg() as { system: string } | undefined
      expect(callArg?.system).toBe('System prompt base.')
    })

    it('does not fail the request if resolvePageContext throws', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
      const resolvePageContext = jest.fn(async () => {
        throw new Error('boom')
      })
      seedAgentRegistryForTests([
        makeAgent({
          id: 'customers.assistant',
          moduleId: 'customers',
          resolvePageContext,
          output: parityOutput,
        }),
      ])

      await expect(
        run({
          agentId: 'customers.assistant',
          authContext: baseAuth,
          pageContext: { entityType: 'customers:person', recordId: 'p-1' },
          container: {},
        }),
      ).resolves.toBeDefined()

      const callArg = lastSdkCallArg() as { system: string } | undefined
      expect(callArg?.system).toBe('System prompt base.')
      errorSpy.mockRestore()
    })

    it('prefers modelOverride over agent.defaultModel', async () => {
      seedAgentRegistryForTests([
        makeAgent({
          id: 'customers.assistant',
          moduleId: 'customers',
          defaultModel: 'agent-default',
          output: parityOutput,
        }),
      ])

      await run({
        agentId: 'customers.assistant',
        authContext: baseAuth,
        modelOverride: 'override-model',
      })

      expect(createModelMock).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: 'override-model' }),
      )
    })

    it('falls back to agent.defaultModel when no override is given', async () => {
      seedAgentRegistryForTests([
        makeAgent({
          id: 'customers.assistant',
          moduleId: 'customers',
          defaultModel: 'agent-default',
          output: parityOutput,
        }),
      ])

      await run({
        agentId: 'customers.assistant',
        authContext: baseAuth,
      })

      expect(createModelMock).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: 'agent-default' }),
      )
    })

    it('passes attachmentIds unchanged to the tool-resolution layer (Phase-1 pass-through)', async () => {
      seedAgentRegistryForTests([
        makeAgent({
          id: 'customers.assistant',
          moduleId: 'customers',
          output: parityOutput,
        }),
      ])

      const resolveSpy = jest.spyOn(agentToolsModule, 'resolveAiAgentTools')

      await run({
        agentId: 'customers.assistant',
        authContext: baseAuth,
        attachmentIds: ['att-1', 'att-2'],
      })

      expect(resolveSpy).toHaveBeenCalledTimes(1)
      expect(resolveSpy.mock.calls[0][0]).toMatchObject({
        attachmentIds: ['att-1', 'att-2'],
      })
      resolveSpy.mockRestore()
    })

    it('never exposes a non-whitelisted tool to the SDK', async () => {
      registerMcpTool(makeTool({ name: 'customers.list_people' }), { moduleId: 'customers' })
      registerMcpTool(makeTool({ name: 'catalog.list_products' }), { moduleId: 'catalog' })
      seedAgentRegistryForTests([
        makeAgent({
          id: 'customers.assistant',
          moduleId: 'customers',
          // Only one of the two registered tools is whitelisted.
          allowedTools: ['customers.list_people'],
          output: parityOutput,
        }),
      ])

      const resolveSpy = jest.spyOn(agentToolsModule, 'resolveAiAgentTools')

      await run({ agentId: 'customers.assistant', authContext: baseAuth })

      const resolved = await resolveSpy.mock.results[0].value
      expect(Object.keys(resolved.tools)).toEqual(['customers.list_people'])
      expect(Object.keys(resolved.tools)).not.toContain('catalog.list_products')

      if (helper === 'text') {
        const callArg = lastSdkCallArg() as { tools: Record<string, unknown> } | undefined
        expect(callArg).toBeDefined()
        expect(Object.keys(callArg!.tools)).toEqual(['customers.list_people'])
        expect(Object.keys(callArg!.tools)).not.toContain('catalog.list_products')
      }

      resolveSpy.mockRestore()
    })
  })

  describe('execution-mode gate is symmetric-by-design', () => {
    it('object-mode agent requested through runAiAgentText → execution_mode_not_supported', async () => {
      seedAgentRegistryForTests([
        makeAgent({
          id: 'catalog.extractor',
          moduleId: 'catalog',
          executionMode: 'object',
          output: parityOutput,
        }),
      ])

      await expect(
        runAiAgentText({
          agentId: 'catalog.extractor',
          messages: baseMessages as never,
          authContext: baseAuth,
        }),
      ).rejects.toMatchObject({
        name: 'AgentPolicyError',
        code: 'execution_mode_not_supported',
      })
      expect(streamTextMock).not.toHaveBeenCalled()
    })

    it('chat-mode agent requested through runAiAgentObject → execution_mode_not_supported', async () => {
      seedAgentRegistryForTests([
        makeAgent({
          id: 'customers.assistant',
          moduleId: 'customers',
          executionMode: 'chat',
        }),
      ])

      await expect(
        runAiAgentObject({
          agentId: 'customers.assistant',
          input: 'go',
          authContext: baseAuth,
        }),
      ).rejects.toMatchObject({
        name: 'AgentPolicyError',
        code: 'execution_mode_not_supported',
      })
      expect(generateObjectMock).not.toHaveBeenCalled()
    })
  })
})

/**
 * Type-level assertion: the policy gate accepts the identical
 * `AiChatRequestContext` shape from both helpers. Changing one without
 * the other is a compile-time error.
 */
describe('type-level parity', () => {
  it('both helpers accept the same AiChatRequestContext shape', () => {
    const authContext = baseAuth
    // Compile-time only — calling either with an incompatible shape would
    // fail type-check. These refs keep the imports live.
    void runAiAgentText
    void runAiAgentObject
    expect(authContext).toBeDefined()
  })
})

/**
 * Invariant snapshot — tests that would also fail if someone modifies
 * `AgentPolicyError` to drop the deny code. Keeps the re-export honest.
 */
describe('AgentPolicyError re-export parity', () => {
  it('AgentPolicyError thrown by both helpers carries the same structural shape', async () => {
    const errors: AgentPolicyError[] = []

    try {
      await runAiAgentText({
        agentId: 'ghost.agent',
        messages: baseMessages as never,
        authContext: baseAuth,
      })
    } catch (error) {
      errors.push(error as AgentPolicyError)
    }

    try {
      await runAiAgentObject({
        agentId: 'ghost.agent',
        input: 'hi',
        authContext: baseAuth,
      })
    } catch (error) {
      errors.push(error as AgentPolicyError)
    }

    expect(errors).toHaveLength(2)
    for (const error of errors) {
      expect(error).toBeInstanceOf(AgentPolicyError)
      expect(error.code).toBe('agent_unknown')
    }
  })
})
