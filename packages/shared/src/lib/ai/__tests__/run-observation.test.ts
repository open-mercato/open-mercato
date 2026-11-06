import {
  RUN_OBSERVATION_MAX_KNOWLEDGE_KEYS,
  RUN_OBSERVATION_MAX_RETRIEVAL_HITS,
  bindRunObservation,
  createRunObservationCollector,
  getActiveRunObservationCollector,
  reportKnowledgeVersion,
  reportRetrieval,
} from '../run-observation'

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

describe('run observation collector', () => {
  it('is a no-op when no collector is bound', () => {
    expect(getActiveRunObservationCollector()).toBeUndefined()
    expect(() => reportKnowledgeVersion('rules.rule_set', 'v1')).not.toThrow()
    expect(() => reportRetrieval({ source: 'kb', queryHash: 'q1', k: 3, hits: [] })).not.toThrow()
  })

  it('collects knowledge versions and retrievals inside a bound scope', async () => {
    const collector = createRunObservationCollector()
    const result = await bindRunObservation(collector, async () => {
      reportKnowledgeVersion('rules.rule_set', '2026-10-20.3', { label: 'Rules' })
      await delay(1)
      reportRetrieval({ source: 'knowledge.articles', queryHash: 'abc', k: 2, hits: [{ ref: 'a1', score: 0.9 }] })
      return 'done'
    })
    expect(result).toBe('done')
    expect(collector.snapshot()).toEqual({
      knowledge: { 'rules.rule_set': { version: '2026-10-20.3', label: 'Rules' } },
      retrievals: [{ source: 'knowledge.articles', queryHash: 'abc', k: 2, hits: [{ ref: 'a1', score: 0.9 }] }],
      dropped: { knowledgeKeys: 0, retrievalHits: 0 },
    })
    reportKnowledgeVersion('rules.other', 'v2')
    expect(collector.snapshot().knowledge['rules.other']).toBeUndefined()
  })

  it('keeps concurrent runs isolated', async () => {
    const first = createRunObservationCollector()
    const second = createRunObservationCollector()
    await Promise.all([
      bindRunObservation(first, async () => {
        await delay(5)
        reportKnowledgeVersion('rules.rule_set', 'first')
        await delay(5)
        reportRetrieval({ source: 'first', queryHash: 'q', k: 1, hits: [] })
      }),
      bindRunObservation(second, async () => {
        reportKnowledgeVersion('rules.rule_set', 'second')
        await delay(8)
        reportRetrieval({ source: 'second', queryHash: 'q', k: 1, hits: [] })
      }),
    ])
    expect(first.snapshot().knowledge['rules.rule_set'].version).toBe('first')
    expect(first.snapshot().retrievals.map((entry) => entry.source)).toEqual(['first'])
    expect(second.snapshot().knowledge['rules.rule_set'].version).toBe('second')
    expect(second.snapshot().retrievals.map((entry) => entry.source)).toEqual(['second'])
  })

  it('isolates nested binds and restores the outer collector afterwards', () => {
    const outer = createRunObservationCollector()
    const inner = createRunObservationCollector()
    bindRunObservation(outer, () => {
      reportKnowledgeVersion('outer.key', 'v1')
      bindRunObservation(inner, () => {
        reportKnowledgeVersion('inner.key', 'v1')
      })
      reportKnowledgeVersion('outer.after', 'v1')
    })
    expect(Object.keys(outer.snapshot().knowledge)).toEqual(['outer.key', 'outer.after'])
    expect(Object.keys(inner.snapshot().knowledge)).toEqual(['inner.key'])
  })

  it('lets the last write per key win', () => {
    const collector = createRunObservationCollector()
    bindRunObservation(collector, () => {
      reportKnowledgeVersion('rules.rule_set', 'v1', { label: 'Old' })
      reportKnowledgeVersion('rules.rule_set', 'v2')
    })
    expect(collector.snapshot().knowledge).toEqual({ 'rules.rule_set': { version: 'v2' } })
  })

  it('ignores and counts invalid keys', () => {
    const collector = createRunObservationCollector()
    bindRunObservation(collector, () => {
      reportKnowledgeVersion('nodot', 'v1')
      reportKnowledgeVersion('Rules.RuleSet', 'v1')
      reportKnowledgeVersion('a.b.c', 'v1')
      reportKnowledgeVersion('rules.', 'v1')
      reportKnowledgeVersion('knowledge.article_set', 'v1')
    })
    const snapshot = collector.snapshot()
    expect(Object.keys(snapshot.knowledge)).toEqual(['knowledge.article_set'])
    expect(snapshot.dropped.knowledgeKeys).toBe(4)
  })

  it('drops new keys beyond the limit but still updates existing ones', () => {
    const collector = createRunObservationCollector()
    bindRunObservation(collector, () => {
      for (let index = 0; index < RUN_OBSERVATION_MAX_KNOWLEDGE_KEYS + 3; index += 1) {
        reportKnowledgeVersion(`module.key_${index}`, 'v1')
      }
      reportKnowledgeVersion('module.key_0', 'v2')
    })
    const snapshot = collector.snapshot()
    expect(Object.keys(snapshot.knowledge)).toHaveLength(RUN_OBSERVATION_MAX_KNOWLEDGE_KEYS)
    expect(snapshot.knowledge['module.key_0'].version).toBe('v2')
    expect(snapshot.knowledge[`module.key_${RUN_OBSERVATION_MAX_KNOWLEDGE_KEYS}`]).toBeUndefined()
    expect(snapshot.dropped.knowledgeKeys).toBe(3)
  })

  it('caps hits per retrieval and counts the excess', () => {
    const collector = createRunObservationCollector()
    const hits = Array.from({ length: RUN_OBSERVATION_MAX_RETRIEVAL_HITS + 7 }, (_, index) => ({ ref: `doc-${index}` }))
    bindRunObservation(collector, () => {
      reportRetrieval({ source: 'kb', queryHash: 'q', k: hits.length, hits })
      reportRetrieval({ source: 'kb', queryHash: 'q2', k: 1, hits: [{ ref: 'x' }] })
    })
    const snapshot = collector.snapshot()
    expect(snapshot.retrievals[0].hits).toHaveLength(RUN_OBSERVATION_MAX_RETRIEVAL_HITS)
    expect(snapshot.retrievals[1].hits).toEqual([{ ref: 'x' }])
    expect(snapshot.dropped.retrievalHits).toBe(7)
  })
})
