import type { AiAgentDefinition } from '../ai-agent-definition'
import type { AiAgentCallObserver, AiAgentPromptResolvedEvent } from '../agent-call-contract'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'

let currentModel: MockLanguageModelV4
const getLatestMock = jest.fn()

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

jest.mock('../../data/repositories/AiAgentPromptOverrideRepository', () => ({
  AiAgentPromptOverrideRepository: jest.fn().mockImplementation(() => ({
    getLatest: (...args: unknown[]) => getLatestMock(...args),
  })),
}))

import { z } from 'zod'
import { resetAgentRegistryForTests, seedAgentRegistryForTests } from '../agent-registry'
import { toolRegistry } from '../tool-registry'
import {
  composeSystemPrompt,
  composeSystemPromptWithMeta,
  resolveSystemPromptWithOverrideMeta,
  runAiAgentObject,
  runAiAgentText,
} from '../agent-runtime'
import { composeSystemPromptWithOverride } from '../prompt-override-merge'

function buildUsage(inputTokens: number, outputTokens: number) {
  return {
    inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: outputTokens, text: outputTokens, reasoning: undefined },
  }
}

function buildTextModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: 'test-provider',
    modelId: 'provider-default-model',
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start' as const, warnings: [] },
          { type: 'text-start' as const, id: 'text-1' },
          { type: 'text-delta' as const, id: 'text-1', delta: 'Done' },
          { type: 'text-end' as const, id: 'text-1' },
          {
            type: 'finish' as const,
            finishReason: { unified: 'stop' as const, raw: 'stop' },
            usage: buildUsage(3, 1),
          },
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
      usage: buildUsage(4, 2),
      warnings: [],
    }),
  })
}

function makeAgent(overrides: Partial<AiAgentDefinition> = {}): AiAgentDefinition {
  return {
    id: 'customers.assistant',
    moduleId: 'customers',
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

const overrideRow = { id: 'override-1', version: 3, sections: { role: 'Be concise.' } }

function buildContainer() {
  const entityManager = {}
  return {
    resolve: (name: string) => {
      if (name === 'em') return entityManager
      throw new Error(`[internal] not registered: ${name}`)
    },
  }
}

function buildRecordingObserver() {
  const events: AiAgentPromptResolvedEvent[] = []
  const observer: AiAgentCallObserver = {
    onPromptResolved: (event) => {
      events.push(event)
    },
  }
  return { observer, events }
}

describe('prompt override metadata and onPromptResolved', () => {
  beforeEach(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
    getLatestMock.mockReset()
  })

  afterAll(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  it('resolves override metadata alongside the composed prompt when an override exists', async () => {
    getLatestMock.mockResolvedValue(overrideRow)
    const agent = makeAgent()
    const resolved = await resolveSystemPromptWithOverrideMeta(agent, buildContainer() as never, 'tenant-1', 'org-1')
    expect(resolved.override).toEqual({ id: 'override-1', version: 3 })
    expect(resolved.prompt).toBe(composeSystemPromptWithOverride(agent.systemPrompt, { sections: overrideRow.sections }))
    const composed = await composeSystemPrompt(agent, undefined, buildContainer() as never, 'tenant-1', 'org-1')
    expect(composed).toBe(resolved.prompt)
  })

  it('reports a null override when none is stored', async () => {
    getLatestMock.mockResolvedValue(null)
    const agent = makeAgent()
    const resolved = await resolveSystemPromptWithOverrideMeta(agent, buildContainer() as never, 'tenant-1', 'org-1')
    expect(resolved).toEqual({ prompt: agent.systemPrompt, override: null })
  })

  it('reports page-context hydration in the composed metadata', async () => {
    getLatestMock.mockResolvedValue(null)
    const agent = makeAgent({ resolvePageContext: async () => 'Record details.' })
    const composed = await composeSystemPromptWithMeta(
      agent,
      { entityType: 'customers:person', recordId: 'record-1' },
      buildContainer() as never,
      'tenant-1',
      'org-1',
    )
    expect(composed).toEqual({
      prompt: 'System prompt base.\n\nRecord details.',
      promptOverride: null,
      pageContextHydrated: true,
    })
  })

  it('chat: calls onPromptResolved once with the final system prompt, override and model', async () => {
    getLatestMock.mockResolvedValue(overrideRow)
    seedAgentRegistryForTests([makeAgent()])
    currentModel = buildTextModel()
    const { observer, events } = buildRecordingObserver()
    const response = await runAiAgentText({
      agentId: 'customers.assistant',
      messages: baseMessages as never,
      authContext: baseAuth,
      container: buildContainer() as never,
      observe: observer,
    })
    await response.text()
    expect(events).toHaveLength(1)
    const [event] = events
    expect(event.agentId).toBe('customers.assistant')
    expect(event.promptOverride).toEqual({ id: 'override-1', version: 3 })
    expect(event.pageContextHydrated).toBe(false)
    expect(event.attachmentCount).toBe(0)
    expect(event.provider).toBe('test-provider')
    expect(event.modelId).toBe('provider-default-model')
    expect(event.systemPrompt).toContain('Be concise.')
    expect(currentModel.doStreamCalls).toHaveLength(1)
    const sentSystem = currentModel.doStreamCalls[0].prompt.find((message) => message.role === 'system')
    expect(sentSystem?.content).toBe(event.systemPrompt)
  })

  it('object: calls onPromptResolved once with a null override when none is stored', async () => {
    getLatestMock.mockResolvedValue(null)
    seedAgentRegistryForTests([makeAgent({ executionMode: 'object', output: objectOutput })])
    currentModel = buildObjectModel()
    const { observer, events } = buildRecordingObserver()
    await runAiAgentObject({
      agentId: 'customers.assistant',
      input: 'Describe the product',
      authContext: baseAuth,
      container: buildContainer() as never,
      observe: observer,
    })
    expect(events).toHaveLength(1)
    expect(events[0].promptOverride).toBeNull()
    expect(events[0].provider).toBe('test-provider')
    expect(events[0].modelId).toBe('provider-default-model')
    const sentSystem = currentModel.doGenerateCalls[0].prompt.find((message) => message.role === 'system')
    expect(sentSystem?.content).toBe(events[0].systemPrompt)
  })

  it.each(['text', 'object'] as const)('%s: a throwing onPromptResolved does not fail the run', async (mode) => {
    getLatestMock.mockResolvedValue(overrideRow)
    const onPromptResolved = jest.fn(() => {
      throw new Error('[internal] observer failure')
    })
    if (mode === 'text') {
      seedAgentRegistryForTests([makeAgent()])
      currentModel = buildTextModel()
      const response = await runAiAgentText({
        agentId: 'customers.assistant',
        messages: baseMessages as never,
        authContext: baseAuth,
        container: buildContainer() as never,
        observe: { onPromptResolved },
      })
      await expect(response.text()).resolves.toContain('Done')
    } else {
      seedAgentRegistryForTests([makeAgent({ executionMode: 'object', output: objectOutput })])
      currentModel = buildObjectModel()
      const result = await runAiAgentObject({
        agentId: 'customers.assistant',
        input: 'Describe the product',
        authContext: baseAuth,
        container: buildContainer() as never,
        observe: { onPromptResolved },
      })
      expect(result.object).toEqual({ name: 'Widget' })
    }
    expect(onPromptResolved).toHaveBeenCalledTimes(1)
  })
})
