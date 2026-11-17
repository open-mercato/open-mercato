import { createContainer } from 'awilix'
import { generateObject, generateText, stepCountIs, tool, streamText, wrapLanguageModel } from 'ai'
import { z } from 'zod'
import { createModelFactory, type CreateModelFactoryDependencies } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory'
import { createModelReplaySession, isOfflineModelReplay } from '../lib/eval/modelReplay'

type Model = ReturnType<typeof wrapLanguageModel>
type Result = Awaited<ReturnType<Model['doGenerate']>>
const usage: Result['usage'] = {
  inputTokens: { total: 2, noCache: 2, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 3, text: 3, reasoning: 0 },
}
const textResult = (text: string): Result => ({
  content: [{ type: 'text', text }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [],
})

function factory(results: Result[]) {
  let index = 0
  const liveCall = jest.fn(async () => results[index++] ?? textResult('fallback'))
  const model: Model = {
    specificationVersion: 'v4', provider: 'synthetic', modelId: 'fixture-model', supportedUrls: {},
    doGenerate: liveCall,
    doStream: jest.fn(async () => ({ stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: 'stream-start', warnings: [] })
      controller.enqueue({ type: 'text-start', id: 'text-1' })
      controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'hello' })
      controller.enqueue({ type: 'text-end', id: 'text-1' })
      controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage })
      controller.close()
    } }) })),
  }
  const provider = { id: 'synthetic', defaultModel: 'fixture-model', resolveApiKey: () => 'synthetic-only', createModel: () => model }
  const deps = { registry: { resolveFirstConfigured: () => provider }, env: {} } as unknown as CreateModelFactoryDependencies
  return { resolveOptions: () => createModelFactory(createContainer(), deps).resolveModel({ moduleId: 'test' }), resolve: () => createModelFactory(createContainer(), deps).resolveModel({ moduleId: 'test' }).model as Model, liveCall, model }
}
const resolveOffline = () => createModelFactory(createContainer(), {
  registry: { resolveFirstConfigured: () => { throw new Error('live provider resolution attempted') } }, env: {},
}).resolveModel({ moduleId: 'test' }).model as Model

describe('A-3 model record/replay through the real SDK', () => {
  it('round trips provider-native structured output without resolving credentials', async () => {
    const live = factory([textResult('{"ok":true}')])
    const recorded = createModelReplaySession('record')
    const invoke = (model: Model) => generateObject({ model, schema: z.object({ ok: z.boolean() }), prompt: 'synthetic input', maxRetries: 0 })
    const before = await recorded.run(async () => invoke(live.resolve()))
    recorded.assertComplete()
    expect(isOfflineModelReplay()).toBe(false)
    for (let repeat = 0; repeat < 2; repeat++) {
      const replay = createModelReplaySession('replay', recorded.recorded)
      const after = await replay.run(async () => {
        expect(isOfflineModelReplay()).toBe(true)
        return invoke(resolveOffline())
      })
      replay.assertComplete()
      expect(after.object).toEqual(before.object)
      expect(after.usage).toEqual(before.usage)
    }
    expect(live.liveCall).toHaveBeenCalledTimes(1)
  })

  it('replays every step of a tool loop with recorded tool call ids', async () => {
    const live = factory([
      { ...textResult(''), content: [{ type: 'tool-call', toolCallId: 'call-synthetic', toolName: 'lookup', input: '{"key":"fixture"}' }], finishReason: { unified: 'tool-calls', raw: 'tool_calls' } },
      textResult('found'),
    ])
    const execute = jest.fn(async () => ({ value: 'synthetic' }))
    const invoke = (model: Model) => generateText({ model, prompt: 'look up fixture', maxRetries: 0, stopWhen: stepCountIs(3),
      tools: { lookup: tool({ inputSchema: z.object({ key: z.string() }), execute }) },
    })
    const recorded = createModelReplaySession('record')
    const before = await recorded.run(async () => invoke(live.resolve()))
    recorded.assertComplete()
    const replay = createModelReplaySession('replay', recorded.recorded)
    const after = await replay.run(async () => invoke(resolveOffline()))
    replay.assertComplete()
    expect(after.text).toBe(before.text)
    expect(after.steps).toHaveLength(2)
    expect(live.liveCall).toHaveBeenCalledTimes(2)
  })

  it('captures and replays streaming calls', async () => {
    const live = factory([])
    const recorded = createModelReplaySession('record')
    const before = await recorded.run(async () => streamText({ model: live.resolve(), prompt: 'hi', maxRetries: 0 }).text)
    recorded.assertComplete()
    const replay = createModelReplaySession('replay', recorded.recorded)
    const after = await replay.run(async () => streamText({ model: resolveOffline(), prompt: 'hi', maxRetries: 0 }).text)
    replay.assertComplete()
    expect(after).toBe(before)
    expect(live.model.doStream).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the prompt or response schema changes', async () => {
    const live = factory([textResult('{"ok":true}')])
    const recorded = createModelReplaySession('record')
    await recorded.run(async () => generateObject({ model: live.resolve(), schema: z.object({ ok: z.boolean() }), prompt: 'original', maxRetries: 0 }))
    const replay = createModelReplaySession('replay', recorded.recorded)
    await expect(replay.run(async () => generateObject({ model: resolveOffline(), schema: z.object({ changed: z.boolean() }), prompt: 'original', maxRetries: 0 }))).rejects.toThrow('model_fixture_request_mismatch')
    expect(() => replay.assertComplete()).toThrow('model_fixture_request_mismatch')
  })

  it('remembers a swallowed miss, rejects unused fixtures and isolates concurrent cases', async () => {
    const live = factory([textResult('one'), textResult('two')])
    const first = createModelReplaySession('record')
    const second = createModelReplaySession('record')
    await Promise.all([
      first.run(async () => generateText({ model: live.resolve(), prompt: 'one' })),
      second.run(async () => generateText({ model: live.resolve(), prompt: 'two' })),
    ])
    expect(first.recorded).toHaveLength(1)
    expect(second.recorded).toHaveLength(1)
    const missing = createModelReplaySession('replay')
    await missing.run(async () => { try { resolveOffline() } catch {} })
    expect(() => missing.assertComplete()).toThrow('model_fixture_missing')
    const unused = createModelReplaySession('replay', first.recorded)
    await unused.run(async () => undefined)
    expect(() => unused.assertComplete()).toThrow('model_fixture_unused')
    expect(isOfflineModelReplay()).toBe(false)
  })
})

it.each(['image', 'file'])('records and replays unsupported URL %s downloads without network access', async (kind) => {
  const live = factory([textResult('downloaded')])
  const originalFetch = globalThis.fetch
  const downloadFetch = jest.fn(async () => new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { 'content-type': 'image/png' } }))
  globalThis.fetch = downloadFetch
  const input = kind === 'image'
    ? { type: 'image' as const, image: new URL('https://example.com/synthetic.png') }
    : { type: 'file' as const, data: new URL('https://example.com/synthetic.pdf'), mediaType: 'application/pdf' }
  const invoke = (options: ReturnType<typeof live.resolveOptions>) => generateText({
    model: options.model as Model, experimental_download: options.download,
    messages: [{ role: 'user', content: [input] }], maxRetries: 0,
  })
  try {
    const recorded = createModelReplaySession('record')
    const before = await recorded.run(() => invoke(live.resolveOptions()))
    recorded.assertComplete()
    expect(downloadFetch).toHaveBeenCalledTimes(1)
    globalThis.fetch = async () => { throw new Error('Offline download attempted') }
    const replay = createModelReplaySession('replay', recorded.recorded)
    const after = await replay.run(() => invoke(createModelFactory(createContainer(), { registry: { resolveFirstConfigured: () => { throw new Error('Live resolution attempted') } }, env: {} }).resolveModel({ moduleId: 'test' })))
    replay.assertComplete()
    expect(after.text).toBe(before.text)
    expect(live.liveCall).toHaveBeenCalledTimes(1)
  } finally { globalThis.fetch = originalFetch }
})

it('replays URL attachments through the actual object runtime with its prepared SDK options', async () => {
  const { runAiAgentObject } = await import('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-runtime')
  const { seedAgentRegistryForTests, resetAgentRegistryForTests } = await import('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-registry')
  const { llmProviderRegistry } = await import('@open-mercato/ai-assistant/modules/ai_assistant/lib/llm-registry')
  const providers = [...llmProviderRegistry.list()]
  const live = factory([textResult('{"ok":true}')])
  const originalFetch = globalThis.fetch
  const downloadFetch = jest.fn(async () => new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { 'content-type': 'image/png' } }))
  try {
    llmProviderRegistry.reset()
    llmProviderRegistry.register({
      id: 'synthetic', name: 'Synthetic', envKeys: [], defaultModel: 'fixture-model', defaultModels: [],
      isConfigured: () => true, resolveApiKey: () => 'synthetic-only', getConfiguredEnvKey: () => '', createModel: () => live.model,
    })
    seedAgentRegistryForTests([{
      id: 'synthetic.attachment', moduleId: 'synthetic', label: 'Synthetic attachment', description: 'Synthetic attachment',
      executionMode: 'object', defaultProvider: 'synthetic', defaultModel: 'fixture-model',
      systemPrompt: 'Return a synthetic result.', allowedTools: [], mutationPolicy: 'read-only',
      output: { schemaName: 'SyntheticOutput', schema: z.object({ ok: z.boolean() }) },
    }])
    const invoke = () => runAiAgentObject({
      agentId: 'synthetic.attachment',
      authContext: { tenantId: 'synthetic-tenant', organizationId: 'synthetic-org', userId: 'synthetic-user', features: ['*'], isSuperAdmin: true },
      input: [{ id: 'synthetic-message', role: 'user', parts: [{ type: 'text', text: 'Inspect the image.' }, { type: 'file', mediaType: 'image/png', url: 'https://example.com/synthetic.png' }] }],
    })
    globalThis.fetch = downloadFetch
    const recorded = createModelReplaySession('record')
    const before = await recorded.run(invoke)
    recorded.assertComplete()
    expect(downloadFetch).toHaveBeenCalledTimes(1)
    llmProviderRegistry.reset()
    globalThis.fetch = async () => { throw new Error('Offline fetch attempted') }
    const replay = createModelReplaySession('replay', recorded.recorded)
    const after = await replay.run(invoke)
    replay.assertComplete()
    expect(before.mode).toBe('generate')
    expect(after.mode).toBe('generate')
    if (after.mode === 'generate' && before.mode === 'generate') expect(after.object).toEqual(before.object)
    expect(live.liveCall).toHaveBeenCalledTimes(1)
  } finally {
    globalThis.fetch = originalFetch
    resetAgentRegistryForTests()
    llmProviderRegistry.reset()
    for (const provider of providers) llmProviderRegistry.register(provider)
  }
})
