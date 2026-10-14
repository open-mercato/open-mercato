import {
  SEGMENTS_FIELD,
  expressionReferencesField,
  isSelfReferentialSegment,
  isValidSegmentSlug,
  slugifySegmentName,
} from '../engine/segment-expression'
import { computeSegmentSlugs, namesForSlugs } from '../segments'
import { planNarrowing } from '../engine/narrowing'
import type { SubjectDocument } from '../engine/types'

const now = new Date('2026-09-29T10:00:00.000Z')

function subject(overrides: Partial<SubjectDocument> = {}): SubjectDocument {
  return {
    customer: { id: 'c1', email: 'someone@example.com', displayName: 'Someone', createdAt: null },
    tags: [],
    orders: { count: 0, totalGross: 0, skus: [] },
    score: { points: 0, tier: 'bronze', tierRank: 0 },
    address: null,
    survey: { nps: null, answeredAt: null },
    segments: [],
    trigger: {},
    ...overrides,
  }
}

describe('slugifySegmentName', () => {
  it('produces a usable reference', () => {
    expect(slugifySegmentName('Lapsed VIP customers')).toBe('lapsed-vip-customers')
    expect(isValidSegmentSlug(slugifySegmentName('Lapsed VIP customers'))).toBe(true)
  })

  it('never produces an empty reference', () => {
    // A name with nothing sluggable in it still has to resolve to something.
    expect(slugifySegmentName('日本語')).toBe('segment')
    expect(slugifySegmentName('   ---  ')).toBe('segment')
  })

  it('caps the length', () => {
    expect(slugifySegmentName('x'.repeat(200)).length).toBeLessThanOrEqual(64)
  })
})

describe('expressionReferencesField', () => {
  it('finds a field at the top level and inside nested groups', () => {
    expect(expressionReferencesField({ operator: 'AND', rules: [{ field: 'tags', operator: 'CONTAINS', value: 'vip' }] }, 'tags')).toBe(true)
    expect(expressionReferencesField({
      operator: 'AND',
      rules: [{ operator: 'OR', rules: [{ field: 'segments', operator: 'CONTAINS', value: 'x' }] }],
    }, SEGMENTS_FIELD)).toBe(true)
  })

  it('matches a dotted path under the field', () => {
    expect(expressionReferencesField({ field: 'segments.slug' }, SEGMENTS_FIELD)).toBe(true)
  })

  it('does not match a different field that starts the same way', () => {
    expect(expressionReferencesField({ field: 'segmentsomething' }, SEGMENTS_FIELD)).toBe(false)
  })

  it('handles the shapes this expression format has had', () => {
    for (const key of ['rules', 'conditions', 'children', 'groups', 'any', 'all']) {
      expect(expressionReferencesField({ [key]: [{ field: 'segments' }] }, SEGMENTS_FIELD)).toBe(true)
    }
  })

  it('says no for null, scalars and empty trees', () => {
    for (const value of [null, undefined, 'segments', 42, {}, []]) {
      expect(expressionReferencesField(value, SEGMENTS_FIELD)).toBe(false)
    }
  })
})

describe('isSelfReferentialSegment', () => {
  it('refuses a segment defined in terms of segments', () => {
    // Nesting segments invites a cycle, and a cycle here is a stack overflow inside a dispatch.
    expect(isSelfReferentialSegment({ operator: 'AND', rules: [{ field: 'segments', operator: 'CONTAINS', value: 'vip' }] })).toBe(true)
  })

  it('allows every other expression', () => {
    expect(isSelfReferentialSegment({ operator: 'AND', rules: [{ field: 'tags', operator: 'CONTAINS', value: 'vip' }] })).toBe(false)
    expect(isSelfReferentialSegment(null)).toBe(false)
  })
})

describe('computeSegmentSlugs', () => {
  const definitions = [
    { id: '1', slug: 'vip', name: 'VIP', expression: { operator: 'AND', rules: [{ field: 'tags', operator: 'CONTAINS', value: 'vip' }] } },
    { id: '2', slug: 'buyers', name: 'Buyers', expression: { operator: 'AND', rules: [{ field: 'orders.count', operator: '>=', value: 1 }] } },
    { id: '3', slug: 'everybody', name: 'Everybody', expression: null },
  ] as never[]

  it('returns the slugs whose expressions match', () => {
    const slugs = computeSegmentSlugs(subject({ tags: ['vip'] }), definitions, now)
    // `everybody` has no expression, which means everybody — a legitimate thing to name and reuse.
    expect(slugs).toEqual(['vip', 'everybody'])
  })

  it('includes a segment whose condition the customer meets', () => {
    const slugs = computeSegmentSlugs(subject({ orders: { count: 3, totalGross: 100, skus: [] } }), definitions, now)
    expect(slugs).toContain('buyers')
  })

  it('is empty when nothing is defined', () => {
    expect(computeSegmentSlugs(subject(), [], now)).toEqual([])
  })

  it('evaluates against a document whose segments key is empty, whatever was passed in', () => {
    const referencesSegments = [
      { id: '4', slug: 'nested', name: 'Nested', expression: { operator: 'AND', rules: [{ field: 'segments', operator: 'CONTAINS', value: 'vip' }] } },
    ] as never[]
    // The writer refuses such a definition; this makes the refusal unnecessary to trust, because an old row
    // cannot make membership depend on membership.
    const slugs = computeSegmentSlugs(subject({ segments: ['vip'] }), referencesSegments, now)
    expect(slugs).toEqual([])
  })

  it('never lets one broken definition hide the others', () => {
    const broken = [
      { id: '5', slug: 'broken', name: 'Broken', expression: { operator: 'AND', rules: [{ field: 'tags', operator: 'nonsense', value: 1 }] } },
      ...definitions,
    ] as never[]
    expect(computeSegmentSlugs(subject({ tags: ['vip'] }), broken, now)).toContain('vip')
  })
})

describe('namesForSlugs', () => {
  it('maps to names, and falls back to the slug for one that no longer exists', () => {
    const definitions = [{ id: '1', slug: 'vip', name: 'VIP', expression: null }] as never[]
    expect(namesForSlugs(definitions, ['vip', 'gone'])).toEqual(['VIP', 'gone'])
  })
})

describe('narrowing and segments', () => {
  it('never pushes a segment comparison down to SQL', () => {
    /**
     * Membership is computed from the subject document, so there is nothing in the database to query. The
     * planner must therefore treat it as unconstrained — a superset — rather than as something it can express.
     */
    const plan = planNarrowing({
      operator: 'AND',
      rules: [{ field: 'segments', operator: 'CONTAINS', value: 'vip' }],
    } as never)
    expect(plan.narrowing.kind).toBe('all')
    expect(plan.complete).toBe(false)
  })

  it('still pushes the parts it can when a segment is one of several conditions', () => {
    const plan = planNarrowing({
      operator: 'AND',
      rules: [
        { field: 'segments', operator: 'CONTAINS', value: 'vip' },
        { field: 'tags', operator: 'CONTAINS', value: 'newsletter' },
      ],
    } as never)
    // The tag narrows the candidate set; the segment is decided per customer. Still a superset.
    expect(plan.narrowing.kind).toBe('predicate')
    expect(plan.complete).toBe(false)
  })
})
