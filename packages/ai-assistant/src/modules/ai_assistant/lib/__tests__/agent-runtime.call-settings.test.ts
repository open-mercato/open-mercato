import type { AiAgentDefinition } from '../ai-agent-definition'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'

let currentModel: MockLanguageModelV4

jest.mock('@open-mercato/shared/lib/ai/llm-provider-registry', () => ({
  llmProviderRegistry: {
    resolveFirstConfigured: () => ({
      id: 'test-provider',
      defaultModel: 'provider-default-model',
      resolveApiKey: () => 'test-api-key',
      createModel: () => currentModel,
      isConfigured: () => true,
    }),
    get: () => null,
  },
}))

import { z } from 'zod'
import { resetAgentRegistryForTests, seedAgentRegistryForTests } from '../agent-registry'
import { toolRegistry } from '../tool-registry'
import { runAiAgentObject, runAiAgentText, type PreparedAiSdkObjectOptions } from '../agent-runtime'

function buildUsage() {
  return {
    inputTokens: { total: 4, noCache: 4, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 2, text: 2, reasoning: undefined },
  }
}

function buildTextModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: 'test-provider',
    modelId: 'provider-default-model',
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: 'Hello' },
          { type: 'text-end', id: 'text-1' },
          { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: buildUsage() },
        ],
      }),
    }),
  })
}

function buildObjectModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: 'test-provider',
    modelId: 'provider-default-model',
    doGenerate: async () => ({
      content: [{ type: 'text', text: JSON.stringify({ name: 'Widget' }) }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: buildUsage(),
      warnings: [],
    }),
  })
}

function makeAgent(overrides: Partial<AiAgentDefinition>): AiAgentDefinition {
  return {
    id: 'catalog.assistant',
    moduleId: 'catalog',
    label: 'Assistant',
    description: 'Assistant description',
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

const baseMessages = [{ role: 'user' as const, id: 'msg-1', parts: [{ type: 'text' as const, text: 'hi' }] }]

const objectOutput = { schemaName: 'Product', schema: z.object({ name: z.string() }) }

const settingKeys = ['temperature', 'topP', 'topK', 'maxOutputTokens', 'seed', 'stopSequences', 'presencePenalty', 'frequencyPenalty'] as const

function pickSettings(options: Record<string, unknown>): Record<string, unknown> {
  const picked: Record<string, unknown> = {}
  for (const key of settingKeys) {
    if (options[key] !== undefined) picked[key] = options[key]
  }
  if (options.providerOptions !== undefined) picked.providerOptions = options.providerOptions
  return picked
}

async function runChat(agent: AiAgentDefinition, callSettings?: Record<string, unknown>) {
  currentModel = buildTextModel()
  seedAgentRegistryForTests([agent])
  const response = await runAiAgentText({
    agentId: agent.id,
    messages: baseMessages as never,
    authContext: baseAuth,
    ...(callSettings ? { callSettings } : {}),
  })
  await response.text()
  expect(currentModel.doStreamCalls).toHaveLength(1)
  return currentModel.doStreamCalls[0] as unknown as Record<string, unknown>
}

async function runObject(agent: AiAgentDefinition, callSettings?: Record<string, unknown>) {
  currentModel = buildObjectModel()
  seedAgentRegistryForTests([agent])
  const result = await runAiAgentObject({
    agentId: agent.id,
    input: 'extract',
    authContext: baseAuth,
    output: objectOutput,
    ...(callSettings ? { callSettings } : {}),
  })
  expect(result.mode).toBe('generate')
  expect(currentModel.doGenerateCalls).toHaveLength(1)
  return currentModel.doGenerateCalls[0] as unknown as Record<string, unknown>
}

describe('agent runtime call settings forwarding', () => {
  beforeEach(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  afterAll(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  it('chat: sends no call settings when none are declared', async () => {
    const options = await runChat(makeAgent({}))
    expect(pickSettings(options)).toEqual({})
  })

  it('chat: call settings override model settings per key and reach the provider', async () => {
    const options = await runChat(
      makeAgent({
        modelSettings: {
          temperature: 0.1,
          maxOutputTokens: 256,
          providerOptions: { testProvider: { reasoning: 'low' } },
        },
      }),
      { temperature: 0.7, seed: 42 },
    )
    expect(pickSettings(options)).toEqual({
      temperature: 0.7,
      maxOutputTokens: 256,
      seed: 42,
      providerOptions: { testProvider: { reasoning: 'low' } },
    })
  })

  it('object: sends no call settings when none are declared', async () => {
    const options = await runObject(makeAgent({ executionMode: 'object' }))
    expect(pickSettings(options)).toEqual({})
  })

  it('object: call settings override model settings per key and reach the provider', async () => {
    const options = await runObject(
      makeAgent({ executionMode: 'object', modelSettings: { temperature: 0.2, topP: 0.5 } }),
      { topP: 0.9, stopSequences: ['END'] },
    )
    expect(pickSettings(options)).toEqual({ temperature: 0.2, topP: 0.9, stopSequences: ['END'] })
  })

  it('object: passes effective call settings to the generateObject callback only when declared', async () => {
    currentModel = buildObjectModel()
    const received: PreparedAiSdkObjectOptions[] = []
    const callback = async (options: PreparedAiSdkObjectOptions) => {
      received.push(options)
      return { object: { name: 'Widget' } } as never
    }
    seedAgentRegistryForTests([makeAgent({ executionMode: 'object', modelSettings: { temperature: 0.3 } })])
    await runAiAgentObject({
      agentId: 'catalog.assistant',
      input: 'extract',
      authContext: baseAuth,
      output: objectOutput,
      callSettings: { maxOutputTokens: 64 },
      generateObject: callback,
    })
    resetAgentRegistryForTests()
    seedAgentRegistryForTests([makeAgent({ executionMode: 'object' })])
    await runAiAgentObject({
      agentId: 'catalog.assistant',
      input: 'extract',
      authContext: baseAuth,
      output: objectOutput,
      generateObject: callback,
    })
    expect(received[0].callSettings).toEqual({ temperature: 0.3, maxOutputTokens: 64 })
    expect('callSettings' in received[1]).toBe(false)
  })
})
