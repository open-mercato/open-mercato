const streamTextMock = jest.fn()
const generateTextMock = jest.fn()
const generateObjectMock = jest.fn()
const convertToModelMessagesMock = jest.fn((messages: unknown) => messages)
const recordAgentRunMock = jest.fn()

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

jest.mock('../agent-run-recorder', () => {
  const actual = jest.requireActual('../agent-run-recorder')
  return {
    ...actual,
    recordAgentRun: (...args: unknown[]) => recordAgentRunMock(...args),
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

import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import type { AiAgentDefinition, LoopTrace } from '../ai-agent-definition'
import type { AiToolDefinition } from '../types'
import type { PreparedAiSdkOptions } from '../agent-runtime'
import type { AgentRunRecordPayload } from '../agent-run-recorder'
import { resetAgentRegistryForTests, seedAgentRegistryForTests } from '../agent-registry'
import { toolRegistry, registerMcpTool } from '../tool-registry'
import { runAiAgentObject, runAiAgentText } from '../agent-runtime'

const SANITIZED_READ_TOOL = 'customers__read_deal'

const baseAuth = {
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  userId: 'user-1',
  features: ['*'],
  isSuperAdmin: true,
}

const baseMessages = [
  { role: 'user' as const, id: 'm1', parts: [{ type: 'text' as const, text: 'find the deal' }] },
]

const outputSchema = z.object({ verdict: z.string() })

const container = { resolve: () => null } as unknown as AwilixContainer

function makeTool(name: string): AiToolDefinition {
  return {
    name,
    description: `${name} description`,
    inputSchema: z.object({ id: z.string() }),
    handler: async () => ({ ok: true }),
  }
}

function makeAgent(executionMode: 'chat' | 'object', overrides: Partial<AiAgentDefinition> = {}): AiAgentDefinition {
  return {
    id: 'customers.run_agent',
    moduleId: 'customers',
    label: 'Run agent',
    description: 'Run agent description',
    systemPrompt: 'System prompt.',
    allowedTools: ['customers.read_deal'],
    mutationPolicy: 'read-only',
    executionMode,
    version: '1.2.0',
    ...(executionMode === 'object' ? { output: { schemaName: 'Verdict', schema: outputSchema } } : {}),
    ...overrides,
  }
}

function seedRegistry(executionMode: 'chat' | 'object'): void {
  registerMcpTool(makeTool('customers.read_deal'), { moduleId: 'customers' })
  seedAgentRegistryForTests([makeAgent(executionMode)])
}

function buildStepEvent(): Record<string, unknown> {
  return {
    toolCalls: [{ type: 'tool-call', toolCallId: 'call-1', toolName: SANITIZED_READ_TOOL, input: { id: 'd1' } }],
    toolResults: [
      { type: 'tool-result', toolCallId: 'call-1', toolName: SANITIZED_READ_TOOL, input: { id: 'd1' }, output: { ok: true } },
    ],
    text: 'Found it.',
    finishReason: 'tool-calls',
    usage: { inputTokens: 12, outputTokens: 3, cachedInputTokens: 2 },
    response: { modelId: 'provider-default-model' },
  }
}

function sseResponse(lines: string[]): Response {
  const body = lines.map((line) => `data: ${line}\n\n`).join('')
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

function callbackStreaming(
  lines: string[],
  captured: PreparedAiSdkOptions[],
): (options: PreparedAiSdkOptions) => Promise<never> {
  return async (options) => {
    captured.push(options)
    if (options.onStepFinish) await options.onStepFinish(buildStepEvent() as never)
    return { toUIMessageStreamResponse: () => sseResponse(lines) } as never
  }
}

async function waitForRecordCalls(expected: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (recordAgentRunMock.mock.calls.length >= expected) return
    await new Promise((resolve) => setImmediate(resolve))
  }
}

function recordedPayload(index = 0): AgentRunRecordPayload {
  return recordAgentRunMock.mock.calls[index][1] as AgentRunRecordPayload
}

describe('agent runtime run recording', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    recordAgentRunMock.mockResolvedValue(true)
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  afterAll(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  it('records a text run once with steps, tool calls and runId even when emitLoopTrace is off', async () => {
    seedRegistry('chat')
    const captured: PreparedAiSdkOptions[] = []
    const response = await runAiAgentText({
      agentId: 'customers.run_agent',
      messages: baseMessages as never,
      authContext: baseAuth,
      container,
      runId: 'run-text-1',
      sessionId: 'conversation-1',
      generateText: callbackStreaming(['{"type":"text-delta","delta":"Found it."}'], captured),
    })
    const body = await response.text()
    expect(body).toContain('text-delta')
    expect(body).not.toContain('loop-finish')
    await waitForRecordCalls(1)

    expect(recordAgentRunMock).toHaveBeenCalledTimes(1)
    expect(recordAgentRunMock.mock.calls[0][0]).toBe(container)
    const payload = recordedPayload()
    expect(payload.runId).toBe('run-text-1')
    expect(payload.status).toBe('completed')
    expect(payload.channel).toBe('internal')
    expect(payload.executionMode).toBe('chat')
    expect(payload.agentVersion).toBe('1.2.0')
    expect(payload.agentDefinitionHash).toMatch(/^sha256:/)
    expect(payload.tenantId).toBe('tenant-1')
    expect(payload.conversationId).toBe('conversation-1')
    expect(payload.userId).toBe('user-1')
    expect(payload.inputText).toBe('find the deal')
    expect(payload.outputText).toBe('Found it.')
    expect(payload.toolNames).toEqual(['customers.read_deal'])
    expect(payload.effectiveMutationPolicy).toBe('read-only')
    expect(payload.usage).toMatchObject({ inputTokens: 12, outputTokens: 3, cachedInputTokens: 2 })
    expect(payload.steps).toHaveLength(1)
    expect(payload.toolCalls).toEqual([
      expect.objectContaining({
        stepIndex: 0,
        callIndex: 0,
        toolCallId: 'call-1',
        toolName: 'customers.read_deal',
        isMutation: false,
        args: { id: 'd1' },
        result: { ok: true },
        error: null,
      }),
    ])
    expect(payload.modelParams).toMatchObject({ maxSteps: 10, modelSource: 'default' })

    const trace: LoopTrace = captured[0].finalizeLoopTrace()
    expect(trace.runId).toBe('run-text-1')
  })

  it('generates a runId and adds it to the loop-finish event when emitLoopTrace is on', async () => {
    seedRegistry('chat')
    const captured: PreparedAiSdkOptions[] = []
    const response = await runAiAgentText({
      agentId: 'customers.run_agent',
      messages: baseMessages as never,
      authContext: baseAuth,
      container,
      emitLoopTrace: true,
      trace: { channel: 'chat', correlationId: `  ${'c'.repeat(200)}  ` },
      generateText: callbackStreaming(['{"type":"text-delta","delta":"ok"}'], captured),
    })
    const body = await response.text()
    await waitForRecordCalls(1)
    const payload = recordedPayload()
    expect(payload.runId).toEqual(expect.any(String))
    expect(payload.channel).toBe('chat')
    expect(payload.correlationId).toBe('c'.repeat(128))
    expect(body).toContain('loop-finish')
    expect(body).toContain(`"runId":"${payload.runId}"`)
  })

  it('records the default stream-text path', async () => {
    seedRegistry('chat')
    streamTextMock.mockImplementation((args: { onStepFinish?: (event: unknown) => Promise<void> }) => ({
      toUIMessageStreamResponse: () => sseResponse(['{"type":"text-delta","delta":"hi"}']),
      consumeStream: async () => {
        if (args.onStepFinish) await args.onStepFinish(buildStepEvent())
      },
    }))
    const response = await runAiAgentText({
      agentId: 'customers.run_agent',
      messages: baseMessages as never,
      authContext: baseAuth,
      container,
      runId: 'run-stream-1',
    })
    await response.text()
    await waitForRecordCalls(1)
    expect(recordAgentRunMock).toHaveBeenCalledTimes(1)
    expect(recordedPayload().runId).toBe('run-stream-1')
    expect(recordedPayload().status).toBe('completed')
  })

  it('writes nothing when trace.persist is false', async () => {
    seedRegistry('chat')
    const observe = { onPromptResolved: jest.fn() }
    const response = await runAiAgentText({
      agentId: 'customers.run_agent',
      messages: baseMessages as never,
      authContext: baseAuth,
      container,
      trace: { persist: false },
      observe,
      generateText: callbackStreaming(['{"type":"text-delta","delta":"ok"}'], []),
    })
    await response.text()
    await waitForRecordCalls(1)
    expect(recordAgentRunMock).not.toHaveBeenCalled()
    expect(observe.onPromptResolved).toHaveBeenCalledTimes(1)
  })

  it('writes nothing when the capture level is off', async () => {
    seedRegistry('chat')
    const previous = process.env.OM_AI_RUN_TRACE_CAPTURE
    process.env.OM_AI_RUN_TRACE_CAPTURE = 'off'
    try {
      const response = await runAiAgentText({
        agentId: 'customers.run_agent',
        messages: baseMessages as never,
        authContext: baseAuth,
        container,
        generateText: callbackStreaming(['{"type":"text-delta","delta":"ok"}'], []),
      })
      await response.text()
      await waitForRecordCalls(1)
      expect(recordAgentRunMock).not.toHaveBeenCalled()
    } finally {
      if (previous === undefined) delete process.env.OM_AI_RUN_TRACE_CAPTURE
      else process.env.OM_AI_RUN_TRACE_CAPTURE = previous
    }
  })

  it('does not fail the run when the recorder fails', async () => {
    seedRegistry('chat')
    recordAgentRunMock.mockRejectedValue(new Error('database down'))
    const response = await runAiAgentText({
      agentId: 'customers.run_agent',
      messages: baseMessages as never,
      authContext: baseAuth,
      container,
      generateText: callbackStreaming(['{"type":"text-delta","delta":"still here"}'], []),
    })
    const body = await response.text()
    await waitForRecordCalls(1)
    expect(body).toContain('still here')
    expect(recordAgentRunMock).toHaveBeenCalledTimes(1)
  })

  it('records an aborted stream with the steps collected so far', async () => {
    seedRegistry('chat')
    const response = await runAiAgentText({
      agentId: 'customers.run_agent',
      messages: baseMessages as never,
      authContext: baseAuth,
      container,
      generateText: callbackStreaming(['{"type":"text-delta","delta":"partial"}', '{"type":"abort"}'], []),
    })
    await response.text()
    await waitForRecordCalls(1)
    const payload = recordedPayload()
    expect(payload.status).toBe('aborted')
    expect(payload.stopReason).toBe('abort')
    expect(payload.steps).toHaveLength(1)
  })

  it('records a failed stream when the stream carries an error part', async () => {
    seedRegistry('chat')
    const response = await runAiAgentText({
      agentId: 'customers.run_agent',
      messages: baseMessages as never,
      authContext: baseAuth,
      container,
      generateText: callbackStreaming(['{"type":"error","errorText":"provider exploded"}'], []),
    })
    await response.text()
    await waitForRecordCalls(1)
    const payload = recordedPayload()
    expect(payload.status).toBe('failed')
    expect(payload.error).toEqual({ code: 'stream_error', message: 'provider exploded' })
  })

  it('records a failed run and rethrows when the generateText callback throws', async () => {
    seedRegistry('chat')
    const failure = new Error('callback failed')
    await expect(
      runAiAgentText({
        agentId: 'customers.run_agent',
        messages: baseMessages as never,
        authContext: baseAuth,
        container,
        generateText: async () => {
          throw failure
        },
      }),
    ).rejects.toBe(failure)
    expect(recordAgentRunMock).toHaveBeenCalledTimes(1)
    expect(recordedPayload().status).toBe('failed')
  })

  it('records a completed object run and returns its runId', async () => {
    seedRegistry('object')
    generateObjectMock.mockResolvedValue({
      object: { verdict: 'approve' },
      finishReason: 'stop',
      usage: { inputTokens: 30, outputTokens: 5 },
    })
    const result = await runAiAgentObject({
      agentId: 'customers.run_agent',
      input: 'judge it',
      authContext: baseAuth,
      container,
      runId: 'run-object-1',
      trace: { channel: 'run-object', correlationId: 'corr-1' },
    })
    expect(result.mode).toBe('generate')
    expect(result.runId).toBe('run-object-1')
    expect(recordAgentRunMock).toHaveBeenCalledTimes(1)
    const payload = recordedPayload()
    expect(payload.runId).toBe('run-object-1')
    expect(payload.status).toBe('completed')
    expect(payload.executionMode).toBe('object')
    expect(payload.channel).toBe('run-object')
    expect(payload.correlationId).toBe('corr-1')
    expect(payload.outputText).toBe('{"verdict":"approve"}')
    expect(payload.inputText).toBe('judge it')
    expect(payload.usage).toMatchObject({ inputTokens: 30, outputTokens: 5 })
    expect(payload.steps).toHaveLength(1)
  })

  it('records a failed object run and rethrows the original error', async () => {
    seedRegistry('object')
    const failure = new Error('model unavailable')
    generateObjectMock.mockRejectedValue(failure)
    await expect(
      runAiAgentObject({
        agentId: 'customers.run_agent',
        input: 'judge it',
        authContext: baseAuth,
        container,
      }),
    ).rejects.toBe(failure)
    expect(recordAgentRunMock).toHaveBeenCalledTimes(1)
    const payload = recordedPayload()
    expect(payload.status).toBe('failed')
    expect(payload.channel).toBe('internal')
    expect(payload.error).toEqual({ code: 'Error', message: 'model unavailable' })
  })

  it('does not record an object run with persist false and still returns the result when the recorder resolves false', async () => {
    seedRegistry('object')
    generateObjectMock.mockResolvedValue({ object: { verdict: 'ok' }, finishReason: 'stop' })
    const skipped = await runAiAgentObject({
      agentId: 'customers.run_agent',
      input: 'judge it',
      authContext: baseAuth,
      container,
      trace: { persist: false },
    })
    expect(skipped.mode).toBe('generate')
    expect(recordAgentRunMock).not.toHaveBeenCalled()

    recordAgentRunMock.mockResolvedValue(false)
    const recorded = await runAiAgentObject({
      agentId: 'customers.run_agent',
      input: 'judge it',
      authContext: baseAuth,
      container,
    })
    expect(recorded.mode === 'generate' ? recorded.object : null).toEqual({ verdict: 'ok' })
    expect(recordAgentRunMock).toHaveBeenCalledTimes(1)
  })
})
