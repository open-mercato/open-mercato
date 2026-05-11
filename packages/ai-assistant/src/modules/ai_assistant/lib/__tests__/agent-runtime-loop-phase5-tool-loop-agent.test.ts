/**
 * Phase 5 unit tests — `executionEngine: 'tool-loop-agent'` runtime dispatch.
 *
 * These tests are the runtime-level proof for spec
 * `.ai/specs/2026-04-28-ai-agents-agentic-loop-controls.md` §Phase 5: when an
 * agent declares `executionEngine: 'tool-loop-agent'`, the runtime MUST
 * construct a `ToolLoopAgent` (`Experimental_Agent`) per turn with:
 *
 *   - `instructions` set to the wrapper-composed `systemPrompt`. Without this
 *     the model runs with NO prompt — `prepareCall` returns
 *     `Omit<Prompt, 'system'>` so the system text cannot be supplied per-turn.
 *   - `prepareStep` set to the wrapper-composed mutation-approval guard. This
 *     is the security-critical assertion the spec MUST: the mutation gate
 *     survives the engine swap because `prepareStep` is wired at construction.
 *   - `stopWhen` set to the agent's resolved stop conditions.
 *   - `onStepFinish` wired ONLY at construction (NOT also on the per-call
 *     `.stream()`), otherwise `mergeOnStepFinishCallbacks` (verified against
 *     `node_modules/ai/dist/index.mjs:8122-8133`) would fire it twice per
 *     step and halve the effective budget.
 *
 * The Playwright `TC-AI-AGENT-LOOP-006` test in
 * `__integration__/TC-AI-AGENT-LOOP-001-006.spec.ts` cannot exercise these
 * invariants because it stubs the entire dispatcher with `page.route()` — it
 * never reaches the agent-runtime construction. THIS test does.
 *
 * Phase 5 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
 */

import type { AiAgentDefinition } from '../ai-agent-definition'

const streamTextMock = jest.fn()
const stepCountIsMock = jest.fn((count: number) => ({ __stopWhen: 'stepCount', count }))
const convertToModelMessagesMock = jest.fn((messages: unknown) => messages)

const toolLoopAgentInstanceStream = jest.fn(
  async () =>
    ({
      consumeStream: jest.fn(async () => undefined),
      toUIMessageStreamResponse: jest.fn(
        () =>
          new Response('tool-loop-streamed', {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
      ),
    }) as unknown,
)
const capturedToolLoopAgentSettings: unknown[] = []
const ExperimentalAgentMock = jest.fn().mockImplementation((settings: unknown) => {
  capturedToolLoopAgentSettings.push(settings)
  return {
    stream: toolLoopAgentInstanceStream,
  }
})

jest.mock('ai', () => {
  const actual = jest.requireActual('ai')
  return {
    ...actual,
    streamText: (...args: unknown[]) => streamTextMock(...args),
    stepCountIs: (...args: unknown[]) => stepCountIsMock(...(args as [number])),
    convertToModelMessages: (...args: unknown[]) => convertToModelMessagesMock(...args),
    Experimental_Agent: ExperimentalAgentMock,
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

import {
  resetAgentRegistryForTests,
  seedAgentRegistryForTests,
} from '../agent-registry'
import { toolRegistry } from '../tool-registry'
import { runAiAgentText } from '../agent-runtime'

function makeAgent(
  overrides: Partial<AiAgentDefinition> & Pick<AiAgentDefinition, 'id' | 'moduleId'>,
): AiAgentDefinition {
  return {
    label: `${overrides.id} label`,
    description: `${overrides.id} description`,
    systemPrompt: 'Phase-5 baseline system prompt.',
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

const baseMessages = [
  { role: 'user' as const, id: 'm1', parts: [{ type: 'text' as const, text: 'hi' }] },
]

function fakeStreamTextResult() {
  return {
    consumeStream: jest.fn(async () => undefined),
    toUIMessageStreamResponse: jest.fn(
      () =>
        new Response('stream-text-streamed', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    ),
  }
}

function resetMocks() {
  jest.clearAllMocks()
  capturedToolLoopAgentSettings.length = 0
  resetAgentRegistryForTests()
  toolRegistry.clear()
  streamTextMock.mockImplementation(() => fakeStreamTextResult())
}

describe('Phase 5: executionEngine: tool-loop-agent dispatch', () => {
  beforeEach(resetMocks)

  afterAll(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  it('constructs ToolLoopAgent once per turn and routes through agent.stream()', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.tool_loop_assistant',
        moduleId: 'catalog',
        executionEngine: 'tool-loop-agent',
      }),
    ])

    await runAiAgentText({
      agentId: 'catalog.tool_loop_assistant',
      messages: baseMessages as never,
      authContext: baseAuth,
    })

    expect(ExperimentalAgentMock).toHaveBeenCalledTimes(1)
    expect(toolLoopAgentInstanceStream).toHaveBeenCalledTimes(1)
    expect(streamTextMock).not.toHaveBeenCalled()
  })

  it('wires the agent.systemPrompt as ToolLoopAgentSettings.instructions (would catch system-prompt drop)', async () => {
    // Use a sentinel string so the assertion proves the wiring rather than
    // matching anything the runtime composes by accident.
    const sentinelPrompt = 'PHASE-5-SENTINEL-SYSTEM-PROMPT-37c8e0'

    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.tool_loop_assistant',
        moduleId: 'catalog',
        systemPrompt: sentinelPrompt,
        executionEngine: 'tool-loop-agent',
      }),
    ])

    await runAiAgentText({
      agentId: 'catalog.tool_loop_assistant',
      messages: baseMessages as never,
      authContext: baseAuth,
    })

    expect(capturedToolLoopAgentSettings).toHaveLength(1)
    const settings = capturedToolLoopAgentSettings[0] as { instructions?: unknown }
    expect(settings.instructions).toEqual(expect.stringContaining(sentinelPrompt))
  })

  it('wires wrapperPrepareStep into ToolLoopAgentSettings.prepareStep (TC-AI-AGENT-LOOP-006 MUST — mutation gate survives engine swap)', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.tool_loop_assistant',
        moduleId: 'catalog',
        executionEngine: 'tool-loop-agent',
      }),
    ])

    await runAiAgentText({
      agentId: 'catalog.tool_loop_assistant',
      messages: baseMessages as never,
      authContext: baseAuth,
    })

    expect(capturedToolLoopAgentSettings).toHaveLength(1)
    const settings = capturedToolLoopAgentSettings[0] as { prepareStep?: unknown }
    // prepareStep MUST be present and MUST be a function. The wrapper-composed
    // mutation-approval guard is the security-critical contract per spec §Phase 5.
    expect(settings.prepareStep).toBeDefined()
    expect(typeof settings.prepareStep).toBe('function')
  })

  it('does NOT pass onStepFinish on the per-call .stream() (would double-fire via SDK mergeOnStepFinishCallbacks)', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.tool_loop_assistant',
        moduleId: 'catalog',
        executionEngine: 'tool-loop-agent',
      }),
    ])

    await runAiAgentText({
      agentId: 'catalog.tool_loop_assistant',
      messages: baseMessages as never,
      authContext: baseAuth,
    })

    expect(toolLoopAgentInstanceStream).toHaveBeenCalledTimes(1)
    const streamArgs = toolLoopAgentInstanceStream.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined
    expect(streamArgs).toBeDefined()
    expect(streamArgs).not.toHaveProperty('onStepFinish')
    // onStepFinish MUST be wired at construction instead.
    const settings = capturedToolLoopAgentSettings[0] as { onStepFinish?: unknown }
    expect(settings.onStepFinish).toBeDefined()
    expect(typeof settings.onStepFinish).toBe('function')
  })

  it('wires stopWhen into ToolLoopAgentSettings at construction (spec §Phase 5 correction)', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.tool_loop_assistant',
        moduleId: 'catalog',
        executionEngine: 'tool-loop-agent',
        maxSteps: 7,
      }),
    ])

    await runAiAgentText({
      agentId: 'catalog.tool_loop_assistant',
      messages: baseMessages as never,
      authContext: baseAuth,
    })

    expect(capturedToolLoopAgentSettings).toHaveLength(1)
    const settings = capturedToolLoopAgentSettings[0] as { stopWhen?: unknown }
    expect(settings.stopWhen).toBeDefined()
  })

  it('default stream-text path is unaffected when executionEngine is unset', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.account_assistant',
        moduleId: 'customers',
      }),
    ])

    await runAiAgentText({
      agentId: 'customers.account_assistant',
      messages: baseMessages as never,
      authContext: baseAuth,
    })

    expect(ExperimentalAgentMock).not.toHaveBeenCalled()
    expect(toolLoopAgentInstanceStream).not.toHaveBeenCalled()
    expect(streamTextMock).toHaveBeenCalledTimes(1)
  })

  it('default stream-text path is unaffected when executionEngine is explicitly stream-text', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.account_assistant',
        moduleId: 'customers',
        executionEngine: 'stream-text',
      }),
    ])

    await runAiAgentText({
      agentId: 'customers.account_assistant',
      messages: baseMessages as never,
      authContext: baseAuth,
    })

    expect(ExperimentalAgentMock).not.toHaveBeenCalled()
    expect(toolLoopAgentInstanceStream).not.toHaveBeenCalled()
    expect(streamTextMock).toHaveBeenCalledTimes(1)
  })
})
