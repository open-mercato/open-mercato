import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { createContainer } from 'awilix'
import { generateText, Output, stepCountIs, tool, wrapLanguageModel } from 'ai'
import { z } from 'zod'
import { createModelFactory, type CreateModelFactoryDependencies } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory'
import {
  withToolReplayContext, resolveToolReplayDecision, buildRecordedToolFixture,
  type ToolReplayFixture, type ToolReplayMiss,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/llm-adapters/tool-replay-context'
import { withCaseModelFixtures } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/eval/modelFixtures'
import { createFileToolFixtureStore, describeToolReplayMisses } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/eval/toolFixtures'

type Model = ReturnType<typeof wrapLanguageModel>
type Result = Awaited<ReturnType<Model['doGenerate']>>

test('TC-AGENT-EVAL-REPLAY-001: disk fixtures replay the real SDK tool loop and output validation without live calls', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'om-eval-offline-'))
  const originalFetch = globalThis.fetch
  let liveModelCalls = 0
  let liveToolCalls = 0
  let externalRequests = 0
  const ref = { agentId: 'synthetic.offline', caseKey: 'case-1', fixturePath: null, trialIndex: 0 }
  const usage: Result['usage'] = {
    inputTokens: { total: 2, noCache: 2, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 2, text: 2, reasoning: 0 },
  }
  const model: Model = {
    specificationVersion: 'v4', provider: 'synthetic', modelId: 'synthetic-model', supportedUrls: {},
    async doGenerate() {
      liveModelCalls += 1
      return liveModelCalls === 1
        ? { content: [{ type: 'tool-call', toolCallId: 'fixture-call', toolName: 'lookup', input: '{"key":"synthetic"}' }], finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage, warnings: [] }
        : { content: [{ type: 'text', text: '{"ok":true}' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] }
    },
    async doStream() { throw new Error('Unexpected streaming call') },
  }
  const provider = { id: 'synthetic', defaultModel: 'synthetic-model', resolveApiKey: () => 'synthetic-only', createModel: () => model }
  const recordDeps = { registry: { resolveFirstConfigured: () => provider }, env: {} } as unknown as CreateModelFactoryDependencies
  const replayDeps: CreateModelFactoryDependencies = {
    registry: { resolveFirstConfigured: () => { throw new Error('Offline provider resolution attempted') } }, env: {},
  }
  const store = createFileToolFixtureStore({ recordDir: directory, replayDir: directory })
  const invoke = async (deps: CreateModelFactoryDependencies) => {
    const resolved = createModelFactory(createContainer(), deps).resolveModel({ moduleId: 'synthetic' })
    const result = await generateText({
      model: resolved.model as Model, prompt: 'Look up the synthetic fixture and answer ok.',
      output: Output.object({ schema: z.object({ ok: z.boolean() }) }),
      stopWhen: stepCountIs(3), maxRetries: 0,
      tools: { lookup: tool({ inputSchema: z.object({ key: z.string() }), async execute(args, context) {
        const decision = resolveToolReplayDecision({ toolName: 'lookup', args, isMutation: false, toolCallId: context.toolCallId })
        if (decision.kind === 'replay') return decision.fixture.output
        liveToolCalls += 1
        const output = { value: 'synthetic' }
        if (decision.kind === 'record') decision.sink(buildRecordedToolFixture(decision.call, { output }))
        return output
      } }) },
    })
    return { output: result.output, steps: result.steps.length }
  }
  try {
    globalThis.fetch = async () => { externalRequests += 1; throw new Error('External request forbidden') }
    const tools: ToolReplayFixture[] = []
    const recorded = await withCaseModelFixtures({ mode: 'record', directory }, ref, () =>
      withToolReplayContext({ mode: 'record', sink: (fixture) => tools.push(fixture) }, () => invoke(recordDeps)))
    await store.save(ref, tools)
    expect(recorded.output).toEqual({ ok: true })
    expect(recorded.steps).toBe(2)
    expect(liveModelCalls).toBe(2)
    expect(liveToolCalls).toBe(1)
    for (let trial = 0; trial < 2; trial++) {
      const loaded = await store.load(ref)
      expect(loaded.ok).toBeTruthy()
      if (!loaded.ok) throw new Error('Recorded tool fixture missing')
      const replayed = await withCaseModelFixtures({ mode: 'replay', directory }, ref, () =>
        withToolReplayContext({ mode: 'replay', fixtures: loaded.fixtures, match: 'strict', onMiss: 'error' }, () => invoke(replayDeps)))
      expect(replayed).toEqual(recorded)
    }
    const misses: ToolReplayMiss[] = []
    await expect(withCaseModelFixtures({ mode: 'replay', directory }, ref, () =>
      withToolReplayContext({ mode: 'replay', fixtures: [], match: 'strict', onMiss: 'error', observeMiss: (miss) => misses.push(miss) }, () => invoke(replayDeps)))).rejects.toThrow()
    expect(describeToolReplayMisses(misses)).toContain('tool_fixture_missing')
    expect(liveModelCalls).toBe(2)
    expect(liveToolCalls).toBe(1)
    expect(externalRequests).toBe(0)
  } finally {
    globalThis.fetch = originalFetch
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
