/** @jest-environment node */

/**
 * Regression suite for the Step 5.1 factory-delegation shim in
 * `packages/core/src/modules/inbox_ops/lib/llmProvider.ts`.
 *
 * Asserts that:
 *   1. The public export surface (`resolveExtractionProviderId`,
 *      `createStructuredModel`, `withTimeout`,
 *      `runExtractionWithConfiguredProvider`) is unchanged.
 *   2. `runExtractionWithConfiguredProvider` delegates to
 *      `createModelFactory` for model resolution (via the in-module
 *      `__inboxOpsLlmProviderInternal` seam) and calls
 *      `factory.resolveModel({ moduleId: 'inbox_ops', callerOverride })`.
 *   3. Existing consumers importing from the shim continue to receive the
 *      same model instance the factory produces.
 */

import { generateObject } from 'ai'
import { AiModelFactoryError } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory'
import * as llmProvider from '../lib/llmProvider'
import { extractionOutputSchema } from '../data/validators'

jest.mock('ai', () => ({
  generateObject: jest.fn(),
}))

type ExtractionObject = ReturnType<typeof extractionOutputSchema.parse>

const FAKE_EXTRACTION_OBJECT = {
  emailClassification: 'inquiry',
  confidenceScore: 0.9,
  language: 'en',
  participants: [],
  extractedItems: [],
  proposedActions: [],
  discrepancies: [],
  summary: 'fake',
} as unknown as ExtractionObject

describe('inbox_ops llmProvider shim', () => {
  const originalFactory = llmProvider.__inboxOpsLlmProviderInternal.createModelFactory
  const originalContainer = llmProvider.__inboxOpsLlmProviderInternal.createContainer

  beforeEach(() => {
    jest.clearAllMocks()
    ;(generateObject as jest.Mock).mockResolvedValue({
      object: FAKE_EXTRACTION_OBJECT,
      usage: { totalTokens: 123 },
    })
  })

  afterEach(() => {
    llmProvider.__inboxOpsLlmProviderInternal.createModelFactory = originalFactory
    llmProvider.__inboxOpsLlmProviderInternal.createContainer = originalContainer
  })

  it('preserves the pre-Step-5.1 public API shape', () => {
    expect(typeof llmProvider.resolveExtractionProviderId).toBe('function')
    expect(typeof llmProvider.createStructuredModel).toBe('function')
    expect(typeof llmProvider.withTimeout).toBe('function')
    expect(typeof llmProvider.runExtractionWithConfiguredProvider).toBe('function')
  })

  it('delegates runExtractionWithConfiguredProvider to createModelFactory', async () => {
    const fakeModel = { __kind: 'fake-model-from-factory' }
    const resolveModel = jest.fn(() => ({
      model: fakeModel,
      modelId: 'claude-haiku-fake',
      providerId: 'anthropic',
      source: 'module_env' as const,
    }))
    const createModelFactoryMock = jest.fn(() => ({ resolveModel }))
    const fakeContainer = { __fake: true }
    const createContainerMock = jest.fn(() => fakeContainer)

    llmProvider.__inboxOpsLlmProviderInternal.createModelFactory =
      createModelFactoryMock as unknown as typeof originalFactory
    llmProvider.__inboxOpsLlmProviderInternal.createContainer =
      createContainerMock as unknown as typeof originalContainer

    const result = await llmProvider.runExtractionWithConfiguredProvider({
      systemPrompt: 'system prompt',
      userPrompt: 'user prompt',
      modelOverride: 'caller-pinned',
      timeoutMs: 1000,
    })

    expect(createContainerMock).toHaveBeenCalledTimes(1)
    expect(createModelFactoryMock).toHaveBeenCalledTimes(1)
    expect(createModelFactoryMock).toHaveBeenCalledWith(fakeContainer)
    expect(resolveModel).toHaveBeenCalledWith({
      moduleId: 'inbox_ops',
      callerOverride: 'caller-pinned',
    })
    expect(generateObject).toHaveBeenCalledTimes(1)
    const generateCall = (generateObject as jest.Mock).mock.calls[0][0]
    expect(generateCall.model).toBe(fakeModel)
    expect(generateCall.schema).toBe(extractionOutputSchema)
    expect(generateCall.system).toBe('system prompt')
    expect(generateCall.prompt).toBe('user prompt')
    expect(result.object).toBe(FAKE_EXTRACTION_OBJECT)
    expect(result.totalTokens).toBe(123)
    expect(result.modelWithProvider).toBe('anthropic/claude-haiku-fake')
  })

  it('forwards the same model instance the factory produces', async () => {
    const uniqueModel = { __kind: 'identity-marker', nonce: Math.random() }
    const resolveModel = jest.fn(() => ({
      model: uniqueModel,
      modelId: 'identity-model',
      providerId: 'anthropic',
      source: 'agent_default' as const,
    }))
    llmProvider.__inboxOpsLlmProviderInternal.createModelFactory = (() => ({
      resolveModel,
    })) as unknown as typeof originalFactory
    llmProvider.__inboxOpsLlmProviderInternal.createContainer =
      (() => ({})) as unknown as typeof originalContainer

    await llmProvider.runExtractionWithConfiguredProvider({
      systemPrompt: 'x',
      userPrompt: 'y',
      timeoutMs: 1000,
    })
    const generateCall = (generateObject as jest.Mock).mock.calls[0][0]
    expect(generateCall.model).toBe(uniqueModel)
  })

  it('passes undefined callerOverride through when modelOverride is absent', async () => {
    const resolveModel = jest.fn(() => ({
      model: { __kind: 'm' },
      modelId: 'provider-default',
      providerId: 'openai',
      source: 'provider_default' as const,
    }))
    llmProvider.__inboxOpsLlmProviderInternal.createModelFactory = (() => ({
      resolveModel,
    })) as unknown as typeof originalFactory
    llmProvider.__inboxOpsLlmProviderInternal.createContainer =
      (() => ({})) as unknown as typeof originalContainer

    await llmProvider.runExtractionWithConfiguredProvider({
      systemPrompt: 's',
      userPrompt: 'u',
      timeoutMs: 1000,
    })
    expect(resolveModel).toHaveBeenCalledWith({
      moduleId: 'inbox_ops',
      callerOverride: undefined,
    })
  })

  it('builds a single-prefixed modelWithProvider for a gateway resolution', async () => {
    const resolveModel = jest.fn(() => ({
      model: { __kind: 'gw' },
      modelId: 'anthropic/claude-sonnet-4.5',
      providerId: 'openrouter',
      source: 'env_default' as const,
    }))
    llmProvider.__inboxOpsLlmProviderInternal.createModelFactory = (() => ({
      resolveModel,
    })) as unknown as typeof originalFactory
    llmProvider.__inboxOpsLlmProviderInternal.createContainer =
      (() => ({})) as unknown as typeof originalContainer

    const result = await llmProvider.runExtractionWithConfiguredProvider({
      systemPrompt: 's',
      userPrompt: 'u',
      timeoutMs: 1000,
    })
    expect(result.modelWithProvider).toBe('openrouter/anthropic/claude-sonnet-4.5')
  })

  it('exposes resolveConfiguredStructuredModel that routes through the factory (shared by categorize/translation)', async () => {
    expect(typeof llmProvider.resolveConfiguredStructuredModel).toBe('function')
    const model = { __kind: 'shared-model' }
    const resolveModel = jest.fn(() => ({
      model,
      modelId: 'anthropic/claude-sonnet-4.5',
      providerId: 'openrouter',
      source: 'module_env' as const,
    }))
    llmProvider.__inboxOpsLlmProviderInternal.createModelFactory = (() => ({
      resolveModel,
    })) as unknown as typeof originalFactory
    llmProvider.__inboxOpsLlmProviderInternal.createContainer =
      (() => ({})) as unknown as typeof originalContainer

    const res = await llmProvider.resolveConfiguredStructuredModel({ moduleId: 'inbox_ops' })
    expect(res.model).toBe(model)
    expect(res.modelWithProvider).toBe('openrouter/anthropic/claude-sonnet-4.5')
    expect(resolveModel).toHaveBeenCalledWith({ moduleId: 'inbox_ops', callerOverride: undefined })
  })

  it('fails loudly (never silently openai) when a non-native OM_AI_PROVIDER reaches the legacy fallback', async () => {
    const prev = process.env.OM_AI_PROVIDER
    process.env.OM_AI_PROVIDER = 'openrouter'
    const resolveModel = jest.fn(() => {
      throw new AiModelFactoryError('no_provider_configured', 'none configured')
    })
    llmProvider.__inboxOpsLlmProviderInternal.createModelFactory = (() => ({
      resolveModel,
    })) as unknown as typeof originalFactory
    llmProvider.__inboxOpsLlmProviderInternal.createContainer =
      (() => ({})) as unknown as typeof originalContainer

    try {
      await expect(
        llmProvider.resolveConfiguredStructuredModel({ moduleId: 'inbox_ops' }),
      ).rejects.toThrow(/OM_AI_PROVIDER="openrouter"/)
    } finally {
      if (prev === undefined) delete process.env.OM_AI_PROVIDER
      else process.env.OM_AI_PROVIDER = prev
    }
  })
})

describe('resolveExtractionProviderId — loud failure vs BC fall-through', () => {
  const savedOm = process.env.OM_AI_PROVIDER
  const savedOc = process.env.OPENCODE_PROVIDER

  const setEnv = (key: 'OM_AI_PROVIDER' | 'OPENCODE_PROVIDER', value: string | undefined) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  afterEach(() => {
    setEnv('OM_AI_PROVIDER', savedOm)
    setEnv('OPENCODE_PROVIDER', savedOc)
  })

  it('throws a descriptive error for a non-native canonical OM_AI_PROVIDER', () => {
    setEnv('OM_AI_PROVIDER', 'openrouter')
    setEnv('OPENCODE_PROVIDER', undefined)
    expect(() => llmProvider.resolveExtractionProviderId()).toThrow(/OM_AI_PROVIDER="openrouter"/)
  })

  it('still honors a native canonical OM_AI_PROVIDER', () => {
    setEnv('OM_AI_PROVIDER', 'anthropic')
    setEnv('OPENCODE_PROVIDER', undefined)
    expect(llmProvider.resolveExtractionProviderId()).toBe('anthropic')
  })

  it('leaves the legacy OPENCODE_PROVIDER fall-through untouched (no throw)', () => {
    setEnv('OM_AI_PROVIDER', undefined)
    setEnv('OPENCODE_PROVIDER', 'google')
    expect(llmProvider.resolveExtractionProviderId()).toBe('google')
  })
})
