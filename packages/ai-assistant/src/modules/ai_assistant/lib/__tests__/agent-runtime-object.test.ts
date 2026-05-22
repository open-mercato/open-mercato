import type { AiAgentDefinition, AiAgentPageContextInput } from '../ai-agent-definition'

const generateObjectMock = jest.fn()
const streamObjectMock = jest.fn()
const stepCountIsMock = jest.fn((count: number) => ({ __stopWhen: 'stepCount', count }))
const convertToModelMessagesMock = jest.fn((messages: unknown) => messages)
const streamTextMock = jest.fn()

jest.mock('ai', () => {
  const actual = jest.requireActual('ai')
  return {
    ...actual,
    generateObject: (...args: unknown[]) => generateObjectMock(...args),
    streamObject: (...args: unknown[]) => streamObjectMock(...args),
    streamText: (...args: unknown[]) => streamTextMock(...args),
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
import { toolRegistry } from '../tool-registry'
import { runAiAgentObject } from '../agent-runtime'
import { AgentPolicyError } from '../agent-tools'

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

const baseAuth = {
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  userId: 'user-1',
  features: ['*'],
  isSuperAdmin: true,
}

describe('runAiAgentObject — generate mode', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetAgentRegistryForTests()
    toolRegistry.clear()
    generateObjectMock.mockImplementation(async () => ({
      object: { name: 'X' },
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 5 },
    }))
  })

  afterAll(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  it('returns the parsed object when the agent declares output + executionMode=object', async () => {
    const schema = z.object({ name: z.string() })
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.extractor',
        moduleId: 'catalog',
        executionMode: 'object',
        mutationPolicy: 'read-only',
        output: { schemaName: 'ExtractedAttributes', schema },
      }),
    ])

    const result = await runAiAgentObject({
      agentId: 'catalog.extractor',
      input: 'extract please',
      authContext: baseAuth,
    })

    expect(result.mode).toBe('generate')
    if (result.mode !== 'generate') throw new Error('unreachable')
    expect(result.object).toEqual({ name: 'X' })
    expect(result.finishReason).toBe('stop')
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
    expect(generateObjectMock).toHaveBeenCalledTimes(1)
    const callArg = generateObjectMock.mock.calls[0][0] as {
      system: string
      schemaName: string
      schema: unknown
      messages: unknown
      model: { id: string }
    }
    expect(callArg.system).toBe('System prompt base.')
    expect(callArg.schemaName).toBe('ExtractedAttributes')
    expect(callArg.schema).toBe(schema)
    expect(callArg.model.id).toBe('provider-default-model')
  })

  it('runtime output override wins over agent-level output', async () => {
    const agentSchema = z.object({ a: z.string() })
    const overrideSchema = z.object({ b: z.number() })
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.extractor',
        moduleId: 'catalog',
        executionMode: 'object',
        output: { schemaName: 'AgentSchema', schema: agentSchema },
      }),
    ])

    await runAiAgentObject({
      agentId: 'catalog.extractor',
      input: 'go',
      authContext: baseAuth,
      output: { schemaName: 'RuntimeSchema', schema: overrideSchema },
    })

    const callArg = generateObjectMock.mock.calls[0][0] as {
      schemaName: string
      schema: unknown
    }
    expect(callArg.schemaName).toBe('RuntimeSchema')
    expect(callArg.schema).toBe(overrideSchema)
  })

  it('throws AgentPolicyError(execution_mode_not_supported) when neither the agent nor the caller declare a schema', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.extractor',
        moduleId: 'catalog',
        executionMode: 'object',
      }),
    ])

    await expect(
      runAiAgentObject({
        agentId: 'catalog.extractor',
        input: 'go',
        authContext: baseAuth,
      }),
    ).rejects.toMatchObject({
      name: 'AgentPolicyError',
      code: 'execution_mode_not_supported',
    })
    expect(generateObjectMock).not.toHaveBeenCalled()
  })

  it('rejects chat-mode agents called via runAiAgentObject', async () => {
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
    ).rejects.toBeInstanceOf(AgentPolicyError)
    await expect(
      runAiAgentObject({
        agentId: 'customers.assistant',
        input: 'go',
        authContext: baseAuth,
      }),
    ).rejects.toMatchObject({ code: 'execution_mode_not_supported' })
    expect(generateObjectMock).not.toHaveBeenCalled()
  })

  it('rejects when the caller lacks the agent.requiredFeatures', async () => {
    const schema = z.object({ name: z.string() })
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.extractor',
        moduleId: 'catalog',
        executionMode: 'object',
        requiredFeatures: ['catalog.extract'],
        output: { schemaName: 'Out', schema },
      }),
    ])

    await expect(
      runAiAgentObject({
        agentId: 'catalog.extractor',
        input: 'go',
        authContext: {
          ...baseAuth,
          features: ['unrelated.feature'],
          isSuperAdmin: false,
        },
      }),
    ).rejects.toMatchObject({
      name: 'AgentPolicyError',
      code: 'agent_features_denied',
    })
  })

  it('applies modelOverride when supplied', async () => {
    const schema = z.object({ name: z.string() })
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.extractor',
        moduleId: 'catalog',
        executionMode: 'object',
        defaultModel: 'agent-default',
        output: { schemaName: 'Out', schema },
      }),
    ])

    await runAiAgentObject({
      agentId: 'catalog.extractor',
      input: 'go',
      authContext: baseAuth,
      modelOverride: 'override-model',
    })

    expect(createModelMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'override-model' }),
    )
  })

  it('invokes resolvePageContext and appends hydration output when entityType+recordId are provided', async () => {
    const schema = z.object({ name: z.string() })
    const resolvePageContext = jest.fn(async (_input: AiAgentPageContextInput) => 'Hydrated record context.')
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.extractor',
        moduleId: 'catalog',
        executionMode: 'object',
        output: { schemaName: 'Out', schema },
        resolvePageContext,
      }),
    ])

    await runAiAgentObject({
      agentId: 'catalog.extractor',
      input: 'go',
      authContext: baseAuth,
      pageContext: { entityType: 'catalog:product', recordId: 'p-1' },
      container: {} as never,
    })

    expect(resolvePageContext).toHaveBeenCalledTimes(1)
    const callArg = generateObjectMock.mock.calls[0][0] as { system: string }
    expect(callArg.system).toBe('System prompt base.\n\nHydrated record context.')
  })
})

describe('runAiAgentObject — stream mode', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetAgentRegistryForTests()
    toolRegistry.clear()
    streamObjectMock.mockImplementation(() => ({
      object: Promise.resolve({ name: 'final' }),
      partialObjectStream: (async function* () {
        yield { name: 'fi' } as Partial<{ name: string }>
        yield { name: 'final' } as Partial<{ name: string }>
      })(),
      textStream: (async function* () {
        yield '{"name":"fi'
        yield 'nal"}'
      })(),
      finishReason: Promise.resolve('stop' as string | undefined),
      usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
    }))
  })

  afterAll(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  it('mode=stream calls streamObject and returns a stream handle', async () => {
    const schema = z.object({ name: z.string() })
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.extractor',
        moduleId: 'catalog',
        executionMode: 'object',
        output: { schemaName: 'Out', schema, mode: 'stream' },
      }),
    ])

    const result = await runAiAgentObject<{ name: string }>({
      agentId: 'catalog.extractor',
      input: 'go',
      authContext: baseAuth,
    })

    expect(streamObjectMock).toHaveBeenCalledTimes(1)
    expect(result.mode).toBe('stream')
    if (result.mode !== 'stream') throw new Error('unreachable')
    await expect(result.object).resolves.toEqual({ name: 'final' })

    const partials: Array<Partial<{ name: string }>> = []
    for await (const part of result.partialObjectStream) partials.push(part)
    expect(partials.length).toBeGreaterThan(0)

    const chunks: string[] = []
    for await (const chunk of result.textStream) chunks.push(chunk)
    expect(chunks.join('')).toContain('"name"')
  })
})
