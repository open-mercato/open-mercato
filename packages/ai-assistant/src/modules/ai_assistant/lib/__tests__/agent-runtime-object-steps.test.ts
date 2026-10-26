import type { AiAgentDefinition } from '../ai-agent-definition'
import type { AiToolDefinition } from '../types'

const generateObjectMock = jest.fn()
const generateTextMock = jest.fn()
const stepCountIsMock = jest.fn((count: number) => ({ __stopWhen: 'stepCount', count }))
const convertToModelMessagesMock = jest.fn((messages: unknown) => messages)

jest.mock('ai', () => {
  const actual = jest.requireActual('ai')
  return {
    ...actual,
    generateObject: (...args: unknown[]) => generateObjectMock(...args),
    generateText: (...args: unknown[]) => generateTextMock(...args),
    stepCountIs: (...args: unknown[]) => stepCountIsMock(...(args as [number])),
    convertToModelMessages: (...args: unknown[]) => convertToModelMessagesMock(...args),
  }
})

const createModelMock = jest.fn(
  (options: { modelId: string; apiKey: string }) => ({ id: options.modelId, apiKey: options.apiKey }),
)

jest.mock('@open-mercato/shared/lib/ai/llm-provider-registry', () => ({
  llmProviderRegistry: {
    resolveFirstConfigured: () => ({
      id: 'test-provider',
      defaultModel: 'provider-default-model',
      resolveApiKey: () => 'test-api-key',
      createModel: createModelMock,
      isConfigured: () => true,
    }),
  },
}))

import { z } from 'zod'
import { resetAgentRegistryForTests, seedAgentRegistryForTests } from '../agent-registry'
import { toolRegistry, registerMcpTool } from '../tool-registry'
import { runAiAgentObject } from '../agent-runtime'

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

const outputSchema = z.object({ verdict: z.string() })

function seedToolLoopAgent(): void {
  registerMcpTool(makeTool({ name: 'customers.read_deal' }), { moduleId: 'customers' })
  seedAgentRegistryForTests([
    makeAgent({
      id: 'customers.object_agent',
      moduleId: 'customers',
      executionMode: 'object',
      mutationPolicy: 'read-only',
      allowedTools: ['customers.read_deal'],
      output: { schemaName: 'Verdict', schema: outputSchema },
    }),
  ])
}

type StepFinishEvent = {
  toolCalls?: unknown[]
  text?: string
  finishReason?: string
  usage?: { inputTokens?: number; outputTokens?: number }
  response?: { modelId?: string }
}

/**
 * Simulates the AI SDK tool loop: invokes the wired `onStepFinish` once per
 * fake step before resolving, mirroring generateText's per-step callbacks.
 */
function mockGenerateTextWithSteps(steps: StepFinishEvent[]): void {
  generateTextMock.mockImplementation(async (args: { onStepFinish?: (event: unknown) => Promise<void> }) => {
    for (const step of steps) {
      if (args.onStepFinish) await args.onStepFinish(step)
    }
    return {
      output: { verdict: 'ok' },
      finishReason: 'stop',
      usage: { inputTokens: 30, outputTokens: 12 },
    }
  })
}

describe('runAiAgentObject enableTools branch — per-step exposure (native-runtime Phase 1)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  afterAll(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  it('returns per-step LoopStepRecord entries from the tool loop', async () => {
    seedToolLoopAgent()
    mockGenerateTextWithSteps([
      {
        toolCalls: [{ toolName: 'customers__read_deal', args: { id: 'd1' }, result: { ok: true } }],
        text: '',
        finishReason: 'tool-calls',
        usage: { inputTokens: 20, outputTokens: 4 },
        response: { modelId: 'provider-default-model' },
      },
      {
        toolCalls: [],
        text: 'final',
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 8 },
        response: { modelId: 'provider-default-model' },
      },
    ])

    const result = await runAiAgentObject({
      agentId: 'customers.object_agent',
      input: 'judge',
      authContext: baseAuth,
      enableTools: true,
    })

    expect(result.mode).toBe('generate')
    if (result.mode !== 'generate') throw new Error('unreachable')
    expect(result.object).toEqual({ verdict: 'ok' })
    expect(result.steps).toHaveLength(2)
    expect(result.steps?.[0]).toMatchObject({
      stepIndex: 0,
      finishReason: 'tool-calls',
      usage: { inputTokens: 20, outputTokens: 4 },
    })
    expect(result.steps?.[0]?.toolCalls[0]).toMatchObject({
      toolName: 'customers.read_deal',
      args: { id: 'd1' },
    })
    expect(result.steps?.[1]).toMatchObject({
      stepIndex: 1,
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 8 },
    })
  })

  it('forwards the caller loop.onStepFinish (previously dropped in object mode)', async () => {
    seedToolLoopAgent()
    mockGenerateTextWithSteps([
      { toolCalls: [], text: 'a', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } },
    ])
    const userOnStepFinish = jest.fn(async () => undefined)

    await runAiAgentObject({
      agentId: 'customers.object_agent',
      input: 'judge',
      authContext: baseAuth,
      enableTools: true,
      loop: { onStepFinish: userOnStepFinish },
    })

    expect(userOnStepFinish).toHaveBeenCalledTimes(1)
  })

  it('a throwing caller onStepFinish never aborts the turn', async () => {
    seedToolLoopAgent()
    mockGenerateTextWithSteps([
      { toolCalls: [], text: 'a', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } },
    ])
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const result = await runAiAgentObject({
        agentId: 'customers.object_agent',
        input: 'judge',
        authContext: baseAuth,
        enableTools: true,
        loop: {
          onStepFinish: async () => {
            throw new Error('caller hook exploded')
          },
        },
      })
      expect(result.mode).toBe('generate')
      if (result.mode !== 'generate') throw new Error('unreachable')
      expect(result.object).toEqual({ verdict: 'ok' })
    } finally {
      consoleError.mockRestore()
    }
  })

  it('regression: callers without loop options observe the same object/finishReason/usage as before', async () => {
    seedToolLoopAgent()
    mockGenerateTextWithSteps([])

    const result = await runAiAgentObject({
      agentId: 'customers.object_agent',
      input: 'judge',
      authContext: baseAuth,
      enableTools: true,
    })

    expect(result.mode).toBe('generate')
    if (result.mode !== 'generate') throw new Error('unreachable')
    expect(result.object).toEqual({ verdict: 'ok' })
    expect(result.finishReason).toBe('stop')
    expect(result.usage).toEqual({ inputTokens: 30, outputTokens: 12 })
    expect(result.steps).toEqual([])
    const callArg = generateTextMock.mock.calls[0][0] as Record<string, unknown>
    expect(typeof callArg.onStepFinish).toBe('function')
    expect(callArg.tools).toBeDefined()
    expect(callArg.output).toBeDefined()
  })

  it('regression: the toolless generateObject path is byte-for-byte unchanged (no steps field)', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.toolless_agent',
        moduleId: 'customers',
        executionMode: 'object',
        mutationPolicy: 'read-only',
        output: { schemaName: 'Verdict', schema: outputSchema },
      }),
    ])
    generateObjectMock.mockResolvedValue({
      object: { verdict: 'plain' },
      finishReason: 'stop',
      usage: { inputTokens: 5, outputTokens: 2 },
    })

    const result = await runAiAgentObject({
      agentId: 'customers.toolless_agent',
      input: 'judge',
      authContext: baseAuth,
      enableTools: true,
    })

    expect(generateTextMock).not.toHaveBeenCalled()
    expect(result.mode).toBe('generate')
    if (result.mode !== 'generate') throw new Error('unreachable')
    expect(result.object).toEqual({ verdict: 'plain' })
    expect('steps' in result && result.steps !== undefined).toBe(false)
  })
})
