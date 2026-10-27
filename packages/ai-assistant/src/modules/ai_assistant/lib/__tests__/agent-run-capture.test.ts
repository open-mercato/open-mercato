import type { AwilixContainer } from 'awilix'
import { createAgentRunCapture, readPendingActionId } from '../agent-run-capture'
import type { AgentRunCaptureInput, AgentRunSettleInput } from '../agent-run-capture'
import type { AiAgentDefinition, LoopStepRecord } from '../ai-agent-definition'
import type { AiChatRequestContext } from '../attachment-bridge-types'
import { reportAiAssistantError } from '../report-ai-assistant-error'

jest.mock('../report-ai-assistant-error', () => ({ reportAiAssistantError: jest.fn() }))

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
