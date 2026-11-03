import { getNestedValue } from '@open-mercato/core/modules/business_rules/lib/value-resolver'
import type { SubjectDocument } from '../../engine/types'
import { AUDIENCE_FIELDS, AUDIENCE_FIELD_GROUPS, findAudienceField, isEditableRule } from '../field-catalog'

/**
 * Every optional key filled on purpose.
 *
 * The point of this document is to answer "does this path exist", so a legitimately absent key would be
 * indistinguishable from a path nobody spelled correctly.
 */
const COMPLETE: SubjectDocument = {
  customer: { id: 'c1', email: 'a@b.c', displayName: 'A B', createdAt: '2026-01-01T00:00:00.000Z', locale: 'pl' },
  tags: ['vip'],
  orders: {
    count: 3,
    totalGross: 900,
    lastPlacedAt: '2026-08-01T00:00:00.000Z',
    daysSinceLast: 30,
    skus: ['SKU-1'],
    categories: ['shoes'],
    channels: ['web'],
    firstPlacedAt: '2026-01-01T00:00:00.000Z',
    averageGross: 300,
  },
  rfm: { recency: 4, frequency: 3, monetary: 5, cell: '435', total: 12 },
  value: {
    averageOrderGross: 300,
    ordersPerYear: 4,
    projectedAnnualGross: 1200,
    projectedHorizonGross: 2400,
    grossPercentile: 80,
  },
  score: { points: 120, tier: 'silver', tierRank: 1 },
  address: { country: 'PL', region: 'DS', city: 'Wroclaw', postalCode: '50-266' },
  survey: { nps: 9, answeredAt: '2026-09-01T00:00:00.000Z' },
  engagement: {
    sent: 10,
    opened: 6,
    clicked: 2,
    lastSentAt: '2026-09-20T00:00:00.000Z',
    lastEngagedAt: '2026-09-21T00:00:00.000Z',
    daysSinceEngaged: 9,
  },
  segments: ['lapsed-vip'],
  trigger: {},
}

/** Exactly what `expression-evaluator.ts` has a case for. A catalogue entry outside this list is a promise nothing keeps. */
const EVALUATOR_OPERATORS = new Set([
  '=', '==', '!=', '>', '>=', '<', '<=',
  'IN', 'NOT_IN', 'CONTAINS', 'NOT_CONTAINS',
  'STARTS_WITH', 'ENDS_WITH', 'MATCHES', 'IS_EMPTY', 'IS_NOT_EMPTY',
])

describe('the audience field catalogue', () => {
  it('offers only paths a subject document actually answers', () => {
    const unresolved = AUDIENCE_FIELDS
      .filter((field) => getNestedValue(COMPLETE, field.path) === undefined)
      .map((field) => field.path)

    // A misspelled path is not a broken screen — it is an audience that silently matches nobody, which is
    // the worst failure this module has, so it fails here instead.
    expect(unresolved).toEqual([])
  })

  it('offers only operators the evaluator implements', () => {
    const unknown = AUDIENCE_FIELDS.flatMap((field) =>
      field.operators.filter((operator) => !EVALUATOR_OPERATORS.has(operator)).map((operator) => `${field.path} ${operator}`))

    expect(unknown).toEqual([])
  })

  it('names each path once', () => {
    const paths = AUDIENCE_FIELDS.map((field) => field.path)
    expect(paths).toHaveLength(new Set(paths).size)
  })

  it('gives every field at least one operator and a group that exists', () => {
    for (const field of AUDIENCE_FIELDS) {
      expect(field.operators.length).toBeGreaterThan(0)
      expect(AUDIENCE_FIELD_GROUPS).toContain(field.group)
    }
  })

  it('attaches an option source to exactly the fields that need one', () => {
    for (const field of AUDIENCE_FIELDS) {
      const needsOptions = field.kind === 'choice' || field.kind === 'inList'
      // A dropdown with nowhere to get its options renders empty, and an author reads that as "we have no
      // segments" rather than "this screen is broken".
      expect(Boolean(field.optionSource)).toBe(needsOptions)
    }
  })

  it('bounds a numeric field only where the bound is real', () => {
    expect(findAudienceField('rfm.recency')).toMatchObject({ min: 1, max: 5 })
    expect(findAudienceField('survey.nps')).toMatchObject({ min: 0, max: 10 })
    // Points have no ceiling, so claiming one would refuse a number somebody legitimately wants.
    expect(findAudienceField('score.points')?.max).toBeUndefined()
  })

  it('admits which rules it cannot edit', () => {
    expect(isEditableRule('orders.count', '>=')).toBe(true)
    // A path nobody catalogued — authored through the raw builder, and still valid.
    expect(isEditableRule('trigger.orderTotal', '>=')).toBe(false)
    // A catalogued path with an operator this field does not offer.
    expect(isEditableRule('orders.count', 'MATCHES')).toBe(false)
  })
})
