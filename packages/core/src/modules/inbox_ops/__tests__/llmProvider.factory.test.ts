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
})
