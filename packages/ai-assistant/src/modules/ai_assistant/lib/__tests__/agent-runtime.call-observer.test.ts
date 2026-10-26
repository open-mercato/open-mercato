import type { AiAgentDefinition } from '../ai-agent-definition'
import type { AiToolDefinition } from '../types'
import type {
  AiAgentCallObserver,
  AiAgentModelCallEndEvent,
  AiAgentModelCallStartEvent,
} from '../agent-call-contract'
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
import { registerMcpTool, toolRegistry } from '../tool-registry'
import { runAiAgentObject, runAiAgentText, type PreparedAiSdkOptions } from '../agent-runtime'

function buildUsage(inputTokens: number, outputTokens: number) {
  return {
    inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: outputTokens, text: outputTokens, reasoning: undefined },
  }
}

function buildToolLoopStreamModel(): MockLanguageModelV4 {
  let callIndex = 0
  return new MockLanguageModelV4({
    provider: 'test-provider',
    modelId: 'provider-default-model',
    doStream: async () => {
      const currentCall = callIndex
      callIndex += 1
      const chunks =
        currentCall === 0
          ? [
              { type: 'stream-start' as const, warnings: [] },
              {
                type: 'tool-call' as const,
                toolCallId: 'call-read',
                toolName: 'customers__read_deal',
                input: JSON.stringify({}),
              },
              {
                type: 'finish' as const,
                finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' },
                usage: buildUsage(11, 3),
              },
            ]
          : [
              { type: 'stream-start' as const, warnings: [] },
              { type: 'text-start' as const, id: 'text-1' },
              { type: 'text-delta' as const, id: 'text-1', delta: 'Done' },
              { type: 'text-end' as const, id: 'text-1' },
              {
                type: 'finish' as const,
                finishReason: { unified: 'stop' as const, raw: 'stop' },
                usage: buildUsage(17, 5),
              },
            ]
      return { stream: simulateReadableStream({ chunks }) }
    },
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

function makeTool(name: string): AiToolDefinition {
  return {
    name,
    description: `${name} description`,
    inputSchema: z.object({}),
    handler: async () => ({ ok: true }),
  }
}

function makeAgent(overrides: Partial<AiAgentDefinition>): AiAgentDefinition {
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

const settingKeys = ['temperature', 'topP', 'topK', 'maxOutputTokens', 'seed', 'stopSequences', 'presencePenalty', 'frequencyPenalty'] as const

function pickSentSettings(options: Record<string, unknown>): Record<string, unknown> {
  const picked: Record<string, unknown> = {}
  for (const key of settingKeys) {
    if (options[key] !== undefined) picked[key] = options[key]
  }
  if (options.providerOptions !== undefined) picked.providerOptions = options.providerOptions
  return picked
}

function toolNamesOf(event: AiAgentModelCallStartEvent): string[] {
  return (event.tools ?? [])
    .map((definition) => definition.name)
    .filter((name): name is string => typeof name === 'string')
    .sort()
}

function buildRecordingObserver() {
  const starts: AiAgentModelCallStartEvent[] = []
  const ends: AiAgentModelCallEndEvent[] = []
  const observer: AiAgentCallObserver = {
    onModelCallStart: (event) => {
      starts.push(event)
    },
    onModelCallEnd: (event) => {
      ends.push(event)
    },
  }
  return { observer, starts, ends }
}

function seedToolLoopAgent(overrides: Partial<AiAgentDefinition> = {}): void {
  registerMcpTool(makeTool('customers.read_deal'), { moduleId: 'customers' })
  registerMcpTool(makeTool('customers.read_person'), { moduleId: 'customers' })
  seedAgentRegistryForTests([
    makeAgent({
      mutationPolicy: 'read-only',
      readOnly: true,
      allowedTools: ['customers.read_deal', 'customers.read_person'],
      loop: {
        maxSteps: 5,
        prepareStep: ({ stepNumber }) =>
          stepNumber === 0 ? { activeTools: ['customers.read_deal'] } : { activeTools: ['customers.read_person'] },
      },
      ...overrides,
    }),
  ])
}

describe('agent runtime model-call observer', () => {
  beforeEach(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  afterAll(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  it.each(['stream-text', 'tool-loop-agent'] as const)(
    'chat (%s): emits exactly one start/end pair per tool-loop step with the active tools and sent settings',
    async (executionEngine) => {
      seedToolLoopAgent({ executionEngine })
      currentModel = buildToolLoopStreamModel()
      const { observer, starts, ends } = buildRecordingObserver()
      const response = await runAiAgentText({
        agentId: 'customers.assistant',
        messages: baseMessages as never,
        authContext: baseAuth,
        callSettings: { temperature: 0.3, maxOutputTokens: 128, providerOptions: { testProvider: { mode: 'fast' } } },
        observe: observer,
      })
      await response.text()

      expect(currentModel.doStreamCalls).toHaveLength(2)
      expect(starts).toHaveLength(2)
      expect(ends).toHaveLength(2)
      expect(starts.map((event) => event.stepNumber)).toEqual([0, 1])
      expect(toolNamesOf(starts[0])).toEqual(['customers__read_deal'])
      expect(toolNamesOf(starts[1])).toEqual(['customers__read_person'])
      const firstPrompt = (currentModel.doStreamCalls[0] as unknown as { prompt: Array<{ role: string; content: unknown }> }).prompt
      const sentSystem = firstPrompt.find((message) => message.role === 'system')?.content
      expect(starts[0].system).toBe(sentSystem)
      expect(starts[0].provider).toBe('test-provider')
      expect(starts[0].modelId).toBe('provider-default-model')
      expect(starts[0].callId).toBe(ends[0].callId)
      expect(starts[1].callId).toBe(ends[1].callId)
      for (const [index, event] of starts.entries()) {
        const sent = currentModel.doStreamCalls[index] as unknown as Record<string, unknown>
        expect(event.callSettings).toEqual(pickSentSettings(sent))
      }
      expect(starts[0].callSettings).toEqual({
        temperature: 0.3,
        maxOutputTokens: 128,
        providerOptions: { testProvider: { mode: 'fast' } },
      })
      expect(ends.map((event) => event.finishReason)).toEqual(['tool-calls', 'stop'])
      expect(ends[0].usage).toEqual({ inputTokens: 11, outputTokens: 3 })
      expect(ends[1].usage).toEqual({ inputTokens: 17, outputTokens: 5 })
      expect(ends[0].content.some((part) => (part as { type?: string }).type === 'tool-call')).toBe(true)
      expect(typeof ends[0].responseTimeMs).toBe('number')
      expect(ends[0].endedAtMs).toBeGreaterThanOrEqual(starts[0].startedAtMs)
    },
  )

  it('chat: a throwing observer (sync and async) never fails the run', async () => {
    seedToolLoopAgent()
    currentModel = buildToolLoopStreamModel()
    const observer: AiAgentCallObserver = {
      onModelCallStart: () => {
        throw new Error('[internal] observer start failure')
      },
      onModelCallEnd: async () => {
        throw new Error('[internal] observer end failure')
      },
    }
    const response = await runAiAgentText({
      agentId: 'customers.assistant',
      messages: baseMessages as never,
      authContext: baseAuth,
      observe: observer,
    })
    const body = await response.text()
    expect(body).toContain('Done')
    expect(currentModel.doStreamCalls).toHaveLength(2)
  })

  it('chat: observer mutations cannot alter what is sent to the model', async () => {
    seedToolLoopAgent()
    currentModel = buildToolLoopStreamModel()
    const observer: AiAgentCallObserver = {
      onModelCallStart: (event) => {
        const tools = event.tools as Array<Record<string, unknown>> | undefined
        tools?.splice(0, tools.length)
        event.messages.splice(0, event.messages.length)
      },
    }
    const response = await runAiAgentText({
      agentId: 'customers.assistant',
      messages: baseMessages as never,
      authContext: baseAuth,
      observe: observer,
    })
    await response.text()
    const firstCall = currentModel.doStreamCalls[0] as unknown as { tools?: unknown[]; prompt: unknown[] }
    expect(firstCall.tools).toHaveLength(1)
    expect(firstCall.prompt.length).toBeGreaterThan(0)
  })

  it('chat: no observer leaves the SDK call free of call-level hooks', async () => {
    seedToolLoopAgent()
    currentModel = buildToolLoopStreamModel()
    const received: PreparedAiSdkOptions[] = []
    await runAiAgentText({
      agentId: 'customers.assistant',
      messages: baseMessages as never,
      authContext: baseAuth,
      generateText: async (options) => {
        received.push(options)
        return { toUIMessageStreamResponse: () => new Response('ok') } as never
      },
    })
    expect('onLanguageModelCallStart' in received[0]).toBe(false)
    expect('onLanguageModelCallEnd' in received[0]).toBe(false)
  })

  it('chat: hands call-level hooks to the generateText escape hatch when observing', async () => {
    seedToolLoopAgent()
    currentModel = buildToolLoopStreamModel()
    const received: PreparedAiSdkOptions[] = []
    const { observer } = buildRecordingObserver()
    await runAiAgentText({
      agentId: 'customers.assistant',
      messages: baseMessages as never,
      authContext: baseAuth,
      observe: observer,
      generateText: async (options) => {
        received.push(options)
        return { toUIMessageStreamResponse: () => new Response('ok') } as never
      },
    })
    expect(typeof received[0].onLanguageModelCallStart).toBe('function')
    expect(typeof received[0].onLanguageModelCallEnd).toBe('function')
  })

  it('object (generateObject): synthesizes one start/end pair with stepNumber 0 and the response format', async () => {
    seedAgentRegistryForTests([makeAgent({ executionMode: 'object', modelSettings: { temperature: 0.2 } })])
    currentModel = buildObjectModel()
    const { observer, starts, ends } = buildRecordingObserver()
    const result = await runAiAgentObject({
      agentId: 'customers.assistant',
      input: 'extract',
      authContext: baseAuth,
      output: objectOutput,
      callSettings: { seed: 7 },
      observe: observer,
    })
    expect(result.mode).toBe('generate')
    expect(starts).toHaveLength(1)
    expect(ends).toHaveLength(1)
    expect(starts[0]).toMatchObject({
      stepNumber: 0,
      provider: 'test-provider',
      modelId: 'provider-default-model',
      tools: undefined,
      callSettings: { temperature: 0.2, seed: 7 },
      responseFormat: { type: 'json', name: 'Product' },
    })
    expect(starts[0].system).toContain('System prompt base.')
    expect(starts[0].messages.length).toBeGreaterThan(0)
    expect(pickSentSettings(currentModel.doGenerateCalls[0] as unknown as Record<string, unknown>)).toEqual(
      starts[0].callSettings,
    )
    expect(ends[0]).toMatchObject({
      callId: starts[0].callId,
      finishReason: 'stop',
      usage: { inputTokens: 4, outputTokens: 2 },
      content: [{ type: 'text', text: JSON.stringify({ name: 'Widget' }) }],
    })
  })

  it('object (generateObject callback): synthesizes events around the caller-supplied call', async () => {
    seedAgentRegistryForTests([makeAgent({ executionMode: 'object' })])
    currentModel = buildObjectModel()
    const { observer, starts, ends } = buildRecordingObserver()
    await runAiAgentObject({
      agentId: 'customers.assistant',
      input: 'extract',
      authContext: baseAuth,
      output: objectOutput,
      observe: observer,
      generateObject: async () =>
        ({ object: { name: 'Gadget' }, finishReason: 'stop', usage: { inputTokens: 3, outputTokens: 1 } }) as never,
    })
    expect(starts).toHaveLength(1)
    expect(starts[0].stepNumber).toBe(0)
    expect(ends).toHaveLength(1)
    expect(ends[0]).toMatchObject({
      callId: starts[0].callId,
      finishReason: 'stop',
      usage: { inputTokens: 3, outputTokens: 1 },
      content: [{ type: 'text', text: JSON.stringify({ name: 'Gadget' }) }],
    })
  })

  it('object (generateObject): a throwing observer never fails the run', async () => {
    seedAgentRegistryForTests([makeAgent({ executionMode: 'object' })])
    currentModel = buildObjectModel()
    const result = await runAiAgentObject({
      agentId: 'customers.assistant',
      input: 'extract',
      authContext: baseAuth,
      output: objectOutput,
      observe: {
        onModelCallStart: async () => {
          throw new Error('[internal] observer start failure')
        },
        onModelCallEnd: () => {
          throw new Error('[internal] observer end failure')
        },
      },
    })
    expect(result.mode).toBe('generate')
    expect((result as { object: unknown }).object).toEqual({ name: 'Widget' })
  })
})
