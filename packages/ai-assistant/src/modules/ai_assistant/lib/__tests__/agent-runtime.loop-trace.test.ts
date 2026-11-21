const streamTextMock = jest.fn()
const generateTextMock = jest.fn()
const generateObjectMock = jest.fn()
const convertToModelMessagesMock = jest.fn((messages: unknown) => messages)

jest.mock('ai', () => {
  const actual = jest.requireActual('ai')
  return {
    ...actual,
    streamText: (...args: unknown[]) => streamTextMock(...args),
    generateText: (...args: unknown[]) => generateTextMock(...args),
    generateObject: (...args: unknown[]) => generateObjectMock(...args),
    convertToModelMessages: (...args: unknown[]) => convertToModelMessagesMock(...args),
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

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: () => null,
  })),
}))

jest.mock('../tool-executor', () => ({
  executeTool: jest.fn(async (name: string, args: unknown, context: unknown) => {
    const { toolRegistry: registry } = await import('../tool-registry')
    const registered = registry.getTool(name)
    if (!registered) return { success: false, error: `Tool "${name}" not found` }
    const result = await registered.handler(args as never, context as never)
    return { success: true, result }
  }),
}))

import { z } from 'zod'
import type { AiAgentDefinition, LoopStepRecord } from '../ai-agent-definition'
import type { AiToolDefinition } from '../types'
import type { PreparedAiSdkOptions } from '../agent-runtime'
import { resetAgentRegistryForTests, seedAgentRegistryForTests } from '../agent-registry'
import { toolRegistry, registerMcpTool } from '../tool-registry'
import { runAiAgentObject, runAiAgentText } from '../agent-runtime'

const TOOL_DELAY_MS = 25
const SANITIZED_READ_TOOL = 'customers__read_deal'

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

const outputSchema = z.object({ verdict: z.string() })

function makeTool(
  overrides: Partial<AiToolDefinition> & Pick<AiToolDefinition, 'name'>,
): AiToolDefinition {
  return {
    description: `${overrides.name} description`,
    inputSchema: z.object({ id: z.string() }),
    handler: async () => {
      await new Promise((resolve) => setTimeout(resolve, TOOL_DELAY_MS))
      return { ok: true }
    },
    ...overrides,
  }
}

function makeAgent(
  overrides: Partial<AiAgentDefinition> & Pick<AiAgentDefinition, 'id' | 'moduleId'>,
): AiAgentDefinition {
  return {
    label: `${overrides.id} label`,
    description: `${overrides.id} description`,
    systemPrompt: 'System prompt.',
    allowedTools: ['customers.read_deal', 'customers.read_contact'],
    mutationPolicy: 'read-only',
    ...overrides,
  }
}

function seedRegistry(executionMode: 'chat' | 'object'): void {
  registerMcpTool(makeTool({ name: 'customers.read_deal' }), { moduleId: 'customers' })
  registerMcpTool(makeTool({ name: 'customers.read_contact' }), { moduleId: 'customers' })
  seedAgentRegistryForTests([
    makeAgent({
      id: 'customers.trace_agent',
      moduleId: 'customers',
      executionMode,
      ...(executionMode === 'object'
        ? { output: { schemaName: 'Verdict', schema: outputSchema } }
        : {}),
    }),
  ])
}

type ExecutableTool = {
  execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>
}

async function executeReadTool(tools: unknown): Promise<unknown> {
  const tool = (tools as Record<string, ExecutableTool>)[SANITIZED_READ_TOOL]
  return tool.execute({ id: 'd1' }, { toolCallId: 'call-ok' })
}

function buildSdk7StepEvent(output: unknown): Record<string, unknown> {
  return {
    toolCalls: [
      { type: 'tool-call', toolCallId: 'call-ok', toolName: SANITIZED_READ_TOOL, input: { id: 'd1' } },
      { type: 'tool-call', toolCallId: 'call-err', toolName: 'customers__read_contact', input: { id: 'c1' } },
    ],
    toolResults: [
      { type: 'tool-result', toolCallId: 'call-ok', toolName: SANITIZED_READ_TOOL, input: { id: 'd1' }, output },
    ],
    content: [
      {
        type: 'tool-error',
        toolCallId: 'call-err',
        toolName: 'customers__read_contact',
        input: { id: 'c1' },
        error: { name: 'NotFound', message: 'Contact missing' },
      },
    ],
    text: '',
    finishReason: 'tool-calls',
    usage: { inputTokens: 20, outputTokens: 4 },
    response: { modelId: 'provider-default-model' },
  }
}

function expectSdk7ToolCalls(step: LoopStepRecord, output: unknown): void {
  expect(step.toolCalls).toHaveLength(2)
  const [okCall, errorCall] = step.toolCalls
  expect(okCall.toolCallId).toBe('call-ok')
  expect(okCall.toolName).toBe('customers.read_deal')
  expect(okCall.args).toEqual({ id: 'd1' })
  expect(okCall.result).toBe(output)
  expect(okCall.result).toEqual(expect.stringContaining('"ok"'))
  expect(okCall.error).toBeUndefined()
  expect(okCall.durationMs).toBeGreaterThanOrEqual(TOOL_DELAY_MS - 5)
  expect(errorCall.toolCallId).toBe('call-err')
  expect(errorCall.toolName).toBe('customers.read_contact')
  expect(errorCall.args).toEqual({ id: 'c1' })
  expect(errorCall.error).toEqual({ code: 'NotFound', message: 'Contact missing' })
  expect(errorCall.durationMs).toBe(0)
  expect(step.usage).toEqual({ inputTokens: 20, outputTokens: 4 })
  expect(step.finishReason).toBe('tool-calls')
  expect(step.modelId).toBe('provider-default-model')
}

describe('loop trace built from AI SDK 7 step events', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  afterAll(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  it('records args, results, errors, toolCallId and timed durations in chat mode', async () => {
    seedRegistry('chat')
    const captured: PreparedAiSdkOptions[] = []
    let toolOutput: unknown

    await runAiAgentText({
      agentId: 'customers.trace_agent',
      messages: baseMessages as never,
      authContext: baseAuth,
      generateText: async (options) => {
        captured.push(options)
        toolOutput = await executeReadTool(options.tools)
        if (options.onStepFinish) {
          await options.onStepFinish(buildSdk7StepEvent(toolOutput) as never)
        }
        return {
          toUIMessageStreamResponse: () =>
            new Response('streamed', {
              status: 200,
              headers: { 'Content-Type': 'text/event-stream' },
            }),
        } as never
      },
    })

    expect(captured).toHaveLength(1)
    const trace = captured[0].finalizeLoopTrace()
    expect(trace.steps).toHaveLength(1)
    expectSdk7ToolCalls(trace.steps[0], toolOutput)
  })

  it('records args, results, errors, toolCallId and timed durations in object tool-loop mode', async () => {
    seedRegistry('object')
    let toolOutput: unknown
    generateTextMock.mockImplementation(
      async (args: { tools: unknown; onStepFinish?: (event: unknown) => Promise<void> }) => {
        toolOutput = await executeReadTool(args.tools)
        if (args.onStepFinish) await args.onStepFinish(buildSdk7StepEvent(toolOutput))
        return {
          output: { verdict: 'ok' },
          finishReason: 'stop',
          usage: { inputTokens: 20, outputTokens: 4 },
        }
      },
    )

    const result = await runAiAgentObject({
      agentId: 'customers.trace_agent',
      input: 'judge it',
      authContext: baseAuth,
      enableTools: true,
    })

    expect(result.mode).toBe('generate')
    const steps = (result as { steps?: LoopStepRecord[] }).steps
    expect(steps).toHaveLength(1)
    expectSdk7ToolCalls((steps as LoopStepRecord[])[0], toolOutput)
  })
})
