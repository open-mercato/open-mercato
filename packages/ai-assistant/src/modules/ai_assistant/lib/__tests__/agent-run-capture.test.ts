import type { AwilixContainer } from 'awilix'
import { createAgentRunCapture, readPendingActionId } from '../agent-run-capture'
import type { AgentRunCaptureInput, AgentRunSettleInput } from '../agent-run-capture'
import type { AiAgentDefinition, LoopStepRecord } from '../ai-agent-definition'
import type { AiChatRequestContext } from '../attachment-bridge-types'
import { reportAiAssistantError } from '../report-ai-assistant-error'

jest.mock('../report-ai-assistant-error', () => ({ reportAiAssistantError: jest.fn() }))

const recordAgentRunMock = jest.fn()
jest.mock('../agent-registry', () => ({ getAgentDefinitionHash: () => 'sha256:test' }))
jest.mock('../agent-run-recorder', () => ({
  ...jest.requireActual('../agent-run-recorder'),
  recordAgentRun: (...args: unknown[]) => recordAgentRunMock(...args),
}))

const PENDING_ACTION_ID = '5f0c6a2e-8b1d-4c3a-9e7f-1a2b3c4d5e6f'

describe('readPendingActionId', () => {
  it('reads a UUID pendingActionId from a mutation tool result object or JSON string', () => {
    expect(readPendingActionId({ pendingActionId: PENDING_ACTION_ID }, true)).toBe(PENDING_ACTION_ID)
    expect(readPendingActionId(JSON.stringify({ pendingActionId: PENDING_ACTION_ID }), true)).toBe(PENDING_ACTION_ID)
  })

  it('ignores pendingActionId on non-mutation tool results', () => {
    expect(readPendingActionId({ pendingActionId: PENDING_ACTION_ID }, false)).toBeNull()
  })

  it.each([
    ['not-a-uuid'],
    ['   '],
    [`${PENDING_ACTION_ID}-extra`],
    [42],
  ])('rejects a non-UUID pendingActionId %p', (value) => {
    expect(readPendingActionId({ pendingActionId: value }, true)).toBeNull()
  })

  it('returns null for results without a pendingActionId', () => {
    expect(readPendingActionId('plain text', true)).toBeNull()
    expect(readPendingActionId(null, true)).toBeNull()
    expect(readPendingActionId([PENDING_ACTION_ID], true)).toBeNull()
  })
})

function makeCaptureInput(): AgentRunCaptureInput {
  return {
    container: {} as AwilixContainer,
    trace: undefined,
    runId: 'run-1',
    agent: { id: 'demo.agent', moduleId: 'demo' } as AiAgentDefinition,
    authContext: { tenantId: 'tenant-1', organizationId: 'org-1', userId: null } as unknown as AiChatRequestContext,
    executionMode: 'chat',
    effectiveMutationPolicy: 'read-only',
    toolNames: ['kb.search'],
    mutationToolNames: new Set<string>(),
    conversationId: null,
    turnId: 'turn-1',
    apiKeyId: null,
    providerId: 'test',
    modelId: 'test-model',
    baseUrl: undefined,
    systemPrompt: '',
    promptOverride: null,
    env: {},
  }
}

function citationsOutput(citations: unknown[]): string {
  return JSON.stringify({ hits: citations.length, uiParts: [{ componentId: 'ai_assistant:citations', payload: { citations } }] })
}

function makeStep(stepIndex: number, results: unknown[]): LoopStepRecord {
  return {
    stepIndex,
    modelId: 'test-model',
    finishReason: 'tool-calls',
    usage: { inputTokens: 1, outputTokens: 1 },
    textDelta: '',
    toolCalls: results.map((result, index) => ({
      toolName: 'kb.search',
      toolCallId: `call-${stepIndex}-${index}`,
      args: {},
      result,
      durationMs: 1,
    })),
  } as unknown as LoopStepRecord
}

describe('createAgentRunCapture citations', () => {
  beforeEach(() => {
    recordAgentRunMock.mockReset()
    recordAgentRunMock.mockResolvedValue(true)
  })

  it('aggregates citation parts from every tool call of the run, deduped', async () => {
    const capture = createAgentRunCapture(makeCaptureInput())
    const outcome = await capture?.settle({
      status: 'completed',
      loopParams: {},
      inputText: 'question',
      steps: [
        makeStep(0, [citationsOutput([{ kind: 'kb', ref: 'refunds@3', label: 'Refunds' }]), 'no parts']),
        makeStep(1, [citationsOutput([{ kind: 'kb', ref: 'refunds@3' }, { kind: 'kb', ref: 'returns@1' }])]),
      ],
    } as unknown as AgentRunSettleInput)

    expect(capture).not.toBeNull()
    expect(outcome).toBe(true)
    expect(recordAgentRunMock).toHaveBeenCalledTimes(1)
    expect(recordAgentRunMock.mock.calls[0][1].citations).toEqual([
      { kind: 'kb', ref: 'refunds@3', label: 'Refunds' },
      { kind: 'kb', ref: 'returns@1' },
    ])
  })

  it('passes null when no tool emitted citations', async () => {
    const capture = createAgentRunCapture(makeCaptureInput())
    await capture?.settle({
      status: 'completed',
      loopParams: {},
      inputText: 'question',
      steps: [makeStep(0, [{ ok: true }])],
    } as unknown as AgentRunSettleInput)

    expect(recordAgentRunMock.mock.calls[0][1].citations).toBeNull()
  })
})

describe('createAgentRunCapture settle', () => {
  it('reports an error thrown while building the run payload and resolves false', async () => {
    const captureInput: AgentRunCaptureInput = {
      container: {} as AwilixContainer,
      trace: undefined,
      runId: 'run-1',
      agent: { id: 'demo.agent', moduleId: 'demo' } as AiAgentDefinition,
      authContext: { tenantId: 'tenant-1', organizationId: null, userId: null } as unknown as AiChatRequestContext,
      executionMode: 'chat',
      effectiveMutationPolicy: 'read-only',
      toolNames: [],
      mutationToolNames: new Set<string>(),
      conversationId: null,
      turnId: 'turn-1',
      apiKeyId: null,
      providerId: 'test',
      modelId: 'test-model',
      baseUrl: undefined,
      systemPrompt: '',
      promptOverride: null,
      env: {},
    }
    const capture = createAgentRunCapture(captureInput)
    expect(capture).not.toBeNull()
    const brokenStep = { stepIndex: 0, toolCalls: [] } as unknown as LoopStepRecord
    const settleInput = {
      status: 'completed',
      loopParams: {},
      inputText: null,
      steps: [brokenStep],
    } as unknown as AgentRunSettleInput

    await expect(capture?.settle(settleInput)).resolves.toBe(false)

    expect(reportAiAssistantError).toHaveBeenCalledTimes(1)
    expect(reportAiAssistantError).toHaveBeenCalledWith(expect.any(TypeError), 'ai_assistant.agent_run_capture_failed')
  })
})
