import type { LanguageModelCallEndEvent, LanguageModelCallStartEvent } from 'ai'
import { z } from 'zod'
import type { AiAgentModelCallEndEvent, AiAgentModelCallStartEvent } from '../agent-call-contract'
import {
  buildObjectResponseFormat,
  createModelCallObserverHooks,
  createSynthesizedModelCall,
  extractObservedCallSettings,
  instructionsToSystem,
  normalizeModelCallUsage,
  observeStreamedObjectEnd,
  readSynthesizedResultMetadata,
  toModelCallEndEvent,
  toModelCallStartEvent,
} from '../agent-call-observer'

function buildStartEvent(overrides: Partial<LanguageModelCallStartEvent> = {}): LanguageModelCallStartEvent {
  return {
    callId: 'call-1',
    provider: 'test-provider.chat',
    modelId: 'model-a',
    instructions: 'Be helpful.',
    messages: [{ role: 'user', content: 'hi' }],
    tools: [{ type: 'function', name: 'lookup_record', inputSchema: { type: 'object' } }],
    temperature: 0.4,
    maxOutputTokens: 64,
    ...overrides,
  } as LanguageModelCallStartEvent
}

function buildEndEvent(overrides: Partial<LanguageModelCallEndEvent> = {}): LanguageModelCallEndEvent {
  return {
    callId: 'call-1',
    provider: 'test-provider.chat',
    modelId: 'model-a-2026',
    finishReason: 'stop',
    usage: {
      inputTokens: 10,
      inputTokenDetails: { noCacheTokens: 6, cacheReadTokens: 4, cacheWriteTokens: undefined },
      outputTokens: 5,
      outputTokenDetails: { textTokens: 3, reasoningTokens: 2 },
      totalTokens: 15,
    },
    content: [{ type: 'text', text: 'Hello' }],
    responseId: 'resp-1',
    providerMetadata: { testProvider: { cached: true } },
    performance: {
      responseTimeMs: 42,
      effectiveOutputTokensPerSecond: 1,
      outputTokensPerSecond: undefined,
      inputTokensPerSecond: undefined,
      effectiveTotalTokensPerSecond: 1,
      timeToFirstOutputMs: undefined,
    },
    ...overrides,
  } as LanguageModelCallEndEvent
}

describe('agent-call-observer adapter', () => {
  it('maps instructions of every shape to a system string', () => {
    expect(instructionsToSystem(undefined)).toBeUndefined()
    expect(instructionsToSystem('Plain')).toBe('Plain')
    expect(instructionsToSystem({ role: 'system', content: 'Single' })).toBe('Single')
    expect(
      instructionsToSystem([
        { role: 'system', content: 'First' },
        { role: 'system', content: 'Second' },
      ]),
    ).toBe('First\n\nSecond')
  })

  it('extracts only present call settings and falls back to the sent provider options', () => {
    expect(extractObservedCallSettings({ temperature: 0.1, topP: undefined, seed: 3, messages: [] })).toEqual({
      temperature: 0.1,
      seed: 3,
    })
    expect(extractObservedCallSettings({}, { openai: { store: false } })).toEqual({
      providerOptions: { openai: { store: false } },
    })
    expect(extractObservedCallSettings({ providerOptions: { google: { safe: true } } }, { openai: {} })).toEqual({
      providerOptions: { google: { safe: true } },
    })
  })

  it('normalizes SDK 7 and flat usage shapes, omitting absent counters', () => {
    expect(normalizeModelCallUsage(buildEndEvent().usage)).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cachedInputTokens: 4,
      reasoningTokens: 2,
    })
    expect(normalizeModelCallUsage({ inputTokens: 3, cachedInputTokens: 1 })).toEqual({
      inputTokens: 3,
      cachedInputTokens: 1,
    })
    expect(normalizeModelCallUsage(undefined)).toEqual({})
  })

  it('maps a start event to the contract shape with copies of the SDK data', () => {
    const sdkEvent = buildStartEvent()
    const mapped = toModelCallStartEvent(sdkEvent, {
      stepNumber: 2,
      startedAtMs: 1000,
      providerOptions: { testProvider: { mode: 'fast' } },
      responseFormat: { type: 'json', name: 'Thing' },
    })
    expect(mapped).toEqual({
      callId: 'call-1',
      stepNumber: 2,
      provider: 'test-provider.chat',
      modelId: 'model-a',
      system: 'Be helpful.',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', name: 'lookup_record', inputSchema: { type: 'object' } }],
      responseFormat: { type: 'json', name: 'Thing' },
      callSettings: { temperature: 0.4, maxOutputTokens: 64, providerOptions: { testProvider: { mode: 'fast' } } },
      startedAtMs: 1000,
    })
    expect(mapped.messages).not.toBe(sdkEvent.messages)
    expect(mapped.tools?.[0]).not.toBe(sdkEvent.tools?.[0])
  })

  it('maps an end event to the contract shape', () => {
    expect(toModelCallEndEvent(buildEndEvent(), { endedAtMs: 2000 })).toEqual({
      callId: 'call-1',
      finishReason: 'stop',
      responseId: 'resp-1',
      responseModelId: 'model-a-2026',
      usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 4, reasoningTokens: 2 },
      content: [{ type: 'text', text: 'Hello' }],
      providerMetadata: { testProvider: { cached: true } },
      responseTimeMs: 42,
      endedAtMs: 2000,
    })
    const withoutMetadata = toModelCallEndEvent(buildEndEvent({ providerMetadata: undefined }), { endedAtMs: 1 })
    expect('providerMetadata' in withoutMetadata).toBe(false)
  })

  it('returns no hooks when no model-call handlers are supplied', () => {
    expect(createModelCallObserverHooks(undefined, { agentId: 'agent' })).toBeUndefined()
    expect(createModelCallObserverHooks({ onPromptResolved: () => undefined }, { agentId: 'agent' })).toBeUndefined()
  })

  it('numbers steps per start event and isolates sync and async observer failures', async () => {
    const starts: AiAgentModelCallStartEvent[] = []
    const hooks = createModelCallObserverHooks(
      { onModelCallStart: (event) => void starts.push(event) },
      { agentId: 'agent', now: () => 5 },
    )
    await hooks?.onLanguageModelCallStart(buildStartEvent({ callId: 'first' }))
    await hooks?.onLanguageModelCallStart(buildStartEvent({ callId: 'second' }))
    await hooks?.onLanguageModelCallEnd(buildEndEvent())
    expect(starts.map((event) => [event.callId, event.stepNumber, event.startedAtMs])).toEqual([
      ['first', 0, 5],
      ['second', 1, 5],
    ])

    const failing = createModelCallObserverHooks(
      {
        onModelCallStart: () => {
          throw new Error('[internal] sync failure')
        },
        onModelCallEnd: () => Promise.reject(new Error('[internal] async failure')),
      },
      { agentId: 'agent' },
    )
    await expect(failing?.onLanguageModelCallStart(buildStartEvent())).resolves.toBeUndefined()
    await expect(failing?.onLanguageModelCallEnd(buildEndEvent())).resolves.toBeUndefined()
  })

  it('builds a JSON response format from a zod schema', () => {
    const format = buildObjectResponseFormat('Product', z.object({ name: z.string() }))
    expect(format).toMatchObject({ type: 'json', name: 'Product', schema: { type: 'object' } })
    expect(buildObjectResponseFormat('Raw', 'not-a-schema')).toEqual({ type: 'json', name: 'Raw' })
  })

  it('synthesizes a start/end pair for branches without call-level hooks', async () => {
    const starts: AiAgentModelCallStartEvent[] = []
    const ends: AiAgentModelCallEndEvent[] = []
    let clock = 100
    const synthesized = createSynthesizedModelCall(
      { onModelCallStart: (event) => void starts.push(event), onModelCallEnd: (event) => void ends.push(event) },
      {
        agentId: 'agent',
        provider: 'test-provider',
        modelId: 'model-a',
        system: 'Extract.',
        messages: [{ role: 'user', content: 'go' }],
        responseFormat: { type: 'json', name: 'Thing' },
        callSettings: { temperature: 0 },
        now: () => clock,
      },
    )
    await synthesized?.start()
    clock = 160
    await synthesized?.end(
      readSynthesizedResultMetadata({
        object: { name: 'Widget' },
        finishReason: 'stop',
        usage: { inputTokens: 2, outputTokens: 1 },
        response: { id: 'resp-9', modelId: 'model-a-v2' },
      }),
    )
    expect(starts).toEqual([
      expect.objectContaining({
        stepNumber: 0,
        system: 'Extract.',
        tools: undefined,
        responseFormat: { type: 'json', name: 'Thing' },
        callSettings: { temperature: 0 },
        startedAtMs: 100,
      }),
    ])
    expect(ends).toEqual([
      {
        callId: starts[0].callId,
        finishReason: 'stop',
        responseId: 'resp-9',
        responseModelId: 'model-a-v2',
        usage: { inputTokens: 2, outputTokens: 1 },
        content: [{ type: 'text', text: JSON.stringify({ name: 'Widget' }) }],
        responseTimeMs: 60,
        endedAtMs: 160,
      },
    ])
  })

  it('emits the streamed end event once the stream settles, even when it rejects', async () => {
    const ends: AiAgentModelCallEndEvent[] = []
    const synthesized = createSynthesizedModelCall(
      { onModelCallEnd: (event) => void ends.push(event) },
      {
        agentId: 'agent',
        provider: 'test-provider',
        modelId: 'model-a',
        system: undefined,
        messages: [],
        responseFormat: undefined,
        callSettings: {},
      },
    )
    const rejectedObject = Promise.reject(new Error('[internal] stream failure'))
    rejectedObject.catch(() => undefined)
    observeStreamedObjectEnd(synthesized, {
      object: rejectedObject,
      finishReason: Promise.resolve(undefined),
      usage: Promise.resolve({ inputTokens: 1 }),
    })
    await new Promise((resolve) => setImmediate(resolve))
    expect(ends).toHaveLength(1)
    expect(ends[0]).toMatchObject({ finishReason: 'error', usage: { inputTokens: 1 }, content: [] })
  })
})
