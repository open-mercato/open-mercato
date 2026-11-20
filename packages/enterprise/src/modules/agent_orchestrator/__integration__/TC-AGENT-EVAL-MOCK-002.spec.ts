import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { withToolReplayContext, type ToolReplayFixture } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/llm-adapters/tool-replay-context'
import { withCaseModelFixtures } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/eval/modelFixtures'
import { createFileToolFixtureStore } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/eval/toolFixtures'
import {
  compileCaseMocks,
  createMockResolver,
  requiredUnusedMockIds,
} from '@open-mercato/enterprise/modules/agent_orchestrator/lib/eval/toolMocks'
import { createMockHarness, mockRecordContext, mockReplayContext } from './helpers/evalMockHarness'

/**
 * TC-AGENT-EVAL-MOCK-002 (library level): a required mock the agent never
 * calls is reported unused and required (the input of the trial-failure rule),
 * and in a mock + recording case the mocked call is answered inline while the
 * other call is answered by the recording.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-11-17-eval-case-tool-mocks.md (A-4).
 */
test('TC-AGENT-EVAL-MOCK-002: required unused mocks and mock + recording precedence', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'om-eval-mock-002-'))
  const originalFetch = globalThis.fetch
  const ref = { agentId: 'synthetic.mocks', caseKey: 'case-2', fixturePath: null, trialIndex: 0 }
  const compiled = compileCaseMocks({
    match: 'any',
    tools: [
      { tool: 'search_companies', output: [{ id: 'acme' }] },
      { id: 'stock', tool: 'get_stock', output: { qty: 3 }, required: true },
    ],
  })
  const harness = createMockHarness([
    { toolName: 'search_companies', input: { query: 'acme' } },
    { toolName: 'list_orders', input: { company: 'acme' } },
  ])
  const store = createFileToolFixtureStore({ recordDir: directory, replayDir: directory })
  try {
    globalThis.fetch = async () => { throw new Error('External request forbidden') }
    const recordResolver = createMockResolver(compiled)
    const recorded: ToolReplayFixture[] = []
    await withCaseModelFixtures({ mode: 'record', directory }, ref, () =>
      withToolReplayContext(mockRecordContext(recordResolver, recorded), () => harness.invoke(false)))
    expect(recorded.map((entry) => entry.toolName)).toEqual(['list_orders'])
    expect(recordResolver.usage().unmatched).toEqual([expect.objectContaining({ tool: 'list_orders', resolution: 'live' })])
    expect(harness.counters.liveToolCalls).toBe(1)
    await store.save(ref, recorded)

    const loaded = await store.load(ref)
    if (!loaded.ok) throw new Error('Recorded tool fixture missing')
    const resolver = createMockResolver(compiled)
    const replayed = await withCaseModelFixtures({ mode: 'replay', directory }, ref, () =>
      withToolReplayContext(mockReplayContext(resolver, loaded.fixtures), () => harness.invoke(true)))
    expect(replayed).toEqual({ ok: true })
    expect(harness.counters.liveToolCalls).toBe(1)
    expect(harness.toolOutputs.list_orders).toEqual([{ live: 'list_orders' }, { live: 'list_orders' }])
    const usage = resolver.usage()
    expect(usage.used).toEqual([{ id: 'search_companies#0', tool: 'search_companies', match: 'any', calls: 1 }])
    expect(usage.unused).toEqual([{ id: 'stock', tool: 'get_stock', required: true }])
    expect(usage.unmatched).toEqual([expect.objectContaining({ tool: 'list_orders', resolution: 'fixture', occurrence: 0 })])
    expect(requiredUnusedMockIds(usage)).toEqual(['stock'])
  } finally {
    globalThis.fetch = originalFetch
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
