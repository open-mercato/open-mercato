import type { AwilixContainer } from 'awilix'
import {
  buildAgentRunModelParams,
  createAgentRunRecorderObserver,
  recordAgentRun,
  resolveAgentRunCaptureConfig,
  type AgentRunRecordPayload,
} from '../agent-run-recorder'
import { composeCallObservers } from '../agent-call-observer'
import { AiAgentRun, AiAgentRunStep, AiAgentRunToolCall } from '../../data/entities'
import type { AiAgentModelCallEndEvent, AiAgentModelCallStartEvent } from '../agent-call-contract'

const mockReportError = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

const testLogger = jest
  .requireMock('@open-mercato/shared/lib/logger')
  .createLogger('test') as Record<'debug' | 'info' | 'warn' | 'error', jest.Mock>

type CreatedRow = { entity: unknown; data: Record<string, unknown> }

function makeContainer(options: { flushThrows?: boolean; resolveThrows?: boolean } = {}) {
  const created: CreatedRow[] = []
  const persisted: unknown[] = []
  const flush = jest.fn(async () => {
    if (options.flushThrows) throw new Error('DB write failed')
  })
  const tx = {
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      created.push({ entity, data })
      return data
    }),
    persist: jest.fn((row: unknown) => {
      persisted.push(row)
      return tx
    }),
    flush,
  }
  const transactional = jest.fn(async (work: (manager: typeof tx) => Promise<void>) => work(tx))
  const forked = { transactional }
  const em = { fork: jest.fn(() => forked) }
  const container = {
    resolve: (name: string) => {
      if (options.resolveThrows) throw new Error('container unavailable')
      if (name === 'em') return em
      throw new Error(`Unknown token: ${name}`)
    },
  } as unknown as Pick<AwilixContainer, 'resolve'>
  const rowsOf = (entity: unknown) => created.filter((row) => row.entity === entity).map((row) => row.data)
  return { container, em, transactional, flush, created, persisted, rowsOf }
}

function makePayload(overrides: Partial<AgentRunRecordPayload> = {}): AgentRunRecordPayload {
  return {
    runId: '00000000-0000-4000-8000-000000000001',
    tenantId: '00000000-0000-4000-8000-0000000000a1',
    organizationId: '00000000-0000-4000-8000-0000000000b1',
    userId: '00000000-0000-4000-8000-0000000000c1',
    apiKeyId: null,
    agentId: 'catalog.assistant',
    moduleId: 'catalog',
    agentVersion: '1.2.0',
    agentDefinitionHash: 'sha256:definition',
    promptOverride: { id: '00000000-0000-4000-8000-0000000000d1', version: 3 },
    executionMode: 'chat',
    effectiveMutationPolicy: 'read-only',
    toolNames: ['catalog.list_products', 'catalog.update_product'],
    channel: 'chat',
    conversationId: 'conversation-1',
    turnId: '00000000-0000-4000-8000-0000000000e1',
    correlationId: 'correlation-1',
    providerId: 'openai',
    modelId: 'gpt-5-mini',
    baseUrlHost: 'api.openai.com',
    modelParams: { maxSteps: 5 },
    status: 'completed',
    stopReason: 'finish-reason',
    finishReason: 'stop',
    usage: { inputTokens: 120, outputTokens: 40, cachedInputTokens: 10, reasoningTokens: null },
    startedAt: new Date('2026-10-26T10:00:00.000Z'),
    completedAt: new Date('2026-10-26T10:00:02.500Z'),
    inputText: 'List products',
    outputText: 'Here are the products',
    systemPrompt: 'You are the catalog assistant.',
    citations: null,
    error: null,
    steps: [
      {
        stepIndex: 0,
        modelId: 'gpt-5-mini',
        finishReason: 'tool-calls',
        inputTokens: 60,
        outputTokens: 20,
        text: 'Looking up products',
        endedAt: new Date('2026-10-26T10:00:01.000Z'),
        durationMs: 1000,
      },
    ],
    toolCalls: [
      {
        stepIndex: 0,
        callIndex: 0,
        toolCallId: 'call-1',
        toolName: 'catalog.list_products',
        isMutation: false,
        pendingActionId: null,
        args: { query: 'shoes', limit: 5 },
        result: { items: [{ id: 'product-1' }] },
        error: null,
        durationMs: 120,
      },
    ],
    ...overrides,
  }
}

const fullEnv = {}

beforeEach(() => {
  mockReportError.mockReset()
  testLogger.warn.mockReset()
  testLogger.error.mockReset()
})

describe('resolveAgentRunCaptureConfig', () => {
  it('defaults to full capture, 16384 bytes and no prompt capture', () => {
    expect(resolveAgentRunCaptureConfig({})).toEqual({
      level: 'full',
      maxPayloadBytes: 16384,
      capturePrompt: false,
    })
  })

  it('reads level, payload cap and prompt flag from env', () => {
    expect(
      resolveAgentRunCaptureConfig({
        OM_AI_RUN_TRACE_CAPTURE: 'METADATA',
        OM_AI_RUN_TRACE_MAX_PAYLOAD_BYTES: '256',
        OM_AI_RUN_TRACE_CAPTURE_PROMPT: 'on',
      }),
    ).toEqual({ level: 'metadata', maxPayloadBytes: 256, capturePrompt: true })
  })

  it('falls back on unknown level and invalid payload cap', () => {
    expect(
      resolveAgentRunCaptureConfig({ OM_AI_RUN_TRACE_CAPTURE: 'verbose', OM_AI_RUN_TRACE_MAX_PAYLOAD_BYTES: 'abc' }),
    ).toEqual({ level: 'full', maxPayloadBytes: 16384, capturePrompt: false })
  })
})

describe('recordAgentRun', () => {
  it('writes run, steps and tool calls with content at the full level in one transaction', async () => {
    const harness = makeContainer()
    const recorded = await recordAgentRun(harness.container, makePayload(), fullEnv)

    expect(recorded).toBe(true)
    expect(harness.em.fork).toHaveBeenCalledTimes(1)
    expect(harness.transactional).toHaveBeenCalledTimes(1)
    expect(harness.flush).toHaveBeenCalledTimes(1)
    expect(harness.persisted).toHaveLength(3)

    const [run] = harness.rowsOf(AiAgentRun)
    expect(run).toMatchObject({
      id: '00000000-0000-4000-8000-000000000001',
      tenantId: '00000000-0000-4000-8000-0000000000a1',
      agentId: 'catalog.assistant',
      agentVersion: '1.2.0',
      promptOverrideId: '00000000-0000-4000-8000-0000000000d1',
      promptOverrideVersion: 3,
      channel: 'chat',
      status: 'completed',
      inputTokens: 120,
      outputTokens: 40,
      cachedInputTokens: 10,
      reasoningTokens: null,
      stepCount: 1,
      toolCallCount: 1,
      durationMs: 2500,
      inputText: 'List products',
      outputText: 'Here are the products',
      contentTruncated: false,
      systemPrompt: null,
      captureLevel: 'full',
      errorCode: null,
      errorMessage: null,
    })
    expect(run.systemPromptHash).toMatch(/^sha256:[0-9a-f]{64}$/)

    const [step] = harness.rowsOf(AiAgentRunStep)
    expect(step).toMatchObject({ runId: run.id, stepIndex: 0, text: 'Looking up products', textTruncated: false })

    const [toolCall] = harness.rowsOf(AiAgentRunToolCall)
    expect(toolCall).toMatchObject({
      runId: run.id,
      toolName: 'catalog.list_products',
      argKeys: ['query', 'limit'],
      args: { query: 'shoes', limit: 5 },
      result: { items: [{ id: 'product-1' }] },
      argsTruncated: false,
      resultTruncated: false,
    })
    expect(toolCall.resultBytes).toBe(Buffer.byteLength(JSON.stringify({ items: [{ id: 'product-1' }] })))
  })

  it('drops every content field at the metadata level but keeps keys, sizes, timings and error codes', async () => {
    const harness = makeContainer()
    const payload = makePayload({
      status: 'failed',
      error: { code: 'provider_error', message: 'Upstream said no' },
      citations: [{ title: 'Source' }],
      toolCalls: [
        {
          ...makePayload().toolCalls[0],
          error: { code: 'tool_failed', message: 'Tool blew up' },
        },
      ],
    })
    await recordAgentRun(harness.container, payload, {
      OM_AI_RUN_TRACE_CAPTURE: 'metadata',
      OM_AI_RUN_TRACE_CAPTURE_PROMPT: 'true',
    })

    const [run] = harness.rowsOf(AiAgentRun)
    expect(run).toMatchObject({
      captureLevel: 'metadata',
      inputText: null,
      outputText: null,
      systemPrompt: null,
      citations: null,
      errorCode: 'provider_error',
      errorMessage: null,
      inputTokens: 120,
      durationMs: 2500,
    })
    expect(run.systemPromptHash).toMatch(/^sha256:[0-9a-f]{64}$/)

    const [step] = harness.rowsOf(AiAgentRunStep)
    expect(step).toMatchObject({ text: null, textTruncated: false, durationMs: 1000, inputTokens: 60 })

    const [toolCall] = harness.rowsOf(AiAgentRunToolCall)
    expect(toolCall).toMatchObject({
      argKeys: ['query', 'limit'],
      args: null,
      result: null,
      errorCode: 'tool_failed',
      errorMessage: null,
      durationMs: 120,
    })
    expect(toolCall.resultBytes).toBeGreaterThan(0)
  })

  it('caps oversized content and sets the truncation flags', async () => {
    const harness = makeContainer()
    const longText = 'x'.repeat(200)
    await recordAgentRun(
      harness.container,
      makePayload({
        inputText: longText,
        steps: [{ ...makePayload().steps[0], text: longText }],
        toolCalls: [
          {
            ...makePayload().toolCalls[0],
            args: { body: longText },
            result: { body: longText },
            error: { code: 'tool_failed', message: longText },
          },
        ],
      }),
      { OM_AI_RUN_TRACE_MAX_PAYLOAD_BYTES: '32' },
    )

    const [run] = harness.rowsOf(AiAgentRun)
    expect(run.contentTruncated).toBe(true)
    expect(run.inputText).toHaveLength(32)
    expect(run.outputText).toBe('Here are the products')

    const [step] = harness.rowsOf(AiAgentRunStep)
    expect(step).toMatchObject({ textTruncated: true })
    expect(step.text).toHaveLength(32)

    const [toolCall] = harness.rowsOf(AiAgentRunToolCall)
    expect(toolCall).toMatchObject({ argsTruncated: true, resultTruncated: true, argKeys: ['body'] })
    expect(typeof toolCall.args).toBe('string')
    expect(toolCall.errorMessage).toHaveLength(32)
    expect(toolCall.resultBytes).toBe(Buffer.byteLength(JSON.stringify({ body: longText })))
  })

  it('stores the system prompt only when prompt capture is enabled', async () => {
    const withoutFlag = makeContainer()
    await recordAgentRun(withoutFlag.container, makePayload(), {})
    expect(withoutFlag.rowsOf(AiAgentRun)[0].systemPrompt).toBeNull()

    const withFlag = makeContainer()
    await recordAgentRun(withFlag.container, makePayload(), { OM_AI_RUN_TRACE_CAPTURE_PROMPT: 'yes' })
    const [run] = withFlag.rowsOf(AiAgentRun)
    expect(run.systemPrompt).toBe('You are the catalog assistant.')
    expect(run.systemPromptHash).toBe(withoutFlag.rowsOf(AiAgentRun)[0].systemPromptHash)
  })

  it('writes nothing when capture is off', async () => {
    const harness = makeContainer()
    const recorded = await recordAgentRun(harness.container, makePayload(), { OM_AI_RUN_TRACE_CAPTURE: 'off' })
    expect(recorded).toBe(false)
    expect(harness.em.fork).not.toHaveBeenCalled()
    expect(harness.created).toHaveLength(0)
  })

  it('never throws when the write fails and reports the error', async () => {
    const harness = makeContainer({ flushThrows: true })
    await expect(recordAgentRun(harness.container, makePayload(), fullEnv)).resolves.toBe(false)
    expect(mockReportError).toHaveBeenCalledTimes(1)
    expect(mockReportError.mock.calls[0][1]).toMatchObject({
      module: 'ai_assistant',
      code: 'ai_assistant.agent_run_record_failed',
    })
    expect(testLogger.warn).toHaveBeenCalled()
  })

  it('never throws when the container cannot resolve the entity manager', async () => {
    const harness = makeContainer({ resolveThrows: true })
    await expect(recordAgentRun(harness.container, makePayload(), fullEnv)).resolves.toBe(false)
    expect(mockReportError).toHaveBeenCalledTimes(1)
  })

  it('persists aborted runs with the steps collected so far', async () => {
    const harness = makeContainer()
    await recordAgentRun(
      harness.container,
      makePayload({ status: 'aborted', stopReason: 'abort', finishReason: null, outputText: null }),
      fullEnv,
    )
    const [run] = harness.rowsOf(AiAgentRun)
    expect(run).toMatchObject({ status: 'aborted', stopReason: 'abort', finishReason: null, stepCount: 1 })
    expect(harness.rowsOf(AiAgentRunStep)).toHaveLength(1)
  })
})

describe('buildAgentRunModelParams', () => {
  it('maps the first call settings onto gen_ai.request keys and omits absent ones', () => {
    const params = buildAgentRunModelParams(
      {
        maxSteps: 8,
        toolChoice: 'auto',
        budget: { maxToolCalls: 4 },
        activeTools: ['catalog.list_products'],
        stopWhenKinds: ['stepCount', 'hasToolCall'],
        allowRuntimeOverride: true,
        modelSource: 'agent',
      },
      {
        temperature: 0.2,
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 512,
        seed: 7,
        stopSequences: ['END'],
        presencePenalty: 0.1,
        frequencyPenalty: 0.3,
        providerOptions: { openai: { store: false } },
      },
    )
    expect(params).toEqual({
      maxSteps: 8,
      toolChoice: 'auto',
      budget: { maxToolCalls: 4 },
      activeTools: ['catalog.list_products'],
      stopWhen: ['stepCount', 'hasToolCall'],
      allowRuntimeOverride: true,
      modelSource: 'agent',
      'gen_ai.request.temperature': 0.2,
      'gen_ai.request.top_p': 0.9,
      'gen_ai.request.top_k': 40,
      'gen_ai.request.max_tokens': 512,
      'gen_ai.request.seed': 7,
      'gen_ai.request.stop_sequences': ['END'],
      'gen_ai.request.presence_penalty': 0.1,
      'gen_ai.request.frequency_penalty': 0.3,
    })
  })

  it('keeps provider defaults implicit when the call sent no settings', () => {
    const params = buildAgentRunModelParams({ modelSource: 'default' }, { temperature: 0 })
    expect(params['gen_ai.request.temperature']).toBe(0)
    expect(Object.keys(params).filter((key) => key.startsWith('gen_ai.'))).toEqual(['gen_ai.request.temperature'])
    expect(buildAgentRunModelParams({}, null)).toEqual({
      maxSteps: null,
      toolChoice: null,
      budget: null,
      activeTools: null,
      stopWhen: [],
      allowRuntimeOverride: null,
      modelSource: null,
    })
  })
})

function startEvent(overrides: Partial<AiAgentModelCallStartEvent> = {}): AiAgentModelCallStartEvent {
  return {
    callId: 'call-a',
    stepNumber: 0,
    provider: 'openai',
    modelId: 'gpt-5-mini',
    system: 'system',
    messages: [],
    tools: undefined,
    responseFormat: undefined,
    callSettings: { temperature: 0.4 },
    startedAtMs: 1000,
    ...overrides,
  }
}

function endEvent(overrides: Partial<AiAgentModelCallEndEvent> = {}): AiAgentModelCallEndEvent {
  return {
    callId: 'call-a',
    finishReason: 'stop',
    responseId: null,
    responseModelId: null,
    usage: { inputTokens: 10, outputTokens: 5 },
    content: [],
    responseTimeMs: 200,
    endedAtMs: 1200,
    ...overrides,
  }
}

describe('createAgentRunRecorderObserver', () => {
  it('captures the first call settings, prompt metadata and per-call timings', async () => {
    const recorder = createAgentRunRecorderObserver()
    await recorder.observer.onPromptResolved?.({
      agentId: 'catalog.assistant',
      systemPrompt: 'prompt',
      promptOverride: { id: 'override-1', version: 2 },
      pageContextHydrated: false,
      attachmentCount: 0,
      provider: 'openai',
      modelId: 'gpt-5-mini',
    })
    await recorder.observer.onModelCallStart?.(startEvent())
    await recorder.observer.onModelCallEnd?.(endEvent())
    await recorder.observer.onModelCallStart?.(
      startEvent({ callId: 'call-b', stepNumber: 1, callSettings: { temperature: 0.9 } }),
    )

    const snapshot = recorder.snapshot()
    expect(snapshot.firstCallSettings).toEqual({ temperature: 0.4 })
    expect(snapshot.promptResolved?.promptOverride).toEqual({ id: 'override-1', version: 2 })
    expect(snapshot.modelCalls).toEqual([
      expect.objectContaining({ callId: 'call-a', endedAtMs: 1200, finishReason: 'stop' }),
      expect.objectContaining({ callId: 'call-b', endedAtMs: null, finishReason: null }),
    ])
    expect(buildAgentRunModelParams({}, snapshot.firstCallSettings)['gen_ai.request.temperature']).toBe(0.4)
  })
})

describe('composeCallObservers', () => {
  it('returns undefined for no observers and the observer itself for one', () => {
    const single = { onModelCallStart: jest.fn() }
    expect(composeCallObservers(undefined, null)).toBeUndefined()
    expect(composeCallObservers(single, undefined)).toBe(single)
  })

  it('fans out every hook to each observer and isolates a throwing observer', async () => {
    const recorder = createAgentRunRecorderObserver()
    const callerStart = jest.fn(() => {
      throw new Error('caller observer failed')
    })
    const callerEnd = jest.fn()
    const composed = composeCallObservers({ onModelCallStart: callerStart, onModelCallEnd: callerEnd }, recorder.observer)

    await composed?.onModelCallStart?.(startEvent())
    await composed?.onModelCallEnd?.(endEvent())

    expect(callerStart).toHaveBeenCalledTimes(1)
    expect(callerEnd).toHaveBeenCalledTimes(1)
    expect(testLogger.error).toHaveBeenCalled()
    expect(recorder.snapshot().firstCallSettings).toEqual({ temperature: 0.4 })
    expect(recorder.snapshot().modelCalls[0]).toMatchObject({ endedAtMs: 1200 })
  })
})
