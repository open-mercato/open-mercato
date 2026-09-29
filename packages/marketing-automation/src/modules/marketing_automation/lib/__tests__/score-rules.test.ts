import type { EntityManager } from '@mikro-orm/postgresql'
import type { SubjectDocument } from '../engine/types'
import type { ScoreRuleDefinition } from '../score-rules'

jest.mock('../scores', () => ({
  loadRuleScoreState: jest.fn(),
  addScoreEntry: jest.fn(),
}))
jest.mock('../subject-document', () => ({
  buildSubjectDocument: jest.fn(),
}))
jest.mock('../../events', () => ({
  emitMarketingAutomationEvent: jest.fn(),
}))

import { addScoreEntry, loadRuleScoreState } from '../scores'
import { buildSubjectDocument } from '../subject-document'
import { emitMarketingAutomationEvent } from '../../events'
import {
  applyRuleScore,
  computeRuleMatch,
  describeRuleMatch,
  isForbiddenRuleExpression,
} from '../score-rules'

const now = new Date('2026-09-29T10:00:00.000Z')
const scope = { tenantId: 't1', organizationId: 'o1' }
const subjectRow = { current: [{ kind: 'person', erased: false }] as Array<{ kind: string; erased: boolean }> }
const em = { getConnection: () => ({ execute: async () => subjectRow.current }) } as unknown as EntityManager

const mockedState = loadRuleScoreState as jest.MockedFunction<typeof loadRuleScoreState>
const mockedAdd = addScoreEntry as jest.MockedFunction<typeof addScoreEntry>
const mockedBuild = buildSubjectDocument as jest.MockedFunction<typeof buildSubjectDocument>
const mockedEmit = emitMarketingAutomationEvent as jest.MockedFunction<typeof emitMarketingAutomationEvent>

function subject(overrides: Partial<SubjectDocument> = {}): SubjectDocument {
  return {
    customer: { id: 'c1', email: 'someone@example.com', displayName: 'Someone', createdAt: null },
    tags: ['b2b'],
    orders: { count: 3, totalGross: 1200, skus: [] },
    score: { points: 500, tier: 'gold', tierRank: 2 },
    address: { country: 'PL', region: null, city: null, postalCode: null },
    survey: { nps: null, answeredAt: null },
    segments: ['vip'],
    trigger: {},
    ...overrides,
  } as SubjectDocument
}

const tagRule: ScoreRuleDefinition = {
  id: 'r1',
  name: 'B2B',
  points: 20,
  expression: { field: 'tags', operator: 'CONTAINS', value: 'b2b' } as never,
}
const spendRule: ScoreRuleDefinition = {
  id: 'r2',
  name: 'Big spender',
  points: 15,
  expression: { field: 'orders.totalGross', operator: '>=', value: 1000 } as never,
}
const penaltyRule: ScoreRuleDefinition = {
  id: 'r3',
  name: 'Never ordered',
  points: -5,
  expression: { field: 'orders.count', operator: '=', value: 0 } as never,
}

beforeEach(() => {
  jest.clearAllMocks()
  subjectRow.current = [{ kind: 'person', erased: false }]
})

describe('isForbiddenRuleExpression', () => {
  it('refuses a rule that reads the score, at any depth', () => {
    expect(isForbiddenRuleExpression({ field: 'score.points', operator: '>=', value: 10 })).toBe(true)
    expect(isForbiddenRuleExpression({
      operator: 'AND',
      rules: [{ operator: 'OR', rules: [{ field: 'score.tier', operator: '=', value: 'gold' }] }],
    })).toBe(true)
  })

  it('refuses a rule that reads segments, which may themselves be defined on score', () => {
    expect(isForbiddenRuleExpression({ field: 'segments', operator: 'CONTAINS', value: 'vip' })).toBe(true)
  })

  it('accepts everything else, and no condition at all', () => {
    expect(isForbiddenRuleExpression({ field: 'tags', operator: 'CONTAINS', value: 'b2b' })).toBe(false)
    expect(isForbiddenRuleExpression(null)).toBe(false)
  })
})

describe('computeRuleMatch', () => {
  it('sums the points of every matching rule, deductions included', () => {
    const match = computeRuleMatch(subject(), [tagRule, spendRule, penaltyRule], now)
    expect(match.points).toBe(35)
    expect(match.matched.map((rule) => rule.id)).toEqual(['r1', 'r2'])

    const newcomer = computeRuleMatch(subject({ tags: [], orders: { count: 0, totalGross: 0, skus: [] } as never }), [tagRule, spendRule, penaltyRule], now)
    expect(newcomer.points).toBe(-5)
  })

  it('evaluates as if score and segments were empty, whatever an older row says', () => {
    const readsScore: ScoreRuleDefinition = {
      id: 'r4',
      name: 'Gold',
      points: 100,
      expression: { field: 'score.points', operator: '>=', value: 100 } as never,
    }
    const readsSegments: ScoreRuleDefinition = {
      id: 'r5',
      name: 'VIP',
      points: 100,
      expression: { field: 'segments', operator: 'CONTAINS', value: 'vip' } as never,
    }
    expect(computeRuleMatch(subject(), [readsScore, readsSegments], now).points).toBe(0)
  })

  it('treats a rule without a condition as matching everybody', () => {
    const baseline: ScoreRuleDefinition = { id: 'r6', name: 'Baseline', points: 1, expression: null }
    expect(computeRuleMatch(subject(), [baseline], now).points).toBe(1)
  })
})

describe('describeRuleMatch', () => {
  it('names the matching rules with their points', () => {
    expect(describeRuleMatch([
      { id: 'r1', name: 'B2B', points: 20 },
      { id: 'r3', name: 'Never ordered', points: -5 },
    ])).toBe('B2B +20, Never ordered -5')
  })

  it('says nothing when nothing matches, and never runs past one line', () => {
    expect(describeRuleMatch([])).toBeNull()
    const long = describeRuleMatch([{ id: 'r', name: 'x'.repeat(500), points: 1 }])
    expect(long?.length).toBeLessThanOrEqual(200)
  })
})

describe('applyRuleScore', () => {
  it('writes only the difference, at the next sequence number, and announces the crossing', async () => {
    mockedState.mockResolvedValue({ points: 20, entries: 1 })
    mockedBuild.mockResolvedValue(subject())
    mockedAdd.mockResolvedValue({ applied: true, previousPoints: 90, points: 105 })

    const outcome = await applyRuleScore(em, scope, 'c1', now, { rules: [tagRule, spendRule] })

    expect(mockedAdd).toHaveBeenCalledWith(em, expect.objectContaining({
      points: 15,
      source: 'rule',
      ruleSequence: 1,
      reason: 'B2B +20, Big spender +15',
    }))
    expect(mockedEmit).toHaveBeenCalledWith(
      'marketing_automation.customer.score_changed',
      expect.objectContaining({ entityId: 'c1', points: 105, previousPoints: 90, delta: 15, source: 'rule' }),
      { persistent: true },
    )
    expect(outcome).toMatchObject({ applied: true, delta: 15 })
  })

  it('writes nothing when the rules still award what they awarded', async () => {
    mockedState.mockResolvedValue({ points: 35, entries: 2 })
    mockedBuild.mockResolvedValue(subject())

    const outcome = await applyRuleScore(em, scope, 'c1', now, { rules: [tagRule, spendRule] })

    expect(mockedAdd).not.toHaveBeenCalled()
    expect(mockedEmit).not.toHaveBeenCalled()
    expect(outcome.applied).toBe(false)
  })

  it('takes the points back when no rule is left, without building a subject document', async () => {
    mockedState.mockResolvedValue({ points: 35, entries: 2 })
    mockedAdd.mockResolvedValue({ applied: true, previousPoints: 135, points: 100 })

    const outcome = await applyRuleScore(em, scope, 'c1', now, { rules: [] })

    expect(mockedBuild).not.toHaveBeenCalled()
    expect(mockedAdd).toHaveBeenCalledWith(em, expect.objectContaining({ points: -35, ruleSequence: 2, reason: null }))
    expect(outcome.delta).toBe(-35)
  })

  it('stays silent when an overlapping evaluation claimed the sequence number first', async () => {
    mockedState.mockResolvedValue({ points: 0, entries: 0 })
    mockedBuild.mockResolvedValue(subject())
    mockedAdd.mockResolvedValue({ applied: false, previousPoints: 20, points: 20 })

    const outcome = await applyRuleScore(em, scope, 'c1', now, { rules: [tagRule] })

    expect(mockedEmit).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ applied: false, delta: 0 })
  })

  it('never touches a customer that no longer exists', async () => {
    mockedState.mockResolvedValue({ points: 20, entries: 1 })
    mockedBuild.mockResolvedValue(subject({ customer: null }))

    const outcome = await applyRuleScore(em, scope, 'gone', now, { rules: [tagRule] })

    expect(mockedAdd).not.toHaveBeenCalled()
    expect(outcome.applied).toBe(false)
  })

  it('never scores an erased person, a company or a customer that is gone — and says so without writing', async () => {
    for (const row of [[{ kind: 'person', erased: true }], [{ kind: 'company', erased: false }], []]) {
      subjectRow.current = row
      const outcome = await applyRuleScore(em, scope, 'c1', now, { rules: [tagRule] })
      expect(outcome.applied).toBe(false)
    }
    expect(mockedState).not.toHaveBeenCalled()
    expect(mockedBuild).not.toHaveBeenCalled()
    expect(mockedAdd).not.toHaveBeenCalled()
  })
})
