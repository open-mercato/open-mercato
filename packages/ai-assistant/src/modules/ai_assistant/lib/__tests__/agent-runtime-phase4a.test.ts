/**
 * Phase 4a unit tests — per-turn tenant override hydration in agent-runtime.
 *
 * Verifies that `resolveRuntimeModelOverride` is called once per turn (both
 * `runAiAgentText` and `runAiAgentObject`), that its return value is threaded
 * into `createModelFactory.resolveModel`, and that a repository failure falls
 * open (warn + fall through) without failing the chat turn.
 */

import type { AiAgentDefinition } from '../ai-agent-definition'

const streamTextMock = jest.fn()
const convertToModelMessagesMock = jest.fn((messages: unknown) => messages)
const generateObjectMock = jest.fn()
const stepCountIsMock = jest.fn((count: number) => ({ __stopWhen: 'stepCount', count }))

jest.mock('ai', () => {
  const actual = jest.requireActual('ai')
  return {
    ...actual,
    streamText: (...args: unknown[]) => streamTextMock(...args),
    generateObject: (...args: unknown[]) => generateObjectMock(...args),
    stepCountIs: (...args: unknown[]) => stepCountIsMock(...(args as [number])),
    convertToModelMessages: (...args: unknown[]) => convertToModelMessagesMock(...args),
  }
})

const createModelMock = jest.fn(
  (options: { modelId: string }) => ({ id: options.modelId }),
)
const resolveApiKeyMock = jest.fn(() => 'test-api-key')

jest.mock('@open-mercato/shared/lib/ai/llm-provider-registry', () => ({
  llmProviderRegistry: {
    resolveFirstConfigured: (options?: { order?: readonly string[] }) => {
      const order = options?.order
      if (order && order.includes('tenant-provider')) {
        return {
          id: 'tenant-provider',
          defaultModel: 'tenant-default-model',
          resolveApiKey: resolveApiKeyMock,
          createModel: createModelMock,
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
      if (id === 'tenant-provider') {
        return {
          id: 'tenant-provider',
          defaultModel: 'tenant-default-model',
          resolveApiKey: resolveApiKeyMock,
          createModel: createModelMock,
          isConfigured: () => true,
        }
      }
      return null
    },
    list: () => [],
  },
}))

const getDefaultMock = jest.fn()

jest.mock(
  '../../data/repositories/AiAgentRuntimeOverrideRepository',
  () => {
    return {
      AiAgentRuntimeOverrideRepository: jest.fn().mockImplementation(() => ({
        getDefault: getDefaultMock,
      })),
    }
  },
)

import { z } from 'zod'
import { resetAgentRegistryForTests, seedAgentRegistryForTests } from '../agent-registry'
import { toolRegistry } from '../tool-registry'
import { runAiAgentText, runAiAgentObject } from '../agent-runtime'

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

const baseMessages = [{ role: 'user' as const, id: 'm1', parts: [{ type: 'text' as const, text: 'hi' }] }]

function fakeStreamResult() {
  return {
    toUIMessageStreamResponse: jest.fn(
      () => new Response('streamed', { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    ),
  }
}

function makeFakeEm() {
  return {
    findOne: jest.fn(),
    fork: jest.fn(),
  }
}

function makeContainer(em: ReturnType<typeof makeFakeEm>) {
  return {
    resolve: jest.fn((key: string) => {
      if (key === 'em') return em
      throw new Error(`Unknown DI key: ${key}`)
    }),
  }
}

describe('Phase 4a — runtime model override hydration in agent-runtime', () => {
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    resetAgentRegistryForTests()
    toolRegistry.clear()
    streamTextMock.mockImplementation(() => fakeStreamResult())
    generateObjectMock.mockResolvedValue({ object: { result: 'ok' }, finishReason: 'stop', usage: {} })
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  afterAll(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  describe('runAiAgentText', () => {
    it('calls getDefault exactly once per turn with agentId + tenantId + organizationId', async () => {
      getDefaultMock.mockResolvedValue(null)
      seedAgentRegistryForTests([
        makeAgent({ id: 'customers.assistant', moduleId: 'customers' }),
      ])

      const fakeEm = makeFakeEm()
      const container = makeContainer(fakeEm)

      await runAiAgentText({
        agentId: 'customers.assistant',
        messages: baseMessages as never,
        authContext: baseAuth,
        container: container as never,
      })

      expect(getDefaultMock).toHaveBeenCalledTimes(1)
      expect(getDefaultMock).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        agentId: 'customers.assistant',
      })
    })

    it('uses model from tenantOverride row when the repo returns one', async () => {
      getDefaultMock.mockResolvedValue({
        providerId: 'tenant-provider',
        modelId: 'tenant-model-from-db',
        baseUrl: null,
      })
      seedAgentRegistryForTests([
        makeAgent({ id: 'customers.assistant', moduleId: 'customers' }),
      ])

      const container = makeContainer(makeFakeEm())

      await runAiAgentText({
        agentId: 'customers.assistant',
        messages: baseMessages as never,
        authContext: baseAuth,
        container: container as never,
      })

      expect(createModelMock).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: 'tenant-model-from-db' }),
      )
    })

    it('forwards requestOverride from input through to model factory', async () => {
      getDefaultMock.mockResolvedValue(null)
      seedAgentRegistryForTests([
        makeAgent({ id: 'customers.assistant', moduleId: 'customers' }),
      ])

      const container = makeContainer(makeFakeEm())

      await runAiAgentText({
        agentId: 'customers.assistant',
        messages: baseMessages as never,
        authContext: baseAuth,
        container: container as never,
        requestOverride: { providerId: null, modelId: 'request-override-model', baseURL: null },
      })

      expect(createModelMock).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: 'request-override-model' }),
      )
    })

    it('requestOverride wins over tenantOverride when both are present', async () => {
      getDefaultMock.mockResolvedValue({
        providerId: null,
        modelId: 'tenant-model',
        baseUrl: null,
      })
      seedAgentRegistryForTests([
        makeAgent({ id: 'customers.assistant', moduleId: 'customers' }),
      ])

      const container = makeContainer(makeFakeEm())

      await runAiAgentText({
        agentId: 'customers.assistant',
        messages: baseMessages as never,
        authContext: baseAuth,
        container: container as never,
        requestOverride: { providerId: null, modelId: 'request-wins-model', baseURL: null },
      })

      expect(createModelMock).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: 'request-wins-model' }),
      )
    })

    it('falls open when the repo throws — warns and continues without override', async () => {
      getDefaultMock.mockRejectedValue(new Error('DB connection failed'))
      seedAgentRegistryForTests([
        makeAgent({ id: 'customers.assistant', moduleId: 'customers', defaultModel: 'agent-default' }),
      ])

      const container = makeContainer(makeFakeEm())

      const response = await runAiAgentText({
        agentId: 'customers.assistant',
        messages: baseMessages as never,
        authContext: baseAuth,
        container: container as never,
      })

      expect(response).toBeInstanceOf(Response)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Runtime model override lookup failed'),
        expect.anything(),
      )
      expect(createModelMock).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: 'agent-default' }),
      )
    })

    it('skips getDefault when no container is provided', async () => {
      seedAgentRegistryForTests([
        makeAgent({ id: 'customers.assistant', moduleId: 'customers' }),
      ])

      await runAiAgentText({
        agentId: 'customers.assistant',
        messages: baseMessages as never,
        authContext: baseAuth,
      })

      expect(getDefaultMock).not.toHaveBeenCalled()
    })

    it('suppresses both overrides when allowRuntimeModelOverride is false', async () => {
      getDefaultMock.mockResolvedValue({
        providerId: null,
        modelId: 'tenant-model-should-be-suppressed',
        baseUrl: null,
      })
      seedAgentRegistryForTests([
        makeAgent({
          id: 'customers.assistant',
          moduleId: 'customers',
          defaultModel: 'pinned-agent-model',
          allowRuntimeModelOverride: false,
        }),
      ])

      const container = makeContainer(makeFakeEm())

      await runAiAgentText({
        agentId: 'customers.assistant',
        messages: baseMessages as never,
        authContext: baseAuth,
        container: container as never,
        requestOverride: { providerId: null, modelId: 'request-model-should-be-suppressed', baseURL: null },
      })

      // tenantOverride and requestOverride are both skipped; agent default wins
      expect(createModelMock).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: 'pinned-agent-model' }),
      )
    })
  })

  describe('runAiAgentObject', () => {
    const objectSchema = z.object({ result: z.string() })

    it('calls getDefault exactly once per turn', async () => {
      getDefaultMock.mockResolvedValue(null)
      seedAgentRegistryForTests([
        makeAgent({ id: 'catalog.extractor', moduleId: 'catalog', executionMode: 'object' }),
      ])

      const container = makeContainer(makeFakeEm())

      await runAiAgentObject({
        agentId: 'catalog.extractor',
        input: 'extract data',
        authContext: baseAuth,
        container: container as never,
        output: { schemaName: 'ExtractionResult', schema: objectSchema },
      })

      expect(getDefaultMock).toHaveBeenCalledTimes(1)
      expect(getDefaultMock).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        agentId: 'catalog.extractor',
      })
    })

    it('forwards requestOverride to model factory in object mode', async () => {
      getDefaultMock.mockResolvedValue(null)
      seedAgentRegistryForTests([
        makeAgent({ id: 'catalog.extractor', moduleId: 'catalog', executionMode: 'object' }),
      ])

      const container = makeContainer(makeFakeEm())

      await runAiAgentObject({
        agentId: 'catalog.extractor',
        input: 'extract data',
        authContext: baseAuth,
        container: container as never,
        output: { schemaName: 'ExtractionResult', schema: objectSchema },
        requestOverride: { providerId: null, modelId: 'object-request-model', baseURL: null },
      })

      expect(createModelMock).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: 'object-request-model' }),
      )
    })

    it('falls open on repo failure in object mode', async () => {
      getDefaultMock.mockRejectedValue(new Error('Table not found'))
      seedAgentRegistryForTests([
        makeAgent({ id: 'catalog.extractor', moduleId: 'catalog', defaultModel: 'catalog-default', executionMode: 'object' }),
      ])

      const container = makeContainer(makeFakeEm())

      const result = await runAiAgentObject({
        agentId: 'catalog.extractor',
        input: 'extract data',
        authContext: baseAuth,
        container: container as never,
        output: { schemaName: 'ExtractionResult', schema: objectSchema },
      })

      expect(result.mode).toBe('generate')
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Runtime model override lookup failed'),
        expect.anything(),
      )
      expect(createModelMock).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: 'catalog-default' }),
      )
    })
  })
})
