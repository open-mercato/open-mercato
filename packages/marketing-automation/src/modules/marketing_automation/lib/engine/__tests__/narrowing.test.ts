import { describeNarrowing, planNarrowing, recencyBounds } from '../narrowing'
import type { Narrowing } from '../narrowing'
import { matchesAudience } from '../audience'
import type { SubjectDocument } from '../types'
import type { ConditionExpression } from '@open-mercato/core/modules/business_rules/lib/expression-evaluator'

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
const NOW = new Date('2026-09-28T12:00:00.000Z')
const MS_PER_DAY = 86_400_000

const leaf = (field: string, operator: string, value?: unknown): ConditionExpression =>
  ({ field, operator, value } as ConditionExpression)
const group = (operator: 'AND' | 'OR' | 'NOT', rules: ConditionExpression[]): ConditionExpression =>
  ({ operator, rules } as ConditionExpression)

/**
 * The narrowing, interpreted in memory exactly as the SQL interprets it.
 *
 * This mirror is what makes the superset property testable without a database: the resolver's
 * queries return the customers this predicate is true for, including the part that is easy to
 * forget — the aggregate query can only return customers who have orders at all.
 */
function satisfiesNarrowing(narrowing: Narrowing, subject: SubjectDocument): boolean {
  switch (narrowing.kind) {
    case 'all':
      return true
    case 'none':
      return false
    case 'and':
      return narrowing.parts.every((part) => satisfiesNarrowing(part, subject))
    case 'or':
      return narrowing.parts.some((part) => satisfiesNarrowing(part, subject))
    case 'predicate': {
      const predicate = narrowing.predicate
      if (predicate.kind === 'hasTag') return subject.tags.includes(predicate.slug)
      if (predicate.kind === 'hasAnyTag') return subject.tags.length > 0
      if (predicate.kind === 'scorePoints') {
        // The ledger query can only return customers who HAVE entries, and a customer with no
        // entries has a total of zero — the same shape as the order aggregate below.
        if (subject.score.points === 0) return false
        switch (predicate.op) {
          case '=': return subject.score.points === predicate.value
          case '>': return subject.score.points > predicate.value
          case '>=': return subject.score.points >= predicate.value
          case '<': return subject.score.points < predicate.value
          case '<=': return subject.score.points <= predicate.value
        }
        return true
      }
      if (subject.orders.count === 0) return false
      if (predicate.metric === 'daysSinceLast') {
        if (subject.orders.lastPlacedAt === undefined) return false
        const daysAgo = (NOW.getTime() - new Date(subject.orders.lastPlacedAt).getTime()) / MS_PER_DAY
        const bounds = recencyBounds(predicate.op, predicate.value)
        if (bounds.minDaysAgo !== undefined && daysAgo < bounds.minDaysAgo) return false
        if (bounds.maxDaysAgo !== undefined && daysAgo > bounds.maxDaysAgo) return false
        return true
      }
      const actual = predicate.metric === 'count' ? subject.orders.count : subject.orders.totalGross
      switch (predicate.op) {
        case '=': return actual === predicate.value
        case '>': return actual > predicate.value
        case '>=': return actual >= predicate.value
        case '<': return actual < predicate.value
        case '<=': return actual <= predicate.value
      }
      return true
    }
  }
}

function subjectOf(input: {
  tags?: string[]
  count?: number
  totalGross?: number
  daysAgo?: number | null
  points?: number
}): SubjectDocument {
  const orders: SubjectDocument['orders'] = {
    count: input.count ?? 0,
    totalGross: input.totalGross ?? 0,
  }
  if (input.daysAgo !== undefined && input.daysAgo !== null) {
    const placedAt = new Date(NOW.getTime() - input.daysAgo * MS_PER_DAY)
    orders.lastPlacedAt = placedAt.toISOString()
    orders.daysSinceLast = Math.max(0, Math.floor((NOW.getTime() - placedAt.getTime()) / MS_PER_DAY))
  }
  return {
    customer: { id: 'c1', email: null, displayName: null, createdAt: null },
    tags: input.tags ?? [],
    orders,
    score: { points: input.points ?? 0 },
    trigger: {},
  }
}

describe('planNarrowing — what can be pushed', () => {
  test('no audience is everyone, exactly', () => {
    expect(planNarrowing(null)).toEqual({ narrowing: { kind: 'all' }, complete: true, pushed: [] })
  })

  test('a tag membership becomes a tag lookup', () => {
    const plan = planNarrowing(leaf('tags', 'CONTAINS', 'vip'))
    expect(plan.narrowing).toEqual({ kind: 'predicate', predicate: { kind: 'hasTag', slug: 'vip' } })
    expect(plan.complete).toBe(true)
  })

  test('"has any tag" becomes a lookup, "has no tag" does not', () => {
    expect(planNarrowing(leaf('tags', 'IS_NOT_EMPTY')).narrowing.kind).toBe('predicate')
    expect(planNarrowing(leaf('tags', 'IS_EMPTY')).narrowing.kind).toBe('all')
    expect(planNarrowing(leaf('tags', 'NOT_CONTAINS', 'vip')).narrowing.kind).toBe('all')
  })

  test('order aggregates become aggregate comparisons', () => {
    const plan = planNarrowing(leaf('orders.totalGross', '>=', 1000))
    expect(plan.narrowing).toEqual({
      kind: 'predicate',
      predicate: { kind: 'orderMetric', metric: 'totalGross', op: '>=', value: 1000 },
    })
    expect(plan.complete).toBe(true)
  })

  test('a recency bound is pushed but never claimed as exact, because it is widened', () => {
    const plan = planNarrowing(leaf('orders.daysSinceLast', '>=', 90))
    expect(plan.narrowing.kind).toBe('predicate')
    expect(plan.complete).toBe(false)
  })

  // The subtlest rule in the planner. The aggregate query cannot return a customer with no orders,
  // so any comparison that a never-buyer satisfies must not be pushed down at all.
  test.each([
    ['orders.count', '<=', 5],
    ['orders.count', '<', 3],
    ['orders.count', '=', 0],
    ['orders.count', '>=', 0],
    ['orders.count', '>', -1],
    ['orders.totalGross', '=', 0],
    ['orders.totalGross', '>=', 0],
    ['orders.totalGross', '<=', 100],
  ])('does not push %s %s %s, which a never-buyer satisfies', (field, operator, value) => {
    expect(planNarrowing(leaf(field, operator, value)).narrowing.kind).toBe('all')
  })

  test.each([
    ['orders.count', '>=', 1],
    ['orders.count', '>', 0],
    ['orders.count', '=', 3],
    ['orders.totalGross', '>', 0],
    ['orders.totalGross', '>=', 500],
  ])('pushes %s %s %s, which implies an order exists', (field, operator, value) => {
    expect(planNarrowing(leaf(field, operator, value)).narrowing.kind).toBe('predicate')
  })

  test.each([
    ['score.points', '>=', 1],
    ['score.points', '>', 0],
    ['score.points', '=', 50],
  ])('pushes %s %s %s', (field, operator, value) => {
    expect(planNarrowing(leaf(field, operator, value)).narrowing).toEqual({
      kind: 'predicate',
      predicate: { kind: 'scorePoints', op: operator === '==' ? '=' : operator, value },
    })
  })

  // A customer who never scored has a total of zero, and the ledger has no row for them — the same
  // trap as the order aggregates, and the same rule.
  test.each([
    ['score.points', '<=', 10],
    ['score.points', '<', 5],
    ['score.points', '=', 0],
    ['score.points', '>=', 0],
  ])('does not push %s %s %s, which a never-scored customer satisfies', (field, operator, value) => {
    expect(planNarrowing(leaf(field, operator, value)).narrowing.kind).toBe('all')
  })

  test('a field the database cannot answer is left to the per-subject check', () => {
    expect(planNarrowing(leaf('trigger.orderTotal', '>=', 100)).narrowing.kind).toBe('all')
    expect(planNarrowing(leaf('customer.email', 'CONTAINS', '@example.com')).narrowing.kind).toBe('all')
    expect(planNarrowing(leaf('orders.lastPlacedAt', '<', '2026-01-01')).narrowing.kind).toBe('all')
  })

  test('a template value is not a number', () => {
    expect(planNarrowing(leaf('orders.count', '>=', '{{threshold}}')).narrowing.kind).toBe('all')
  })

  test('a numeric string is', () => {
    expect(planNarrowing(leaf('orders.count', '>=', '2')).narrowing.kind).toBe('predicate')
  })
})

describe('planNarrowing — combining', () => {
  test('AND intersects what it can and ignores what it cannot', () => {
    const plan = planNarrowing(group('AND', [
      leaf('tags', 'CONTAINS', 'vip'),
      leaf('trigger.source', '=', 'newsletter'),
      leaf('orders.count', '>=', 2),
    ]))
    expect(plan.narrowing.kind).toBe('and')
    expect(plan.pushed).toHaveLength(2)
    // A leaf was dropped, so the narrowing is a superset and cannot be counted as the audience.
    expect(plan.complete).toBe(false)
  })

  test('an AND of only pushable leaves is exact', () => {
    const plan = planNarrowing(group('AND', [
      leaf('tags', 'CONTAINS', 'vip'),
      leaf('orders.totalGross', '>=', 100),
    ]))
    expect(plan.complete).toBe(true)
  })

  // Unioning the branches we understand would be TOO TIGHT: a subject matching only the branch we
  // could not express would never be projected and never be mailed.
  test('one untranslatable branch makes the whole OR untranslatable', () => {
    const plan = planNarrowing(group('OR', [
      leaf('tags', 'CONTAINS', 'vip'),
      leaf('trigger.source', '=', 'newsletter'),
    ]))
    expect(plan.narrowing.kind).toBe('all')
    expect(plan.complete).toBe(false)
  })

  test('an OR of pushable branches becomes a union', () => {
    const plan = planNarrowing(group('OR', [
      leaf('tags', 'CONTAINS', 'vip'),
      leaf('orders.totalGross', '>=', 1000),
    ]))
    expect(plan.narrowing.kind).toBe('or')
    expect(plan.complete).toBe(true)
  })

  test('NOT is never translated', () => {
    expect(planNarrowing(group('NOT', [leaf('tags', 'CONTAINS', 'vip')])).narrowing.kind).toBe('all')
  })

  test('a NOT nested in an AND only costs that branch', () => {
    const plan = planNarrowing(group('AND', [
      leaf('tags', 'CONTAINS', 'vip'),
      group('NOT', [leaf('tags', 'CONTAINS', 'churned')]),
    ]))
    expect(plan.narrowing).toEqual({ kind: 'predicate', predicate: { kind: 'hasTag', slug: 'vip' } })
    expect(plan.complete).toBe(false)
  })

  test('an empty group matches nobody, so there is nothing to sweep', () => {
    const plan = planNarrowing(group('AND', []))
    expect(plan.narrowing).toEqual({ kind: 'none' })
    expect(plan.complete).toBe(true)
  })

  test('a nested group is planned recursively', () => {
    const plan = planNarrowing(group('AND', [
      leaf('orders.count', '>=', 1),
      group('OR', [leaf('tags', 'CONTAINS', 'vip'), leaf('tags', 'CONTAINS', 'wholesale')]),
    ]))
    expect(plan.narrowing.kind).toBe('and')
    expect(plan.pushed.map((predicate) => predicate.kind)).toEqual(['orderMetric', 'hasTag', 'hasTag'])
    expect(plan.complete).toBe(true)
  })
})

/**
 * The property the whole design rests on: the narrowing is a SUPERSET.
 *
 * A narrowing that is merely imprecise wastes a few projections. One that is too tight silently
 * stops mailing customers who qualify, and nothing in the system would report it — so this asserts
 * it over the full cross-product of realistic audiences and subjects rather than on examples.
 */
describe('the narrowing never excludes a subject the audience accepts', () => {
  const audiences: Array<[string, ConditionExpression]> = [
    ['vip tag', leaf('tags', 'CONTAINS', 'vip')],
    ['any tag', leaf('tags', 'IS_NOT_EMPTY')],
    ['no tag', leaf('tags', 'IS_EMPTY')],
    ['not vip', leaf('tags', 'NOT_CONTAINS', 'vip')],
    ['has ordered', leaf('orders.count', '>=', 1)],
    ['exactly three orders', leaf('orders.count', '=', 3)],
    ['at most two orders', leaf('orders.count', '<=', 2)],
    ['never ordered', leaf('orders.count', '=', 0)],
    ['big spender', leaf('orders.totalGross', '>=', 500)],
    ['small spender', leaf('orders.totalGross', '<', 100)],
    ['dormant 90 days', leaf('orders.daysSinceLast', '>=', 90)],
    ['dormant 30 days', leaf('orders.daysSinceLast', '>', 30)],
    ['recent 7 days', leaf('orders.daysSinceLast', '<=', 7)],
    ['exactly 45 days ago', leaf('orders.daysSinceLast', '=', 45)],
    ['win-back', group('AND', [leaf('orders.count', '>=', 1), leaf('orders.daysSinceLast', '>=', 90)])],
    ['vip win-back', group('AND', [
      leaf('tags', 'CONTAINS', 'vip'),
      leaf('orders.daysSinceLast', '>=', 60),
      leaf('orders.totalGross', '>=', 200),
    ])],
    ['vip or big spender', group('OR', [leaf('tags', 'CONTAINS', 'vip'), leaf('orders.totalGross', '>=', 1000)])],
    ['vip or newsletter', group('OR', [leaf('tags', 'CONTAINS', 'vip'), leaf('trigger.source', '=', 'newsletter')])],
    ['vip and not churned', group('AND', [
      leaf('tags', 'CONTAINS', 'vip'),
      group('NOT', [leaf('tags', 'CONTAINS', 'churned')]),
    ])],
    ['nested', group('AND', [
      leaf('orders.count', '>=', 1),
      group('OR', [leaf('tags', 'CONTAINS', 'vip'), leaf('orders.daysSinceLast', '<=', 7)]),
    ])],
    ['scored at all', leaf('score.points', '>=', 1)],
    ['hot lead', leaf('score.points', '>=', 100)],
    ['cold lead', leaf('score.points', '<=', 10)],
    ['never scored', leaf('score.points', '=', 0)],
    ['negative score', leaf('score.points', '<', 0)],
    ['hot vip', group('AND', [leaf('score.points', '>=', 50), leaf('tags', 'CONTAINS', 'vip')])],
  ]

  const subjects: SubjectDocument[] = []
  for (const tags of [[], ['vip'], ['churned'], ['vip', 'churned'], ['wholesale']]) {
    for (const [count, totalGross] of [[0, 0], [1, 0], [1, 99.99], [3, 500], [12, 4200]] as const) {
      for (const daysAgo of count === 0 ? [null] : [0, 1, 7, 30, 44, 45, 46, 60, 89, 90, 91, 400]) {
        for (const points of [0, 1, 10, 99, 100, 101, -5]) {
          subjects.push(subjectOf({ tags, count, totalGross, daysAgo, points }))
        }
      }
    }
  }

  const describeSubject = (subject: SubjectDocument) =>
    `tags=[${subject.tags.join(',')}] orders=${JSON.stringify(subject.orders)}`

  test.each(audiences)('%s', (_label, audience) => {
    const plan = planNarrowing(audience)
    const excluded: string[] = []
    let matched = 0
    for (const subject of subjects) {
      if (!matchesAudience(audience, subject, { now: NOW, logger })) continue
      matched += 1
      if (!satisfiesNarrowing(plan.narrowing, subject)) excluded.push(describeSubject(subject))
    }
    // Listed rather than asserted one by one, so a failure names every subject that would stop
    // being mailed instead of only the first.
    expect(excluded).toEqual([])
    // A test that matched nothing would assert nothing.
    expect(matched).toBeGreaterThan(0)
  })

  test('a complete plan is not merely a superset — it matches the audience exactly', () => {
    const disagreements: string[] = []
    for (const [label, audience] of audiences) {
      const plan = planNarrowing(audience)
      if (!plan.complete) continue
      for (const subject of subjects) {
        const narrowed = satisfiesNarrowing(plan.narrowing, subject)
        const matches = matchesAudience(audience, subject, { now: NOW, logger })
        if (narrowed !== matches) disagreements.push(`${label}: ${describeSubject(subject)}`)
      }
    }
    expect(disagreements).toEqual([])
  })
})

describe('recencyBounds', () => {
  test('"at least N days ago" widens towards the present', () => {
    expect(recencyBounds('>=', 90)).toEqual({ minDaysAgo: 89 })
    expect(recencyBounds('>', 30)).toEqual({ minDaysAgo: 29 })
  })

  test('"at most N days ago" widens away from the present', () => {
    expect(recencyBounds('<=', 7)).toEqual({ maxDaysAgo: 9 })
  })

  test('equality becomes a window widened on both sides', () => {
    expect(recencyBounds('=', 45)).toEqual({ minDaysAgo: 44, maxDaysAgo: 47 })
  })

  test('never asks for a negative age', () => {
    expect(recencyBounds('>=', 0).minDaysAgo).toBe(0)
  })
})

describe('describeNarrowing', () => {
  test('summarises what went to the database', () => {
    expect(describeNarrowing(planNarrowing(null))).toBe('all')
    expect(describeNarrowing(planNarrowing(group('AND', [])))).toBe('none')
    expect(describeNarrowing(planNarrowing(group('AND', [
      leaf('tags', 'CONTAINS', 'vip'),
      leaf('orders.daysSinceLast', '>=', 90),
    ])))).toBe('tag:vip&orders.daysSinceLast>=90')
  })
})

/**
 * The crossing semantics the score trigger rests on.
 *
 * `score_changed` carries the PREVIOUS total precisely so an author can say "reached 100 points"
 * rather than "is above 100 points". Without it a campaign would fire again on every later change
 * while the customer stayed above the threshold, which is the difference between a milestone email
 * and a nuisance.
 */
describe('reaching a score threshold, expressed in an audience', () => {
  const reachedAHundred = group('AND', [
    leaf('trigger.previousPoints', '<', 100),
    leaf('score.points', '>=', 100),
  ])

  const scoredSubject = (points: number, previousPoints: number): SubjectDocument => ({
    customer: { id: 'c1', email: null, displayName: null, createdAt: null },
    tags: [],
    orders: { count: 0, totalGross: 0 },
    score: { points },
    trigger: { points, previousPoints, delta: points - previousPoints },
  })

  test('fires on the change that crosses the threshold', () => {
    expect(matchesAudience(reachedAHundred, scoredSubject(105, 95), { now: NOW, logger })).toBe(true)
  })

  test('does not fire again once the customer is already above it', () => {
    expect(matchesAudience(reachedAHundred, scoredSubject(130, 105), { now: NOW, logger })).toBe(false)
  })

  test('does not fire below the threshold', () => {
    expect(matchesAudience(reachedAHundred, scoredSubject(60, 20), { now: NOW, logger })).toBe(false)
  })

  test('fires again after a deduction dropped them below and they came back', () => {
    expect(matchesAudience(reachedAHundred, scoredSubject(100, 80), { now: NOW, logger })).toBe(true)
  })

  // The narrowing can only push the score half; the previous-total half is per-subject by nature,
  // so the plan must report itself as a superset rather than exact.
  test('the narrowing pushes the score half and stays a superset', () => {
    const plan = planNarrowing(reachedAHundred)
    expect(plan.pushed).toEqual([{ kind: 'scorePoints', op: '>=', value: 100 }])
    expect(plan.complete).toBe(false)
  })
})
