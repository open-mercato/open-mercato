import type { AiAgentDefinition, AiAgentPageContextInput } from '../ai-agent-definition'
import type { AiToolDefinition } from '../types'

const streamTextMock = jest.fn()
const stepCountIsMock = jest.fn((count: number) => ({ __stopWhen: 'stepCount', count }))
const convertToModelMessagesMock = jest.fn((messages: unknown) => messages)

jest.mock('ai', () => {
  const actual = jest.requireActual('ai')
  return {
    ...actual,
    streamText: (...args: unknown[]) => streamTextMock(...args),
    stepCountIs: (...args: unknown[]) => stepCountIsMock(...(args as [number])),
    convertToModelMessages: (...args: unknown[]) => convertToModelMessagesMock(...args),
  }
})

const createModelMock = jest.fn(
  (options: { modelId: string; apiKey: string }) => ({ id: options.modelId, apiKey: options.apiKey }),
)
const resolveApiKeyMock = jest.fn(() => 'test-api-key')

const openaiCreateModelMock = jest.fn(
  (options: { modelId: string; apiKey: string }) => ({ id: options.modelId, apiKey: options.apiKey, provider: 'openai' }),
)
const openaiResolveApiKeyMock = jest.fn(() => 'openai-test-key')

jest.mock('@open-mercato/shared/lib/ai/llm-provider-registry', () => ({
  llmProviderRegistry: {
    resolveFirstConfigured: (options?: { env?: Record<string, string | undefined>; order?: readonly string[] }) => {
      const order = options?.order
      if (order && order.includes('openai')) {
        return {
          id: 'openai',
          defaultModel: 'gpt-4o-mini',
          resolveApiKey: openaiResolveApiKeyMock,
          createModel: openaiCreateModelMock,
          isConfigured: () => true,
        }
      }
      return {
        id: 'test-provider',
        defaultModel: 'provider-default-model',
        resolveApiKey: resolveApiKeyMock,
        createModel: createModelMock,
        isConfigured: () => true,
      }
    },
    get: (id: string) => {
      if (id === 'openai') {
        return {
          id: 'openai',
          defaultModel: 'gpt-4o-mini',
          resolveApiKey: openaiResolveApiKeyMock,
          createModel: openaiCreateModelMock,
          isConfigured: () => true,
        }
      }
      return null
    },
  },
}))

import { z } from 'zod'
import {
  resetAgentRegistryForTests,
  seedAgentRegistryForTests,
} from '../agent-registry'
import { toolRegistry, registerMcpTool } from '../tool-registry'
import { runAiAgentText, composeSystemPrompt } from '../agent-runtime'

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

const baseMessages = [{ role: 'user' as const, id: 'm1', parts: [{ type: 'text' as const, text: 'hi' }] }]

function fakeStreamResult(): {
  toTextStreamResponse: jest.Mock
  toUIMessageStreamResponse: jest.Mock
} {
  const toTextStreamResponse = jest.fn(
    () =>
      new Response('streamed', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
  )
  const toUIMessageStreamResponse = jest.fn(
    () =>
      new Response('streamed', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
  )
  return { toTextStreamResponse, toUIMessageStreamResponse }
}

describe('runAiAgentText', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetAgentRegistryForTests()
    toolRegistry.clear()
    streamTextMock.mockImplementation(() => fakeStreamResult())
  })

  afterAll(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  it('invokes streamText with the composed system prompt and tools map', async () => {
    registerMcpTool(makeTool({ name: 'customers.list_people' }), { moduleId: 'customers' })
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.assistant',
        moduleId: 'customers',
        allowedTools: ['customers.list_people'],
      }),
    ])

    const response = await runAiAgentText({
      agentId: 'customers.assistant',
      messages: baseMessages as never,
      authContext: baseAuth,
    })

    expect(response).toBeInstanceOf(Response)
    expect(streamTextMock).toHaveBeenCalledTimes(1)
    const callArg = streamTextMock.mock.calls[0][0] as {
      system: string
      tools: Record<string, unknown>
      messages: unknown
      model: { id: string }
      stopWhen?: unknown
    }
    expect(callArg.system).toBe('System prompt base.')
    expect(Object.keys(callArg.tools)).toEqual(['customers__list_people'])
    // PR #1593 applies a default stopWhen of stepCountIs(10) when maxSteps
    // is undefined so tool-calls actually execute (agent-runtime.ts).
    expect(callArg.stopWhen).toBeDefined()
    expect(callArg.model.id).toBe('provider-default-model')
    expect(convertToModelMessagesMock).toHaveBeenCalledWith(baseMessages)
  })

  it('propagates maxSteps as stopWhen: stepCountIs(n)', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.assistant',
        moduleId: 'customers',
        maxSteps: 5,
      }),
    ])

    await runAiAgentText({
      agentId: 'customers.assistant',
      messages: baseMessages as never,
      authContext: baseAuth,
    })

    expect(stepCountIsMock).toHaveBeenCalledWith(5)
    const callArg = streamTextMock.mock.calls[0][0] as { stopWhen: unknown }
    // Phase 2: stopWhen is now always an array from translateStopConditions
    expect(callArg.stopWhen).toEqual([{ __stopWhen: 'stepCount', count: 5 }])
  })

  it('lets modelOverride win over agent.defaultModel', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.assistant',
        moduleId: 'customers',
        defaultModel: 'agent-default',
      }),
    ])

    await runAiAgentText({
      agentId: 'customers.assistant',
      messages: baseMessages as never,
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
      }),
    ])

    await runAiAgentText({
      agentId: 'customers.assistant',
      messages: baseMessages as never,
      authContext: baseAuth,
    })

    expect(createModelMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'agent-default' }),
    )
  })

  it('appends resolvePageContext output to the system prompt when entityType+recordId are present', async () => {
    const resolvePageContext = jest.fn(async (_input: AiAgentPageContextInput) => 'Hydrated record context.')
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.assistant',
        moduleId: 'customers',
        resolvePageContext,
      }),
    ])

    await runAiAgentText({
      agentId: 'customers.assistant',
      messages: baseMessages as never,
      authContext: baseAuth,
      pageContext: { entityType: 'customers:person', recordId: 'abc' },
      container: {} as never,
    })

    expect(resolvePageContext).toHaveBeenCalledTimes(1)
    const callArg = streamTextMock.mock.calls[0][0] as { system: string }
    expect(callArg.system).toBe('System prompt base.\n\nHydrated record context.')
  })

  it('skips resolvePageContext silently when entityType or recordId are missing', async () => {
    const resolvePageContext = jest.fn(async () => 'should-not-append')
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.assistant',
        moduleId: 'customers',
        resolvePageContext,
      }),
    ])

    await runAiAgentText({
      agentId: 'customers.assistant',
      messages: baseMessages as never,
      authContext: baseAuth,
      pageContext: { pageId: 'customers.people' },
      container: {} as never,
    })

    expect(resolvePageContext).not.toHaveBeenCalled()
    const callArg = streamTextMock.mock.calls[0][0] as { system: string }
    expect(callArg.system).toBe('System prompt base.')
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
      }),
    ])

    const response = await runAiAgentText({
      agentId: 'customers.assistant',
      messages: baseMessages as never,
      authContext: baseAuth,
      pageContext: { entityType: 'customers:person', recordId: 'abc' },
      container: {} as never,
    })

    expect(response).toBeInstanceOf(Response)
    const callArg = streamTextMock.mock.calls[0][0] as { system: string }
    expect(callArg.system).toBe('System prompt base.')
    errorSpy.mockRestore()
  })

  it('uses openai provider when agent.defaultProvider=openai and anthropic is registration-first', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.assistant',
        moduleId: 'customers',
        defaultProvider: 'openai',
        defaultModel: 'gpt-5-mini',
      }),
    ])

    await runAiAgentText({
      agentId: 'customers.assistant',
      messages: baseMessages as never,
      authContext: baseAuth,
      container: {} as never,
    })

    expect(openaiCreateModelMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'gpt-5-mini' }),
    )
    const callArg = streamTextMock.mock.calls[0][0] as { model: { id: string; provider?: string } }
    expect(callArg.model.provider).toBe('openai')
  })
})

describe('composeSystemPrompt', () => {
  it('returns base prompt when resolvePageContext is not declared', async () => {
    const agent: AiAgentDefinition = {
      id: 'x.y',
      moduleId: 'x',
      label: 'x',
      description: 'x',
      systemPrompt: 'base',
      allowedTools: [],
    }
    const result = await composeSystemPrompt(agent, undefined, undefined, null, null)
    expect(result).toBe('base')
  })
})
