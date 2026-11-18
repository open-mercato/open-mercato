import type { LanguageModelCallEndEvent, LanguageModelCallStartEvent } from 'ai'
import { z } from 'zod'
import type { AiAgentModelCallEndEvent, AiAgentModelCallStartEvent } from '../agent-call-contract'
import {
  buildObjectResponseFormat,
  composeCallObservers,
  createModelCallObserverHooks,
  createSynthesizedModelCall,
  extractObservedCallSettings,
  instructionsToSystem,
  isLightweightCallObserver,
  markLightweightCallObserver,
  normalizeModelCallUsage,
  observeStreamedObjectEnd,
  readSynthesizedResultMetadata,
  toModelCallEndEvent,
  toModelCallStartEvent,
} from '../agent-call-observer'
import { createAgentRunRecorderObserver } from '../agent-run-recorder'

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
        synthesized: true,
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

describe('lightweight recorder observer path', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  function heavyCloneTargets(spy: jest.SpyInstance): unknown[] {
    return spy.mock.calls
      .map((call) => call[0])
      .filter((value) => Array.isArray(value) || (typeof value === 'object' && value !== null && 'messages' in value))
  }

  it('skips heavy clones when only the recorder observes', async () => {
    const recorder = createAgentRunRecorderObserver()
    expect(isLightweightCallObserver(recorder.observer)).toBe(true)
    const observe = composeCallObservers(undefined, recorder.observer)
    expect(isLightweightCallObserver(observe)).toBe(true)
    const cloneSpy = jest.spyOn(globalThis, 'structuredClone')
    const hooks = createModelCallObserverHooks(observe, { agentId: 'demo.agent', now: () => 1000 })
    await hooks?.onLanguageModelCallStart(buildStartEvent())
    await hooks?.onLanguageModelCallEnd(buildEndEvent())
    expect(heavyCloneTargets(cloneSpy)).toEqual([])
    const snapshot = recorder.snapshot()
    expect(snapshot.firstCallSettings).toEqual({ temperature: 0.4, maxOutputTokens: 64 })
    expect(snapshot.modelCalls).toEqual([
      expect.objectContaining({ callId: 'call-1', stepNumber: 0, finishReason: 'stop', endedAtMs: 1000 }),
    ])
    expect(snapshot.modelCalls[0].usage).toMatchObject({ inputTokens: 10, outputTokens: 5 })
  })

  it('still delivers the full event to a caller observer composed with the recorder', async () => {
    const recorder = createAgentRunRecorderObserver()
    const starts: AiAgentModelCallStartEvent[] = []
    const ends: AiAgentModelCallEndEvent[] = []
    const callerObserver = {
      onModelCallStart: (event: AiAgentModelCallStartEvent) => {
        starts.push(event)
      },
      onModelCallEnd: (event: AiAgentModelCallEndEvent) => {
        ends.push(event)
      },
    }
    const observe = composeCallObservers(callerObserver, recorder.observer)
    expect(isLightweightCallObserver(observe)).toBe(false)
    const hooks = createModelCallObserverHooks(observe, { agentId: 'demo.agent', now: () => 1000 })
    await hooks?.onLanguageModelCallStart(buildStartEvent())
    await hooks?.onLanguageModelCallEnd(buildEndEvent())
    expect(starts[0].messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(starts[0].tools).toHaveLength(1)
    expect(starts[0].system).toBe('Be helpful.')
    expect(ends[0].content).toEqual([{ type: 'text', text: 'Hello' }])
    expect(ends[0].providerMetadata).toEqual({ testProvider: { cached: true } })
    expect(recorder.snapshot().modelCalls).toHaveLength(1)
  })

  it('marks synthesized start events and keeps the marker for lightweight composed observers', async () => {
    const recorder = createAgentRunRecorderObserver()
    const lightweightStarts: AiAgentModelCallStartEvent[] = []
    const realStarts: AiAgentModelCallStartEvent[] = []
    const lightweightCaller = markLightweightCallObserver({
      onModelCallStart: (event: AiAgentModelCallStartEvent) => {
        lightweightStarts.push(event)
      },
    })
    const fullCaller = {
      onModelCallStart: (event: AiAgentModelCallStartEvent) => {
        realStarts.push(event)
      },
    }
    const observe = composeCallObservers(fullCaller, lightweightCaller, recorder.observer)
    const synthesized = createSynthesizedModelCall(observe, {
      agentId: 'demo.agent',
      provider: 'test-provider',
      modelId: 'model-a',
      system: 'System.',
      messages: [],
      responseFormat: undefined,
      callSettings: {},
    })
    await synthesized?.start()
    expect(realStarts[0].synthesized).toBe(true)
    expect(lightweightStarts[0].synthesized).toBe(true)

    const hooks = createModelCallObserverHooks(observe, { agentId: 'demo.agent', now: () => 1 })
    await hooks?.onLanguageModelCallStart(buildStartEvent())
    expect('synthesized' in realStarts[1]).toBe(false)
    expect('synthesized' in lightweightStarts[1]).toBe(false)
  })

  it('synthesized calls skip message clones for a lightweight observer', async () => {
    const recorder = createAgentRunRecorderObserver()
    const messages = [{ role: 'user', content: 'hi' }]
    const cloneSpy = jest.spyOn(globalThis, 'structuredClone')
    const synthesized = createSynthesizedModelCall(recorder.observer, {
      agentId: 'demo.agent',
      provider: 'test-provider',
      modelId: 'model-a',
      system: 'System.',
      messages,
      responseFormat: { type: 'json' },
      callSettings: { temperature: 0.1 },
      now: () => 5,
    })
    await synthesized?.start()
    await synthesized?.end({ finishReason: 'stop', object: { verdict: 'ok' } })
    expect(cloneSpy.mock.calls.some((call) => call[0] === messages || Array.isArray(call[0]))).toBe(false)
    expect(recorder.snapshot().modelCalls).toEqual([expect.objectContaining({ finishReason: 'stop' })])
  })
})
