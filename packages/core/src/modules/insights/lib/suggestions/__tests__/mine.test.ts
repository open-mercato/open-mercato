import { wilsonLowerBound } from '../../analytics/stats'
import { XRAY_STATS_GUARDS } from '../../analytics/types'
import { XRAY_SUGGESTION_THRESHOLDS } from '../constants'
import { mineSuggestions, settableFields, suggestionSignature, triggerOf, type MiningCase } from '../mine'
import {
  HOUR_MS,
  MINING_NOW,
  MINING_WINDOW,
  MINUTE_MS,
  TEST_THRESHOLDS,
  actorOf,
  caseIdOf,
  creation,
  dealCases,
  dealRows,
  miningCaseOf,
  plainDealProcess,
  stepRow,
} from './suggestionsTestSupport'

const process = plainDealProcess()

function mine(cases: MiningCase[], thresholds = TEST_THRESHOLDS) {
  return mineSuggestions({ process, cases, window: MINING_WINDOW, thresholds })
}

const qaReview = (delayMs = 5 * MINUTE_MS) => ({ key: 'status:qa_review', delayMs })

describe('mineSuggestions — the rule and its statistics', () => {
  it('finds "created → status:qa_review" with support, trigger count, Wilson confidence, lift and distinct actors', () => {
    const result = mine(dealCases(8, () => ({ followup: qaReview() })))
    expect(result).toHaveLength(1)
    const [rule] = result
    expect(rule.trigger).toEqual({ activityKey: 'created', activityKind: 'lifecycle', field: null, value: null })
    expect(rule.condition).toBeNull()
    expect(rule.followups).toEqual([{ field: 'status', value: 'qa_review', activityKind: 'stage' }])
    expect(rule.windowSeconds).toBe(600)
    expect(rule.support).toBe(8)
    expect(rule.triggerCount).toBe(8)
    expect(rule.supportCases).toBe(8)
    expect(rule.confidenceRatio).toBe(1)
    expect(rule.confidence).toBeCloseTo(wilsonLowerBound(8, 8) as number, 12)
    expect(rule.baseRate).toBeCloseTo(8 / 24, 12)
    expect(rule.lift).toBeCloseTo(3, 12)
    expect(rule.distinctActorCount).toBe(3)
    expect(rule.processKey).toBe('test.deal')
    expect(rule.signatureHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('never stores an actor identity: the result carries counts only', () => {
    const [rule] = mine(dealCases(8, () => ({ followup: qaReview() })))
    expect(JSON.stringify(rule)).not.toMatch(/tk1:|actor-/)
  })

  it('counts a person-valued follow-up field as a trigger without its value and never as a follow-up', () => {
    const rows = dealRows(1, { ownerChanges: 1 })
    const ownerEvent = miningCaseOf(caseIdOf(1), rows).events.find((event) => event.activityKind === 'followup')
    expect(ownerEvent && triggerOf(ownerEvent, MINING_WINDOW)).toEqual({ activityKey: 'ownerUserId:changed', activityKind: 'followup', field: 'ownerUserId', value: null })
    expect(Array.from(settableFields(process).keys())).toEqual(['status', 'stageId', 'priority'])
  })
})

describe('mineSuggestions — thresholds (boundaries)', () => {
  it('support: exactly the minimum passes, one less does not', () => {
    const atMinimum = dealCases(7, () => ({ followup: qaReview() }))
    expect(mine(atMinimum, { ...TEST_THRESHOLDS, minSupport: 7 })).toHaveLength(1)
    expect(mine(atMinimum, { ...TEST_THRESHOLDS, minSupport: 8 })).toEqual([])
  })

  it('confidence: the Wilson lower bound must reach 0.6 (6 of 6 passes, 5 of 5 does not)', () => {
    expect(wilsonLowerBound(6, 6)).toBeGreaterThanOrEqual(0.6)
    expect(wilsonLowerBound(5, 5)).toBeLessThan(0.6)
    expect(mine(dealCases(6, () => ({ followup: qaReview() })))).toHaveLength(1)
    expect(mine(dealCases(5, () => ({ followup: qaReview() })))).toEqual([])
  })

  it('confidence: misses lower the bound below 0.6 even with enough support', () => {
    const cases = dealCases(12, (index) => ({ followup: index <= 8 ? qaReview() : null }))
    expect(wilsonLowerBound(8, 12)).toBeLessThan(0.6)
    expect(mine(cases)).toEqual([])
  })

  it('lift: exactly 2 passes, below 2 does not', () => {
    const exactlyTwo = dealCases(8, () => ({ followup: qaReview(), ownerChanges: 1 }))
    const [rule] = mine(exactlyTwo)
    expect(rule.lift).toBeCloseTo(2, 12)
    expect(mine(dealCases(8, () => ({ followup: qaReview(), ownerChanges: 0 })))).toEqual([])
  })

  it('distinct actors: three people pass, two do not (one dominant actor is never a rule)', () => {
    expect(mine(dealCases(8, (index) => ({ actor: actorOf(index % 3), followup: qaReview() })))[0]?.distinctActorCount).toBe(3)
    expect(mine(dealCases(8, (index) => ({ actor: actorOf(index % 2), followup: qaReview() })))).toEqual([])
    expect(mine(dealCases(8, () => ({ actor: actorOf(1), followup: qaReview() })))).toEqual([])
  })

  it('distinct actors: the platform threshold is the analytics three-actor rule', () => {
    expect(XRAY_SUGGESTION_THRESHOLDS.minDistinctActors).toBe(XRAY_STATS_GUARDS.minDistinctActors)
    const platform = { ...TEST_THRESHOLDS, minDistinctActors: XRAY_SUGGESTION_THRESHOLDS.minDistinctActors }
    expect(mine(dealCases(8, (index) => ({ actor: actorOf(index % 2), followup: qaReview() })), platform)).toEqual([])
    expect(mine(dealCases(8, (index) => ({ actor: actorOf(index % 3), followup: qaReview() })), platform)).toHaveLength(1)
  })

  it('cases: the supporting cases must reach k', () => {
    const cases = dealCases(8, () => ({ followup: qaReview() }))
    expect(mine(cases, { ...TEST_THRESHOLDS, minCases: 8 })).toHaveLength(1)
    expect(mine(cases, { ...TEST_THRESHOLDS, minCases: 9 })).toEqual([])
  })
})

describe('mineSuggestions — population', () => {
  it('excludes corrections: A→B→A by the same actor inside the debounce window is not a follow-up', () => {
    const cases = Array.from({ length: 8 }, (_, position) => {
      const index = position + 1
      const caseId = caseIdOf(index)
      const rows = dealRows(index, { followup: qaReview() })
      const actor = actorOf(index % 3)
      rows.push(stepRow(caseId, { key: 'status:open', atMs: MINING_NOW - 20 * 86_400_000 + index * HOUR_MS + 6 * MINUTE_MS, actor }))
      return miningCaseOf(caseId, rows, { debounceMs: 120_000 })
    })
    expect(cases[0].events.map((event) => event.activityKey)).not.toContain('status:qa_review')
    expect(mine(cases)).toEqual([])
  })

  it('keeps a settled follow-up and drops only the debounced intermediate value', () => {
    const cases = Array.from({ length: 8 }, (_, position) => {
      const index = position + 1
      const caseId = caseIdOf(index)
      const start = MINING_NOW - 20 * 86_400_000 + index * HOUR_MS
      const actor = actorOf(index % 3)
      const rows = dealRows(index, { followup: { key: 'status:draft', delayMs: 4 * MINUTE_MS } })
      rows.push(stepRow(caseId, { key: 'status:qa_review', atMs: start + 5 * MINUTE_MS, actor }))
      return miningCaseOf(caseId, rows, { debounceMs: 120_000 })
    })
    expect(mine(cases).map((rule) => rule.followups[0].value)).toEqual(['qa_review'])
  })

  it.each([
    ['automated (workflow)', { cause: 'workflow' }],
    ['legacy (no cause recorded)', { cause: null }],
    ['a sync run', { sync: true }],
  ])('never counts %s follow-ups', (_label, followup) => {
    expect(mine(dealCases(8, () => ({ followup: { ...qaReview(), ...followup } })))).toEqual([])
  })

  it('never counts automated or legacy triggers', () => {
    expect(mine(dealCases(8, () => ({ createdCause: 'workflow', followup: qaReview() })))).toEqual([])
    expect(mine(dealCases(8, () => ({ createdCause: null, followup: qaReview() })))).toEqual([])
  })

  it('never treats the initial values of the creation as triggers or follow-ups', () => {
    const cases = dealCases(8, () => ({ followup: null }))
    expect(mine(cases)).toEqual([])
    const initial = cases[0].events.find((event) => event.activityKey === 'status:open')
    expect(initial && triggerOf(initial, MINING_WINDOW)).toBeNull()
  })

  it('ignores the other / none placeholders as follow-up values', () => {
    expect(mine(dealCases(8, () => ({ followup: { key: 'status:other', delayMs: MINUTE_MS } })))).toEqual([])
    expect(mine(dealCases(8, () => ({ followup: { key: 'status:none', delayMs: MINUTE_MS } })))).toEqual([])
  })

  it('only counts triggers inside the mining window', () => {
    const old = dealCases(8, (index) => ({ startMs: MINING_NOW - 31 * 86_400_000 + index * MINUTE_MS, followup: qaReview() }))
    expect(mine(old)).toEqual([])
  })
})

describe('mineSuggestions — window selection and censoring', () => {
  it('reports the smallest window in which every threshold holds', () => {
    expect(mine(dealCases(8, () => ({ followup: qaReview(30 * MINUTE_MS) })))[0]?.windowSeconds).toBe(3600)
    expect(mine(dealCases(8, () => ({ followup: qaReview(5 * HOUR_MS), ownerChanges: 0 })))).toEqual([])
    const late = dealCases(8, () => ({ followup: qaReview(5 * HOUR_MS) }))
    expect(late[0].events.map((event) => event.activityKey)).toContain('status:qa_review')
  })

  it('leaves out trigger occurrences whose window has not ended yet (right-censored)', () => {
    const settled = dealCases(8, () => ({ followup: qaReview() }))
    const pending = dealCases(4, (index) => ({ startMs: MINING_NOW - 2 * MINUTE_MS + index * 1000, followup: null, ownerChanges: 0 }), { offset: 100 })
    const [rule] = mine([...settled, ...pending])
    expect(rule.triggerCount).toBe(8)
    expect(rule.support).toBe(8)
    const elapsed = dealCases(4, (index) => ({ startMs: MINING_NOW - 20 * MINUTE_MS + index * 1000, followup: null, ownerChanges: 0 }), { offset: 200 })
    const [perWindow] = mine([...settled, ...elapsed])
    expect(perWindow.windowSeconds).toBe(3600)
    expect(perWindow.triggerCount).toBe(8)
  })
})

describe('mineSuggestions — conditions', () => {
  it('prefers the unconditioned rule when it passes', () => {
    expect(mine(dealCases(8, () => ({ followup: { key: `stageId:55555555-0000-4000-8000-00000000000a`, delayMs: MINUTE_MS } })))[0]?.condition).toBeNull()
  })

  it('reports the best passing condition (a root field value right after the trigger) when the unconditioned rule fails', () => {
    const cases = [
      ...dealCases(8, () => ({ createdStatus: 'open', followup: { key: 'stageId:55555555-0000-4000-8000-00000000000a', delayMs: MINUTE_MS } })),
      ...dealCases(8, () => ({ createdStatus: 'draft', followup: null }), { offset: 100 }),
    ]
    const [rule] = mine(cases)
    expect(rule.condition).toEqual({ field: 'status', value: 'open' })
    expect(rule.triggerCount).toBe(8)
    expect(rule.support).toBe(8)
  })

  it('never conditions on the follow-up field itself', () => {
    const cases = [
      ...dealCases(8, () => ({ createdStatus: 'open', followup: qaReview() })),
      ...dealCases(8, () => ({ createdStatus: 'draft', followup: null }), { offset: 100 }),
    ]
    expect(mine(cases)).toEqual([])
  })
})

describe('suggestionSignature', () => {
  it('is stable across passes (independent of window and statistics) and of the follow-up order', () => {
    const first = mine(dealCases(8, () => ({ followup: qaReview() })))[0]
    const second = mine(dealCases(12, () => ({ followup: qaReview(40 * MINUTE_MS) })))[0]
    expect(second.windowSeconds).not.toBe(first.windowSeconds)
    expect(second.signatureHash).toBe(first.signatureHash)
    const base = { processKey: 'test.deal', trigger: { activityKey: 'created' }, condition: null }
    expect(suggestionSignature({ ...base, followups: [{ field: 'a', value: '1' }, { field: 'b', value: '2' }] }))
      .toBe(suggestionSignature({ ...base, followups: [{ field: 'b', value: '2' }, { field: 'a', value: '1' }] }))
  })

  it('differs by process, trigger, condition and follow-up', () => {
    const base = { processKey: 'test.deal', trigger: { activityKey: 'created' }, condition: null, followups: [{ field: 'status', value: 'won' }] }
    const reference = suggestionSignature(base)
    expect(suggestionSignature({ ...base, processKey: 'test.order' })).not.toBe(reference)
    expect(suggestionSignature({ ...base, trigger: { activityKey: 'status:open' } })).not.toBe(reference)
    expect(suggestionSignature({ ...base, condition: { field: 'stageId', value: 'x' } })).not.toBe(reference)
    expect(suggestionSignature({ ...base, followups: [{ field: 'status', value: 'lost' }] })).not.toBe(reference)
  })

  it('orders suggestions by confidence, then support, deterministically (input order does not matter)', () => {
    const cases = [
      ...dealCases(8, () => ({ followup: qaReview() })),
      ...Array.from({ length: 10 }, (_, position) => {
        const index = 200 + position
        const caseId = caseIdOf(index)
        const start = MINING_NOW - 10 * 86_400_000 + position * HOUR_MS
        const actor = actorOf(position % 3)
        const rows = creation(caseId, MINING_NOW - 40 * 86_400_000, { actor })
        rows.push(stepRow(caseId, { key: 'status:won', atMs: start, actor }))
        rows.push(stepRow(caseId, { key: 'priority:changed', kind: 'followup', field: 'priority', value: 'high', atMs: start + MINUTE_MS, actor }))
        return miningCaseOf(caseId, rows)
      }),
    ]
    const first = mine(cases)
    const second = mine([...cases].reverse())
    expect(first.map((rule) => [rule.trigger.activityKey, rule.followups[0].field, rule.followups[0].value])).toEqual([
      ['status:won', 'priority', 'high'],
      ['created', 'status', 'qa_review'],
    ])
    expect(first[0].followups[0].activityKind).toBe('followup')
    expect(first.map((rule) => rule.signatureHash)).toEqual(second.map((rule) => rule.signatureHash))
    expect(first[0].confidence).toBeGreaterThan(first[1].confidence)
  })
})
