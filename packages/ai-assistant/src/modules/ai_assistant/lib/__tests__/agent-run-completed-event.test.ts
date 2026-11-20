import type { AwilixContainer } from 'awilix'
import { AGENT_RUN_COMPLETED_EVENT_ID, recordAgentRun, type AgentRunRecordPayload } from '../agent-run-recorder'

const mockEmit = jest.fn()
const mockReportError = jest.fn()

jest.mock('../../events', () => ({
  emitAiAssistantEvent: (...args: unknown[]) => mockEmit(...args),
}))

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

function makeContainer(options: { flushThrows?: boolean } = {}) {
  const callOrder: string[] = []
  const tx = {
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => data),
    persist: jest.fn(() => tx),
    flush: jest.fn(async () => {
      if (options.flushThrows) throw new Error('DB write failed')
    }),
  }
  const transactional = jest.fn(async (work: (manager: typeof tx) => Promise<void>) => {
    await work(tx)
    callOrder.push('commit')
  })
  const em = { fork: jest.fn(() => ({ transactional })) }
  const container = {
    resolve: (name: string) => {
      if (name === 'em') return em
      throw new Error(`Unknown token: ${name}`)
    },
  } as unknown as Pick<AwilixContainer, 'resolve'>
  return { container, callOrder }
}

function makePayload(): AgentRunRecordPayload {
  return {
    runId: '00000000-0000-4000-8000-000000000001',
    tenantId: '00000000-0000-4000-8000-0000000000a1',
    organizationId: '00000000-0000-4000-8000-0000000000b1',
    userId: '00000000-0000-4000-8000-0000000000c1',
    apiKeyId: null,
    agentId: 'catalog.assistant',
    moduleId: 'catalog',
    agentVersion: null,
    agentDefinitionHash: 'sha256:definition',
    promptOverride: null,
    executionMode: 'chat',
    effectiveMutationPolicy: 'read-only',
    toolNames: [],
    channel: 'chat',
    conversationId: 'conversation-1',
    turnId: '00000000-0000-4000-8000-0000000000e1',
    correlationId: null,
    providerId: 'openai',
    modelId: 'gpt-5-mini',
    baseUrlHost: null,
    modelParams: {},
    status: 'completed',
    stopReason: null,
    finishReason: 'stop',
    usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: null, reasoningTokens: null },
    startedAt: new Date('2026-10-26T10:00:00.000Z'),
    completedAt: new Date('2026-10-26T10:00:01.000Z'),
    inputText: 'secret question',
    outputText: 'secret answer',
    systemPrompt: 'You are the catalog assistant.',
    citations: null,
    error: null,
    steps: [],
    toolCalls: [],
  }
}

beforeEach(() => {
  mockEmit.mockReset()
  mockEmit.mockResolvedValue(undefined)
  mockReportError.mockReset()
})

describe('ai_assistant.agent_run.completed emission', () => {
  it('emits a persistent ids-only event after the transaction commits', async () => {
    const { container, callOrder } = makeContainer()
    mockEmit.mockImplementation(async () => {
      callOrder.push('emit')
    })
    const written = await recordAgentRun(container, makePayload(), {})
    expect(written).toBe(true)
    expect(callOrder).toEqual(['commit', 'emit'])
    expect(mockEmit).toHaveBeenCalledTimes(1)
    const [eventId, eventPayload, emitOptions] = mockEmit.mock.calls[0]
    expect(eventId).toBe(AGENT_RUN_COMPLETED_EVENT_ID)
    expect(eventPayload).toEqual({
      runId: '00000000-0000-4000-8000-000000000001',
      tenantId: '00000000-0000-4000-8000-0000000000a1',
      organizationId: '00000000-0000-4000-8000-0000000000b1',
      agentId: 'catalog.assistant',
      channel: 'chat',
      status: 'completed',
      conversationId: 'conversation-1',
    })
    expect(emitOptions).toEqual({ persistent: true })
    expect(JSON.stringify(eventPayload)).not.toContain('secret')
  })

  it('does not emit when capture is off', async () => {
    const { container } = makeContainer()
    const written = await recordAgentRun(container, makePayload(), { OM_AI_RUN_TRACE_CAPTURE: 'off' })
    expect(written).toBe(false)
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('does not emit when the write fails', async () => {
    const { container } = makeContainer({ flushThrows: true })
    const written = await recordAgentRun(container, makePayload(), {})
    expect(written).toBe(false)
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('swallows and reports an emit failure while still reporting the run as written', async () => {
    const { container } = makeContainer()
    mockEmit.mockRejectedValue(new Error('bus down'))
    await expect(recordAgentRun(container, makePayload(), {})).resolves.toBe(true)
    expect(mockReportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ code: 'ai_assistant.agent_run_completed_emit_failed' }),
    )
  })
})
