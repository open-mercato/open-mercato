import {
  coveredRuleTexts,
  duplicatePairIds,
  entryIdsOf,
  mergePairGroups,
  pairsOf,
  unresolvedCovers,
  withoutCoveredRules,
} from '../registry-helpers'
import { copy, type UsagePair } from '../types'

function pair(id: string, covers?: string[]): UsagePair {
  const side = { caption: copy(`test.${id}.caption`, 'Caption'), specimen: null }
  return { id, title: copy(`test.${id}.title`, 'Title'), do: side, avoid: side, covers }
}

describe('usage visual registry helpers', () => {
  it('merges groups and exposes pairs by entry id', () => {
    const merged = mergePairGroups([{ button: [pair('first')] }, { card: [pair('second'), pair('third')] }])
    expect(pairsOf(merged, 'button').map((item) => item.id)).toEqual(['first'])
    expect(pairsOf(merged, 'card').map((item) => item.id)).toEqual(['second', 'third'])
    expect(pairsOf(merged, 'unknown')).toEqual([])
  })

  it('rejects an entry declared in two groups', () => {
    expect(() => mergePairGroups([{ button: [pair('first')] }, { button: [pair('second')] }])).toThrow('button')
  })

  it('lists only entries that have at least one pair', () => {
    expect(entryIdsOf({ button: [pair('first')], card: [] })).toEqual(['button'])
  })

  it('collects the rule texts covered by the pairs of an entry', () => {
    const covered = coveredRuleTexts([pair('first', ['Rule one']), pair('second'), pair('third', ['Rule two', 'Rule one'])])
    expect([...covered].sort()).toEqual(['Rule one', 'Rule two'])
  })

  it('drops covered rules and keeps the order of the rest', () => {
    const rules = ['Rule one', 'Rule two', 'Rule three']
    expect(withoutCoveredRules(rules, new Set(['Rule two']))).toEqual(['Rule one', 'Rule three'])
    expect(withoutCoveredRules(rules, new Set())).toEqual(rules)
    expect(withoutCoveredRules(rules, new Set(rules))).toEqual([])
  })

  it('matches covered rules by exact text only', () => {
    expect(withoutCoveredRules(['Rule one.'], new Set(['Rule one']))).toEqual(['Rule one.'])
  })

  it('reports covered references that no longer match a rule', () => {
    const usage = { do: ['Rule one'], dont: ['Rule two'] }
    expect(unresolvedCovers([pair('first', ['Rule one', 'Rule two'])], usage)).toEqual([])
    expect(unresolvedCovers([pair('first', ['Rule one', 'Renamed rule'])], usage)).toEqual(['Renamed rule'])
  })

  it('reports duplicate pair ids inside an entry', () => {
    expect(duplicatePairIds([pair('first'), pair('second'), pair('first')])).toEqual(['first'])
    expect(duplicatePairIds([pair('first'), pair('second')])).toEqual([])
  })
})
