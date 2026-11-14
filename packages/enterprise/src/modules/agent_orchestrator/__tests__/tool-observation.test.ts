import type { RunObservationSnapshot } from '@open-mercato/shared/lib/ai/run-observation'
import type { TraceSpanIngest } from '../data/validators'
import {
  TOOL_OBSERVATION_MAX_CHARS,
  TOOL_OBSERVATION_MAX_HITS_PER_RETRIEVAL,
  TOOL_OBSERVATION_MAX_RETRIEVALS,
  TOOL_OBSERVATION_SPAN_NAME,
  buildToolObservationAttributes,
  foldToolObservationsIntoToolSpans,
  hasToolObservationReports,
  mergeToolObservationKnowledge,
  parseToolObservationRecord,
  toolObservationExternalSpanId,
  type ToolObservationRecord,
} from '../lib/trace/toolObservation'

function snapshot(overrides: Partial<RunObservationSnapshot> = {}): RunObservationSnapshot {
  return {
    knowledge: {},
    retrievals: [],
    dropped: { knowledgeKeys: 0, retrievalHits: 0 },
    ...overrides,
  }
}

function toolSpan(name: string, sequence: number): TraceSpanIngest {
  return {
    externalSpanId: `tc-${sequence}`,
    sequence,
    name,
    kind: 'tool',
    startedAt: new Date(Date.UTC(2026, 9, 28, 10, 0, sequence)).toISOString(),
    status: 'ok',
  }
}

function record(toolName: string, second: number, knowledge: Record<string, string>): ToolObservationRecord {
  return {
    toolName,
    startedAt: new Date(Date.UTC(2026, 9, 28, 10, 0, second)).toISOString(),
    knowledge,
    retrievals: [],
  }
}

describe('tool observation attributes', () => {
  it('builds an idempotent external span id under the run', () => {
    expect(toolObservationExternalSpanId('run-1', 'corr-1')).toBe('run-1:obs:corr-1')
    expect(toolObservationExternalSpanId('run-1', 'x'.repeat(400))).toHaveLength(200)
  })

  it('detects whether anything was reported', () => {
    expect(hasToolObservationReports(snapshot())).toBe(false)
    expect(hasToolObservationReports(snapshot({ knowledge: { 'kb.policy': { version: 'v1' } } }))).toBe(true)
    expect(hasToolObservationReports(snapshot({ retrievals: [{ source: 'kb', queryHash: 'q', k: 1, hits: [] }] }))).toBe(
      true,
    )
  })

  it('keeps knowledge versions and retrieval ids/scores only', () => {
    const attributes = buildToolObservationAttributes(
      'customers.search',
      snapshot({
        knowledge: { 'kb.policy': { version: 'v3', label: 'Refund policy' } },
        retrievals: [{ source: 'kb', queryHash: 'qh', k: 3, hits: [{ ref: 'doc-1', score: 0.8, version: 'r2' }] }],
      }),
    )
    expect(attributes).toEqual({
      'om.tool.name': 'customers.search',
      'om.knowledge': { 'kb.policy': 'v3' },
      'om.retrieval': [{ source: 'kb', queryHash: 'qh', k: 3, hitCount: 1, hits: [{ ref: 'doc-1', score: 0.8, version: 'r2' }] }],
    })
  })

  it('caps retrievals, hits and the serialized size', () => {
    const retrievals = Array.from({ length: TOOL_OBSERVATION_MAX_RETRIEVALS + 3 }, (_, index) => ({
      source: `source-${index}`,
      queryHash: `hash-${index}`,
      k: 50,
      hits: Array.from({ length: 50 }, (__, hitIndex) => ({ ref: `ref-${index}-${hitIndex}-${'x'.repeat(40)}`, score: 0.5 })),
    }))
    const attributes = buildToolObservationAttributes('kb.search', snapshot({ retrievals }))
    expect(attributes['om.retrieval'].length).toBeLessThanOrEqual(TOOL_OBSERVATION_MAX_RETRIEVALS)
    for (const retrieval of attributes['om.retrieval']) {
      expect(retrieval.hits.length).toBeLessThanOrEqual(TOOL_OBSERVATION_MAX_HITS_PER_RETRIEVAL)
    }
    expect(attributes['om.observation.truncated']).toBe(true)
    expect(attributes['om.observation.dropped']).toMatchObject({ retrievals: 3 })
    expect(JSON.stringify(attributes).length).toBeLessThanOrEqual(TOOL_OBSERVATION_MAX_CHARS)
  })
})

describe('tool observation records', () => {
  it('parses a tool.observation span and ignores other spans', () => {
    const startedAt = new Date('2026-10-28T10:00:00.000Z')
    expect(
      parseToolObservationRecord({
        name: TOOL_OBSERVATION_SPAN_NAME,
        startedAt,
        attributes: { 'om.tool.name': 'kb.search', 'om.knowledge': { 'kb.policy': 'v1' }, 'om.retrieval': [] },
      }),
    ).toEqual({ toolName: 'kb.search', startedAt: startedAt.toISOString(), knowledge: { 'kb.policy': 'v1' }, retrievals: [] })
    expect(parseToolObservationRecord({ name: 'llm', startedAt, attributes: {} })).toBeNull()
    expect(parseToolObservationRecord({ name: TOOL_OBSERVATION_SPAN_NAME, startedAt, attributes: null })).toBeNull()
  })

  it('merges knowledge with the latest observation winning', () => {
    expect(
      mergeToolObservationKnowledge([
        record('kb.search', 5, { 'kb.policy': 'v2' }),
        record('kb.search', 1, { 'kb.policy': 'v1', 'kb.faq': 'f1' }),
      ]),
    ).toEqual({ knowledge: { 'kb.policy': { version: 'v2' }, 'kb.faq': { version: 'f1' } } })
  })

  it('attributes observations to tool spans by normalized name and order', () => {
    const spans = [
      toolSpan('open-mercato_kb_search', 0),
      toolSpan('open-mercato_customers_get', 1),
      toolSpan('open-mercato_kb_search', 2),
    ]
    const folded = foldToolObservationsIntoToolSpans(spans, [
      record('kb.search', 3, { 'kb.policy': 'second' }),
      record('kb.search', 1, { 'kb.policy': 'first' }),
      record('orders.lookup', 2, { 'orders.rules': 'v1' }),
    ])
    expect(folded[0].attributes).toEqual({ 'om.knowledge': { 'kb.policy': 'first' } })
    expect(folded[1].attributes).toBeUndefined()
    expect(folded[2].attributes).toEqual({ 'om.knowledge': { 'kb.policy': 'second' } })
  })

  it('returns the spans unchanged without observations', () => {
    const spans = [toolSpan('open-mercato_kb_search', 0)]
    expect(foldToolObservationsIntoToolSpans(spans, [])).toEqual(spans)
  })
})
