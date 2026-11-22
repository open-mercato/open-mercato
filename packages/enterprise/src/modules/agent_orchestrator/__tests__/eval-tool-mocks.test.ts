import {
  computeToolArgsKey,
  type ToolReplayCall,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/llm-adapters/tool-replay-context'
import {
  EVAL_MOCK_UNMATCHED_JOURNAL_MAX,
  buildEvalRunMockSummary,
  compileCaseMocks,
  createMockResolver,
  normalizeCaseMocks,
  requiredUnusedMockIds,
  type EvalCaseMockUsage,
} from '../lib/eval/toolMocks'

function call(toolName: string, args: unknown, extra: Partial<ToolReplayCall> = {}): ToolReplayCall {
  return { toolName, args, argsKey: computeToolArgsKey(args), occurrence: 0, ordinal: 0, toolCallId: null, ...extra }
}

describe('eval tool mocks', () => {
  it('fills default ids per tool and applies the case default match', () => {
    expect(
      normalizeCaseMocks({
        match: 'any',
        tools: [
          { tool: 'catalog.get_stock', output: 1 },
          { tool: 'customers.search', match: 'strict', args: { q: 'a' }, output: [] },
          { tool: 'catalog.get_stock', output: 2, required: true },
          { id: 'named', tool: 'customers.search', output: [] },
        ],
      }),
    ).toEqual([
      { id: 'catalog.get_stock#0', tool: 'catalog.get_stock', match: 'any', output: 1, required: false },
      { id: 'customers.search#0', tool: 'customers.search', match: 'strict', args: { q: 'a' }, output: [], required: false },
      { id: 'catalog.get_stock#1', tool: 'catalog.get_stock', match: 'any', output: 2, required: true },
      { id: 'named', tool: 'customers.search', match: 'any', output: [], required: false },
    ])
  })

  it('answers repeated strict mocks with the same args in file order', () => {
    const resolver = createMockResolver(
      compileCaseMocks({
        tools: [
          { tool: 't', args: { q: 1 }, output: 'first' },
          { tool: 't', args: { q: 1 }, output: 'second' },
        ],
      }),
    )
    expect(resolver.lookup(call('t', { q: 1 }))?.output).toBe('first')
    expect(resolver.lookup(call('t', { q: 1 }, { occurrence: 1 }))?.output).toBe('second')
    expect(resolver.lookup(call('t', { q: 1 }, { occurrence: 2 }))).toBeNull()
    expect(resolver.lookup(call('t', { q: 2 }))).toBeNull()
  })

  it('consumes ordered mocks independently of strict mocks', () => {
    const resolver = createMockResolver(
      compileCaseMocks({
        tools: [
          { tool: 't', match: 'ordered', output: 'o1' },
          { tool: 't', args: { q: 'x' }, output: 's' },
          { tool: 't', match: 'ordered', output: 'o2' },
        ],
      }),
    )
    expect(resolver.lookup(call('t', { q: 'y' }))?.output).toBe('o1')
    expect(resolver.lookup(call('t', { q: 'x' }))?.output).toBe('s')
    expect(resolver.lookup(call('t', { q: 'x' }, { occurrence: 1 }))?.output).toBe('o2')
    expect(resolver.lookup(call('t', { q: 'z' }))).toBeNull()
  })

  it('never consumes any mocks and applies strict, then ordered, then any', () => {
    const resolver = createMockResolver(
      compileCaseMocks({
        tools: [
          { tool: 't', match: 'any', output: 'any' },
          { tool: 't', match: 'ordered', output: 'ordered' },
          { tool: 't', args: { q: 1 }, output: 'strict' },
        ],
      }),
    )
    expect(resolver.lookup(call('t', { q: 1 }))?.output).toBe('strict')
    expect(resolver.lookup(call('t', { q: 1 }, { occurrence: 1 }))?.output).toBe('ordered')
    expect(resolver.lookup(call('t', { q: 1 }, { occurrence: 2 }))?.output).toBe('any')
    expect(resolver.lookup(call('t', { q: 9 }))?.output).toBe('any')
    expect(resolver.usage().used).toEqual([
      { id: 't#0', tool: 't', match: 'any', calls: 2 },
      { id: 't#1', tool: 't', match: 'ordered', calls: 1 },
      { id: 't#2', tool: 't', match: 'strict', calls: 1 },
    ])
  })

  it('builds an error fixture and keeps the call identity on a hit', () => {
    const resolver = createMockResolver(compileCaseMocks({ match: 'any', tools: [{ tool: 't', error: 'upstream timeout' }] }))
    const hit = resolver.lookup(call('t', { a: 1 }, { occurrence: 3 }))
    expect(hit).toEqual({
      toolName: 't',
      argsKey: computeToolArgsKey({ a: 1 }),
      args: { a: 1 },
      output: null,
      error: { message: 'upstream timeout' },
      occurrence: 3,
    })
  })

  it('isolates consumption state per resolver (per trial)', () => {
    const compiled = compileCaseMocks({ match: 'ordered', tools: [{ tool: 't', output: 'once' }] })
    const first = createMockResolver(compiled)
    const second = createMockResolver(compiled)
    expect(first.lookup(call('t', {}))?.output).toBe('once')
    expect(first.lookup(call('t', {}))).toBeNull()
    expect(second.lookup(call('t', {}))?.output).toBe('once')
  })

  it('reports used, unused (with required) and a capped unmatched journal', () => {
    const resolver = createMockResolver(
      compileCaseMocks({
        match: 'any',
        tools: [
          { tool: 'used', output: 1 },
          { id: 'stock', tool: 'stock', output: 2, required: true },
          { tool: 'spare', output: 3 },
        ],
      }),
    )
    resolver.lookup(call('used', {}))
    for (let index = 0; index < EVAL_MOCK_UNMATCHED_JOURNAL_MAX + 2; index += 1) {
      resolver.observeUnmatched({ toolName: 'other', argsKey: 'k', occurrence: index, toolCallId: `c${index}` }, 'fixture')
    }
    const usage = resolver.usage()
    expect(usage.used).toEqual([{ id: 'used#0', tool: 'used', match: 'any', calls: 1 }])
    expect(usage.unused).toEqual([
      { id: 'stock', tool: 'stock', required: true },
      { id: 'spare#0', tool: 'spare', required: false },
    ])
    expect(usage.unmatched).toHaveLength(EVAL_MOCK_UNMATCHED_JOURNAL_MAX)
    expect(usage.unmatched[0]).toEqual({ tool: 'other', argsKey: 'k', occurrence: 0, toolCallId: 'c0', resolution: 'fixture' })
    expect(usage.unmatchedTruncated).toBe(true)
    expect(requiredUnusedMockIds(usage)).toEqual(['stock'])
  })

  it('keeps per-trial usage in the suite summary and drops it above the size cap', () => {
    const usage: EvalCaseMockUsage = {
      used: [{ id: 'a', tool: 'a', match: 'strict', calls: 1 }],
      unused: [{ id: 'b', tool: 'b', required: true }],
      unmatched: [{ tool: 'c', argsKey: 'k', occurrence: 0, toolCallId: null, resolution: 'error' }],
      unmatchedTruncated: false,
    }
    const totals = { cases: 2, used: 2, unused: 2, requiredUnused: 2, unmatched: 2 }
    expect(buildEvalRunMockSummary([{ caseRunId: 'r1', usage }, { caseRunId: 'r2', usage }])).toEqual({
      byCaseRun: { r1: usage, r2: usage },
      totals,
    })
    expect(buildEvalRunMockSummary([{ caseRunId: 'r1', usage }, { caseRunId: 'r2', usage }], 10)).toEqual({
      totals,
      truncated: true,
    })
  })
})
