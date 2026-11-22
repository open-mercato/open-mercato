import type {
  AiAgentModelCallEndEvent,
  AiAgentModelCallStartEvent,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-call-contract'
import {
  attachModelCallsToSteps,
  createNativeModelCallCollector,
} from '../lib/runtime/nativeModelCallRecorder'
import { computeManifestSha256 } from '../lib/trace/runManifest'

const SECRET_SYSTEM = 'System prompt with a confidential marker'
const SECRET_MESSAGE = 'user message confidential marker'
const SECRET_RESPONSE = 'model answer confidential marker'

function startEvent(overrides: Partial<AiAgentModelCallStartEvent> = {}): AiAgentModelCallStartEvent {
  return {
    callId: 'call-1',
    stepNumber: 0,
    provider: 'test-provider',
    modelId: 'model-a',
    system: SECRET_SYSTEM,
    messages: [{ role: 'user', content: SECRET_MESSAGE }],
    tools: [
      { type: 'function', name: 'zeta_tool', inputSchema: { type: 'object' } },
      { type: 'function', name: 'alpha_tool', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } },
    ],
    responseFormat: { type: 'json', name: 'Thing' },
    callSettings: { temperature: 0.2, stopSequences: ['END'], providerOptions: { testProvider: { mode: 'fast' } } },
    startedAtMs: 1000,
    ...overrides,
  }
}

function endEvent(overrides: Partial<AiAgentModelCallEndEvent> = {}): AiAgentModelCallEndEvent {
  return {
    callId: 'call-1',
    finishReason: 'stop',
    responseId: 'resp-1',
    responseModelId: 'model-a-2026',
    usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 4, reasoningTokens: 2 },
    content: [{ type: 'text', text: SECRET_RESPONSE }],
    responseTimeMs: 42,
    endedAtMs: 1050,
    ...overrides,
  }
}

describe('createNativeModelCallCollector', () => {
  it('builds one metadata record per completed call', () => {
    const collector = createNativeModelCallCollector()
    collector.observer.onModelCallStart(startEvent())
    collector.observer.onModelCallEnd(endEvent())

    const [record] = collector.records()
    expect(record).toMatchObject({
      callId: 'call-1',
      stepNumber: 0,
      provider: 'test-provider',
      requestModel: 'model-a',
      responseModel: 'model-a-2026',
      responseId: 'resp-1',
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 4, reasoningTokens: 2 },
      callSettings: { temperature: 0.2, stopSequences: ['END'] },
      hasProviderOptions: true,
      latencyMs: 42,
      startedAtMs: 1000,
      endedAtMs: 1050,
      fidelity: 'exact',
      systemSha256: computeManifestSha256(SECRET_SYSTEM),
      toolCount: 2,
      messageCount: 1,
    })
    expect(record.callSettings).not.toHaveProperty('providerOptions')
    expect(record.requestSha256).toMatch(/^sha256:[0-9a-f]+$/)
    expect(record.responseSha256).toMatch(/^sha256:[0-9a-f]+$/)
    expect(record.requestBytes).toBeGreaterThan(0)
    expect(record.responseBytes).toBeGreaterThan(0)
  })

  it('retains no prompt, message, tool schema or response content', () => {
    const collector = createNativeModelCallCollector()
    collector.observer.onModelCallStart(startEvent())
    collector.observer.onModelCallEnd(endEvent())
    const serialized = JSON.stringify(collector.records())
    expect(serialized).not.toContain('confidential marker')
    expect(serialized).not.toContain('alpha_tool')
    expect(serialized).not.toContain('properties')
  })

  it('retains the request and response content only when asked, with the same hashes', () => {
    const plain = createNativeModelCallCollector()
    const retaining = createNativeModelCallCollector({ retainContent: true })
    for (const collector of [plain, retaining]) {
      collector.observer.onModelCallStart(startEvent())
      collector.observer.onModelCallEnd(endEvent({ providerMetadata: { testProvider: { cached: true } } }))
    }
    const [plainRecord] = plain.records()
    const [retained] = retaining.records()
    expect(plainRecord.content).toBeUndefined()
    expect(retained.requestSha256).toBe(plainRecord.requestSha256)
    expect(retained.responseSha256).toBe(plainRecord.responseSha256)
    expect(retained.content).toEqual({
      request: {
        provider: 'test-provider',
        modelId: 'model-a',
        system: SECRET_SYSTEM,
        messages: [{ role: 'user', content: SECRET_MESSAGE }],
        tools: startEvent().tools,
        responseFormat: { type: 'json', name: 'Thing' },
        callSettings: startEvent().callSettings,
      },
      response: {
        finishReason: 'stop',
        content: [{ type: 'text', text: SECRET_RESPONSE }],
        usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 4, reasoningTokens: 2 },
        providerMetadata: { testProvider: { cached: true } },
      },
    })
  })

  it('hashes the tool set independently of tool order and tracks content changes', () => {
    const first = createNativeModelCallCollector()
    first.observer.onModelCallStart(startEvent())
    first.observer.onModelCallEnd(endEvent())

    const reordered = startEvent()
    const second = createNativeModelCallCollector()
    second.observer.onModelCallStart({
      ...reordered,
      tools: reordered.tools ? [...reordered.tools].reverse() : undefined,
    })
    second.observer.onModelCallEnd(endEvent())

    const [left] = first.records()
    const [right] = second.records()
    expect(right.toolsSha256).toBe(left.toolsSha256)
    expect(right.responseSha256).toBe(left.responseSha256)

    const changed = createNativeModelCallCollector()
    changed.observer.onModelCallStart(startEvent({ messages: [{ role: 'user', content: 'different' }] }))
    changed.observer.onModelCallEnd(endEvent({ content: [{ type: 'text', text: 'other' }] }))
    const [different] = changed.records()
    expect(different.requestSha256).not.toBe(left.requestSha256)
    expect(different.responseSha256).not.toBe(left.responseSha256)
    expect(different.toolsSha256).toBe(left.toolsSha256)
  })

  it('keeps the request hash stable across key order of the request', () => {
    const first = createNativeModelCallCollector()
    first.observer.onModelCallStart(startEvent())
    first.observer.onModelCallEnd(endEvent())
    const second = createNativeModelCallCollector()
    second.observer.onModelCallStart({
      ...startEvent(),
      callSettings: { providerOptions: { testProvider: { mode: 'fast' } }, stopSequences: ['END'], temperature: 0.2 },
    })
    second.observer.onModelCallEnd(endEvent())
    expect(second.records()[0].requestSha256).toBe(first.records()[0].requestSha256)
  })

  it('keeps SDK-synthesized object calls exact', () => {
    const collector = createNativeModelCallCollector()
    collector.observer.onModelCallStart(startEvent({ synthesized: true, tools: undefined }))
    collector.observer.onModelCallEnd(endEvent())
    expect(collector.records()[0].fidelity).toBe('exact')
  })

  it('marks caller-managed calls as reconstructed and handles a toolless call', () => {
    const collector = createNativeModelCallCollector()
    collector.observer.onModelCallStart(
      startEvent({ synthesized: true, callerManaged: true, tools: undefined, system: undefined, callSettings: {} }),
    )
    collector.observer.onModelCallEnd(endEvent({ responseTimeMs: 0, endedAtMs: 1300 }))
    const [record] = collector.records()
    expect(record).toMatchObject({
      fidelity: 'reconstructed',
      toolsSha256: null,
      toolCount: 0,
      systemSha256: null,
      hasProviderOptions: false,
      callSettings: {},
      latencyMs: 300,
    })
  })

  it('orders records by end and ignores ends without a start or starts without an end', () => {
    const collector = createNativeModelCallCollector()
    collector.observer.onModelCallStart(startEvent({ callId: 'call-a', stepNumber: 0 }))
    collector.observer.onModelCallStart(startEvent({ callId: 'call-b', stepNumber: 1 }))
    collector.observer.onModelCallStart(startEvent({ callId: 'call-c', stepNumber: 2 }))
    collector.observer.onModelCallEnd(endEvent({ callId: 'call-b' }))
    collector.observer.onModelCallEnd(endEvent({ callId: 'call-a' }))
    collector.observer.onModelCallEnd(endEvent({ callId: 'unknown' }))
    expect(collector.records().map((record) => record.callId)).toEqual(['call-b', 'call-a'])
  })
})

describe('attachModelCallsToSteps', () => {
  function recordFor(callId: string, stepNumber = 0) {
    const collector = createNativeModelCallCollector()
    collector.observer.onModelCallStart(startEvent({ callId, stepNumber }))
    collector.observer.onModelCallEnd(endEvent({ callId }))
    return collector.records()[0]
  }

  it('merges each call into the step with its step number', () => {
    const calls = [recordFor('call-1', 0), recordFor('call-2', 1)]
    const attached = attachModelCallsToSteps([{ seq: 0 }, { seq: 1 }], calls)
    expect(attached.steps.map((step) => step.call?.callId)).toEqual(['call-1', 'call-2'])
    expect(attached.fallbackCall).toBeNull()
  })

  it('matches by step number when calls complete out of order', () => {
    const calls = [recordFor('call-b', 1), recordFor('call-c', 2), recordFor('call-a', 0)]
    const attached = attachModelCallsToSteps([{ seq: 0 }, { seq: 1 }, { seq: 2 }], calls)
    expect(attached.steps.map((step) => step.call?.callId)).toEqual(['call-a', 'call-b', 'call-c'])
    expect(attached.fallbackCall).toBeNull()
  })

  it('leaves a step whose call is missing untouched instead of shifting later calls', () => {
    const attached = attachModelCallsToSteps(
      [{ seq: 0 }, { seq: 1 }, { seq: 2 }],
      [recordFor('call-a', 0), recordFor('call-c', 2)],
    )
    expect(attached.steps[0].call?.callId).toBe('call-a')
    expect(attached.steps[1]).toEqual({ seq: 1 })
    expect(attached.steps[2].call?.callId).toBe('call-c')
    expect(attached.fallbackCall).toBeNull()
  })

  it('never attaches one call to two steps and routes the first unattached call to the fallback', () => {
    const attached = attachModelCallsToSteps(
      [{ seq: 0 }, { seq: 1 }],
      [recordFor('call-a', 0), recordFor('call-extra', 5), recordFor('call-dup', 0), recordFor('call-b', 1)],
    )
    expect(attached.steps.map((step) => step.call?.callId)).toEqual(['call-a', 'call-b'])
    expect(attached.fallbackCall?.callId).toBe('call-extra')
  })

  it('falls back to positional matching only when no call carries a usable step number', () => {
    const calls = [recordFor('call-1', -1), recordFor('call-2', Number.NaN), recordFor('call-3', 1.5)]
    const attached = attachModelCallsToSteps([{ seq: 0 }, { seq: 1 }], calls)
    expect(attached.steps.map((step) => step.call?.callId)).toEqual(['call-1', 'call-2'])
    expect(attached.fallbackCall?.callId).toBe('call-3')
  })

  it('does not attach calls without a usable step number when others carry one', () => {
    const attached = attachModelCallsToSteps(
      [{ seq: 0 }, { seq: 1 }],
      [recordFor('call-unknown', -1), recordFor('call-b', 1)],
    )
    expect(attached.steps[0]).toEqual({ seq: 0 })
    expect(attached.steps[1].call?.callId).toBe('call-b')
    expect(attached.fallbackCall?.callId).toBe('call-unknown')
  })

  it('routes a call without a matching step to the fallback call', () => {
    const attached = attachModelCallsToSteps([], [recordFor('call-1')])
    expect(attached.steps).toEqual([])
    expect(attached.fallbackCall?.callId).toBe('call-1')
    expect(attachModelCallsToSteps([], []).fallbackCall).toBeNull()
  })
})
