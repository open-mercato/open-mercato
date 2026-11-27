import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { withToolReplayContext, type ToolReplayFixture } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/llm-adapters/tool-replay-context'
import { withCaseModelFixtures } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/eval/modelFixtures'
import { compileCaseMocks, createMockResolver } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/eval/toolMocks'
import { createMockHarness, mockRecordContext, mockReplayContext } from './helpers/evalMockHarness'

/**
 * TC-AGENT-EVAL-MOCK-001 (library level, same harness as TC-AGENT-EVAL-REPLAY-001):
 * a case with a strict and an any mock runs the real SDK tool loop under model
 * fixtures with no recorded tool file. The real tool handler never runs.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-11-17-eval-case-tool-mocks.md (A-4).
 */
test('TC-AGENT-EVAL-MOCK-001: strict and any mocks answer the SDK tool loop offline without a tool recording', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'om-eval-mock-001-'))
  const originalFetch = globalThis.fetch
  let externalRequests = 0
  const ref = { agentId: 'synthetic.mocks', caseKey: 'case-1', fixturePath: null, trialIndex: 0 }
  const compiled = compileCaseMocks({
    match: 'strict',
    tools: [
      { tool: 'search_companies', args: { query: 'acme' }, output: [] },
      { tool: 'get_stock', match: 'any', output: { qty: 0 } },
    ],
  })
  const harness = createMockHarness([
    { toolName: 'search_companies', input: { query: 'acme' } },
    { toolName: 'get_stock', input: { sku: 'a' } },
    { toolName: 'get_stock', input: { sku: 'b' } },
  ])
  try {
    globalThis.fetch = async () => { externalRequests += 1; throw new Error('External request forbidden') }
    const recordResolver = createMockResolver(compiled)
    const recorded: ToolReplayFixture[] = []
    const recordedOutput = await withCaseModelFixtures({ mode: 'record', directory }, ref, () =>
      withToolReplayContext(mockRecordContext(recordResolver, recorded), () => harness.invoke(false)))
    expect(recordedOutput).toEqual({ ok: true })
    expect(recorded).toEqual([])
    expect(harness.counters.liveModelCalls).toBe(2)

    const resolver = createMockResolver(compiled)
    const replayed = await withCaseModelFixtures({ mode: 'replay', directory }, ref, () =>
      withToolReplayContext(mockReplayContext(resolver, []), () => harness.invoke(true)))
    expect(replayed).toEqual({ ok: true })
    expect(harness.counters.liveModelCalls).toBe(2)
    expect(harness.counters.liveToolCalls).toBe(0)
    expect(harness.toolOutputs.search_companies).toEqual([[], []])
    expect(harness.toolOutputs.get_stock).toEqual([{ qty: 0 }, { qty: 0 }, { qty: 0 }, { qty: 0 }])
    expect(resolver.usage()).toEqual({
      used: [
        { id: 'search_companies#0', tool: 'search_companies', match: 'strict', calls: 1 },
        { id: 'get_stock#0', tool: 'get_stock', match: 'any', calls: 2 },
      ],
      unused: [],
      unmatched: [],
      unmatchedTruncated: false,
    })
    expect(externalRequests).toBe(0)
  } finally {
    globalThis.fetch = originalFetch
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
