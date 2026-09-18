/**
 * Regression tests for #5042 — `onStepFinish` on the tool-loop-agent path.
 *
 * The hook is wired once, at `ToolLoopAgent` construction. Passing it to
 * `.stream()` as well made the SDK merge both wirings without dedup, so
 * `BudgetEnforcer.recordStep` counted every tool call and every token twice and
 * aborted the turn before the final answer was streamed.
 */

const streamTextMock = jest.fn()
const stepCountIsMock = jest.fn((count: number) => ({ __kind: 'stepCount', count }))
const hasToolCallMock = jest.fn((name: string) => ({ __kind: 'hasToolCall', name }))
const convertToModelMessagesMock = jest.fn((messages: unknown) => messages)

type StepFinishHook = (event: unknown) => unknown

const toolLoopAgentSettings: Array<{ onStepFinish?: StepFinishHook }> = []
const toolLoopStreamOptions: Array<Record<string, unknown>> = []

function fakeStreamResult() {
  return {
    consumeStream: jest.fn(async () => undefined),
    toUIMessageStreamResponse: jest.fn(
      () =>
        new Response('streamed', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    ),
  }
}

jest.mock('ai', () => {
  const actual = jest.requireActual('ai')
  class FakeToolLoopAgent {
    constructor(settings: { onStepFinish?: StepFinishHook }) {
      toolLoopAgentSettings.push(settings)
    }

    async stream(options: Record<string, unknown>) {
      toolLoopStreamOptions.push(options)
      return fakeStreamResult()
    }
  }
  return {
    ...actual,
    streamText: (...args: unknown[]) => streamTextMock(...args),
    stepCountIs: (count: number) => stepCountIsMock(count),
    hasToolCall: (name: string) => hasToolCallMock(name),
    convertToModelMessages: (...args: unknown[]) => convertToModelMessagesMock(...args),
    Experimental_Agent: FakeToolLoopAgent,
  }
})

jest.mock('@open-mercato/shared/lib/ai/llm-provider-registry', () => ({
  llmProviderRegistry: {
    resolveFirstConfigured: () => ({
      id: 'test-provider',
      defaultModel: 'provider-default-model',
      resolveApiKey: () => 'test-api-key',
      createModel: (options: { modelId: string }) => ({ id: options.modelId }),
      isConfigured: () => true,
    }),
    get: () => null,
  },
}))

import type { AiAgentDefinition } from '../ai-agent-definition'
import {
  resetAgentRegistryForTests,
  seedAgentRegistryForTests,
} from '../agent-registry'
import { toolRegistry } from '../tool-registry'
import { runAiAgentText } from '../agent-runtime'

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

function toolLoopAgent(overrides: Partial<AiAgentDefinition> = {}): AiAgentDefinition {
  return {
    id: 'mod.tool_loop_agent',
    moduleId: 'mod',
    label: 'Tool loop agent',
    description: 'Tool loop agent description',
    systemPrompt: 'System prompt.',
    allowedTools: [],
    executionEngine: 'tool-loop-agent',
    ...overrides,
  }
}

describe('#5042: onStepFinish is wired once on the tool-loop-agent path', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    toolLoopAgentSettings.length = 0
    toolLoopStreamOptions.length = 0
    resetAgentRegistryForTests()
    toolRegistry.clear()
    streamTextMock.mockImplementation(() => fakeStreamResult())
  })

  afterAll(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  it('wires onStepFinish at construction and not again on stream()', async () => {
    seedAgentRegistryForTests([toolLoopAgent()])

    await runAiAgentText({
      agentId: 'mod.tool_loop_agent',
      messages: baseMessages as never,
      authContext: baseAuth,
    })

    expect(toolLoopAgentSettings).toHaveLength(1)
    expect(typeof toolLoopAgentSettings[0].onStepFinish).toBe('function')
    expect(toolLoopStreamOptions).toHaveLength(1)
    expect(toolLoopStreamOptions[0]).not.toHaveProperty('onStepFinish')
    expect(streamTextMock).not.toHaveBeenCalled()
  })

  it("delivers one caller callback per step when every SDK-side wiring fires", async () => {
    const callerOnStepFinish = jest.fn()
    seedAgentRegistryForTests([
      toolLoopAgent({ loop: { maxSteps: 4, onStepFinish: callerOnStepFinish } }),
    ])

    await runAiAgentText({
      agentId: 'mod.tool_loop_agent',
      messages: baseMessages as never,
      authContext: baseAuth,
    })

    const wirings: StepFinishHook[] = [
      ...toolLoopAgentSettings
        .map((settings) => settings.onStepFinish)
        .filter((hook): hook is StepFinishHook => typeof hook === 'function'),
      ...toolLoopStreamOptions
        .map((options) => options.onStepFinish)
        .filter((hook): hook is StepFinishHook => typeof hook === 'function'),
    ]
    expect(wirings).toHaveLength(1)

    const stepEvent = {
      usage: { inputTokens: 10, outputTokens: 5 },
      toolCalls: [{ toolName: 'mod.tool' }],
    }
    for (const wiring of wirings) await wiring(stepEvent)

    expect(callerOnStepFinish).toHaveBeenCalledTimes(1)
    expect(callerOnStepFinish).toHaveBeenCalledWith(stepEvent)
  })
})
